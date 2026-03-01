"""
Alpha Vantage async wrapper (drop-in replacement for yfinance_client).

All HTTP calls are synchronous; wrapped in asyncio.to_thread.
Same public API as the original yfinance_client — no caller changes needed.

Rate limiting: 5 calls / 60 seconds (Alpha Vantage free tier).
Caching: 120-second TTL on all price data to stay within limits.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections import deque
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
            # Purge calls older than the window
            while _call_times and now - _call_times[0] > _RATE_WINDOW:
                _call_times.popleft()
            if len(_call_times) < _RATE_LIMIT:
                _call_times.append(now)
                return  # slot acquired
            wait_time = _RATE_WINDOW - (now - _call_times[0]) + 0.1
        # Sleep *outside* the lock so other threads aren't blocked
        time.sleep(min(wait_time, 30.0))


def _try_rate_limit() -> bool:
    """Non-blocking: acquire a slot if available, else return False."""
    with _rate_lock:
        now = time.monotonic()
        while _call_times and now - _call_times[0] > _RATE_WINDOW:
            _call_times.popleft()
        if len(_call_times) < _RATE_LIMIT:
            _call_times.append(now)
            return True
        return False


# ── Response cache (configurable TTL, default 120s) ──────────────────────
_cache: dict[str, tuple[object, float]] = {}
_cache_lock = threading.Lock()
_CACHE_TTL: float = float(settings.av_cache_ttl)


def _get_cached(key: str) -> object | None:
    """Return cached value if fresh, else None."""
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.monotonic() - entry[1]) < _CACHE_TTL:
            return entry[0]
    return None


def _set_cached(key: str, value: object) -> None:
    """Store value in cache with current timestamp."""
    with _cache_lock:
        _cache[key] = (value, time.monotonic())


# ── HTTP session ──────────────────────────────────────────────────────────
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
        resp = _session.get(_BASE_URL, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        # Alpha Vantage returns errors/warnings in the JSON body
        if "Error Message" in data:
            logger.warning("Alpha Vantage error: %s", data["Error Message"])
            return None
        if "Note" in data:
            logger.warning("Alpha Vantage rate limit note: %s", data["Note"])
            return None
        return data
    except Exception:
        logger.exception("Alpha Vantage request failed")
        return None


def _av_get_nonblocking(params: dict) -> dict | None:
    """Non-blocking variant: skip if rate-limited instead of waiting."""
    if not _try_rate_limit():
        return None
    params["apikey"] = _API_KEY
    try:
        resp = _session.get(_BASE_URL, params=params, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        if "Error Message" in data:
            logger.warning("Alpha Vantage error: %s", data["Error Message"])
            return None
        if "Note" in data:
            logger.warning("Alpha Vantage rate limit note: %s", data["Note"])
            return None
        return data
    except Exception:
        logger.exception("Alpha Vantage request failed")
        return None


# ── Daily time-series helper (shared by vol, ytd, history, 1y) ───────────
def _fetch_daily_series(ticker: str, full: bool = False) -> dict[str, dict] | None:
    """
    Fetch TIME_SERIES_DAILY for a ticker.
    Returns the "Time Series (Daily)" dict or None.
    Uses cache keyed on (ticker, outputsize).
    """
    size = "full" if full else "compact"
    cache_key = f"daily:{ticker.upper()}:{size}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

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


# ── Spot price ────────────────────────────────────────────────────────────
def _fetch_spot(ticker: str) -> Decimal | None:
    upper = ticker.upper()
    cache_key = f"spot:{upper}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    sym = _av_symbol(upper)
    data = _av_get({"function": "GLOBAL_QUOTE", "symbol": sym})
    if not data or "Global Quote" not in data:
        return None

    quote = data["Global Quote"]
    price_str = quote.get("05. price")
    if not price_str:
        return None

    try:
        price = Decimal(price_str).quantize(Decimal("0.0001"))
        if price > 0:
            _set_cached(cache_key, price)
            return price
    except Exception:
        pass
    return None


# ── Historical volatility ────────────────────────────────────────────────
def _fetch_hist_vol(ticker: str) -> Decimal:
    upper = ticker.upper()
    cache_key = f"hvol:{upper}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    ts = _fetch_daily_series(upper, full=False)  # compact = ~100 days
    if not ts:
        return DEFAULT_SIGMA

    # Last 30 trading days
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
    _set_cached(cache_key, vol)
    return vol


# ── YTD return ────────────────────────────────────────────────────────────
def _fetch_ytd_return(ticker: str) -> Decimal | None:
    upper = ticker.upper()
    cache_key = f"ytd:{upper}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    ts = _fetch_daily_series(upper, full=True)
    if not ts:
        return None

    today = date.today()
    jan1_str = f"{today.year}-01"

    # Find first trading day of the year
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


# ── Price history ─────────────────────────────────────────────────────────
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


# ── Batch spot prices (for PriceFeedService) ─────────────────────────────
def _fetch_spots_batch(tickers: list[str]) -> dict[str, Decimal]:
    """
    Fetch spot prices for multiple tickers.
    Returns cached values immediately; fetches uncached symbols up to rate limit.
    Symbols that can't be fetched this cycle will be retried next poll.
    """
    if not tickers:
        return {}

    result: dict[str, Decimal] = {}
    uncached: list[str] = []

    # 1. Serve from cache first
    for t in tickers:
        upper = t.upper()
        cache_key = f"spot:{upper}"
        cached = _get_cached(cache_key)
        if cached is not None:
            result[upper] = cached
        else:
            uncached.append(upper)

    # 2. Fetch uncached symbols (non-blocking rate limit — skip if exhausted)
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
            # Rate limited — stop trying, remaining symbols retry next cycle
            logger.debug("Rate limit reached in batch, %d symbols deferred", len(uncached) - uncached.index(sym))
            break

    return result


# ── 1-year daily closes (for IV Rank in MarketScannerService) ────────────
def _fetch_1y_closes(ticker: str) -> list[float]:
    upper = ticker.upper()
    cache_key = f"1y:{upper}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    ts = _fetch_daily_series(upper, full=True)
    if not ts:
        return []

    # Last ~252 trading days
    sorted_dates = sorted(ts.keys(), reverse=True)[:252]

    closes: list[float] = []
    for d in reversed(sorted_dates):
        try:
            closes.append(float(ts[d]["4. close"]))
        except (KeyError, ValueError):
            pass

    if closes:
        _set_cached(cache_key, closes)
    return closes


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
