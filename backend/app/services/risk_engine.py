"""
Risk aggregation engine — extracted from routers/risk.py.

Reusable by both the REST endpoint (GET /api/risk/dashboard) and the
WebSocket PriceFeedService (risk_update broadcast).

compute_risk_summary(positions, spot_map, vol_map) → dict
  Pure computation: no DB calls, no yfinance calls.
  Returns the core risk metrics (Greeks, VaR, expiry buckets, alerts).
"""
from __future__ import annotations

import math
from datetime import date
from decimal import Decimal

from app.config import settings
from app.models import InstrumentType
from app.routers.symbols import get_asset_class
from app.services.black_scholes import (
    DEFAULT_SIGMA,
    MULTIPLIER,
    calculate_greeks,
    maintenance_margin,
    net_delta_exposure,
)
from app.services.position_engine import PositionRow

# Gamma crash alert threshold: alert when delta doubles within this % move
_GAMMA_ALERT_THRESHOLD_PCT = 20.0
_Z95 = Decimal("1.645")
_SQRT252 = Decimal(str(math.sqrt(252)))


def _build_risk_alerts(
    sym_delta: dict[str, Decimal],
    sym_gamma: dict[str, Decimal],
    spot_map: dict[str, Decimal | None],
) -> list[str]:
    alerts: list[str] = []
    for sym, delta_exp in sym_delta.items():
        gamma_exp = sym_gamma.get(sym)
        if not gamma_exp or gamma_exp == Decimal("0"):
            continue
        spot = spot_map.get(sym)
        if not spot or spot <= 0:
            continue
        dollar_move = abs(delta_exp / gamma_exp)
        crash_pct = float(dollar_move / spot) * 100.0
        if crash_pct < _GAMMA_ALERT_THRESHOLD_PCT:
            direction = "drop" if float(gamma_exp) < 0 else "rally"
            alerts.append(
                f"{sym}: delta exposure doubles within a {crash_pct:.1f}% {direction} "
                f"(gamma-exp={float(gamma_exp):.4f}, delta-exp={float(delta_exp):.1f})"
            )
    return sorted(alerts)


def compute_risk_summary(
    positions: list[PositionRow],
    spot_map: dict[str, Decimal | None],
    vol_map: dict[str, Decimal],
) -> dict:
    """
    Compute core risk metrics from positions + market data.

    Returns a dict with:
      total_net_delta, total_gamma, total_theta_daily, total_vega,
      maintenance_margin_total, var_1d_95, positions_count,
      expiry_buckets, top_efficient_symbol, sector_exposure, risk_alerts
    """
    today = date.today()
    r_f = Decimal(str(settings.risk_free_rate))

    total_delta = Decimal("0")
    total_gamma = Decimal("0")
    total_theta = Decimal("0")
    total_vega = Decimal("0")
    total_margin = Decimal("0")
    n_positions = 0

    sym_theta: dict[str, Decimal] = {}
    sym_margin: dict[str, Decimal] = {}
    sym_gamma: dict[str, Decimal] = {}
    sym_delta: dict[str, Decimal] = {}
    sector_exp: dict[str, Decimal] = {}

    buckets: dict[str, dict] = {
        "\u22647d":   {"net_contracts": 0, "delta_exposure": Decimal("0")},
        "8-30d":  {"net_contracts": 0, "delta_exposure": Decimal("0")},
        "31-90d": {"net_contracts": 0, "delta_exposure": Decimal("0")},
        ">90d":   {"net_contracts": 0, "delta_exposure": Decimal("0")},
    }

    for pos in positions:
        inst = pos.instrument

        # ── Stock / ETF / Index / Crypto ─────────────────────────────
        if inst.option_type is None:
            stock_delta = Decimal(str(pos.net_contracts))
            total_delta += stock_delta
            sym_delta[inst.symbol] = sym_delta.get(inst.symbol, Decimal("0")) + stock_delta
            n_positions += 1
            # Sector bucketing: ETF/Index/Crypto go to their own class bucket first;
            # stocks fall back to instrument tags (user-defined sector labels).
            asset_class = get_asset_class(inst.symbol)
            if asset_class in ("etf", "index"):
                bucket = "ETF/Index"
                sector_exp[bucket] = sector_exp.get(bucket, Decimal("0")) + stock_delta
            elif asset_class == "crypto":
                bucket = "Crypto"
                sector_exp[bucket] = sector_exp.get(bucket, Decimal("0")) + stock_delta
            else:
                tags = inst.tags or []
                if tags:
                    for tag in tags:
                        sector_exp[tag] = sector_exp.get(tag, Decimal("0")) + stock_delta
                else:
                    sector_exp["Stock"] = sector_exp.get("Stock", Decimal("0")) + stock_delta
            continue

        # ── Option position ──────────────────────────────────────────
        if inst.expiry is None:
            continue

        n_positions += 1
        dte = (inst.expiry - today).days
        T = Decimal(str(max(dte, 0) / 365.0))
        spot = spot_map.get(inst.symbol)
        marg = maintenance_margin(pos.net_contracts, inst.strike)
        total_margin += marg
        sym_margin[inst.symbol] = sym_margin.get(inst.symbol, Decimal("0")) + marg

        delta_exp = Decimal("0")
        if spot and T > 0:
            g = calculate_greeks(
                spot, inst.strike, T, inst.option_type.value, DEFAULT_SIGMA, r_f
            )
            delta_exp = net_delta_exposure(pos.net_contracts, g)
            net_contracts_d = Decimal(str(pos.net_contracts))
            abs_n = Decimal(str(abs(pos.net_contracts)))

            total_delta += delta_exp
            theta_exp = g.theta * net_contracts_d * MULTIPLIER
            gamma_exp = g.gamma * net_contracts_d * MULTIPLIER
            vega_exp = g.vega * abs_n * MULTIPLIER

            total_theta += theta_exp
            total_gamma += g.gamma * abs_n * MULTIPLIER
            total_vega += vega_exp

            sym_theta[inst.symbol] = sym_theta.get(inst.symbol, Decimal("0")) + theta_exp
            sym_gamma[inst.symbol] = sym_gamma.get(inst.symbol, Decimal("0")) + gamma_exp
            sym_delta[inst.symbol] = sym_delta.get(inst.symbol, Decimal("0")) + delta_exp

            tags = inst.tags or []
            for tag in tags:
                sector_exp[tag] = sector_exp.get(tag, Decimal("0")) + delta_exp

        # Expiry bucket
        if dte <= 7:
            bkt = "\u22647d"
        elif dte <= 30:
            bkt = "8-30d"
        elif dte <= 90:
            bkt = "31-90d"
        else:
            bkt = ">90d"

        buckets[bkt]["net_contracts"] += pos.net_contracts
        buckets[bkt]["delta_exposure"] = buckets[bkt]["delta_exposure"] + delta_exp

    # ── Top capital-efficient underlying ─────────────────────────────
    top_efficient: str | None = None
    best_ratio = Decimal("-999999")
    for sym in sym_theta:
        margin = sym_margin.get(sym, Decimal("0"))
        if margin > Decimal("0"):
            ratio = sym_theta[sym] / margin
            if ratio > best_ratio:
                best_ratio = ratio
                top_efficient = sym

    # ── Gamma crash risk alerts ──────────────────────────────────────
    risk_alerts = _build_risk_alerts(sym_delta, sym_gamma, spot_map)

    # ── 1-day 95% VaR — delta-normal method ──────────────────────────
    var_sum_sq = Decimal("0")
    for sym, d_exp in sym_delta.items():
        spot_s = spot_map.get(sym)
        if spot_s is None or spot_s <= 0:
            continue
        sigma_annual = vol_map.get(sym, DEFAULT_SIGMA)
        sigma_daily = sigma_annual / _SQRT252
        dollar_vol = abs(d_exp) * spot_s * sigma_daily
        var_sum_sq += dollar_vol * dollar_vol
    var_1d_95: Decimal | None = None
    if var_sum_sq > 0:
        var_1d_95 = _Z95 * Decimal(str(math.sqrt(float(var_sum_sq))))

    return {
        "total_net_delta": total_delta,
        "total_gamma": total_gamma,
        "total_theta_daily": total_theta,
        "total_vega": total_vega,
        "maintenance_margin_total": total_margin,
        "var_1d_95": var_1d_95,
        "positions_count": n_positions,
        "top_efficient_symbol": top_efficient,
        "sector_exposure": {tag: str(v) for tag, v in sector_exp.items()},
        "risk_alerts": risk_alerts,
        "expiry_buckets": [
            {"label": k, "net_contracts": v["net_contracts"], "delta_exposure": v["delta_exposure"]}
            for k, v in buckets.items()
        ],
    }
