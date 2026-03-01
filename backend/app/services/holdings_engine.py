"""
Holdings computation engine — extracted from routers/holdings.py.

Reusable by both the REST endpoint (GET /api/holdings) and the
WebSocket PriceFeedService (holdings_update broadcast).

compute_holding_groups(positions, spot_map, vol_map) → list[HoldingGroup]
  Pure computation: no DB calls, no yfinance calls.
  Accepts pre-fetched positions and market data maps.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.config import settings
from app.models import Instrument, InstrumentType
from app.schemas.holding import HoldingGroup, OptionLeg, StockLeg
from app.services.black_scholes import (
    DEFAULT_SIGMA,
    calculate_greeks,
    maintenance_margin,
    net_delta_exposure,
)
from app.services.position_engine import PositionRow
from app.services.strategy_recognizer import LegSnapshot, identify_strategy


def compute_holding_groups(
    positions: list[PositionRow],
    spot_map: dict[str, Decimal | None],
    vol_map: dict[str, Decimal],
) -> list[HoldingGroup]:
    """
    Build HoldingGroup list from positions + market data.

    Args:
        positions: output of position_engine.calculate_positions()
        spot_map:  {symbol: spot_price} (None if unavailable)
        vol_map:   {symbol: historical_vol}

    Returns:
        list[HoldingGroup] grouped by underlying symbol, enriched with Greeks.
    """
    if not positions:
        return []

    # ── Group by symbol ──────────────────────────────────────────────────
    by_symbol: dict[str, list[PositionRow]] = {}
    for pos in positions:
        by_symbol.setdefault(pos.instrument.symbol, []).append(pos)

    today = date.today()
    r_f = Decimal(str(settings.risk_free_rate))

    holding_groups: list[HoldingGroup] = []

    for sym in sorted(by_symbol):
        spot = spot_map.get(sym)
        sigma = vol_map.get(sym, DEFAULT_SIGMA)

        option_legs: list[OptionLeg] = []
        stock_legs: list[StockLeg] = []
        total_delta_exp = Decimal("0")
        total_margin = Decimal("0")
        total_theta_daily = Decimal("0")

        for pos in by_symbol[sym]:
            inst: Instrument = pos.instrument

            # ── Stock / ETF leg ──────────────────────────────────────
            if inst.instrument_type == InstrumentType.STOCK or inst.option_type is None:
                delta_exp = Decimal(str(pos.net_contracts))
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
                continue

            # ── Option leg ───────────────────────────────────────────
            if inst.expiry is None:
                continue

            dte = (inst.expiry - today).days
            T = Decimal(str(max(dte, 0) / 365.0))
            marg = maintenance_margin(pos.net_contracts, inst.strike)
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
                delta_exp = net_delta_exposure(pos.net_contracts, g)
                total_delta_exp += delta_exp

                net_contracts_d = Decimal(str(pos.net_contracts))
                theta_exposure = g.theta * net_contracts_d * Decimal("100")
                total_theta_daily += theta_exposure

                greeks_kwargs = {
                    "delta": g.delta,
                    "gamma": g.gamma,
                    "theta": g.theta,
                    "vega": g.vega,
                    "delta_exposure": delta_exp,
                }
            else:
                greeks_kwargs = {
                    "delta": None, "gamma": None,
                    "theta": None, "vega": None,
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

            # ── Strategy auto-recognition ────────────────────────────
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
