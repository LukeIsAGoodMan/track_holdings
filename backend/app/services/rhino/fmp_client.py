"""
FMP (Financial Modeling Prep) async HTTP client.

Single point for auth, timeout, caching, and request coalescing.
All providers go through fmp_get() — never call httpx directly.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

FMP_BASE = "https://financialmodelingprep.com/stable"
TIMEOUT = 8.0  # seconds


# ── TTL cache ────────────────────────────────────────────────────────────────

class _CacheEntry:
    __slots__ = ("value", "expires_at")

    def __init__(self, value: Any, ttl_s: float) -> None:
        self.value = value
        self.expires_at = time.monotonic() + ttl_s


_cache: dict[str, _CacheEntry] = {}


def cache_get(key: str) -> Any | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    if time.monotonic() > entry.expires_at:
        _cache.pop(key, None)
        return None
    return entry.value


def cache_set(key: str, value: Any, ttl_s: float) -> None:
    _cache[key] = _CacheEntry(value, ttl_s)


# ── In-flight coalescing ────────────────────────────────────────────────────

_in_flight: dict[str, asyncio.Future[Any]] = {}


async def coalesce(key: str, factory):
    """If a request for `key` is already in-flight, await it. Otherwise run factory."""
    existing = _in_flight.get(key)
    if existing is not None:
        return await existing

    loop = asyncio.get_running_loop()
    future: asyncio.Future[Any] = loop.create_future()
    _in_flight[key] = future

    try:
        result = await factory()
        future.set_result(result)
        return result
    except Exception as exc:
        future.set_exception(exc)
        raise
    finally:
        _in_flight.pop(key, None)


# ── HTTP wrapper ─────────────────────────────────────────────────────────────

async def fmp_get(path: str, params: dict[str, str] | None = None) -> Any | None:
    """Low-level FMP GET. Returns parsed JSON or None on error."""
    api_key = settings.fmp_api_key
    if not api_key:
        logger.warning("[FMP] No API key configured")
        return None

    query = {"apikey": api_key}
    if params:
        query.update(params)

    url = f"{FMP_BASE}{path}"

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(url, params=query, headers={"User-Agent": "RhinoEngine/1.0"})

        if resp.status_code == 403:
            logger.error("[FMP] 403 Forbidden: %s", path)
            return None
        if not resp.is_success:
            logger.error("[FMP] %d on %s", resp.status_code, path)
            return None

        return resp.json()
    except httpx.TimeoutException:
        logger.error("[FMP] Timeout: %s", path)
        return None
    except Exception:
        logger.exception("[FMP] Request error: %s", path)
        return None


# ── Symbol normalization ─────────────────────────────────────────────────────

_SYMBOL_MAP = {"GSPC": "SPY", "VIX": "VIX", "SPX": "SPX"}


def normalize_ticker(symbol: str) -> str:
    return symbol.strip().upper().lstrip("^")


def fmp_symbol(symbol: str) -> str:
    bare = normalize_ticker(symbol)
    return _SYMBOL_MAP.get(bare, bare)


# ── TTL constants (seconds) ──────────────────────────────────────────────────

TTL_QUOTE = 120       # 2 min
TTL_HISTORY = 900     # 15 min
TTL_ESTIMATE = 86400  # 1 day
TTL_MACRO = 300       # 5 min
TTL_NEGATIVE = 30     # failed lookups
