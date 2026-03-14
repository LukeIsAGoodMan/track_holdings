"""
GET /api/holdings[?portfolio_id=N]

Core holdings endpoint:
1. Recursive roll-up: resolve portfolio_id → all descendant IDs
2. Replay TradeEvents via position_engine → net positions
3. Batch-fetch live spot prices + historical vols via yfinance (concurrent)
4. Compute real-time Greeks for each option leg; stock legs get delta=1, greeks=0
5. Return grouped by underlying symbol with capital_efficiency per group

Stock/ETF support:
- instrument_type == STOCK → delta = net_shares (1 share = 1Δ)
- gamma / theta / vega = 0 for stocks
- All positions for the same underlying symbol are merged into one HoldingGroup
  so that "100 shares NVDA + short 1x NVDA call" shows the combined Delta.
"""
from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.holding import HoldingGroup
from app.services import position_engine, yfinance_client
from app.services.black_scholes import calculate_option_price
from app.services.holdings_engine import compute_holding_groups
from app.services.portfolio_resolver import resolve_portfolio_ids

router = APIRouter(tags=["holdings"])


@router.get("/holdings", response_model=list[HoldingGroup])
async def get_holdings(
    portfolio_id: int | None = Query(None, description="Filter by portfolio ID"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Return active positions grouped by underlying, enriched with live Greeks.

    Stock and option positions for the same symbol are merged into the same
    HoldingGroup so the combined Net Delta Exposure is immediately visible.
    Uses recursive roll-up: querying a parent portfolio automatically includes
    all child sub-strategy portfolios.
    """
    pids = await resolve_portfolio_ids(db, user.id, portfolio_id)
    positions = await position_engine.calculate_positions(db, portfolio_ids=pids)

    if not positions:
        return []

    # ── Batch market data (concurrent) ───────────────────────────────────
    symbols = list({pos.instrument.symbol for pos in positions})

    spot_results, vol_results = await asyncio.gather(
        asyncio.gather(*[yfinance_client.get_spot_price(s) for s in symbols]),
        asyncio.gather(*[yfinance_client.get_hist_vol(s)   for s in symbols]),
    )
    spot_map: dict[str, Decimal | None] = dict(zip(symbols, spot_results))
    vol_map:  dict[str, Decimal]        = dict(zip(symbols, vol_results))

    # Build perf_map — 1s async fetch on cold cache, instant on warm cache
    perf_results = await asyncio.gather(*[yfinance_client.get_perf_cached(s) for s in symbols])
    perf_map = dict(zip(symbols, perf_results))

    # ── BS mark-to-market P&L per underlying ─────────────────────────────
    _today = date.today()
    _r_f = Decimal(str(settings.risk_free_rate))
    bs_pnl_map: dict[str, Decimal] = {}

    for sym in symbols:
        spot = spot_map.get(sym)
        prev_close = yfinance_client.get_prev_close_cached_only(sym)
        if spot is None or prev_close is None:
            continue

        group_pnl = Decimal("0")
        for pos in positions:
            if pos.instrument.symbol != sym:
                continue
            inst = pos.instrument
            if inst.instrument_type.value == "OPTION":
                if not (inst.option_type and inst.strike and inst.expiry):
                    continue
                dte = (inst.expiry - _today).days
                T = Decimal(str(max(dte, 0) / 365.0))
                if T <= 0:
                    continue
                vol = vol_map.get(sym, Decimal("0.30"))
                otype = inst.option_type.value
                mark_now  = calculate_option_price(spot,       inst.strike, T, otype, vol, _r_f)
                mark_prev = calculate_option_price(prev_close, inst.strike, T, otype, vol, _r_f)
                multiplier = inst.multiplier or 100
                group_pnl += (mark_now - mark_prev) * Decimal(str(pos.net_contracts)) * Decimal(str(multiplier))
            else:
                group_pnl += (spot - prev_close) * Decimal(str(pos.net_contracts))

        bs_pnl_map[sym] = group_pnl.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    return compute_holding_groups(
        positions, spot_map, vol_map,
        perf_map=perf_map,
        bs_pnl_map=bs_pnl_map or None,
    )
