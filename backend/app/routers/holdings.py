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
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.holding import HoldingGroup
from app.services import position_engine, yfinance_client
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

    return compute_holding_groups(positions, spot_map, vol_map)
