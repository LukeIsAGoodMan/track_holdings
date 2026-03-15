"""
Data providers — thin async wrappers over FMP endpoints.

Each provider: check cache → coalesce → fetch → normalize → cache → return.
"""
from __future__ import annotations

import logging
from datetime import date

from .fmp_client import (
    cache_get, cache_set, coalesce, fmp_get, fmp_symbol,
    TTL_QUOTE, TTL_HISTORY, TTL_ESTIMATE, TTL_MACRO, TTL_NEGATIVE,
)

logger = logging.getLogger(__name__)


# ── Quote ────────────────────────────────────────────────────────────────────

async def get_quote(symbol: str) -> dict | None:
    """Fetch live quote. Returns dict with price/change/volume or None."""
    sym = fmp_symbol(symbol)
    key = f"quote:{sym}"

    cached = cache_get(key)
    if cached is not None:
        return cached if cached != "_nil" else None

    async def _fetch():
        data = await fmp_get("/quote", {"symbol": sym})
        if not data or not isinstance(data, list) or len(data) == 0:
            cache_set(key, "_nil", TTL_NEGATIVE)
            return None
        item = data[0]
        if not item.get("price"):
            cache_set(key, "_nil", TTL_NEGATIVE)
            return None
        result = {
            "symbol": sym,
            "price": item["price"],
            "previous_close": item.get("previousClose"),
            "change": item.get("change"),
            "change_pct": item.get("changesPercentage"),
            "volume": item.get("volume"),
            "market_cap": item.get("marketCap"),
            "name": item.get("name"),
        }
        cache_set(key, result, TTL_QUOTE)
        return result

    return await coalesce(key, _fetch)


# ── History ──────────────────────────────────────────────────────────────────

async def get_history(symbol: str) -> list[dict]:
    """Fetch daily OHLCV bars, sorted ascending by date."""
    sym = fmp_symbol(symbol)
    key = f"history:{sym}"

    cached = cache_get(key)
    if cached is not None:
        return cached

    async def _fetch():
        raw = await fmp_get("/historical-price-eod/full", {"symbol": sym})

        items: list[dict] = []
        if isinstance(raw, list):
            items = raw
        elif isinstance(raw, dict) and isinstance(raw.get("historical"), list):
            items = raw["historical"]
        else:
            cache_set(key, [], TTL_NEGATIVE)
            return []

        bars = []
        for d in items:
            if not d.get("date") or d.get("close") is None or d["close"] <= 0:
                continue
            bars.append({
                "date": d["date"],
                "open": d.get("open") or d["close"],
                "high": d.get("high") or d["close"],
                "low": d.get("low") or d["close"],
                "close": d["close"],
                "volume": d.get("volume") or 0,
            })

        # Deterministic ascending sort — never assume input order
        bars.sort(key=lambda b: b["date"])
        cache_set(key, bars, TTL_HISTORY)
        return bars

    return await coalesce(key, _fetch)


# ── Estimates ────────────────────────────────────────────────────────────────

async def get_estimates(symbol: str) -> dict:
    """Fetch analyst consensus EPS/revenue for FY1 and FY2."""
    sym = fmp_symbol(symbol)
    key = f"estimate:{sym}"

    cached = cache_get(key)
    if cached is not None:
        return cached

    empty = {"fy1_eps_avg": None, "fy2_eps_avg": None,
             "fy1_revenue_avg": None, "fy2_revenue_avg": None}

    async def _fetch():
        data = await fmp_get("/analyst-estimates", {"symbol": sym, "period": "annual"})
        if not data or not isinstance(data, list) or len(data) == 0:
            cache_set(key, empty, TTL_ESTIMATE)
            return empty

        sorted_est = sorted(
            [d for d in data if d.get("date")],
            key=lambda d: d["date"],
        )
        today = date.today().isoformat()
        future = [d for d in sorted_est if d["date"] >= today]

        fy1 = future[0] if len(future) > 0 else None
        fy2 = future[1] if len(future) > 1 else None

        result = {
            "fy1_eps_avg": fy1.get("estimatedEpsAvg") if fy1 else None,
            "fy2_eps_avg": fy2.get("estimatedEpsAvg") if fy2 else None,
            "fy1_revenue_avg": fy1.get("estimatedRevenueAvg") if fy1 else None,
            "fy2_revenue_avg": fy2.get("estimatedRevenueAvg") if fy2 else None,
        }
        cache_set(key, result, TTL_ESTIMATE)
        return result

    return await coalesce(key, _fetch)


# ── Macro ────────────────────────────────────────────────────────────────────

async def get_macro() -> dict:
    """Fetch VIX level and 10Y Treasury yield."""
    key = "macro:snapshot"

    cached = cache_get(key)
    if cached is not None:
        return cached

    async def _fetch():
        import asyncio
        vix_task = fmp_get("/quote", {"symbol": "VIX"})
        treasury_task = fmp_get("/treasury", {})
        vix_data, treasury_data = await asyncio.gather(vix_task, treasury_task)

        vix = None
        if isinstance(vix_data, list) and len(vix_data) > 0:
            vix = vix_data[0].get("price")

        us10y = None
        if isinstance(treasury_data, list) and len(treasury_data) > 0:
            us10y = treasury_data[0].get("year10")

        result = {"vix": vix, "us10y": us10y}
        cache_set(key, result, TTL_MACRO)
        return result

    return await coalesce(key, _fetch)
