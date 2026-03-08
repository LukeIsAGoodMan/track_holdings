"""
FMP 2026 Stable Protocol - Unified Production Implementation
1. 100% 对齐规范：使用 /quote?symbol= 和 /historical-price-eod/full?symbol=
2. 完整保留原始符号映射 (^GSPC -> SPY, ^VIX -> VIX)
3. 补全 get_1y_closes 接口，修复部署 ImportError

Performance hardening (止血):
- _SyncTokenBucket:       global 2 req/s cap on all outbound FMP calls
- _refresh_scheduled:     deduplicates concurrent background refreshes for the same key
- get_price_history():    10-min TTL cache (was uncached — hit on every chart render)
"""
from __future__ import annotations
import asyncio
import logging
import threading
import time
from datetime import date
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

# ── 符号映射 (必须保留，用于 scanner_service 扫描指数) ──────────────
_SYMBOL_MAP: dict[str, str] = {
    "^GSPC": "SPY",
    "^VIX":  "VIX",
}

def _fmp_sym(sym: str) -> str:
    return _SYMBOL_MAP.get(sym.upper(), sym.upper())

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


def get_change_cached(ticker: str) -> Decimal | None:
    """Return cached intraday change (price delta from previous close)."""
    return _last_known.get(f"change:{ticker.upper()}")


def get_changepct_cached(ticker: str) -> Decimal | None:
    """Return cached changesPercentage from FMP quote."""
    return _last_known.get(f"changepct:{ticker.upper()}")


def get_perf_cached(ticker: str) -> dict[str, float | None]:
    """
    Return multi-period performance from cached 1-year close history — zero network I/O.

    Periods: 1d (1 close back), 5d (5), 1m (~22 trading days), 3m (~66 trading days).
    Returns None for each period when the cache doesn't have enough data.
    Used by holdings router to enrich HoldingGroup without triggering API calls.
    """
    key = f"1y:{ticker.upper()}"
    closes = _last_known.get(key)
    if not isinstance(closes, list) or len(closes) < 2:
        return {"1d": None, "5d": None, "1m": None, "3m": None}

    def _pct(n: int) -> float | None:
        if len(closes) <= n:
            return None
        base = closes[-1 - n]
        if not base:
            return None
        return round((closes[-1] / base - 1) * 100, 2)

    return {"1d": _pct(1), "5d": _pct(5), "1m": _pct(22), "3m": _pct(66)}


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
_screener_meta: dict[str, dict] = {}   # sym → {"isFund": bool, "volume": int}
_screener_meta_lock = threading.Lock()


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
        meta[sym] = {
            "isFund": bool(item.get("isFund")),
            "volume": int(item.get("volume") or 0),
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

async def get_ytd_return(ticker: str) -> Decimal | None:
    closes = await get_1y_closes(ticker)
    if len(closes) < 2: return None
    start_price, current_price = closes[0], closes[-1]
    if start_price <= 0: return None
    return Decimal(str(round((current_price - start_price) / start_price, 6)))
