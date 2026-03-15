"""
Data providers — thin async wrappers that delegate to the shared
yfinance_client market-data layer.

No direct FMP calls here. All caching, rate limiting, and symbol
normalization is handled by yfinance_client.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date

from app.services.yfinance_client import (
    normalize_ticker,
    get_spot_price,
    get_analyst_estimates,
    get_treasury_rates,
    _do_fetch_hist_data,
    _refresh_pool,
)

logger = logging.getLogger(__name__)


# ── Quote ────────────────────────────────────────────────────────────────────

async def get_quote(symbol: str) -> dict | None:
    """Fetch live quote via the shared market-data layer. Returns dict or None."""
    sym = normalize_ticker(symbol)
    price = await get_spot_price(sym)
    if price is None:
        return None

    # Retrieve cached supplementary fields populated by _do_fetch_quote
    from app.services.yfinance_client import (
        get_prev_close_cached_only,
        get_change_cached,
        get_changepct_cached,
    )
    prev = get_prev_close_cached_only(sym)
    change = get_change_cached(sym)
    change_pct = get_changepct_cached(sym)

    return {
        "symbol": sym,
        "price": float(price),
        "previous_close": float(prev) if prev is not None else None,
        "change": float(change) if change is not None else None,
        "change_pct": float(change_pct) if change_pct is not None else None,
        "volume": None,     # not needed for analysis (EOD basis)
        "market_cap": None,
        "name": None,
    }


# ── History ──────────────────────────────────────────────────────────────────

async def get_history(symbol: str) -> list[dict]:
    """Fetch daily OHLCV bars, sorted ascending by date."""
    sym = normalize_ticker(symbol)
    loop = asyncio.get_running_loop()
    raw = await loop.run_in_executor(_refresh_pool, _do_fetch_hist_data, sym)

    bars = []
    for d in raw:
        if not d.get("date") or d.get("close") is None or d["close"] <= 0:
            continue
        bars.append({
            "date": d["date"],
            "open": float(d.get("open") or d["close"]),
            "high": float(d.get("high") or d["close"]),
            "low": float(d.get("low") or d["close"]),
            "close": float(d["close"]),
            "volume": int(d.get("volume") or 0),
        })

    # FMP may return newest-first; ensure ascending
    bars.sort(key=lambda b: b["date"])
    return bars


# ── Estimates ────────────────────────────────────────────────────────────────

async def get_estimates(symbol: str) -> dict:
    """Fetch analyst consensus EPS for FY1 and FY2 via shared layer."""
    sym = normalize_ticker(symbol)
    empty = {"fy1_eps_avg": None, "fy2_eps_avg": None}

    result = await get_analyst_estimates(sym)
    if result is None or not isinstance(result.get("estimates"), list):
        return empty

    estimates_list = result["estimates"]
    if len(estimates_list) == 0:
        return empty

    # yfinance_client returns estimates newest-first (first two entries)
    # Filter to future-dated estimates
    today = date.today().isoformat()
    future = [e for e in estimates_list if e.get("date") and e["date"] >= today]

    # If no future estimates, use whatever we have
    if not future:
        future = estimates_list

    fy1 = future[0] if len(future) > 0 else None
    fy2 = future[1] if len(future) > 1 else None

    return {
        "fy1_eps_avg": fy1.get("estimated_eps_avg") if fy1 else None,
        "fy2_eps_avg": fy2.get("estimated_eps_avg") if fy2 else None,
    }


# ── Macro ────────────────────────────────────────────────────────────────────

async def get_macro() -> dict:
    """Fetch VIX level and 10Y Treasury yield via shared layer."""
    # Parallel: VIX quote + Treasury rates
    vix_task = get_spot_price("VIX")
    treasury_task = get_treasury_rates()
    vix_price, treasury_data = await asyncio.gather(vix_task, treasury_task)

    vix = float(vix_price) if vix_price is not None else None
    us10y = None
    if isinstance(treasury_data, dict):
        us10y = treasury_data.get("year10")

    return {"vix": vix, "us10y": us10y}
