"""
Shared market-data layer — single FMP client for the entire application.

Symbol handling (two-stage):
  normalize_ticker(sym)  →  bare uppercase form (VIX, GSPC, AAPL)
  _fmp_sym(sym)          →  FMP-ready form: adds '^' for index symbols
                             VIX → ^VIX,  GSPC → ^GSPC,  AAPL → AAPL

Key endpoints:
  /quote?symbol=              intraday price + change data
  /historical-price-eod/full  daily OHLCV bars
  /analyst-estimates          forward EPS / revenue consensus
  /treasury-rates             US treasury yields (all maturities)
  /stock-price-change         pre-computed 1D/5D/1M/3M returns

Performance:
  _SyncTokenBucket       global 2 req/s cap on all outbound FMP calls
  _refresh_scheduled     deduplicates concurrent background refreshes per key
  SWR cache              stale-while-revalidate with configurable TTL per data type
"""
from __future__ import annotations
import asyncio
import logging
import threading
import time
from datetime import date, timedelta
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor
import requests
from app.config import settings
from app.services.black_scholes import compute_historical_vol, DEFAULT_SIGMA

logger = logging.getLogger(__name__)

_BASE = "https://financialmodelingprep.com/stable"
_API_KEY = settings.fmp_api_key
_HTTP_TIMEOUT = 5
_SESSION = requests.Session()
_SESSION.headers["User-Agent"] = "TrackHoldings/1.0"

# Known index symbols that require a caret prefix for FMP API calls.
# Internal representation stays bare (VIX, GSPC); _fmp_sym() adds "^" on
# outbound requests only.  FMP returns empty results without the caret.
_INDEX_BARE: frozenset[str] = frozenset({
    "VIX", "SPX", "NDX", "RUT", "DJI", "GSPC", "TNX", "TYX", "VXN",
})


def normalize_ticker(symbol: str) -> str:
    """
    Return the canonical bare-symbol form used by FMP.

    - Strips a leading '^' so that ^VIX, ^SPX, ^NDX etc. are normalised to
      their FMP equivalents (VIX, SPX, NDX).
    - Uppercases the result.

    The inverse (adding '^') is handled by _fmp_sym() for index symbols only.
    """
    sym = symbol.upper().strip()
    if sym.startswith("^"):
        sym = sym[1:]
    return sym


def _fmp_sym(sym: str) -> str:
    """Return the FMP-ready symbol.  Index symbols get a '^' prefix."""
    s = normalize_ticker(sym)
    if s in _INDEX_BARE:
        return "^" + s
    return s

# ── Token-bucket rate limiter (2 req/s, burst 4) ──────────────────────────────

class _SyncTokenBucket:
    """
    Thread-safe token-bucket rate limiter for synchronous (thread-pool) callers.

    Capacity defaults to 2× the rate to allow a modest burst (e.g. prewarm)
    without incurring per-call sleep. Sleeps outside the lock to avoid starving
    other threads.
    """
    def __init__(self, rate: float, capacity: float) -> None:
        self._rate     = rate
        self._capacity = capacity
        self._tokens   = capacity
        self._last     = time.monotonic()
        self._lock     = threading.Lock()

    def acquire(self) -> None:
        while True:
            with self._lock:
                now = time.monotonic()
                self._tokens = min(
                    self._capacity,
                    self._tokens + (now - self._last) * self._rate,
                )
                self._last = now
                if self._tokens >= 1.0:
                    self._tokens -= 1.0
                    return
                wait = (1.0 - self._tokens) / self._rate
            # Sleep outside the lock — other threads can still accrue tokens
            time.sleep(wait)

# Rate-limited only when a real API key is configured (no-op in test environments)
_api_rate_limiter = _SyncTokenBucket(rate=2.0, capacity=4.0)

# ── 核心私有获取逻辑 (严格遵循表格规范) ──────────────────────────────

def _fmp_get(path: str, params: dict) -> object | None:
    # Throttle outbound calls; no-op when API key is absent (test/mock mode)
    if _API_KEY:
        _api_rate_limiter.acquire()
    url = f"{_BASE}{path}"
    params["apikey"] = _API_KEY
    last_exc: Exception | None = None
    for attempt in range(2):   # 1 automatic retry on transient failure
        try:
            resp = _SESSION.get(url, params=params, timeout=_HTTP_TIMEOUT)
            if resp.status_code == 403:
                logger.error("FMP 403 Forbidden: %s | body=%s", path, resp.text[:500])
                return None
            resp.raise_for_status()
            return resp.json()
        except requests.Timeout as e:
            last_exc = e
            if attempt == 0:
                logger.warning("FMP timeout (attempt 1): %s %s — retrying", path, params.get("symbol"))
        except Exception as e:
            logger.error("FMP Request Error: %s %s -> %s", path, params.get("symbol"), e)
            return None
    logger.error("FMP timeout (attempt 2): %s %s -> %s", path, params.get("symbol"), last_exc)
    return None

def _do_fetch_quote(ticker: str) -> Decimal | None:
    fmp_s = _fmp_sym(ticker)
    data = _fmp_get("/quote", {"symbol": fmp_s})
    if data and isinstance(data, list) and len(data) > 0:
        item = data[0]
        price = item.get("price")
        if price:
            val = Decimal(str(price)).quantize(Decimal("0.0001"))
            _set_cached(f"spot:{ticker.upper()}", val)
            # Cache previousClose (stable all day — 24h TTL, daily P&L baseline)
            prev = item.get("previousClose")
            if prev is not None:
                _set_cached(
                    f"prev_close:{ticker.upper()}",
                    Decimal(str(prev)).quantize(Decimal("0.0001")),
                )
            # Cache intraday change & changesPercentage for ticker bar enrichment
            change = item.get("change")
            if change is not None:
                _set_cached(f"change:{ticker.upper()}", Decimal(str(change)).quantize(Decimal("0.0001")))
            change_pct = item.get("changesPercentage")
            if change_pct is not None:
                _set_cached(f"changepct:{ticker.upper()}", Decimal(str(change_pct)).quantize(Decimal("0.0001")))
            return val
    return None

def _do_fetch_hist_data(ticker: str, extra_params: dict | None = None) -> list[dict]:
    fmp_s = _fmp_sym(ticker)
    p = {"symbol": fmp_s}
    if extra_params: p.update(extra_params)
    data = _fmp_get("/historical-price-eod/full", p)
    # FMP stable API returns a plain list; v3 wraps in {"historical": [...]}
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "historical" in data:
        return data["historical"]
    return []

# ── SWR 缓存与锁 ──────────────────────────────────────────────────

_cache: dict[str, tuple[object, float]] = {}
_last_known: dict[str, object] = {}
_cache_lock = threading.Lock()
_refresh_pool = ThreadPoolExecutor(max_workers=50)

# ── Background-refresh deduplication ──────────────────────────────
# Tracks which cache keys already have an in-flight background refresh.
# Prevents N concurrent requests for the same symbol from spawning N
# duplicate thread-pool tasks.
_refresh_scheduled: set[str] = set()
_refresh_sched_lock = threading.Lock()


def _schedule_bg_refresh(cache_key: str, fn, *args) -> None:
    """
    Submit fn(*args) to the thread pool only if no refresh is already in-flight
    for cache_key.  The key is removed from the set when the task finishes.
    """
    with _refresh_sched_lock:
        if cache_key in _refresh_scheduled:
            return          # already being fetched — skip duplicate
        _refresh_scheduled.add(cache_key)

    def _work() -> None:
        try:
            fn(*args)
        finally:
            with _refresh_sched_lock:
                _refresh_scheduled.discard(cache_key)

    _refresh_pool.submit(_work)


def _set_cached(key: str, value: object):
    with _cache_lock:
        _cache[key] = (value, time.monotonic())
        _last_known[key] = value

def _get_cached(key: str, ttl: float) -> object | None:
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.monotonic() - entry[1]) < ttl:
            return entry[0]
    return _last_known.get(key)

def _is_cache_fresh(key: str, ttl: float) -> bool:
    """True only when entry exists AND is within TTL — never for stale last-known values."""
    with _cache_lock:
        entry = _cache.get(key)
        return bool(entry and (time.monotonic() - entry[1]) < ttl)

# ── 公共 Async 接口 (11 个文件调用的入口) ─────────────────────────────

async def get_spot_price(ticker: str) -> Decimal | None:
    ticker = ticker.upper()
    spot_key = f"spot:{ticker}"
    cached = _get_cached(spot_key, 60.0)
    if cached is not None:
        if not _is_cache_fresh(spot_key, 60.0):
            # Stale last-known value: serve immediately, schedule ONE background
            # refresh (deduped — 3 concurrent callers → still only 1 FMP call)
            _schedule_bg_refresh(spot_key, _do_fetch_quote, ticker)
        # Fresh hit: return as-is — NO background call
        return cached
    # Absolute cache miss: blocking fetch in executor
    return await asyncio.get_running_loop().run_in_executor(_refresh_pool, _do_fetch_quote, ticker)

async def get_spot_prices_batch(tickers: list[str]) -> dict[str, Decimal]:
    tasks = [get_spot_price(t) for t in tickers]
    results = await asyncio.gather(*tasks)
    return {t.upper(): r for t, r in zip(tickers, results) if r is not None}

async def get_prev_close(ticker: str) -> Decimal | None:
    """
    Get yesterday's official closing price (FMP /quote previousClose field).

    Cached with a 24h TTL — previousClose is stable for the entire trading day
    and is the correct baseline for daily P&L calculation.
    """
    ticker = ticker.upper()
    cached = _get_cached(f"prev_close:{ticker}", 86400.0)
    if cached is not None:
        return cached
    # Not cached yet — fetch a full quote to populate both spot and prev_close
    await asyncio.get_running_loop().run_in_executor(_refresh_pool, _do_fetch_quote, ticker)
    return _get_cached(f"prev_close:{ticker}", 86400.0)

def get_prev_close_cached_only(ticker: str) -> Decimal | None:
    """
    Return prev_close from in-memory cache — zero network I/O.

    Used by NlvSamplerService so NLV computation never triggers API calls.
    Returns None if prev_close hasn't been populated yet (prewarm not done).
    """
    key = f"prev_close:{ticker.upper()}"
    with _cache_lock:
        entry = _cache.get(key)
        if entry:
            return entry[0]
    return _last_known.get(key)


def get_spot_cached_only(ticker: str) -> Decimal | None:
    """
    Return the most recently cached spot price — zero network I/O.

    Used as a fallback when historical price data is unavailable, to prevent
    a symbol's contribution from being zeroed out in NLV calculations.
    Returns None if the spot price has never been fetched for this ticker.
    """
    key = f"spot:{ticker.upper()}"
    with _cache_lock:
        entry = _cache.get(key)
        if entry:
            return entry[0]
    return _last_known.get(key)


def nearest_business_day_back(d: date) -> date:
    """
    Return d if it falls on a weekday (Mon–Fri), otherwise step back to the
    most recent Friday.  Ensures history start-dates never land on a weekend,
    which can cause FMP to return an empty leading segment.
    """
    while d.weekday() >= 5:   # 5 = Saturday, 6 = Sunday
        d -= timedelta(days=1)
    return d


def get_change_cached(ticker: str) -> Decimal | None:
    """Return cached intraday change (price delta from previous close)."""
    return _last_known.get(f"change:{ticker.upper()}")


def get_changepct_cached(ticker: str) -> Decimal | None:
    """Return cached changesPercentage from FMP quote."""
    return _last_known.get(f"changepct:{ticker.upper()}")


def _do_fetch_1y_closes(ticker: str) -> list[float]:
    """Synchronous 1-year history fetch — runs in the background thread pool."""
    ticker = ticker.upper()
    hist = _do_fetch_hist_data(ticker)
    closes = [float(d["close"]) for d in reversed(hist[:252]) if "close" in d]
    if closes:
        _set_cached(f"1y:{ticker}", closes)
    return closes


# ── /stock-price-change — single-call multi-period performance ─────────────

def _do_fetch_stock_price_change(ticker: str) -> dict[str, float | None] | None:
    """
    Fetch pre-computed price changes from FMP /stock-price-change.

    Returns {1d, 5d, 1m, 3m} as float percentages, or None on failure.
    FMP response: [{symbol, 1D, 5D, 1M, 3M, 6M, ytd, 1Y, ...}]
    """
    fmp_s = _fmp_sym(ticker)
    data = _fmp_get("/stock-price-change", {"symbol": fmp_s})
    if not isinstance(data, list) or len(data) == 0:
        return None
    item = data[0]

    def _safe_float(key: str) -> float | None:
        v = item.get(key)
        if v is None:
            return None
        try:
            return round(float(v), 2)
        except (ValueError, TypeError):
            return None

    result = {
        "1d": _safe_float("1D"),
        "5d": _safe_float("5D"),
        "1m": _safe_float("1M"),
        "3m": _safe_float("3M"),
    }
    ticker_upper = ticker.upper()
    _set_cached(f"perf:{ticker_upper}", result)
    return result


async def get_perf_cached(ticker: str) -> dict[str, float | None]:
    """
    Return multi-period performance: {1d, 5d, 1m, 3m} as float percentages.

    Strategy (fastest first):
      1. Warm cache hit (perf: key)  → instant, zero I/O.
      2. /stock-price-change API     → single FMP call returns all periods.
      3. Fallback: 1-year closes     → compute from daily close history.
      4. Timeout / fail              → return None placeholders.

    1d is always overridden with live FMP changesPercentage when available.
    Never raises; always returns a dict.
    """
    ticker_upper = ticker.upper()

    # ── 1. Warm cache hit — instant ──────────────────────────────────
    perf_key = f"perf:{ticker_upper}"
    cached = _get_cached(perf_key, 300.0)  # 5-min TTL
    if isinstance(cached, dict) and any(v is not None for v in cached.values()):
        # Schedule SWR background refresh if stale
        if not _is_cache_fresh(perf_key, 300.0):
            _schedule_bg_refresh(perf_key, _do_fetch_stock_price_change, ticker_upper)
        result = dict(cached)
        live_1d = get_changepct_cached(ticker_upper)
        if live_1d is not None:
            result["1d"] = float(live_1d)
        return result

    # ── 2. Try /stock-price-change (single API call) ─────────────────
    loop = asyncio.get_running_loop()
    try:
        spc = await asyncio.wait_for(
            loop.run_in_executor(_refresh_pool, _do_fetch_stock_price_change, ticker_upper),
            timeout=3.0,
        )
    except asyncio.TimeoutError:
        spc = None

    if isinstance(spc, dict) and any(v is not None for v in spc.values()):
        live_1d = get_changepct_cached(ticker_upper)
        if live_1d is not None:
            spc["1d"] = float(live_1d)
        return spc

    # ── 3. Fallback: compute from 1-year close history ───────────────
    key_1y = f"1y:{ticker_upper}"
    closes = _last_known.get(key_1y)
    if not isinstance(closes, list) or len(closes) < 2:
        try:
            closes = await asyncio.wait_for(
                loop.run_in_executor(_refresh_pool, _do_fetch_1y_closes, ticker_upper),
                timeout=3.0,
            )
        except asyncio.TimeoutError:
            stale = _last_known.get(key_1y)
            if isinstance(stale, list) and len(stale) >= 2:
                closes = stale
            else:
                return {"1d": None, "5d": None, "1m": None, "3m": None}
        if not isinstance(closes, list) or len(closes) < 2:
            return {"1d": None, "5d": None, "1m": None, "3m": None}

    def _pct(n: int) -> float | None:
        if len(closes) <= n:
            return None
        base = closes[-1 - n]
        if not base:
            return None
        return round((closes[-1] / base - 1) * 100, 2)

    result = {"1d": _pct(1), "5d": _pct(5), "1m": _pct(22), "3m": _pct(66)}
    live_1d = get_changepct_cached(ticker_upper)
    if live_1d is not None:
        result["1d"] = float(live_1d)
    # Warm the perf cache so next call is instant
    _set_cached(perf_key, result)
    return result


# ── /analyst-estimates — forward EPS & revenue estimates ───────────────────

def _do_fetch_analyst_estimates(ticker: str) -> dict | None:
    """
    Fetch analyst consensus estimates from FMP /analyst-estimates.

    Returns structured dict with current/next year EPS + revenue estimates.
    FMP has migrated field names (estimatedEpsAvg → epsAvg etc.) so we
    accept both old and new keys.
    """
    fmp_s = _fmp_sym(ticker)
    data = _fmp_get("/analyst-estimates", {"symbol": fmp_s})
    if not isinstance(data, list) or len(data) == 0:
        return None

    # FMP returns future fiscal years first (desc by date).
    # Take the first two entries as next_year and current_year.
    estimates: list[dict] = []
    for item in data[:2]:
        entry = {
            "date":                  item.get("date"),
            "estimated_revenue_low":  _safe_decimal(_coalesce(item, "revenueLow", "estimatedRevenueLow")),
            "estimated_revenue_high": _safe_decimal(_coalesce(item, "revenueHigh", "estimatedRevenueHigh")),
            "estimated_revenue_avg":  _safe_decimal(_coalesce(item, "revenueAvg", "estimatedRevenueAvg")),
            "estimated_eps_avg":      _safe_float_val(_coalesce(item, "epsAvg", "estimatedEpsAvg")),
            "estimated_eps_high":     _safe_float_val(_coalesce(item, "epsHigh", "estimatedEpsHigh")),
            "estimated_eps_low":      _safe_float_val(_coalesce(item, "epsLow", "estimatedEpsLow")),
            "number_analysts_estimated_revenue": int(item.get("numberAnalystsEstimatedRevenue") or 0),
            "number_analysts_estimated_eps":     int(item.get("numberAnalystsEstimatedEps") or 0),
        }
        estimates.append(entry)

    result = {"estimates": estimates}
    _set_cached(f"estimates:{ticker.upper()}", result)
    return result


async def get_analyst_estimates(ticker: str) -> dict | None:
    """
    Return analyst estimates for a ticker (24h TTL, SWR).

    Returns: {estimates: [{date, estimated_eps_avg, estimated_revenue_avg, ...}, ...]}
    """
    ticker = ticker.upper()
    cache_key = f"estimates:{ticker}"
    cached = _get_cached(cache_key, 86400.0)  # 24h TTL
    if isinstance(cached, dict):
        if not _is_cache_fresh(cache_key, 86400.0):
            _schedule_bg_refresh(cache_key, _do_fetch_analyst_estimates, ticker)
        return cached
    return await asyncio.get_running_loop().run_in_executor(
        _refresh_pool, _do_fetch_analyst_estimates, ticker
    )


# ── /profile — company profile (sector, mktCap, description, image) ───────

def _do_fetch_company_profile(ticker: str) -> dict | None:
    """
    Fetch company profile from FMP /profile.

    FMP response: [{symbol, mktCap, industry, sector, description, image,
                     companyName, exchange, currency, country, ...}]
    """
    fmp_s = _fmp_sym(ticker)
    data = _fmp_get("/profile", {"symbol": fmp_s})
    if not isinstance(data, list) or len(data) == 0:
        return None

    item = data[0]
    profile = {
        "symbol":       item.get("symbol", ""),
        "company_name": item.get("companyName", ""),
        "mkt_cap":      _safe_decimal(item.get("mktCap")),
        "industry":     item.get("industry", ""),
        "sector":       _normalise_sector(item.get("sector", "")),
        "description":  item.get("description", ""),
        "image":        item.get("image", ""),
        "exchange":     item.get("exchange", ""),
        "currency":     item.get("currency", ""),
        "country":      item.get("country", ""),
        "ipo_date":     item.get("ipoDate", ""),
        "full_time_employees": int(item.get("fullTimeEmployees") or 0),
    }
    _set_cached(f"profile:{ticker.upper()}", profile)

    # Side-effect: update screener sector cache for improved sector exposure
    sector = profile["sector"]
    if sector:
        with _screener_meta_lock:
            existing = _screener_meta.get(ticker.upper(), {})
            existing["sector"] = sector
            _screener_meta[ticker.upper()] = existing

    return profile


async def get_company_profile(ticker: str) -> dict | None:
    """
    Return company profile for a ticker (24h TTL, SWR).

    Returns: {symbol, company_name, mkt_cap, industry, sector, description,
              image, exchange, currency, country, ipo_date, full_time_employees}
    """
    ticker = ticker.upper()
    cache_key = f"profile:{ticker}"
    cached = _get_cached(cache_key, 86400.0)  # 24h TTL
    if isinstance(cached, dict):
        if not _is_cache_fresh(cache_key, 86400.0):
            _schedule_bg_refresh(cache_key, _do_fetch_company_profile, ticker)
        return cached
    return await asyncio.get_running_loop().run_in_executor(
        _refresh_pool, _do_fetch_company_profile, ticker
    )


# ── /historical-chart/5min — intraday 5-minute OHLCV bars ─────────────────

def _do_fetch_intraday_5min(ticker: str) -> list[dict] | None:
    """
    Fetch intraday 5-minute chart data from FMP /historical-chart/5min.

    FMP response: [{date, open, high, low, close, volume}, ...]
    Returns list of dicts with Decimal prices, sorted chronologically.
    """
    fmp_s = _fmp_sym(ticker)
    data = _fmp_get("/historical-chart/5min", {"symbol": fmp_s})
    if not isinstance(data, list) or len(data) == 0:
        return None

    # FMP returns newest-first; reverse to chronological order
    bars: list[dict] = []
    for item in reversed(data):
        bar = {
            "date":   item.get("date", ""),
            "open":   _safe_decimal(item.get("open")),
            "high":   _safe_decimal(item.get("high")),
            "low":    _safe_decimal(item.get("low")),
            "close":  _safe_decimal(item.get("close")),
            "volume": int(item.get("volume") or 0),
        }
        bars.append(bar)

    _set_cached(f"intraday5m:{ticker.upper()}", bars)
    return bars


async def get_intraday_5min(ticker: str) -> list[dict] | None:
    """
    Return intraday 5-minute bars for a ticker (60s TTL, SWR).

    Returns list of {date, open, high, low, close, volume} in chronological order.
    Prices are Decimal; volume is int.
    """
    ticker = ticker.upper()
    cache_key = f"intraday5m:{ticker}"
    cached = _get_cached(cache_key, 60.0)  # 1-min TTL for high-frequency rendering
    if isinstance(cached, list):
        if not _is_cache_fresh(cache_key, 60.0):
            _schedule_bg_refresh(cache_key, _do_fetch_intraday_5min, ticker)
        return cached
    return await asyncio.get_running_loop().run_in_executor(
        _refresh_pool, _do_fetch_intraday_5min, ticker
    )


# ── /technical-indicators/sma — SMA(200) for risk modeling ─────────────────

def _do_fetch_sma(ticker: str, period: int = 200) -> list[dict] | None:
    """
    Fetch SMA technical indicator from FMP /technical-indicators/sma.

    FMP response: [{date, sma, open, high, low, close, volume}, ...]
    Returns list of {date, sma, close} in chronological order.
    """
    fmp_s = _fmp_sym(ticker)
    data = _fmp_get("/technical-indicators/sma", {
        "symbol": fmp_s,
        "periodLength": period,
        "timeframe": "daily",
    })
    if not isinstance(data, list) or len(data) == 0:
        return None

    # FMP returns newest-first; reverse for chronological
    points: list[dict] = []
    for item in reversed(data):
        sma_val = item.get("sma")
        if sma_val is None:
            continue
        points.append({
            "date":  item.get("date", ""),
            "sma":   round(float(sma_val), 4),
            "close": round(float(item.get("close", 0)), 4),
        })

    cache_key = f"sma{period}:{ticker.upper()}"
    _set_cached(cache_key, points)

    # Side-effect: cache the latest SMA value for quick lookups
    if points:
        _set_cached(f"sma{period}_latest:{ticker.upper()}", points[-1]["sma"])

    return points


async def get_sma(ticker: str, period: int = 200) -> list[dict] | None:
    """
    Return SMA data points for a ticker (1h TTL, SWR).

    Returns list of {date, sma, close} in chronological order.
    """
    ticker = ticker.upper()
    cache_key = f"sma{period}:{ticker}"
    cached = _get_cached(cache_key, 3600.0)  # 1h TTL
    if isinstance(cached, list):
        if not _is_cache_fresh(cache_key, 3600.0):
            _schedule_bg_refresh(cache_key, _do_fetch_sma, ticker, period)
        return cached
    return await asyncio.get_running_loop().run_in_executor(
        _refresh_pool, _do_fetch_sma, ticker, period
    )


def get_sma_latest_cached(ticker: str, period: int = 200) -> float | None:
    """Return the most recent SMA value from cache — zero network I/O."""
    return _last_known.get(f"sma{period}_latest:{ticker.upper()}")


# ── Shared type-conversion helpers ─────────────────────────────────────────

def _coalesce(d: dict, *keys: str) -> object | None:
    """Return the first non-None value from d for the given keys."""
    for k in keys:
        v = d.get(k)
        if v is not None:
            return v
    return None


def _safe_decimal(val: object) -> Decimal | None:
    """Convert a value to Decimal, returning None on failure."""
    if val is None:
        return None
    try:
        return Decimal(str(val)).quantize(Decimal("0.0001"))
    except Exception:
        return None


def _safe_float_val(val: object) -> float | None:
    """Convert a value to float, returning None on failure."""
    if val is None:
        return None
    try:
        return round(float(val), 4)
    except (ValueError, TypeError):
        return None


async def get_hist_vol(ticker: str) -> Decimal:
    ticker = ticker.upper()
    hvol_key = f"hvol:{ticker}"
    cached = _get_cached(hvol_key, 3600.0)  # 1h cache — avoids repeat FMP calls
    if cached:
        if not _is_cache_fresh(hvol_key, 3600.0):
            # Schedule deduped background refresh so concurrent callers share one task
            def _calc_bg():
                hist = _do_fetch_hist_data(ticker)
                if len(hist) >= 10:
                    closes = [float(d["close"]) for d in reversed(hist[:90]) if "close" in d]
                    vol = compute_historical_vol(closes[-30:])
                    _set_cached(hvol_key, vol)
            _schedule_bg_refresh(hvol_key, _calc_bg)
        return cached
    def _calc():
        hist = _do_fetch_hist_data(ticker)
        if len(hist) < 10:
            return DEFAULT_SIGMA
        closes = [float(d["close"]) for d in reversed(hist[:90]) if "close" in d]
        vol = compute_historical_vol(closes[-30:])
        _set_cached(hvol_key, vol)
        return vol
    return await asyncio.get_running_loop().run_in_executor(_refresh_pool, _calc)

async def get_1y_closes(ticker: str) -> list[float]:
    ticker = ticker.upper()
    cache_key = f"1y:{ticker}"
    cached = _get_cached(cache_key, 3600.0)
    if isinstance(cached, list) and len(cached) > 0:
        return cached
    def _fetch():
        hist = _do_fetch_hist_data(ticker)
        closes = [float(d["close"]) for d in reversed(hist[:252]) if "close" in d]
        if closes:
            _set_cached(cache_key, closes)
        return closes
    return await asyncio.get_running_loop().run_in_executor(_refresh_pool, _fetch)

async def get_price_history(ticker: str, start_date: str) -> dict[str, float]:
    """
    Returns {date_str: close_price} from start_date to today.

    Cached for 10 minutes — the 30-day history chart renders on every page load
    but the data only changes once a day.  Without this cache, each of N users
    loading the Holdings page triggers a fresh FMP history call per stock symbol.
    """
    cache_key = f"history:{ticker.upper()}:{start_date}"
    cached = _get_cached(cache_key, 600.0)  # 10-min TTL
    if isinstance(cached, dict):
        return cached
    def _fetch():
        hist = _do_fetch_hist_data(ticker, {"from": start_date})
        result = {d["date"]: float(d["close"]) for d in hist if "date" in d and "close" in d}
        if result:
            _set_cached(cache_key, result)
        return result
    return await asyncio.get_running_loop().run_in_executor(_refresh_pool, _fetch)

# Core market indices — always pre-warmed, never screener-excluded
_CORE_TICKERS: frozenset[str] = frozenset({"SPY", "QQQ", "VIX"})

async def prewarm(symbols: list[str]):
    """
    Prewarm spot cache for startup — two-phase to keep Render health check fast.

    Phase 1 (blocking): fetch core indices + user symbols concurrently.
      Guarantees the ticker bar lights up before the health check hits.
    Phase 2 (background): fire sync_screener_to_cache() as an asyncio Task.
      Bulk-fills the broader spot cache without blocking the server start.
    """
    # Phase 1: core indices first — these make the top-bar live immediately
    core_task = get_spot_prices_batch(list(_CORE_TICKERS))
    user_task = get_spot_prices_batch([s.upper() for s in symbols if s.strip()])
    await asyncio.gather(core_task, user_task)

    # Phase 2: screener bulk-fill in background — no await, no blocking
    asyncio.create_task(sync_screener_to_cache())


# ── Company Screener — bulk cache pre-fill + business-layer metadata ──────────

_MIN_SCREENER_VOLUME = 500_000
_screener_meta: dict[str, dict] = {}   # sym → {"isFund": bool, "volume": int, "sector": str}
_screener_meta_lock = threading.Lock()

# Normalise sector labels that vary between FMP endpoints / historical data.
_SECTOR_NORMALIZE: dict[str, str] = {
    "information technology":   "Technology",
    "tech":                     "Technology",
    "financial services":       "Financials",
    "financial":                "Financials",
    "finance":                  "Financials",
    "banking":                  "Financials",
    "health care":              "Healthcare",
    "healthcare":               "Healthcare",
    "consumer cyclical":        "Consumer Discretionary",
    "consumer defensive":       "Consumer Staples",
    "basic materials":          "Materials",
    "communication services":   "Communication Services",
    "real estate":              "Real Estate",
    "utilities":                "Utilities",
    "industrials":              "Industrials",
    "energy":                   "Energy",
}

# Hardcoded fallback for very common tickers in case screener data is absent.
_TICKER_SECTOR_FALLBACK: dict[str, str] = {
    "NVDA":  "Technology",
    "AAPL":  "Technology",
    "MSFT":  "Technology",
    "GOOGL": "Technology",
    "GOOG":  "Technology",
    "META":  "Technology",
    "AMD":   "Technology",
    "INTC":  "Technology",
    "CRM":   "Technology",
    "ORCL":  "Technology",
    "TSLA":  "Consumer Discretionary",
    "AMZN":  "Consumer Discretionary",
    "HD":    "Consumer Discretionary",
    "NKE":   "Consumer Discretionary",
    "COST":  "Consumer Staples",
    "WMT":   "Consumer Staples",
    "PG":    "Consumer Staples",
    "KO":    "Consumer Staples",
    "JPM":   "Financials",
    "BAC":   "Financials",
    "GS":    "Financials",
    "MS":    "Financials",
    "BRK.B": "Financials",
    "V":     "Financials",
    "MA":    "Financials",
    "JNJ":   "Healthcare",
    "UNH":   "Healthcare",
    "PFE":   "Healthcare",
    "ABBV":  "Healthcare",
    "LLY":   "Healthcare",
    "MRK":   "Healthcare",
    "XOM":   "Energy",
    "CVX":   "Energy",
    "COP":   "Energy",
    "BA":    "Industrials",
    "CAT":   "Industrials",
    "GE":    "Industrials",
    "UPS":   "Industrials",
    "T":     "Communication Services",
    "VZ":    "Communication Services",
    "NFLX":  "Communication Services",
    "DIS":   "Communication Services",
    "AMT":   "Real Estate",
    "NEE":   "Utilities",
    "SO":    "Utilities",
}


def _normalise_sector(raw: str) -> str:
    """Return a canonical sector label, or empty string if unrecognised."""
    if not raw:
        return ""
    key = raw.lower().strip()
    return _SECTOR_NORMALIZE.get(key, raw.strip())


def _do_sync_screener() -> None:
    """
    Call FMP /company-screener, bulk-fill spot:{sym} cache, record metadata.

    Single HTTP call pre-warms the spot cache for all NASDAQ/NYSE equities
    with volume > 500k before the scanner loop fetches 1-year history.
    """
    data = _fmp_get("/company-screener", {
        "exchange": "NASDAQ,NYSE",
        "volumeMoreThan": _MIN_SCREENER_VOLUME,
        "limit": 500,
    })
    if not isinstance(data, list):
        logger.warning("Screener: unexpected response type %s", type(data).__name__)
        return

    meta: dict[str, dict] = {}
    cached_count = 0
    for idx, item in enumerate(data):
        sym = (item.get("symbol") or "").upper()
        if not sym:
            continue
        price = item.get("price")
        if price is not None:
            try:
                val = Decimal(str(price)).quantize(Decimal("0.0001"))
                _set_cached(f"spot:{sym}", val)
                cached_count += 1
            except Exception:
                pass
        raw_sector = str(item.get("sector") or "").strip()
        meta[sym] = {
            "isFund":  bool(item.get("isFund")),
            "volume":  int(item.get("volume") or 0),
            "sector":  _normalise_sector(raw_sector),
        }
        # Yield CPU every 50 items — prevents event-loop starvation on Render
        if idx % 50 == 49:
            time.sleep(0.01)

    with _screener_meta_lock:
        _screener_meta.update(meta)

    logger.info(
        "Screener sync: %d prices cached from %d results", cached_count, len(data)
    )


async def sync_screener_to_cache() -> None:
    """Async wrapper — runs screener bulk-fill in the thread pool."""
    await asyncio.get_running_loop().run_in_executor(_refresh_pool, _do_sync_screener)


def is_screener_excluded(sym: str) -> bool:
    """
    Return True if the symbol should be skipped by the scanner.

    Exclusion criteria (from last screener run):
      - isFund is True  (mutual fund, not tradeable intraday)
      - volume < _MIN_SCREENER_VOLUME

    Core tickers (SPY, QQQ, VIX) always return False — they are never excluded
    regardless of screener result. Unknown symbols also return False.
    """
    sym = sym.upper()
    if sym in _CORE_TICKERS:
        return False   # hardcoded core indices always pass
    with _screener_meta_lock:
        info = _screener_meta.get(sym)
    if info is None:
        return False   # not seen in screener → allow by default
    return info["isFund"] or info["volume"] < _MIN_SCREENER_VOLUME

def get_cached_sector(symbol: str) -> str:
    """
    Return the sector label for *symbol* from the screener cache, falling back
    to the hardcoded _TICKER_SECTOR_FALLBACK table.

    Returns an empty string if the sector is genuinely unknown.  Callers should
    treat an empty return value as "no sector data" and use a generic label.
    """
    sym = normalize_ticker(symbol)
    with _screener_meta_lock:
        info = _screener_meta.get(sym)
    if info:
        sector = info.get("sector", "")
        if sector:
            return sector
    return _TICKER_SECTOR_FALLBACK.get(sym, "")


# ── /treasury-rates — US treasury yields ──────────────────────────────────

def _do_fetch_treasury_rates() -> dict | None:
    """
    Fetch latest US treasury yields from FMP /treasury-rates.

    FMP response: [{date, month1, month2, month3, month6, year1, year2,
                     year3, year5, year7, year10, year20, year30}, ...]
    Returns dict with maturity → yield mappings, or None on failure.
    """
    data = _fmp_get("/treasury-rates", {})
    if not isinstance(data, list) or len(data) == 0:
        return None

    item = data[0]
    result = {
        "date":    item.get("date"),
        "month1":  _safe_float_val(item.get("month1")),
        "month3":  _safe_float_val(item.get("month3")),
        "month6":  _safe_float_val(item.get("month6")),
        "year1":   _safe_float_val(item.get("year1")),
        "year2":   _safe_float_val(item.get("year2")),
        "year5":   _safe_float_val(item.get("year5")),
        "year10":  _safe_float_val(item.get("year10")),
        "year20":  _safe_float_val(item.get("year20")),
        "year30":  _safe_float_val(item.get("year30")),
    }
    _set_cached("treasury_rates", result)
    return result


async def get_treasury_rates() -> dict | None:
    """
    Return latest US treasury yields (1h TTL, SWR).

    Returns: {date, month1, month3, month6, year1, year2, year5,
              year10, year20, year30} — values are float percentages or None.
    """
    cache_key = "treasury_rates"
    cached = _get_cached(cache_key, 3600.0)  # 1h TTL — rates change slowly
    if isinstance(cached, dict):
        if not _is_cache_fresh(cache_key, 3600.0):
            _schedule_bg_refresh(cache_key, _do_fetch_treasury_rates)
        return cached
    return await asyncio.get_running_loop().run_in_executor(
        _refresh_pool, _do_fetch_treasury_rates
    )


async def get_ytd_return(ticker: str) -> Decimal | None:
    closes = await get_1y_closes(ticker)
    if len(closes) < 2: return None
    start_price, current_price = closes[0], closes[-1]
    if start_price <= 0: return None
    return Decimal(str(round((current_price - start_price) / start_price, 6)))
