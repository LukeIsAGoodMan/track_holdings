"""
Alpha Vantage async wrapper (drop-in replacement for yfinance_client).

Performance strategy: stale-while-revalidate.
  - REST endpoints NEVER block on Alpha Vantage HTTP calls.
  - Fresh cache (< 120s) → instant return.
  - Stale cache (120s – 1h) → instant return + background refresh scheduled.
  - No cache at all → return None/DEFAULT_SIGMA (let PriceFeedService fill it).
  - Only PriceFeedService._poll_loop (via get_spot_prices_batch) actually
    performs blocking AV calls, and it runs in a background asyncio task.

Rate limiting: 5 calls / 60 seconds (Alpha Vantage free tier).
HTTP timeout: 5 seconds per request (fail fast).
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
_RATE_WINDOW = 60.0  # seconds


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


# ── Two-tier cache: fresh (120s) + stale (1h) ────────────────────────────
_cache: dict[str, tuple[object, float]] = {}   # key → (value, timestamp)
_cache_lock = threading.Lock()
_CACHE_TTL: float = float(settings.av_cache_ttl)   # fresh window (120s)
_STALE_TTL: float = 3600.0                         # stale window (1h)


def _get_cached(key: str) -> object | None:
    """Return cached value if within stale window (up to 1h old)."""
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.monotonic() - entry[1]) < _STALE_TTL:
            return entry[0]
    return None


def _is_fresh(key: str) -> bool:
    """True if cache entry exists and is within the fresh TTL."""
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.monotonic() - entry[1]) < _CACHE_TTL:
            return True
    return False


def _set_cached(key: str, value: object) -> None:
    """Store value in cache with current timestamp."""
    with _cache_lock:
        _cache[key] = (value, time.monotonic())


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
            logger.exception("Background refresh failed for %s", cache_key)
        finally:
            with _bg_lock:
                _bg_pending.discard(cache_key)

    _refresh_pool.submit(_run)


# ── HTTP session (5s timeout — fail fast) ─────────────────────────────────
_HTTP_TIMEOUT = 5  # seconds

_session = requests.Session()
_session.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
})


def _av_get(params: dict) -> dict | None:
    """Make a rate-limited GET request to Alpha Vantage. Returns JSON or None."""
    _wait_for_rate_limit()
    params["apikey"] = _API_KEY
    try:
        resp = _session.get(_BASE_URL, params=params, timeout=_HTTP_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        if "Error Message" in data:
            logger.warning("Alpha Vantage error: %s", data["Error Message"])
            return None
        if "Note" in data:
            logger.warning("Alpha Vantage rate limit note: %s", data["Note"])
            return None
        return data
    except requests.Timeout:
        logger.warning("Alpha Vantage timeout (>%ds) for %s", _HTTP_TIMEOUT, params.get("symbol"))
        return None
    except Exception:
        logger.exception("Alpha Vantage request failed")
        return None


def _av_get_nonblocking(params: dict) -> dict | None:
    """Non-blocking variant: skip if rate-limited instead of waiting."""
    if not _try_rate_limit():
        return None
    params["apikey"] = _API_KEY
    try:
        resp = _session.get(_BASE_URL, params=params, timeout=_HTTP_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        if "Error Message" in data:
            logger.warning("Alpha Vantage error: %s", data["Error Message"])
            return None
        if "Note" in data:
            logger.warning("Alpha Vantage rate limit note: %s", data["Note"])
            return None
        return data
    except requests.Timeout:
        logger.warning("Alpha Vantage timeout (>%ds) for %s", _HTTP_TIMEOUT, params.get("symbol"))
        return None
    except Exception:
        logger.exception("Alpha Vantage request failed")
        return None


# ── Internal fetch helpers (do actual HTTP) ──────────────────────────────

def _do_fetch_spot(upper: str) -> Decimal | None:
    """Actually call GLOBAL_QUOTE and cache the result."""
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
    """Actually call TIME_SERIES_DAILY and cache the result."""
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
    """Actually fetch daily series and compute vol."""
    ts = _fetch_daily_series(upper, full=False)
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


# ── Public fetch functions (stale-while-revalidate) ──────────────────────

def _fetch_spot(ticker: str) -> Decimal | None:
    """
    Return spot price instantly from cache/stale.
    Never blocks on AV during a REST request.
    """
    upper = ticker.upper()
    cache_key = f"spot:{upper}"
    cached = _get_cached(cache_key)

    if cached is not None:
        if not _is_fresh(cache_key):
            # Stale — schedule background refresh, return stale now
            _schedule_bg_refresh(cache_key, _do_fetch_spot, upper)
        return cached

    # No data at all — schedule background fetch, return None for now
    _schedule_bg_refresh(cache_key, _do_fetch_spot, upper)
    return None


def _fetch_daily_series(ticker: str, full: bool = False) -> dict[str, dict] | None:
    """
    Return daily series from cache/stale.
    Schedules background refresh if stale.
    """
    size = "full" if full else "compact"
    cache_key = f"daily:{ticker.upper()}:{size}"
    cached = _get_cached(cache_key)

    if cached is not None:
        if not _is_fresh(cache_key):
            _schedule_bg_refresh(cache_key, _do_fetch_daily_series, ticker.upper(), full)
        return cached

    # No data — schedule background fetch
    _schedule_bg_refresh(cache_key, _do_fetch_daily_series, ticker.upper(), full)
    return None


def _fetch_hist_vol(ticker: str) -> Decimal:
    """
    Return historical vol instantly.
    Returns DEFAULT_SIGMA (0.30) if no data cached yet.
    """
    upper = ticker.upper()
    cache_key = f"hvol:{upper}"
    cached = _get_cached(cache_key)

    if cached is not None:
        if not _is_fresh(cache_key):
            _schedule_bg_refresh(cache_key, _do_fetch_hist_vol, upper)
        return cached

    # No data — return default vol, schedule background fetch
    _schedule_bg_refresh(cache_key, _do_fetch_hist_vol, upper)
    return DEFAULT_SIGMA


def _fetch_ytd_return(ticker: str) -> Decimal | None:
    upper = ticker.upper()
    cache_key = f"ytd:{upper}"
    cached = _get_cached(cache_key)
    if cached is not None:
        if _is_fresh(cache_key):
            return cached
        # Stale — still return it, bg refresh via daily series will help
        return cached

    ts = _fetch_daily_series(upper, full=True)
    if not ts:
        return None

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
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    ts = _fetch_daily_series(upper, full=True)
    if not ts:
        return {}

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


# ── Batch spot prices (for PriceFeedService — runs in background) ────────
def _fetch_spots_batch(tickers: list[str]) -> dict[str, Decimal]:
    """
    Fetch spot prices for multiple tickers.
    This is called by PriceFeedService in a background task, so it CAN
    wait for rate limits. Returns cached + freshly fetched prices.
    """
    if not tickers:
        return {}

    result: dict[str, Decimal] = {}
    uncached: list[str] = []

    # 1. Serve from cache first (fresh or stale)
    for t in tickers:
        upper = t.upper()
        cache_key = f"spot:{upper}"
        cached = _get_cached(cache_key)
        if cached is not None and _is_fresh(cache_key):
            result[upper] = cached
        else:
            uncached.append(upper)

    # 2. Fetch uncached/stale symbols (non-blocking rate limit)
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
            # Rate limited — return stale value if we have one, skip rest
            stale = _get_cached(f"spot:{sym}")
            if stale is not None:
                result[sym] = stale
            remaining = len(uncached) - uncached.index(sym) - 1
            if remaining > 0:
                logger.debug("Rate limit reached in batch, %d symbols deferred", remaining)
                # Add stale values for remaining symbols
                for rem in uncached[uncached.index(sym) + 1:]:
                    rem_stale = _get_cached(f"spot:{rem}")
                    if rem_stale is not None:
                        result[rem] = rem_stale
            break

    return result


# ── 1-year daily closes (for IV Rank in MarketScannerService) ────────────
def _fetch_1y_closes(ticker: str) -> list[float]:
    upper = ticker.upper()
    cache_key = f"1y:{upper}"
    cached = _get_cached(cache_key)
    if cached is not None:
        if _is_fresh(cache_key):
            return cached
        # Stale but usable — schedule refresh
        _schedule_bg_refresh(cache_key, _do_fetch_1y_closes, upper)
        return cached

    # No data — schedule and return empty
    _schedule_bg_refresh(cache_key, _do_fetch_1y_closes, upper)
    return []


def _do_fetch_1y_closes(upper: str) -> list[float]:
    """Actually fetch 1-year closes for scanner."""
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


# ── Pre-warm: fetch key symbols on startup ───────────────────────────────

def _do_prewarm(symbols: list[str]) -> None:
    """Synchronously fetch spot prices for a list of symbols (startup only)."""
    for sym in symbols:
        upper = sym.upper()
        logger.info("Pre-warming price cache: %s", upper)
        _do_fetch_spot(upper)


async def prewarm(symbols: list[str]) -> None:
    """Pre-fetch spot prices during startup so cache is warm."""
    await asyncio.to_thread(_do_prewarm, symbols)


# ── Async wrappers (public API — identical signatures to original) ───────

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
