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
from app.routers.symbols import get_asset_class
from app.schemas.holding import HoldingGroup, OptionLeg, StockLeg
from app.services.black_scholes import (
    DEFAULT_SIGMA,
    calculate_greeks,
    calculate_option_price,
    maintenance_margin,
    net_delta_exposure,
)
from app.services.position_engine import PositionRow
from app.services.strategy_recognizer import LegSnapshot, identify_strategy


def _pnl_pct(pnl: Decimal, cost_basis: Decimal) -> Decimal | None:
    """Return pnl / |cost_basis|, or None if cost_basis is zero."""
    if cost_basis == 0:
        return None
    return (pnl / abs(cost_basis)).quantize(Decimal("0.0001"))


def compute_holding_groups(
    positions: list[PositionRow],
    spot_map: dict[str, Decimal | None],
    vol_map: dict[str, Decimal],
    perf_map: dict[str, dict[str, float]] | None = None,
    bs_pnl_map: dict[str, Decimal] | None = None,
    prev_close_map: dict[str, Decimal] | None = None,
) -> list[HoldingGroup]:
    """
    Build HoldingGroup list from positions + market data.

    Args:
        positions:      output of position_engine.calculate_positions()
        spot_map:       {symbol: spot_price} (None if unavailable)
        vol_map:        {symbol: historical_vol}
        prev_close_map: {symbol: prev_close} for daily P&L (None = skip daily)
        bs_pnl_map:     Legacy group-level daily P&L (fallback when prev_close_map absent)

    Returns:
        list[HoldingGroup] grouped by underlying symbol, enriched with Greeks + P&L.
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
        delta_adj_exp = Decimal("0")   # dollar notional (always positive)

        for pos in by_symbol[sym]:
            inst: Instrument = pos.instrument

            # ── Stock / ETF leg ──────────────────────────────────────
            if inst.instrument_type == InstrumentType.STOCK or inst.option_type is None:
                delta_exp = Decimal(str(pos.net_contracts))
                total_delta_exp += delta_exp

                market_val: Decimal | None = None
                leg_daily: Decimal | None = None
                leg_total: Decimal | None = None
                leg_total_pct: Decimal | None = None
                if spot:
                    market_val = spot * delta_exp
                    # dollar notional: |shares| × spot
                    delta_adj_exp += spot * abs(delta_exp)
                    # Total P&L: qty × (spot − avg_open)
                    leg_total = delta_exp * (spot - pos.avg_open_price)
                    cost_basis = abs(delta_exp) * pos.avg_open_price
                    leg_total_pct = _pnl_pct(leg_total, cost_basis)
                    # Daily P&L: qty × (spot − prev_close)
                    pc = (prev_close_map or {}).get(sym)
                    if pc is not None:
                        leg_daily = delta_exp * (spot - pc)

                stock_legs.append(
                    StockLeg(
                        instrument_id=inst.id,
                        net_shares=pos.net_contracts,
                        avg_open_price=pos.avg_open_price,
                        delta_exposure=delta_exp,
                        market_value=market_val,
                        daily_pnl=leg_daily,
                        total_pnl=leg_total,
                        total_pnl_pct=leg_total_pct,
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

            net_d = Decimal(str(pos.net_contracts))
            multiplier = Decimal("100")
            opt_daily: Decimal | None = None
            opt_total: Decimal | None = None
            opt_total_pct: Decimal | None = None

            if spot and spot > 0 and T > 0:
                otype = inst.option_type.value
                g = calculate_greeks(
                    S=spot, K=inst.strike, T=T,
                    option_type=otype, sigma=sigma, r=r_f,
                )
                delta_exp = net_delta_exposure(pos.net_contracts, g)
                total_delta_exp += delta_exp
                # dollar notional for options: spot × |contracts × 100 × |delta||
                delta_adj_exp += spot * abs(net_d * multiplier * abs(g.delta))

                theta_exposure = g.theta * net_d * multiplier
                total_theta_daily += theta_exposure

                greeks_kwargs = {
                    "delta": g.delta,
                    "gamma": g.gamma,
                    "theta": g.theta,
                    "vega": g.vega,
                    "delta_exposure": delta_exp,
                }

                # ── Total P&L: (BS_now − avg_open_price) × net × 100 ──
                try:
                    bs_now = calculate_option_price(
                        S=spot, K=inst.strike, T=T,
                        option_type=otype, sigma=sigma, r=r_f,
                    )
                    opt_total = (bs_now - pos.avg_open_price) * net_d * multiplier
                    cost_basis = abs(net_d) * pos.avg_open_price * multiplier
                    opt_total_pct = _pnl_pct(opt_total, cost_basis)
                except Exception:
                    pass  # BS failure → total P&L unavailable

                # ── Daily P&L: 3-tier (BS diff → delta-linear → skip) ──
                pc = (prev_close_map or {}).get(sym)
                if pc is not None and pc > 0:
                    try:
                        bs_now_d = bs_now if opt_total is not None else calculate_option_price(
                            S=spot, K=inst.strike, T=T,
                            option_type=otype, sigma=sigma, r=r_f,
                        )
                        bs_prev = calculate_option_price(
                            S=pc, K=inst.strike, T=T,
                            option_type=otype, sigma=sigma, r=r_f,
                        )
                        opt_daily = (bs_now_d - bs_prev) * net_d * multiplier
                    except Exception:
                        # Tier 2: delta-linear fallback
                        try:
                            opt_daily = g.delta * (spot - pc) * net_d * multiplier
                        except Exception:
                            pass  # Tier 3: skip
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
                    daily_pnl=opt_daily,
                    total_pnl=opt_total,
                    total_pnl_pct=opt_total_pct,
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

            perf = (perf_map or {}).get(sym, {})

            # ── Directional analytics ─────────────────────────────────
            # is_short: net delta direction is bearish (negative net delta)
            is_short = total_delta_exp < Decimal("0")
            dir_sign: int = -1 if is_short else 1

            # Signed dollar-notional: total_delta (in delta units) × spot_price.
            # Summing across all groups gives portfolio-level net market bias.
            signed_notional: Decimal | None = None
            if spot:
                signed_notional = total_delta_exp * spot

            def _perf_str(val: object) -> str | None:
                return str(val) if val is not None else None

            def _eff(raw: object) -> str | None:
                """Apply directional sign: long put gains when underlying falls."""
                if raw is None:
                    return None
                return str(round(float(raw) * dir_sign, 4))

            # asset_class: use symbol map (authoritative); pure-option groups → 'option'
            if stock_legs:
                asset_class = get_asset_class(sym)
            else:
                asset_class = "option"

            # ── Group P&L aggregation (sum ignoring None legs) ──────
            grp_daily = Decimal("0")
            grp_total = Decimal("0")
            grp_cost_basis = Decimal("0")
            has_daily = False
            has_total = False

            for sl in stock_legs:
                if sl.daily_pnl is not None:
                    grp_daily += Decimal(str(sl.daily_pnl))
                    has_daily = True
                if sl.total_pnl is not None:
                    grp_total += Decimal(str(sl.total_pnl))
                    has_total = True
                    grp_cost_basis += abs(Decimal(str(sl.net_shares))) * Decimal(str(sl.avg_open_price))

            for ol in option_legs:
                if ol.daily_pnl is not None:
                    grp_daily += Decimal(str(ol.daily_pnl))
                    has_daily = True
                if ol.total_pnl is not None:
                    grp_total += Decimal(str(ol.total_pnl))
                    has_total = True
                    grp_cost_basis += abs(Decimal(str(ol.net_contracts))) * Decimal(str(ol.avg_open_price)) * Decimal("100")

            group_daily_pnl: Decimal | None = grp_daily.quantize(Decimal("0.01")) if has_daily else None
            group_total_pnl: Decimal | None = grp_total.quantize(Decimal("0.01")) if has_total else None
            group_total_pnl_pct: Decimal | None = _pnl_pct(grp_total, grp_cost_basis) if has_total else None

            # Legacy bs_pnl_1d: prefer computed daily_pnl; fallback to caller's bs_pnl_map
            bs_pnl = group_daily_pnl
            if bs_pnl is None and bs_pnl_map is not None:
                bs_pnl = bs_pnl_map.get(sym)

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
                    delta_adjusted_exposure=delta_adj_exp if delta_adj_exp > 0 else None,
                    perf_1d=_perf_str(perf.get("1d")),
                    perf_5d=_perf_str(perf.get("5d")),
                    perf_1m=_perf_str(perf.get("1m")),
                    perf_3m=_perf_str(perf.get("3m")),
                    is_short=is_short,
                    signed_delta_notional=signed_notional,
                    effective_perf_1d=_eff(perf.get("1d")),
                    effective_perf_5d=_eff(perf.get("5d")),
                    effective_perf_1m=_eff(perf.get("1m")),
                    effective_perf_3m=_eff(perf.get("3m")),
                    daily_pnl=group_daily_pnl,
                    total_pnl=group_total_pnl,
                    total_pnl_pct=group_total_pnl_pct,
                    bs_pnl_1d=bs_pnl,
                    asset_class=asset_class,
                )
            )

    return holding_groups
