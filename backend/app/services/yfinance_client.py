"""
FMP 2026 Stable Protocol - Unified Production Implementation
1. 100% 对齐规范：使用 /quote?symbol= 和 /historical-price-eod/full?symbol=
2. 完整保留原始符号映射 (^GSPC -> SPY, ^VIX -> VIX)
3. 补全 get_1y_closes 接口，修复部署 ImportError
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

# ── 核心私有获取逻辑 (严格遵循表格规范) ──────────────────────────────

def _fmp_get(path: str, params: dict) -> object | None:
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
    if isinstance(data, dict) and "historical" in data:
        return data["historical"]
    return []

# ── SWR 缓存与锁 ──────────────────────────────────────────────────

_cache: dict[str, tuple[object, float]] = {}
_last_known: dict[str, object] = {}
_cache_lock = threading.Lock()
_refresh_pool = ThreadPoolExecutor(max_workers=50)

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

# ── 公共 Async 接口 (11 个文件调用的入口) ─────────────────────────────

async def get_spot_price(ticker: str) -> Decimal | None:
    ticker = ticker.upper()
    cached = _get_cached(f"spot:{ticker}", 60.0)
    if cached:
        # Fire background refresh without blocking — discard the Future
        asyncio.get_running_loop().run_in_executor(_refresh_pool, _do_fetch_quote, ticker)
        return cached
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


async def get_hist_vol(ticker: str) -> Decimal:
    ticker = ticker.upper()
    cached = _get_cached(f"hvol:{ticker}", 3600.0)  # 1h cache — avoids repeat FMP calls
    if cached:
        return cached
    def _calc():
        hist = _do_fetch_hist_data(ticker)
        if len(hist) < 10:
            return DEFAULT_SIGMA
        closes = [float(d["close"]) for d in reversed(hist[:90]) if "close" in d]
        vol = compute_historical_vol(closes[-30:])
        _set_cached(f"hvol:{ticker}", vol)
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
    def _fetch():
        hist = _do_fetch_hist_data(ticker, {"from": start_date})
        return {d["date"]: float(d["close"]) for d in hist if "date" in d and "close" in d}
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