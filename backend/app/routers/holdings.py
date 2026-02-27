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
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import Instrument, InstrumentType
from app.schemas.holding import HoldingGroup, OptionLeg, StockLeg
from app.services import position_engine, yfinance_client
from app.services.strategy_recognizer import LegSnapshot, identify_strategy
from app.services.black_scholes import (
    DEFAULT_SIGMA,
    RISK_FREE,
    calculate_greeks,
    maintenance_margin,
    net_delta_exposure,
)

router = APIRouter(tags=["holdings"])


@router.get("/holdings", response_model=list[HoldingGroup])
async def get_holdings(
    portfolio_id: int | None = Query(None, description="Filter by portfolio ID"),
    db: AsyncSession = Depends(get_db),
):
    """
    Return active positions grouped by underlying, enriched with live Greeks.

    Stock and option positions for the same symbol are merged into the same
    HoldingGroup so the combined Net Delta Exposure is immediately visible.
    Uses recursive roll-up: querying a parent portfolio automatically includes
    all child sub-strategy portfolios.
    """
    if portfolio_id is not None:
        pids = await position_engine.collect_portfolio_ids(db, portfolio_id)
        positions = await position_engine.calculate_positions(db, portfolio_ids=pids)
    else:
        positions = await position_engine.calculate_positions(db)

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

    # ── Group by symbol ────────────────────────────────────────────────────
    by_symbol: dict[str, list] = {}
    for pos in positions:
        by_symbol.setdefault(pos.instrument.symbol, []).append(pos)

    today = date.today()
    r_f   = Decimal(str(settings.risk_free_rate))

    holding_groups: list[HoldingGroup] = []

    for sym in sorted(by_symbol):
        spot  = spot_map.get(sym)
        sigma = vol_map.get(sym, DEFAULT_SIGMA)

        option_legs:        list[OptionLeg] = []
        stock_legs:         list[StockLeg]  = []
        total_delta_exp   = Decimal("0")
        total_margin      = Decimal("0")
        total_theta_daily = Decimal("0")

        for pos in by_symbol[sym]:
            inst: Instrument = pos.instrument

            # ── Stock / ETF leg ──────────────────────────────────────────
            if inst.instrument_type == InstrumentType.STOCK or inst.option_type is None:
                # 1 share = 1 delta, gamma/theta/vega = 0
                delta_exp = Decimal(str(pos.net_contracts))   # net_shares × 1
                total_delta_exp += delta_exp

                market_val: Decimal | None = None
                if spot:
                    market_val = spot * delta_exp

                stock_legs.append(
                    StockLeg(
                        instrument_id=inst.id,
                        net_shares=pos.net_contracts,
                        avg_open_price=pos.avg_open_price,
                        delta_exposure=delta_exp,
                        market_value=market_val,
                    )
                )
                continue   # no margin, no theta for stocks

            # ── Option leg ───────────────────────────────────────────────
            if inst.expiry is None:
                continue

            dte    = (inst.expiry - today).days
            T      = Decimal(str(max(dte, 0) / 365.0))
            marg   = maintenance_margin(pos.net_contracts, inst.strike)
            total_margin += marg

            if spot and spot > 0 and T > 0:
                g = calculate_greeks(
                    S=spot,
                    K=inst.strike,
                    T=T,
                    option_type=inst.option_type.value,
                    sigma=sigma,
                    r=r_f,
                )
                delta_exp       = net_delta_exposure(pos.net_contracts, g)
                total_delta_exp += delta_exp

                net_contracts_d  = Decimal(str(pos.net_contracts))
                theta_exposure   = g.theta * net_contracts_d * Decimal("100")
                total_theta_daily += theta_exposure

                greeks_kwargs = {
                    "delta": g.delta,
                    "gamma": g.gamma,
                    "theta": g.theta,
                    "vega":  g.vega,
                    "delta_exposure": delta_exp,
                }
            else:
                greeks_kwargs = {
                    "delta": None, "gamma": None,
                    "theta": None, "vega":  None,
                    "delta_exposure": None,
                }

            option_legs.append(
                OptionLeg(
                    instrument_id=inst.id,
                    option_type=inst.option_type.value,
                    strike=inst.strike,
                    expiry=str(inst.expiry),
                    days_to_expiry=max(dte, 0),
                    net_contracts=pos.net_contracts,
                    avg_open_price=pos.avg_open_price,
                    maintenance_margin=marg,
                    **greeks_kwargs,
                )
            )

        if option_legs or stock_legs:
            efficiency: Decimal | None = None
            if total_margin > Decimal("0"):
                efficiency = total_theta_daily / total_margin

            # ── Strategy auto-recognition ──────────────────────────────────
            leg_snapshots = [
                LegSnapshot(
                    option_type=leg.option_type,
                    strike=Decimal(leg.strike),
                    expiry=leg.expiry,
                    net_contracts=leg.net_contracts,
                )
                for leg in option_legs
            ]
            strategy_tag = identify_strategy(leg_snapshots)

            holding_groups.append(
                HoldingGroup(
                    symbol=sym,
                    spot_price=spot,
                    option_legs=option_legs,
                    stock_legs=stock_legs,
                    total_delta_exposure=total_delta_exp,
                    total_maintenance_margin=total_margin,
                    total_theta_daily=total_theta_daily,
                    capital_efficiency=efficiency,
                    strategy_type=strategy_tag.strategy_type,
                    strategy_label=strategy_tag.label,
                )
            )

    return holding_groups
