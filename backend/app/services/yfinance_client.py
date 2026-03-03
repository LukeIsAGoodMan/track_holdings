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
    try:
        resp = _SESSION.get(url, params=params, timeout=_HTTP_TIMEOUT)
        if resp.status_code == 403:
            logger.error("FMP 403 Forbidden: %s | body=%s", path, resp.text[:500])
            return None
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.error(f"FMP Request Error: {path} {params.get('symbol')} -> {e}")
        return None

def _do_fetch_quote(ticker: str) -> Decimal | None:
    fmp_s = _fmp_sym(ticker)
    data = _fmp_get("/quote", {"symbol": fmp_s})
    if data and isinstance(data, list) and len(data) > 0:
        price = data[0].get("price")
        if price:
            val = Decimal(str(price)).quantize(Decimal("0.0001"))
            _set_cached(f"spot:{ticker.upper()}", val)
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
_refresh_pool = ThreadPoolExecutor(max_workers=8)

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
        asyncio.get_event_loop().run_in_executor(_refresh_pool, _do_fetch_quote, ticker)
        return cached
    return await asyncio.get_event_loop().run_in_executor(_refresh_pool, _do_fetch_quote, ticker)

async def get_spot_prices_batch(tickers: list[str]) -> dict[str, Decimal]:
    tasks = [get_spot_price(t) for t in tickers]
    results = await asyncio.gather(*tasks)
    return {t: r for t, r in zip(tickers, results) if r is not None}

async def get_hist_vol(ticker: str) -> Decimal:
    ticker = ticker.upper()
    def _calc():
        hist = _do_fetch_hist_data(ticker)
        if len(hist) < 10: return DEFAULT_SIGMA
        closes = [float(d["close"]) for d in reversed(hist[:90]) if "close" in d]
        return compute_historical_vol(closes[-30:])
    return await asyncio.get_event_loop().run_in_executor(_refresh_pool, _calc)

async def get_1y_closes(ticker: str) -> list[float]:
    """修复导入错误的关键接口"""
    ticker = ticker.upper()
    cache_key = f"1y:{ticker}"
    cached = _get_cached(cache_key, 3600.0)
    if isinstance(cached, list) and len(cached) > 0:
        return cached
    def _fetch():
        hist = _do_fetch_hist_data(ticker)
        closes = [float(d["close"]) for d in reversed(hist[:252]) if "close" in d]
        if closes: _set_cached(cache_key, closes)
        return closes
    return await asyncio.get_event_loop().run_in_executor(_refresh_pool, _fetch)

async def get_price_history(ticker: str, start_date: str) -> dict[str, float]:
    def _fetch():
        hist = _do_fetch_hist_data(ticker, {"from": start_date})
        return {d["date"]: float(d["close"]) for d in hist if "date" in d and "close" in d}
    return await asyncio.get_event_loop().run_in_executor(_refresh_pool, _fetch)

async def prewarm(symbols: list[str]):
    await get_spot_prices_batch(symbols)

async def get_ytd_return(ticker: str) -> Decimal | None:
    closes = await get_1y_closes(ticker)
    if len(closes) < 2: return None
    start_price, current_price = closes[0], closes[-1]
    if start_price <= 0: return None
    return Decimal(str(round((current_price - start_price) / start_price, 6)))