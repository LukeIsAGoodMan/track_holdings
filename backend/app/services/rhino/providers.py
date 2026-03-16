"""
Data providers — thin async wrappers that delegate to the shared
yfinance_client market-data layer.

No direct FMP calls here. All caching, rate limiting, and symbol
normalization is handled by yfinance_client.
"""
from __future__ import annotations

import asyncio
import logging

from app.services.yfinance_client import (
    normalize_ticker,
    get_spot_price,
    get_analyst_estimates,
    get_treasury_rates,
    get_sma,
    _do_fetch_hist_data,
    _refresh_pool,
)

logger = logging.getLogger(__name__)


# ── Quote (DEPRECATED) ────────────────────────────────────────────────────────
# Rhino analysis is 100% EOD-based.  The orchestrator (__init__.py) derives
# price, change, and change_pct directly from historical bars — it does NOT
# call get_quote().  This function is retained only in case external callers
# need an intraday snapshot; do NOT reintroduce it into the analysis pipeline.


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
            "date": str(d["date"])[:10],
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
    """Fetch analyst consensus EPS for FY0 (trailing), FY1, FY2.

    The shared layer returns:
      - estimates[0] = FY1, estimates[1] = FY2 (future fiscal years)
      - fy0 = most recent past fiscal year (trailing EPS)
    """
    sym = normalize_ticker(symbol)
    empty = {"fy0_eps_avg": None, "fy1_eps_avg": None, "fy2_eps_avg": None}

    result = await get_analyst_estimates(sym)
    if result is None or not isinstance(result.get("estimates"), list):
        return empty

    estimates_list = result["estimates"]
    if len(estimates_list) == 0:
        return empty

    fy1 = estimates_list[0]
    fy2 = estimates_list[1] if len(estimates_list) > 1 else None

    fy0_row = result.get("fy0")
    fy0_eps = fy0_row.get("estimated_eps_avg") if fy0_row else None
    fy1_eps = fy1.get("estimated_eps_avg") if fy1 else None
    fy2_eps = fy2.get("estimated_eps_avg") if fy2 else None

    logger.info(
        "Rhino estimates for %s: FY0 eps=%s, FY1=%s (date=%s, eps=%.4f), FY2=%s (eps=%s)",
        sym,
        f"{fy0_eps:.4f}" if fy0_eps is not None else "N/A",
        fy1.get("date") if fy1 else "N/A",
        fy1.get("date") if fy1 else "N/A",
        fy1_eps if fy1_eps is not None else 0,
        fy2.get("date") if fy2 else "N/A",
        f"{fy2_eps:.4f}" if fy2_eps is not None else "N/A",
    )

    return {
        "fy0_eps_avg": fy0_eps,
        "fy1_eps_avg": fy1_eps,
        "fy2_eps_avg": fy2_eps,
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


# ── SMA ───────────────────────────────────────────────────────────────────
# Sourced from the shared market-data layer (FMP /technical-indicators/sma).
# Rhino no longer computes SMA locally — see previous _compute_sma200_series.

async def get_sma_series(symbol: str, period: int = 200) -> list[dict]:
    """Fetch SMA series from the shared endpoint, return [{date, value}].

    Returns chronologically ordered list aligned for chart overlay.
    Empty list if SMA is unavailable.
    """
    sym = normalize_ticker(symbol)
    raw = await get_sma(sym, period)
    if not raw:
        logger.warning("Rhino SMA [%s]: get_sma returned empty/None", symbol)
        return []

    series = [
        {"date": str(pt["date"])[:10], "value": round(float(pt["sma"]), 2)}
        for pt in raw
        if pt.get("sma") is not None
    ]
    logger.info("Rhino SMA [%s]: %d raw points → %d normalized, sample=%s",
                symbol, len(raw), len(series), series[-1] if series else "N/A")
    return series
