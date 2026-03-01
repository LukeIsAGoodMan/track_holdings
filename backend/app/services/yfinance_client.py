"""
Alpha Vantage async wrapper — Phase 12b High-Availability patch.

Smart SWR (Stale-While-Revalidate) cache:
  Fresh hit  (<120s)  → instant return.
  Stale hit  (120s–1h) → instant return + background refresh scheduled.
  First hit  (empty)   → block up to 5s for real data, then give up.
  Zero-Value Guard     → never return None/0 when old data exists.

Rate limiting : 5 calls / 60 seconds (Alpha Vantage free tier).
HTTP timeout  : 5 seconds per request (fail fast).
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal

import requests

from app.config import settings
from app.services.black_scholes import compute_historical_vol, DEFAULT_SIGMA

logger = logging.getLogger(__name__)

# ── Alpha Vantage config ──────────────────────────────────────────────────
_BASE_URL = "https://www.alphavantage.co/query"
_API_KEY = settings.alpha_vantage_api_key
_HTTP_TIMEOUT = 5  # seconds — fail fast

# ── Symbol mapping (Yahoo-style → Alpha Vantage) ─────────────────────────
_SYMBOL_MAP: dict[str, str] = {
    "^GSPC": "SPY",   # S&P 500 → ETF proxy
    "^VIX":  "VIX",   # CBOE VIX
}


def _av_symbol(sym: str) -> str:
    """Map Yahoo-style symbols to Alpha Vantage equivalents."""
    return _SYMBOL_MAP.get(sym.upper(), sym.upper())


# ── Rate limiter (5 calls / 60 seconds) ──────────────────────────────────
_call_times: deque[float] = deque(maxlen=5)
_rate_lock = threading.Lock()
_RATE_LIMIT = 5
_RATE_WINDOW = 60.0


def _wait_for_rate_limit() -> None:
    """Block (outside lock) until a rate-limit slot is available."""
    while True:
        with _rate_lock:
            now = time.monotonic()
            while _call_times and _call_times[0] < now - _RATE_WINDOW:
                _call_times.popleft()
            if len(_call_times) < _RATE_LIMIT:
                _call_times.append(now)
                return
            wait_time = _RATE_WINDOW - (now - _call_times[0]) + 0.1
        time.sleep(min(wait_time, 30.0))


def _try_rate_limit() -> bool:
    """Non-blocking: acquire a slot if available, else return False."""
    with _rate_lock:
        now = time.monotonic()
        while _call_times and _call_times[0] < now - _RATE_WINDOW:
            _call_times.popleft()
        if len(_call_times) < _RATE_LIMIT:
            _call_times.append(now)
            return True
        return False


# ── Two-tier SWR cache ────────────────────────────────────────────────────
# _cache stores (value, monotonic_timestamp).
# Fresh window = _CACHE_TTL (120s).  Stale window = _STALE_TTL (1h).
# Zero-Value Guard: _last_known stores the very last good value per key
# and NEVER expires — used as ultimate fallback when AV is down.

_cache: dict[str, tuple[object, float]] = {}
_last_known: dict[str, object] = {}          # zero-value guard
_cache_lock = threading.Lock()
_CACHE_TTL: float = float(settings.av_cache_ttl)   # 120s
_STALE_TTL: float = 3600.0                         # 1h


def _get_fresh(key: str) -> object | None:
    """Return value only if within the fresh TTL."""
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.monotonic() - entry[1]) < _CACHE_TTL:
            return entry[0]
    return None


def _get_stale(key: str) -> object | None:
    """Return value if within the stale TTL (up to 1h old)."""
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.monotonic() - entry[1]) < _STALE_TTL:
            return entry[0]
    return None


def _get_last_known(key: str) -> object | None:
    """Zero-Value Guard: return the very last known good value (never expires)."""
    with _cache_lock:
        return _last_known.get(key)


def _is_fresh(key: str) -> bool:
    with _cache_lock:
        entry = _cache.get(key)
        return bool(entry and (time.monotonic() - entry[1]) < _CACHE_TTL)


def _set_cached(key: str, value: object) -> None:
    """Store value in both timed cache and permanent last-known store."""
    with _cache_lock:
        _cache[key] = (value, time.monotonic())
        _last_known[key] = value


# ── Background refresh (single-thread executor) ──────────────────────────
_bg_pending: set[str] = set()
_bg_lock = threading.Lock()
_refresh_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="av-bg")


def _schedule_bg_refresh(cache_key: str, fn: object, *args: object) -> None:
    """Submit a background refresh if not already pending for this key."""
    with _bg_lock:
        if cache_key in _bg_pending:
            return
        _bg_pending.add(cache_key)

    def _run() -> None:
        try:
            fn(*args)
        except Exception:
            logger.exception("BG refresh failed: %s", cache_key)
        finally:
            with _bg_lock:
                _bg_pending.discard(cache_key)

    _refresh_pool.submit(_run)


# ── HTTP helpers (5s timeout) ─────────────────────────────────────────────
_session = requests.Session()
_session.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
})


def _av_get(params: dict) -> dict | None:
    """Rate-limited GET to Alpha Vantage.  5s timeout."""
    _wait_for_rate_limit()
    params["apikey"] = _API_KEY
    try:
        resp = _session.get(_BASE_URL, params=params, timeout=_HTTP_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        if "Error Message" in data:
            logger.warning("AV error: %s", data["Error Message"])
            return None
        if "Note" in data:
            logger.warning("AV rate-limit note: %s", data["Note"])
            return None
        return data
    except requests.Timeout:
        logger.warning("AV timeout (>%ds) for %s", _HTTP_TIMEOUT, params.get("symbol"))
        return None
    except Exception:
        logger.exception("AV request failed")
        return None


def _av_get_nonblocking(params: dict) -> dict | None:
    """Non-blocking: skip if rate-limited.  5s timeout."""
    if not _try_rate_limit():
        return None
    params["apikey"] = _API_KEY
    try:
        resp = _session.get(_BASE_URL, params=params, timeout=_HTTP_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        if "Error Message" in data:
            logger.warning("AV error: %s", data["Error Message"])
            return None
        if "Note" in data:
            logger.warning("AV rate-limit note: %s", data["Note"])
            return None
        return data
    except requests.Timeout:
        logger.warning("AV timeout (>%ds) for %s", _HTTP_TIMEOUT, params.get("symbol"))
        return None
    except Exception:
        logger.exception("AV request failed")
        return None


# ── Internal _do_* helpers (actually hit the network) ─────────────────────

def _do_fetch_spot(upper: str) -> Decimal | None:
    sym = _av_symbol(upper)
    data = _av_get({"function": "GLOBAL_QUOTE", "symbol": sym})
    if not data or "Global Quote" not in data:
        return None
    price_str = data["Global Quote"].get("05. price")
    if not price_str:
        return None
    try:
        price = Decimal(price_str).quantize(Decimal("0.0001"))
        if price > 0:
            _set_cached(f"spot:{upper}", price)
            return price
    except Exception:
        pass
    return None


def _do_fetch_daily_series(ticker: str, full: bool = False) -> dict[str, dict] | None:
    size = "full" if full else "compact"
    cache_key = f"daily:{ticker}:{size}"
    sym = _av_symbol(ticker)
    data = _av_get({
        "function": "TIME_SERIES_DAILY",
        "symbol": sym,
        "outputsize": size,
    })
    if not data or "Time Series (Daily)" not in data:
        return None
    ts = data["Time Series (Daily)"]
    _set_cached(cache_key, ts)
    return ts


def _do_fetch_hist_vol(upper: str) -> Decimal:
    ts = _get_daily_series_swr(upper, full=False)
    if not ts:
        return DEFAULT_SIGMA
    sorted_dates = sorted(ts.keys(), reverse=True)[:30]
    if len(sorted_dates) < 5:
        return DEFAULT_SIGMA
    closes: list[float] = []
    for d in reversed(sorted_dates):
        try:
            closes.append(float(ts[d]["4. close"]))
        except (KeyError, ValueError):
            pass
    if len(closes) < 5:
        return DEFAULT_SIGMA
    vol = compute_historical_vol(closes)
    _set_cached(f"hvol:{upper}", vol)
    return vol


def _do_fetch_1y_closes(upper: str) -> list[float]:
    ts = _do_fetch_daily_series(upper, full=True)
    if not ts:
        return []
    sorted_dates = sorted(ts.keys(), reverse=True)[:252]
    closes: list[float] = []
    for d in reversed(sorted_dates):
        try:
            closes.append(float(ts[d]["4. close"]))
        except (KeyError, ValueError):
            pass
    if closes:
        _set_cached(f"1y:{upper}", closes)
    return closes


# ── SWR wrappers called by the public API ─────────────────────────────────

def _get_daily_series_swr(ticker: str, full: bool = False) -> dict[str, dict] | None:
    """SWR for daily series: fresh → stale+bg → first-hit block → last_known."""
    size = "full" if full else "compact"
    cache_key = f"daily:{ticker.upper()}:{size}"

    fresh = _get_fresh(cache_key)
    if fresh is not None:
        return fresh

    stale = _get_stale(cache_key)
    if stale is not None:
        _schedule_bg_refresh(cache_key, _do_fetch_daily_series, ticker.upper(), full)
        return stale

    # First hit — block up to 5s
    result = _do_fetch_daily_series(ticker.upper(), full)
    if result is not None:
        return result

    return _get_last_known(cache_key)


def _fetch_spot(ticker: str) -> Decimal | None:
    """
    SWR spot price:
      1. Fresh cache → instant.
      2. Stale cache → instant + bg refresh.
      3. Empty → block up to 5s (first hit).
      4. Zero-Value Guard → return last_known_price.
    """
    upper = ticker.upper()
    cache_key = f"spot:{upper}"

    fresh = _get_fresh(cache_key)
    if fresh is not None:
        return fresh

    stale = _get_stale(cache_key)
    if stale is not None:
        _schedule_bg_refresh(cache_key, _do_fetch_spot, upper)
        return stale

    # First hit — block up to 5s for real data
    result = _do_fetch_spot(upper)
    if result is not None:
        return result

    # Zero-Value Guard
    last = _get_last_known(cache_key)
    if last is not None:
        logger.warning("Zero-Value Guard: returning last_known spot for %s", upper)
        return last
    return None


def _fetch_hist_vol(ticker: str) -> Decimal:
    """
    SWR historical vol:
      1. Fresh cache → instant.
      2. Stale cache → instant + bg refresh.
      3. Empty → return DEFAULT_SIGMA immediately + bg refresh.
    Never blocks the request for vol data.
    """
    upper = ticker.upper()
    cache_key = f"hvol:{upper}"

    fresh = _get_fresh(cache_key)
    if fresh is not None:
        return fresh

    stale = _get_stale(cache_key)
    if stale is not None:
        _schedule_bg_refresh(cache_key, _do_fetch_hist_vol, upper)
        return stale

    last = _get_last_known(cache_key)
    if last is not None:
        _schedule_bg_refresh(cache_key, _do_fetch_hist_vol, upper)
        return last

    # No data at all — return default, schedule background fetch
    _schedule_bg_refresh(cache_key, _do_fetch_hist_vol, upper)
    return DEFAULT_SIGMA


def _fetch_ytd_return(ticker: str) -> Decimal | None:
    upper = ticker.upper()
    cache_key = f"ytd:{upper}"

    fresh = _get_fresh(cache_key)
    if fresh is not None:
        return fresh
    stale = _get_stale(cache_key)
    if stale is not None:
        return stale

    ts = _get_daily_series_swr(upper, full=True)
    if not ts:
        return _get_last_known(cache_key)

    today = date.today()
    jan1_str = f"{today.year}-01"
    sorted_dates = sorted(ts.keys())
    start_date = None
    for d in sorted_dates:
        if d.startswith(jan1_str):
            start_date = d
            break
    if not start_date:
        return None

    latest_date = sorted_dates[-1]
    try:
        start_price = float(ts[start_date]["4. close"])
        current_price = float(ts[latest_date]["4. close"])
        if start_price <= 0:
            return None
        result = Decimal(str(round((current_price - start_price) / start_price, 6)))
        _set_cached(cache_key, result)
        return result
    except (KeyError, ValueError):
        return None


def _fetch_price_history(ticker: str, start_date: str) -> dict[str, float]:
    upper = ticker.upper()
    cache_key = f"phist:{upper}:{start_date}"

    fresh = _get_fresh(cache_key)
    if fresh is not None:
        return fresh
    stale = _get_stale(cache_key)
    if stale is not None:
        return stale

    ts = _get_daily_series_swr(upper, full=True)
    if not ts:
        last = _get_last_known(cache_key)
        return last if last is not None else {}

    result: dict[str, float] = {}
    for d, values in ts.items():
        if d >= start_date:
            try:
                result[d] = float(values["4. close"])
            except (KeyError, ValueError):
                pass
    if result:
        _set_cached(cache_key, result)
    return result


# ── Batch spot prices (PriceFeedService — background task) ───────────────

def _fetch_spots_batch(tickers: list[str]) -> dict[str, Decimal]:
    """
    Called by PriceFeedService in a background asyncio task.
    Returns cached + freshly fetched prices.  Uses non-blocking rate limit
    so it never stalls the poll loop for >5s per symbol.
    """
    if not tickers:
        return {}

    result: dict[str, Decimal] = {}
    uncached: list[str] = []

    for t in tickers:
        upper = t.upper()
        cache_key = f"spot:{upper}"
        fresh = _get_fresh(cache_key)
        if fresh is not None:
            result[upper] = fresh
        else:
            uncached.append(upper)

    for sym in uncached:
        av_sym = _av_symbol(sym)
        data = _av_get_nonblocking({"function": "GLOBAL_QUOTE", "symbol": av_sym})
        if data and "Global Quote" in data:
            price_str = data["Global Quote"].get("05. price")
            if price_str:
                try:
                    price = Decimal(price_str).quantize(Decimal("0.0001"))
                    if price > 0:
                        result[sym] = price
                        _set_cached(f"spot:{sym}", price)
                except Exception:
                    pass
        elif data is None:
            # Rate limited — fill remaining from stale/last_known
            stale = _get_stale(f"spot:{sym}") or _get_last_known(f"spot:{sym}")
            if stale is not None:
                result[sym] = stale
            idx = uncached.index(sym)
            for rem in uncached[idx + 1:]:
                rem_val = _get_stale(f"spot:{rem}") or _get_last_known(f"spot:{rem}")
                if rem_val is not None:
                    result[rem] = rem_val
            logger.debug("Rate limit in batch, %d symbols used stale/last_known", len(uncached) - idx)
            break

    return result


# ── 1-year daily closes (MarketScannerService) ───────────────────────────

def _fetch_1y_closes(ticker: str) -> list[float]:
    upper = ticker.upper()
    cache_key = f"1y:{upper}"

    fresh = _get_fresh(cache_key)
    if fresh is not None:
        return fresh
    stale = _get_stale(cache_key)
    if stale is not None:
        _schedule_bg_refresh(cache_key, _do_fetch_1y_closes, upper)
        return stale
    last = _get_last_known(cache_key)
    if last is not None:
        _schedule_bg_refresh(cache_key, _do_fetch_1y_closes, upper)
        return last

    _schedule_bg_refresh(cache_key, _do_fetch_1y_closes, upper)
    return []


# ── Pre-warm (called as fire-and-forget background task on startup) ──────

def _do_prewarm(symbols: list[str]) -> None:
    """Synchronously fetch spot prices for a list of symbols."""
    for sym in symbols:
        upper = sym.upper()
        logger.info("Pre-warming: %s", upper)
        try:
            _do_fetch_spot(upper)
        except Exception:
            logger.warning("Pre-warm failed for %s (non-fatal)", upper)


async def prewarm(symbols: list[str]) -> None:
    """Pre-fetch spot prices (runs in thread, safe to fire-and-forget)."""
    await asyncio.to_thread(_do_prewarm, symbols)


# ── Async public API (identical signatures to original yfinance_client) ──

async def get_spot_price(ticker: str) -> Decimal | None:
    return await asyncio.to_thread(_fetch_spot, ticker)


async def get_hist_vol(ticker: str) -> Decimal:
    return await asyncio.to_thread(_fetch_hist_vol, ticker)


async def get_ytd_return(ticker: str) -> Decimal | None:
    """Async wrapper around _fetch_ytd_return."""
    return await asyncio.to_thread(_fetch_ytd_return, ticker)


async def get_price_history(ticker: str, start_date: str) -> dict[str, float]:
    """Async wrapper around _fetch_price_history."""
    return await asyncio.to_thread(_fetch_price_history, ticker, start_date)


async def get_spot_prices_batch(tickers: list[str]) -> dict[str, Decimal]:
    """Async wrapper: fetch multiple spot prices with caching + rate limiting."""
    return await asyncio.to_thread(_fetch_spots_batch, tickers)


async def get_1y_closes(ticker: str) -> list[float]:
    """Async wrapper around _fetch_1y_closes."""
    return await asyncio.to_thread(_fetch_1y_closes, ticker)
