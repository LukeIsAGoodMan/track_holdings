"""
Financial Modeling Prep (FMP) — 2026 Stable Protocol.

All endpoints use the /stable/ prefix (legacy /v3/ and /v4/ deprecated).

Spot prices:
  Primary:  /stable/quote/SYM1,SYM2,...     (batch)
  Fallback: /stable/search-symbol?query=SYM  (per-symbol, data[0]['price'])

Historical: /stable/historical-price-full/{symbol}

SWR cache (PRO — near-real-time):
  Spot fresh   = 60s  (1 min).   Historical fresh = 3600s (1h).
  Stale window = 2h.             Zero-Value Guard (never expires).

Symbol mapping:  ^GSPC → SPY,  ^VIX → VIX.

Security:
  API key from FMP_API_KEY env var (set in Render dashboard).
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal

import requests

from app.config import settings
from app.services.black_scholes import compute_historical_vol, DEFAULT_SIGMA

logger = logging.getLogger(__name__)

# ── FMP config ──────────────────────────────────────────────────────────
_BASE = "https://financialmodelingprep.com/stable"
_API_KEY = settings.fmp_api_key
_HTTP_TIMEOUT = 5  # seconds — fail fast

# ── Symbol mapping (Yahoo-style → FMP) ──────────────────────────────────
_SYMBOL_MAP: dict[str, str] = {
    "^GSPC": "SPY",
    "^VIX":  "VIX",
}


def _fmp_sym(sym: str) -> str:
    return _SYMBOL_MAP.get(sym.upper(), sym.upper())


# ── HTTP session ────────────────────────────────────────────────────────
_session = requests.Session()
_session.headers["User-Agent"] = "TrackHoldings/1.0"


def _fmp_get(path: str, params: dict | None = None) -> object | None:
    """GET to FMP API.  Returns parsed JSON or None on any error."""
    url = f"{_BASE}{path}"
    p = {"apikey": _API_KEY}
    if params:
        p.update(params)
    try:
        resp = _session.get(url, params=p, timeout=_HTTP_TIMEOUT)
        # ── 403 diagnostic: log full body for IP-whitelist debugging ──
        if resp.status_code == 403:
            logger.error(
                "FMP 403 Forbidden: %s | body=%s", path, resp.text[:500]
            )
            return None
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, dict) and "Error Message" in data:
            logger.warning("FMP error: %s", data["Error Message"])
            return None
        return data
    except requests.Timeout:
        logger.warning("FMP timeout (>%ds) for %s", _HTTP_TIMEOUT, path)
    except ValueError:
        logger.warning("FMP invalid JSON for %s | body=%s", path, resp.text[:200])
    except Exception:
        logger.exception("FMP request failed: %s", path)
    return None


# ── Two-tier SWR cache ────────────────────────────────────────────────────
# _cache: (value, monotonic_timestamp).
# _last_known: zero-value guard — NEVER expires.

_cache: dict[str, tuple[object, float]] = {}
_last_known: dict[str, object] = {}
_cache_lock = threading.Lock()
_CACHE_TTL: float = 60.0     # 1 min fresh  (spot prices — PRO plan)
_HIST_TTL:  float = 3600.0   # 1h fresh     (vol, 1Y closes, price history)
_STALE_TTL: float = 7200.0   # 2h stale window


def _get_fresh(key: str, ttl: float | None = None) -> object | None:
    with _cache_lock:
        entry = _cache.get(key)
        if entry and (time.monotonic() - entry[1]) < (ttl or _CACHE_TTL):
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


# ── Background refresh (per-key, for historical data) ────────────────────
_bg_pending: set[str] = set()
_bg_lock = threading.Lock()
_refresh_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="fmp-bg")


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


# ── Batch spot refresh (debounced — one call for ALL stale symbols) ──────
_batch_spot_pending = False
_batch_spot_lock = threading.Lock()
_needs_fetch: set[str] = set()        # symbols requested but never fetched
_needs_fetch_lock = threading.Lock()


def _schedule_batch_spot_refresh() -> None:
    """Collect all stale + never-fetched spot symbols, refresh in one FMP call."""
    global _batch_spot_pending
    with _batch_spot_lock:
        if _batch_spot_pending:
            return
        _batch_spot_pending = True

    def _run() -> None:
        global _batch_spot_pending
        try:
            stale_syms: list[str] = []
            now = time.monotonic()
            with _cache_lock:
                for key, (_, ts) in _cache.items():
                    if key.startswith("spot:") and (now - ts) >= _CACHE_TTL:
                        stale_syms.append(key[5:])
            # Also grab symbols that were requested but never had cache entries
            with _needs_fetch_lock:
                needs = list(_needs_fetch)
                _needs_fetch.clear()
            for s in needs:
                if s not in stale_syms:
                    stale_syms.append(s)
            if stale_syms:
                _do_fetch_batch_spots(stale_syms)
                logger.debug("Batch spot refresh: %d symbols", len(stale_syms))
        except Exception:
            logger.exception("Batch spot refresh failed")
        finally:
            with _batch_spot_lock:
                _batch_spot_pending = False

    _refresh_pool.submit(_run)


# ── Internal _do_* helpers (actually hit FMP) ────────────────────────────

def _do_fetch_spot_search(fmp_sym: str) -> Decimal | None:
    """Fallback: /stable/search-symbol?query=SYM → data[0]['price']."""
    data = _fmp_get("/search-symbol", {"query": fmp_sym})
    if not data or not isinstance(data, list) or len(data) == 0:
        return None
    price = data[0].get("price")
    if price is not None and float(price) > 0:
        return Decimal(str(price)).quantize(Decimal("0.0001"))
    return None


def _do_fetch_batch_spots(symbols: list[str]) -> dict[str, Decimal]:
    """
    Fetch spot prices — batch-first with search-symbol fallback.

    1. Try /stable/quote/SYM1,SYM2,...  (single batch call)
    2. If batch fails or returns empty, fall back to
       /stable/search-symbol per symbol.
    """
    if not symbols:
        return {}

    fmp_syms = [_fmp_sym(s) for s in symbols]
    # Reverse mapping: FMP symbol → list of original symbols
    fmp_to_orig: dict[str, list[str]] = {}
    for orig, fmp in zip(symbols, fmp_syms):
        fmp_to_orig.setdefault(fmp, []).append(orig)

    result: dict[str, Decimal] = {}

    # ── Primary: batch quote ──────────────────────────────────────────
    csv_syms = ",".join(dict.fromkeys(fmp_syms))  # deduplicate, keep order
    data = _fmp_get(f"/quote/{csv_syms}")

    if data and isinstance(data, list):
        for quote in data:
            fmp_sym = quote.get("symbol", "")
            price = quote.get("price")
            if price is not None and float(price) > 0:
                dec_price = Decimal(str(price)).quantize(Decimal("0.0001"))
                for orig_sym in fmp_to_orig.get(fmp_sym, [fmp_sym]):
                    result[orig_sym] = dec_price
                    _set_cached(f"spot:{orig_sym}", dec_price)

    # ── Fallback: search-symbol for any symbols batch missed ──────────
    missed_fmp = [f for f in dict.fromkeys(fmp_syms) if not any(
        orig in result for orig in fmp_to_orig.get(f, [f])
    )]
    if missed_fmp:
        logger.info("Batch quote missed %d symbols, falling back to search-symbol", len(missed_fmp))
        for fmp_s in missed_fmp:
            price = _do_fetch_spot_search(fmp_s)
            if price is not None:
                for orig_sym in fmp_to_orig.get(fmp_s, [fmp_s]):
                    result[orig_sym] = price
                    _set_cached(f"spot:{orig_sym}", price)

    return result


def _do_fetch_historical(symbol: str, extra_params: dict | None = None) -> list[dict]:
    """Fetch historical daily data from FMP.  Plain endpoint by default."""
    fmp_sym = _fmp_sym(symbol)
    data = _fmp_get(f"/historical-price-full/{fmp_sym}", extra_params)
    if not data or not isinstance(data, dict):
        return []
    hist = data.get("historical", [])
    return hist if isinstance(hist, list) else []


def _do_fetch_hist_vol(upper: str) -> Decimal:
    """Compute 30-day historical vol from FMP daily closes."""
    # Plain endpoint — no timeseries param (PRO protocol)
    hist = _do_fetch_historical(upper)
    if len(hist) < 5:
        return DEFAULT_SIGMA
    # FMP returns newest-first → take last 90 entries, reverse to chronological
    hist = hist[:90]
    closes = [float(d["close"]) for d in reversed(hist) if "close" in d]
    if len(closes) < 5:
        return DEFAULT_SIGMA
    closes = closes[-30:]
    vol = compute_historical_vol(closes)
    _set_cached(f"hvol:{upper}", vol)
    return vol


def _do_fetch_1y_closes(upper: str) -> list[float]:
    """Fetch 1 year of daily closes from FMP (scanner — timeseries allowed)."""
    hist = _do_fetch_historical(upper, {"timeseries": "252"})
    if not hist:
        return []
    closes = [float(d["close"]) for d in reversed(hist) if "close" in d]
    if closes:
        _set_cached(f"1y:{upper}", closes)
    return closes


# ── SWR wrappers (called by the public async API) ───────────────────────

def _fetch_spot(ticker: str) -> Decimal | None:
    """
    SWR spot price — NEVER blocks on a network call:
      1. Fresh cache  → instant.
      2. Stale cache  → instant + batch bg refresh.
      3. Last-known   → instant + batch bg refresh.
      4. Empty        → None   + batch bg refresh (shimmer in frontend).
    """
    upper = ticker.upper()
    cache_key = f"spot:{upper}"

    fresh = _get_fresh(cache_key)
    if fresh is not None:
        return fresh

    stale = _get_stale(cache_key)
    if stale is not None:
        _schedule_batch_spot_refresh()
        return stale

    last = _get_last_known(cache_key)
    if last is not None:
        _schedule_batch_spot_refresh()
        logger.info("Zero-Value Guard: returning last_known spot for %s", upper)
        return last

    # No cached data — register for batch fetch, return None
    with _needs_fetch_lock:
        _needs_fetch.add(upper)
    _schedule_batch_spot_refresh()
    return None


def _fetch_hist_vol(ticker: str) -> Decimal:
    """SWR vol (1h fresh): fresh → stale+bg → last_known+bg → DEFAULT_SIGMA+bg."""
    upper = ticker.upper()
    cache_key = f"hvol:{upper}"

    fresh = _get_fresh(cache_key, ttl=_HIST_TTL)
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

    fresh = _get_fresh(cache_key, ttl=_HIST_TTL)
    if fresh is not None:
        return fresh
    stale = _get_stale(cache_key)
    if stale is not None:
        return stale

    try:
        today = date.today()
        hist = _do_fetch_historical(upper)
        if not hist:
            return _get_last_known(cache_key)
        # FMP returns newest-first → reverse
        hist = list(reversed(hist))
        jan1_prefix = f"{today.year}-01"
        start_idx = None
        for i, d in enumerate(hist):
            if d.get("date", "").startswith(jan1_prefix):
                start_idx = i
                break
        if start_idx is None:
            return None
        start_price = float(hist[start_idx]["close"])
        current_price = float(hist[-1]["close"])
        if start_price <= 0:
            return None
        result = Decimal(str(round((current_price - start_price) / start_price, 6)))
        _set_cached(cache_key, result)
        return result
    except Exception:
        logger.warning("FMP YTD return failed for %s", upper)

    return _get_last_known(cache_key)


def _fetch_price_history(ticker: str, start_date: str) -> dict[str, float]:
    upper = ticker.upper()
    cache_key = f"phist:{upper}:{start_date}"

    fresh = _get_fresh(cache_key, ttl=_HIST_TTL)
    if fresh is not None:
        return fresh
    stale = _get_stale(cache_key)
    if stale is not None:
        return stale

    try:
        fmp_sym = _fmp_sym(upper)
        data = _fmp_get(
            f"/historical-price-full/{fmp_sym}",
            {"from": start_date},
        )
        if data and isinstance(data, dict) and "historical" in data:
            result: dict[str, float] = {}
            for d in data["historical"]:
                dt = d.get("date")
                close = d.get("close")
                if dt and close is not None:
                    result[dt] = float(close)
            if result:
                _set_cached(cache_key, result)
            return result
    except Exception:
        logger.warning("FMP price history failed for %s", upper)

    last = _get_last_known(cache_key)
    return last if last is not None else {}


def _fetch_spots_batch(tickers: list[str]) -> dict[str, Decimal]:
    """
    Batch spot prices — single FMP call for ALL uncached symbols.
    Used by PriceFeedService (background poll every 5s).
    """
    if not tickers:
        return {}

    result: dict[str, Decimal] = {}
    uncached: list[str] = []

    for t in tickers:
        upper = t.upper()
        fresh = _get_fresh(f"spot:{upper}")
        if fresh is not None:
            result[upper] = fresh
        else:
            uncached.append(upper)

    if uncached:
        batch_result = _do_fetch_batch_spots(uncached)
        result.update(batch_result)

        # Fill remaining gaps from stale/last_known (zero-value guard)
        for sym in uncached:
            if sym not in result:
                val = _get_stale(f"spot:{sym}") or _get_last_known(f"spot:{sym}")
                if val is not None:
                    result[sym] = val

    return result


def _fetch_1y_closes(ticker: str) -> list[float]:
    """Cache-first 1Y closes — bg refresh only, never blocks scanner."""
    upper = ticker.upper()
    cache_key = f"1y:{upper}"

    fresh = _get_fresh(cache_key, ttl=_HIST_TTL)
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


# ── Pre-warm (fire-and-forget on startup) ────────────────────────────────

def _do_prewarm(symbols: list[str]) -> None:
    """Pre-fetch spot prices (batch) + 1Y closes for startup symbols."""
    if not symbols:
        return
    uppers = [s.upper() for s in symbols]

    # 1. Batch spot prices — one FMP call
    logger.info("Pre-warming spots: %s", uppers)
    try:
        _do_fetch_batch_spots(uppers)
    except Exception:
        logger.warning("Pre-warm batch spots failed (non-fatal)")

    # 2. Historical data for scanner (per-symbol)
    for sym in uppers:
        try:
            _do_fetch_1y_closes(sym)
        except Exception:
            logger.warning("Pre-warm 1Y failed for %s (non-fatal)", sym)


async def prewarm(symbols: list[str]) -> None:
    """Pre-fetch spot + historical data (runs in thread, fire-and-forget)."""
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
