"""
yfinance async wrapper — Phase 12b Robust Anti-Blocking Layer.

Anti-blocking:
  12 modern browser User-Agent strings, rotated randomly per request.
  Custom requests.Session injected into every yf.Ticker() call.

Smart SWR (Stale-While-Revalidate) cache:
  Fresh hit  (<120s)  → instant return.
  Stale hit  (120s–1h) → instant return + background refresh scheduled.
  Empty hit            → return None + schedule bg fetch (NEVER blocks).
  Zero-Value Guard     → _last_known dict never expires — ultimate fallback.
"""
from __future__ import annotations

import asyncio
import logging
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import requests
import yfinance as yf

from app.services.black_scholes import compute_historical_vol, DEFAULT_SIGMA

logger = logging.getLogger(__name__)

# ── User-Agent rotation (12 modern browser strings) ──────────────────────
_USER_AGENTS: list[str] = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/116.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Vivaldi/7.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Brave/131",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
]


def _make_session() -> requests.Session:
    """Create a requests.Session with a randomized User-Agent."""
    s = requests.Session()
    s.headers["User-Agent"] = random.choice(_USER_AGENTS)
    return s


# ── Two-tier SWR cache ────────────────────────────────────────────────────
# _cache: (value, monotonic_timestamp).  Fresh = 120s, stale = 1h.
# _last_known: zero-value guard — NEVER expires.

_cache: dict[str, tuple[object, float]] = {}
_last_known: dict[str, object] = {}
_cache_lock = threading.Lock()
_CACHE_TTL: float = 120.0   # 2 min fresh
_STALE_TTL: float = 3600.0  # 1h stale


def _get_fresh(key: str) -> object | None:
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.monotonic() - entry[1]) < _CACHE_TTL:
            return entry[0]
    return None


def _get_stale(key: str) -> object | None:
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.monotonic() - entry[1]) < _STALE_TTL:
            return entry[0]
    return None


def _get_last_known(key: str) -> object | None:
    with _cache_lock:
        return _last_known.get(key)


def _set_cached(key: str, value: object) -> None:
    with _cache_lock:
        _cache[key] = (value, time.monotonic())
        _last_known[key] = value


# ── Background refresh (2-thread executor) ───────────────────────────────
_bg_pending: set[str] = set()
_bg_lock = threading.Lock()
_refresh_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="yf-bg")


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


# ── Internal _do_* helpers (actually hit yfinance) ───────────────────────

def _do_fetch_spot(upper: str) -> Decimal | None:
    """Fetch spot price from yfinance with randomized UA."""
    try:
        session = _make_session()
        ticker = yf.Ticker(upper, session=session)
        # fast_info is the lightest endpoint
        try:
            price = ticker.fast_info["lastPrice"]
            if price and float(price) > 0:
                result = Decimal(str(price)).quantize(Decimal("0.0001"))
                _set_cached(f"spot:{upper}", result)
                return result
        except (KeyError, TypeError, AttributeError):
            pass
        # Fallback: 5-day history
        hist = ticker.history(period="5d")
        if hist is not None and not hist.empty:
            close = float(hist["Close"].iloc[-1])
            if close > 0:
                result = Decimal(str(close)).quantize(Decimal("0.0001"))
                _set_cached(f"spot:{upper}", result)
                return result
    except Exception:
        logger.warning("yfinance spot fetch failed for %s", upper, exc_info=True)
    return None


def _do_fetch_history(upper: str, period: str = "3mo") -> list[float]:
    """Fetch daily closes from yfinance."""
    try:
        session = _make_session()
        ticker = yf.Ticker(upper, session=session)
        hist = ticker.history(period=period)
        if hist is not None and not hist.empty:
            return [float(c) for c in hist["Close"].tolist()]
    except Exception:
        logger.warning("yfinance history fetch failed for %s (%s)", upper, period)
    return []


def _do_fetch_hist_vol(upper: str) -> Decimal:
    """Compute 30-day historical vol from yfinance daily closes."""
    closes = _do_fetch_history(upper, period="3mo")
    if len(closes) < 5:
        return DEFAULT_SIGMA
    closes = closes[-30:]
    vol = compute_historical_vol(closes)
    _set_cached(f"hvol:{upper}", vol)
    return vol


def _do_fetch_1y_closes(upper: str) -> list[float]:
    """Fetch 1 year of daily closes from yfinance."""
    closes = _do_fetch_history(upper, period="1y")
    if closes:
        _set_cached(f"1y:{upper}", closes)
    return closes


# ── SWR wrappers (called by the public async API) ───────────────────────

def _fetch_spot(ticker: str) -> Decimal | None:
    """
    SWR spot price — NEVER blocks on a network call:
      1. Fresh cache  → instant.
      2. Stale cache  → instant + bg refresh.
      3. Last-known   → instant + bg refresh.
      4. Empty        → None + bg refresh (shimmer in frontend).
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

    last = _get_last_known(cache_key)
    if last is not None:
        _schedule_bg_refresh(cache_key, _do_fetch_spot, upper)
        logger.info("Zero-Value Guard: returning last_known spot for %s", upper)
        return last

    # No cached data at all — schedule bg fetch, return None
    _schedule_bg_refresh(cache_key, _do_fetch_spot, upper)
    return None


def _fetch_hist_vol(ticker: str) -> Decimal:
    """SWR vol: fresh → stale+bg → last_known+bg → DEFAULT_SIGMA+bg."""
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

    try:
        session = _make_session()
        t = yf.Ticker(upper, session=session)
        hist = t.history(period="ytd")
        if hist is not None and len(hist) >= 2:
            start_price = float(hist["Close"].iloc[0])
            current_price = float(hist["Close"].iloc[-1])
            if start_price > 0:
                result = Decimal(str(round((current_price - start_price) / start_price, 6)))
                _set_cached(cache_key, result)
                return result
    except Exception:
        logger.warning("yfinance YTD return failed for %s", upper)

    return _get_last_known(cache_key)


def _fetch_price_history(ticker: str, start_date: str) -> dict[str, float]:
    upper = ticker.upper()
    cache_key = f"phist:{upper}:{start_date}"

    fresh = _get_fresh(cache_key)
    if fresh is not None:
        return fresh
    stale = _get_stale(cache_key)
    if stale is not None:
        return stale

    try:
        session = _make_session()
        t = yf.Ticker(upper, session=session)
        hist = t.history(start=start_date)
        if hist is not None and not hist.empty:
            result: dict[str, float] = {}
            for idx, row in hist.iterrows():
                date_str = idx.strftime("%Y-%m-%d")
                result[date_str] = float(row["Close"])
            if result:
                _set_cached(cache_key, result)
            return result
    except Exception:
        logger.warning("yfinance price history failed for %s", upper)

    last = _get_last_known(cache_key)
    return last if last is not None else {}


def _fetch_spots_batch(tickers: list[str]) -> dict[str, Decimal]:
    """
    Batch spot prices for PriceFeedService.
    Uses SWR cache first, then yf.download() for uncached symbols.
    Fills any remaining gaps from stale/last_known.
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

    if uncached:
        try:
            session = _make_session()
            df = yf.download(
                uncached, period="5d", session=session,
                progress=False, threads=False,
            )
            if df is not None and not df.empty:
                if len(uncached) == 1:
                    sym = uncached[0]
                    if "Close" in df.columns and len(df) > 0:
                        close = float(df["Close"].iloc[-1])
                        if close > 0:
                            price = Decimal(str(close)).quantize(Decimal("0.0001"))
                            result[sym] = price
                            _set_cached(f"spot:{sym}", price)
                else:
                    for sym in uncached:
                        try:
                            close = float(df["Close"][sym].iloc[-1])
                            if close > 0:
                                price = Decimal(str(close)).quantize(Decimal("0.0001"))
                                result[sym] = price
                                _set_cached(f"spot:{sym}", price)
                        except (KeyError, IndexError, TypeError):
                            pass
        except Exception:
            logger.warning("yfinance batch download failed", exc_info=True)

        # Fill remaining gaps from stale/last_known
        for sym in uncached:
            if sym not in result:
                val = _get_stale(f"spot:{sym}") or _get_last_known(f"spot:{sym}")
                if val is not None:
                    result[sym] = val

    return result


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


# ── Pre-warm (fire-and-forget on startup with randomized UA) ─────────────

def _do_prewarm(symbols: list[str]) -> None:
    """Synchronously pre-fetch spot prices for startup symbols."""
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


# ── Async public API (signatures unchanged — 11 files import these) ──────

async def get_spot_price(ticker: str) -> Decimal | None:
    return await asyncio.to_thread(_fetch_spot, ticker)


async def get_hist_vol(ticker: str) -> Decimal:
    return await asyncio.to_thread(_fetch_hist_vol, ticker)


async def get_ytd_return(ticker: str) -> Decimal | None:
    return await asyncio.to_thread(_fetch_ytd_return, ticker)


async def get_price_history(ticker: str, start_date: str) -> dict[str, float]:
    return await asyncio.to_thread(_fetch_price_history, ticker, start_date)


async def get_spot_prices_batch(tickers: list[str]) -> dict[str, Decimal]:
    return await asyncio.to_thread(_fetch_spots_batch, tickers)


async def get_1y_closes(ticker: str) -> list[float]:
    return await asyncio.to_thread(_fetch_1y_closes, ticker)
