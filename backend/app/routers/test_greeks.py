"""
Debug endpoint: manually trigger a Black-Scholes calculation for a symbol.

GET /api/test/greeks?symbol=NVDA&strike=600&expiry=2026-12-18&option_type=PUT

Returns spot price, vol, BS Greeks, and any NaN diagnostics.
"""
from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Query

from app.services import yfinance_client
from app.services.black_scholes import (
    DEFAULT_SIGMA,
    RISK_FREE,
    calculate_greeks,
    calculate_option_price,
    net_delta_exposure,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["debug"])


@router.get("/test/greeks")
async def test_greeks(
    symbol: str = Query(..., description="Underlying ticker, e.g. NVDA"),
    strike: float = Query(..., description="Strike price"),
    expiry: str = Query(..., description="Expiry date YYYY-MM-DD"),
    option_type: str = Query("PUT", description="CALL or PUT"),
    net_contracts: int = Query(-1, description="Signed contract count"),
):
    """
    Manually trigger BS calculation and return full diagnostics.
    Useful for debugging NaN spot prices or missing Greeks.
    """
    # 1. Fetch spot price
    spot = await yfinance_client.get_spot_price(symbol.upper())
    logger.info("[test_greeks] symbol=%s spot=%s", symbol, spot)

    # 2. Fetch historical vol
    vol = await yfinance_client.get_hist_vol(symbol.upper())
    logger.info("[test_greeks] symbol=%s vol=%s", symbol, vol)

    # 3. Compute T
    try:
        expiry_date = date.fromisoformat(expiry)
    except ValueError:
        return {"error": f"Invalid expiry date: {expiry}"}

    dte = (expiry_date - date.today()).days
    T = Decimal(str(max(dte, 0) / 365.0))

    diagnostics = {
        "symbol": symbol.upper(),
        "spot": str(spot) if spot else None,
        "spot_is_none": spot is None,
        "vol": str(vol),
        "strike": strike,
        "expiry": expiry,
        "dte": dte,
        "T": str(T),
        "option_type": option_type.upper(),
        "net_contracts": net_contracts,
        "risk_free_rate": str(RISK_FREE),
    }

    if spot is None or spot <= 0:
        diagnostics["error"] = "Spot price is None or <= 0 — Greeks cannot be computed"
        diagnostics["greeks"] = None
        diagnostics["bs_price"] = None
        logger.warning("[test_greeks] FAILED: spot=%s for %s", spot, symbol)
        return diagnostics

    if T <= 0:
        diagnostics["warning"] = "Option has expired (T <= 0)"

    # 4. Compute Greeks
    S = Decimal(str(spot))
    K = Decimal(str(strike))

    greeks = calculate_greeks(
        S=S, K=K, T=T,
        option_type=option_type.upper(),
        sigma=vol,
        r=RISK_FREE,
    )

    bs_price = calculate_option_price(
        S=S, K=K, T=T,
        option_type=option_type.upper(),
        sigma=vol,
        r=RISK_FREE,
    )

    delta_exp = net_delta_exposure(net_contracts, greeks)

    diagnostics["greeks"] = {
        "delta": str(greeks.delta),
        "gamma": str(greeks.gamma),
        "theta": str(greeks.theta),
        "vega": str(greeks.vega),
    }
    diagnostics["bs_price_per_share"] = str(bs_price)
    diagnostics["delta_exposure"] = str(delta_exp)

    logger.info(
        "[test_greeks] %s: spot=%s vol=%s T=%s => delta=%s gamma=%s theta=%s vega=%s bs_price=%s",
        symbol, spot, vol, T,
        greeks.delta, greeks.gamma, greeks.theta, greeks.vega, bs_price,
    )

    return diagnostics
