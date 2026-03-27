"""
GET /api/risk/dashboard[?portfolio_id=N]
GET /api/risk/scenario[?portfolio_id=N&price_change_pct=X&vol_change_ppt=Y]

Dashboard aggregates:
  - Total Net Δ (options + stocks), Γ, Θ/day, V, maintenance margin
  - Expiry distribution (≤7d | 8-30d | 31-90d | >90d)
  - top_efficient_symbol, sector_exposure, benchmark_ytd
  - risk_alerts: gamma crash points (delta doubles within N% move)

Scenario engine (2nd-order Taylor expansion):
  ΔPnL ≈ (Δ_exp × ΔP) + (0.5 × Γ_exp × ΔP²) + (V_exp × ΔIV_ppt)
  Where ΔP = spot × price_change_pct and ΔIV_ppt = absolute vol-point shift.

Uses recursive roll-up: parent portfolio includes all child sub-strategies.
"""
from __future__ import annotations

import asyncio
import math
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import InstrumentType
from app.models.user import User
from app.models.trade_event import TradeEvent, TradeAction
from app.models.cash_ledger import CashLedger
from app.schemas.risk import (
    AccountHistory,
    AttributionItem,
    AttributionResponse,
    BenchmarkYTD,
    ExpiryBucket,
    PortfolioInsight,
    RiskDashboard,
    ScenarioPnL,
    ScenarioResult,
)
from app.services import position_engine, yfinance_client
from app.services.portfolio_resolver import resolve_portfolio_ids
from app.services.risk_engine import compute_risk_summary
from app.services.black_scholes import (
    DEFAULT_SIGMA,
    MULTIPLIER,
    calculate_greeks,
    calculate_option_price,
    maintenance_margin,
    net_delta_exposure,
)

router = APIRouter(tags=["risk"])

_BENCHMARKS = ["SPY", "QQQ"]

_EMPTY_BUCKETS = [
    ExpiryBucket(label="≤7d",    net_contracts=0, delta_exposure=Decimal("0")),
    ExpiryBucket(label="8-30d",  net_contracts=0, delta_exposure=Decimal("0")),
    ExpiryBucket(label="31-90d", net_contracts=0, delta_exposure=Decimal("0")),
    ExpiryBucket(label=">90d",   net_contracts=0, delta_exposure=Decimal("0")),
]


@router.get("/risk/dashboard", response_model=RiskDashboard)
async def get_risk_dashboard(
    portfolio_id: int | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _internal_user_id: int | None = None,
):
    uid = _internal_user_id if _internal_user_id is not None else user.id
    pids = await resolve_portfolio_ids(db, uid, portfolio_id)
    positions = await position_engine.calculate_positions(db, portfolio_ids=pids)

    # Fetch benchmark YTDs concurrently (independent of positions)
    benchmark_raw = await asyncio.gather(
        *[yfinance_client.get_ytd_return(b) for b in _BENCHMARKS],
        return_exceptions=True,
    )
    benchmark_ytd = [
        BenchmarkYTD(
            symbol=sym,
            ytd_return=ret if isinstance(ret, Decimal) else None,
        )
        for sym, ret in zip(_BENCHMARKS, benchmark_raw)
    ]

    if not positions:
        return RiskDashboard(
            total_net_delta=Decimal("0"),
            total_gamma=Decimal("0"),
            total_theta_daily=Decimal("0"),
            total_vega=Decimal("0"),
            maintenance_margin_total=Decimal("0"),
            expiry_buckets=_EMPTY_BUCKETS,
            positions_count=0,
            as_of=datetime.utcnow(),
            top_efficient_symbol=None,
            sector_exposure={},
            benchmark_ytd=benchmark_ytd,
            risk_alerts=[],
        )

    # ── Batch spot prices + historical vols (all symbols for VaR) ────────
    all_symbols = list({pos.instrument.symbol for pos in positions})
    spot_results, vol_results = await asyncio.gather(
        asyncio.gather(*[yfinance_client.get_spot_price(s) for s in all_symbols]),
        asyncio.gather(*[yfinance_client.get_hist_vol(s)   for s in all_symbols]),
    )
    spot_map: dict[str, Decimal | None] = dict(zip(all_symbols, spot_results))
    vol_map:  dict[str, Decimal]        = dict(zip(all_symbols, vol_results))

    # ── Delegate to risk_engine (shared with WebSocket broadcasts) ───────
    summary = compute_risk_summary(positions, spot_map, vol_map)

    return RiskDashboard(
        total_net_delta=summary["total_net_delta"],
        total_gamma=summary["total_gamma"],
        total_theta_daily=summary["total_theta_daily"],
        total_vega=summary["total_vega"],
        maintenance_margin_total=summary["maintenance_margin_total"],
        expiry_buckets=[
            ExpiryBucket(**bkt) for bkt in summary["expiry_buckets"]
        ],
        positions_count=summary["positions_count"],
        as_of=datetime.utcnow(),
        top_efficient_symbol=summary["top_efficient_symbol"],
        sector_exposure=summary["sector_exposure"],
        sector_allocation=summary.get("sector_allocation", {}),
        benchmark_ytd=benchmark_ytd,
        risk_alerts=summary["risk_alerts"],
        var_1d_95=summary["var_1d_95"],
    )


@router.get("/risk/scenario", response_model=ScenarioResult)
async def get_scenario(
    portfolio_id:    int | None = Query(None),
    price_change_pct: float    = Query(0.0, description="Fractional price move, e.g. -0.15 for -15%"),
    vol_change_ppt:   float    = Query(0.0, description="Absolute IV shift in pp, e.g. 20 for +20pp"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Second-order Taylor expansion PnL estimate.

    For each position:
      - Options: ΔPnL = Δ_exp×ΔP + 0.5×Γ_exp×ΔP² + V_exp×vol_change_ppt
      - Stocks:  ΔPnL = net_shares × ΔP

    Price move ΔP = spot × price_change_pct (dollar change in underlying).
    Vega is per 1 percentage-point vol move; vol_change_ppt is pp shift (e.g. 20).
    """
    pids = await resolve_portfolio_ids(db, user.id, portfolio_id)
    positions = await position_engine.calculate_positions(db, portfolio_ids=pids)

    if not positions:
        return ScenarioResult(
            price_change_pct=price_change_pct,
            vol_change_ppt=vol_change_ppt,
            estimated_pnl=Decimal("0"),
            by_symbol=[],
            as_of=datetime.utcnow(),
        )

    # Batch spot + vol
    symbols = list({pos.instrument.symbol for pos in positions})
    spot_results, vol_results = await asyncio.gather(
        asyncio.gather(*[yfinance_client.get_spot_price(s) for s in symbols]),
        asyncio.gather(*[yfinance_client.get_hist_vol(s)   for s in symbols]),
    )
    spot_map: dict[str, Decimal | None] = dict(zip(symbols, spot_results))
    vol_map:  dict[str, Decimal]        = dict(zip(symbols, vol_results))

    today   = date.today()
    r_f     = Decimal(str(settings.risk_free_rate))
    pc      = Decimal(str(price_change_pct))
    vol_pp  = Decimal(str(vol_change_ppt))

    total_pnl: Decimal = Decimal("0")
    by_symbol: dict[str, Decimal] = {}

    for pos in positions:
        inst = pos.instrument
        spot = spot_map.get(inst.symbol)
        if spot is None or spot <= 0:
            continue

        delta_P = spot * pc   # dollar move in underlying

        # ── Stock leg ──────────────────────────────────────────────────
        if inst.instrument_type == InstrumentType.STOCK or inst.option_type is None:
            leg_pnl = Decimal(str(pos.net_contracts)) * delta_P
            by_symbol[inst.symbol] = by_symbol.get(inst.symbol, Decimal("0")) + leg_pnl
            total_pnl += leg_pnl
            continue

        # ── Option leg ─────────────────────────────────────────────────
        if inst.expiry is None:
            continue

        dte  = (inst.expiry - today).days
        T    = Decimal(str(max(dte, 0) / 365.0))
        if T <= 0:
            continue

        sigma = vol_map.get(inst.symbol, DEFAULT_SIGMA)
        g = calculate_greeks(spot, inst.strike, T, inst.option_type.value, sigma, r_f)

        n_d       = Decimal(str(pos.net_contracts))
        delta_exp = g.delta * n_d * MULTIPLIER
        gamma_exp = g.gamma * n_d * MULTIPLIER
        vega_exp  = g.vega  * n_d * MULTIPLIER

        leg_pnl = (
            delta_exp * delta_P
            + Decimal("0.5") * gamma_exp * delta_P * delta_P
            + vega_exp * vol_pp
        )
        by_symbol[inst.symbol] = by_symbol.get(inst.symbol, Decimal("0")) + leg_pnl
        total_pnl += leg_pnl

    return ScenarioResult(
        price_change_pct=price_change_pct,
        vol_change_ppt=vol_change_ppt,
        estimated_pnl=total_pnl,
        by_symbol=[
            ScenarioPnL(symbol=sym, estimated_pnl=pnl)
            for sym, pnl in sorted(by_symbol.items())
        ],
        as_of=datetime.utcnow(),
    )


@router.get("/risk/history", response_model=AccountHistory)
async def get_account_history(
    portfolio_id: int | None = Query(None),
    benchmarks:   str        = Query("SPY,QQQ", description="Comma-separated benchmark symbols"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Account NLV vs benchmark comparison.

    NLV = cumulative CashLedger cash flows, normalized to index 100 at the
    first trade date.  Benchmark prices are fetched from yfinance and
    normalized to 100 at the same anchor date.

    The date axis is derived from the union of all market trading days
    returned by yfinance for the benchmark series (so the chart is dense
    even when the account has only a few trade events).  Account values
    are carried forward on days with no new trades.
    """
    # ── 1. Resolve portfolio IDs ─────────────────────────────────────────────
    pids = await resolve_portfolio_ids(db, user.id, portfolio_id)

    # ── 2. Fetch all CashLedger entries, sorted chronologically ─────────────
    rows = (await db.execute(
        select(CashLedger)
        .where(CashLedger.portfolio_id.in_(pids))
        .order_by(CashLedger.created_at),
    )).scalars().all()

    if not rows:
        return AccountHistory(
            dates=[], account=[], benchmarks={},
            alpha_vs_spy=None, sharpe_ratio=None, first_date=None,
        )

    # ── 3. Group by date → running cumulative cash ───────────────────────────
    daily_flows: dict[str, Decimal] = defaultdict(Decimal)
    for row in rows:
        day = row.created_at.strftime("%Y-%m-%d")
        daily_flows[day] += Decimal(str(row.amount))

    first_date = min(daily_flows.keys())
    today_str  = date.today().isoformat()

    # ── 4. Fetch benchmark histories concurrently ────────────────────────────
    bm_list = [s.strip().upper() for s in benchmarks.split(",") if s.strip()]
    bm_raw  = await asyncio.gather(
        *[yfinance_client.get_price_history(sym, first_date) for sym in bm_list],
        return_exceptions=True,
    )
    bm_prices: dict[str, dict[str, float]] = {}
    for sym, res in zip(bm_list, bm_raw):
        bm_prices[sym] = res if isinstance(res, dict) else {}

    # ── 5. Build unified date axis (market days from benchmarks + trade dates) ─
    all_dates_set: set[str] = set(daily_flows.keys())
    for hist in bm_prices.values():
        all_dates_set.update(hist.keys())
    all_dates = sorted(
        d for d in all_dates_set if first_date <= d <= today_str
    )
    if not all_dates:
        all_dates = sorted(daily_flows.keys())

    # ── 6. Account NLV series (carry-forward on non-trade days) ─────────────
    cumulative      = Decimal("0")
    first_cum: Decimal | None = None
    account_raw: list[float] = []

    for d in all_dates:
        if d in daily_flows:
            cumulative += daily_flows[d]
        if first_cum is None:
            first_cum = cumulative
        account_raw.append(float(cumulative))

    ref     = float(first_cum) if first_cum is not None else 0.0
    ref_abs = abs(ref) if ref != 0 else 1.0
    # Normalize: first date = 100; subsequent = % change vs first magnitude + 100
    account_series = [(v - ref) / ref_abs * 100.0 + 100.0 for v in account_raw]

    # ── 7. Benchmark normalized series (100 at first price on or after first_date) ─
    benchmark_series: dict[str, list[float]] = {}
    for sym, prices in bm_prices.items():
        if not prices:
            continue
        first_price: float | None = None
        last_price:  float | None = None
        series: list[float] = []

        for d in all_dates:
            p = prices.get(d)
            if p is not None:
                last_price = p
            if first_price is None and last_price is not None:
                first_price = last_price
            if first_price and first_price > 0 and last_price is not None:
                series.append(last_price / first_price * 100.0)
            else:
                series.append(100.0)

        if series:
            benchmark_series[sym] = series

    # ── 8. Alpha vs SPY ──────────────────────────────────────────────────────
    alpha_vs_spy: float | None = None
    if account_series and "SPY" in benchmark_series and benchmark_series["SPY"]:
        spy_ret     = benchmark_series["SPY"][-1] - 100.0
        acct_ret    = account_series[-1] - 100.0
        alpha_vs_spy = round(acct_ret - spy_ret, 2)

    # ── 9. Simplified annualized Sharpe ──────────────────────────────────────
    sharpe: float | None = None
    if len(account_series) > 2:
        daily_rets = [
            (account_series[i] - account_series[i - 1]) / account_series[i - 1]
            for i in range(1, len(account_series))
            if account_series[i - 1] != 0.0
        ]
        if len(daily_rets) >= 2:
            n      = len(daily_rets)
            mean_r = sum(daily_rets) / n
            var    = sum((r - mean_r) ** 2 for r in daily_rets) / max(n - 1, 1)
            std_r  = math.sqrt(var) if var > 0 else 0.0
            if std_r > 0:
                sharpe = round(mean_r / std_r * math.sqrt(252), 2)

    return AccountHistory(
        dates         = all_dates,
        account       = account_series,
        benchmarks    = benchmark_series,
        alpha_vs_spy  = alpha_vs_spy,
        sharpe_ratio  = sharpe,
        first_date    = first_date,
    )


@router.get("/risk/attribution", response_model=AttributionResponse)
async def get_pnl_attribution(
    portfolio_id: int | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _internal_user_id: int | None = None,
):
    """
    P&L attribution: splits unrealized PnL per position into:
      time_decay_pnl   = theta_at_open × net_contracts × 100 × days_elapsed
                         (positive = theta income for short; negative = theta cost for long)
      directional_pnl  = total_unrealized - time_decay_pnl
                         (delta/gamma driven residual, signed)
      total_unrealized = (current_premium - open_premium) × net_contracts × 100
                         (positive = profitable regardless of long/short)

    Current option price estimated via Black-Scholes using live spot + historical vol.
    Greeks at open computed using underlying_price_at_trade from the first opening trade.
    """
    uid = _internal_user_id if _internal_user_id is not None else user.id
    pids = await resolve_portfolio_ids(db, uid, portfolio_id)
    positions = await position_engine.calculate_positions(db, portfolio_ids=pids)

    _zero = Decimal("0")
    if not positions:
        return AttributionResponse(
            items=[],
            total_time_decay_pnl=_zero,
            total_directional_pnl=_zero,
            total_unrealized=_zero,
            as_of=datetime.utcnow(),
        )

    # ── 1. Fetch underlying_price_at_trade for first opening trade per instrument ─
    inst_ids = [pos.instrument.id for pos in positions]
    open_actions = [TradeAction.SELL_OPEN, TradeAction.BUY_OPEN]
    first_trade_rows = (await db.execute(
        select(
            TradeEvent.instrument_id,
            TradeEvent.underlying_price_at_trade,
        )
        .where(
            TradeEvent.instrument_id.in_(inst_ids),
            TradeEvent.action.in_(open_actions),
        )
        .order_by(TradeEvent.instrument_id, TradeEvent.trade_date.asc())
    )).all()

    underlying_at_open: dict[int, Decimal] = {}
    for iid, price in first_trade_rows:
        if iid not in underlying_at_open and price is not None:
            underlying_at_open[iid] = Decimal(str(price))

    # ── 2. Batch spot + hist-vol for all underlyings ──────────────────────────
    all_symbols = list({pos.instrument.symbol for pos in positions})
    spot_results, vol_results = await asyncio.gather(
        asyncio.gather(*[yfinance_client.get_spot_price(s) for s in all_symbols]),
        asyncio.gather(*[yfinance_client.get_hist_vol(s)   for s in all_symbols]),
    )
    spot_map: dict[str, Decimal | None] = dict(zip(all_symbols, spot_results))
    vol_map:  dict[str, Decimal]        = dict(zip(all_symbols, vol_results))

    today = date.today()
    r_f   = Decimal(str(settings.risk_free_rate))

    items: list[AttributionItem] = []
    total_time_decay  = _zero
    total_directional = _zero
    total_unrealized  = _zero

    for pos in positions:
        inst = pos.instrument
        spot = spot_map.get(inst.symbol)
        sigma = vol_map.get(inst.symbol, DEFAULT_SIGMA)
        n_d   = Decimal(str(pos.net_contracts))

        # ── Stock leg ─────────────────────────────────────────────────────
        if inst.instrument_type == InstrumentType.STOCK or inst.option_type is None:
            if spot is None:
                continue
            mult    = Decimal(str(inst.multiplier))
            dir_pnl = (spot - pos.avg_open_price) * n_d * mult
            items.append(AttributionItem(
                symbol=inst.symbol,
                instrument_type="STOCK",
                net_contracts=pos.net_contracts,
                cost_basis=pos.avg_open_price * abs(pos.net_contracts) * mult,
                time_decay_pnl=_zero,
                directional_pnl=dir_pnl,
                total_unrealized=dir_pnl,
            ))
            total_directional += dir_pnl
            total_unrealized  += dir_pnl
            continue

        # ── Option leg ────────────────────────────────────────────────────
        if inst.expiry is None or spot is None:
            continue

        dte_current = (inst.expiry - today).days
        T_current   = Decimal(str(max(dte_current, 0) / 365.0))

        # Greeks at open: use recorded spot if available, else current spot
        S_open   = underlying_at_open.get(inst.id, spot)
        T_open   = Decimal(str(max(pos.days_elapsed + max(dte_current, 0), 0) / 365.0))
        g_open   = calculate_greeks(S_open, inst.strike, T_open, inst.option_type.value, sigma, r_f)

        # Current option price via Black-Scholes
        cur_prem = calculate_option_price(spot, inst.strike, T_current, inst.option_type.value, sigma, r_f)

        # P&L attribution (correct sign: positive = profitable for both long and short)
        # total = (cur - open) × net × 100  → positive when position is winning
        # time_decay = theta_at_open × net × 100 × days  → positive income for shorts
        # directional = residual
        tu  = (cur_prem - pos.avg_open_price) * n_d * MULTIPLIER
        td  = g_open.theta * n_d * MULTIPLIER * Decimal(str(pos.days_elapsed))
        dir_pnl = tu - td

        items.append(AttributionItem(
            symbol=inst.symbol,
            instrument_type="OPTION",
            option_type=inst.option_type.value,
            strike=inst.strike,
            expiry=inst.expiry.isoformat(),
            net_contracts=pos.net_contracts,
            cost_basis=pos.avg_open_price * abs(pos.net_contracts) * MULTIPLIER,
            time_decay_pnl=td,
            directional_pnl=dir_pnl,
            total_unrealized=tu,
        ))
        total_time_decay  += td
        total_directional += dir_pnl
        total_unrealized  += tu

    return AttributionResponse(
        items=items,
        total_time_decay_pnl=total_time_decay,
        total_directional_pnl=total_directional,
        total_unrealized=total_unrealized,
        as_of=datetime.utcnow(),
    )


# ── LLM-Ready Portfolio Insights ──────────────────────────────────────────────

@router.get("/risk/insights", response_model=PortfolioInsight)
async def get_portfolio_insights(
    portfolio_id: int | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _internal_user_id: int | None = None,
):
    """
    LLM-Ready structured risk descriptor.

    Converts the portfolio's Greeks, VaR, and strategy composition into a
    structured JSON document suitable for passing to an AI trading coach.
    The natural_language_hint field provides a ready-to-use context string.

    Strategy mix is computed from the holdings endpoint logic; top_positions
    are the three largest contributors by |delta_exposure|.
    """
    uid = _internal_user_id if _internal_user_id is not None else user.id

    # ── Re-use the risk dashboard for aggregates + VaR ────────────────────
    dashboard = await get_risk_dashboard(
        portfolio_id=portfolio_id, db=db, user=user, _internal_user_id=uid,
    )

    # ── Re-use holdings for strategy mix + top positions ──────────────────
    pids = await resolve_portfolio_ids(db, uid, portfolio_id)
    positions = await position_engine.calculate_positions(db, portfolio_ids=pids)

    # Build HoldingGroups using the holdings service (same logic as GET /holdings)
    all_syms = list({p.instrument.symbol for p in positions})
    if all_syms:
        spot_r, vol_r = await asyncio.gather(
            asyncio.gather(*[yfinance_client.get_spot_price(s) for s in all_syms]),
            asyncio.gather(*[yfinance_client.get_hist_vol(s)   for s in all_syms]),
        )
        ins_spot: dict[str, Decimal | None] = dict(zip(all_syms, spot_r))
        ins_vol:  dict[str, Decimal]        = dict(zip(all_syms, vol_r))
    else:
        ins_spot, ins_vol = {}, {}

    from app.services.strategy_recognizer import LegSnapshot, identify_strategy
    from app.services.black_scholes import RISK_FREE

    today_d   = date.today()
    r_f_ins   = Decimal(str(settings.risk_free_rate))
    by_sym: dict[str, list] = {}
    for pos in positions:
        by_sym.setdefault(pos.instrument.symbol, []).append(pos)

    strategy_mix: dict[str, int] = {}
    top_positions: list[dict]    = []

    for sym, sym_positions in by_sym.items():
        spot_s = ins_spot.get(sym)
        sigma  = ins_vol.get(sym, DEFAULT_SIGMA)

        leg_snaps: list[LegSnapshot] = []
        sym_delta_exp = Decimal("0")
        sym_theta_day = Decimal("0")
        sym_margin    = Decimal("0")
        strategy_label = "Stock / ETF"

        for pos in sym_positions:
            inst = pos.instrument
            if inst.option_type is None:
                sym_delta_exp += Decimal(str(pos.net_contracts))
                continue
            if inst.expiry is None:
                continue
            leg_snaps.append(LegSnapshot(
                option_type=inst.option_type.value,
                strike=inst.strike,
                expiry=str(inst.expiry),
                net_contracts=pos.net_contracts,
            ))
            marg = maintenance_margin(pos.net_contracts, inst.strike)
            sym_margin += marg
            if spot_s and spot_s > 0:
                dte = (inst.expiry - today_d).days
                T   = Decimal(str(max(dte, 0) / 365.0))
                if T > 0:
                    g = calculate_greeks(spot_s, inst.strike, T, inst.option_type.value,
                                        sigma, r_f_ins)
                    sym_delta_exp += net_delta_exposure(pos.net_contracts, g)
                    sym_theta_day += g.theta * Decimal(str(pos.net_contracts)) * MULTIPLIER

        if leg_snaps:
            tag = identify_strategy(leg_snaps)
            st  = tag.strategy_type
            strategy_mix[st] = strategy_mix.get(st, 0) + 1
            strategy_label   = tag.label
        else:
            strategy_mix["SINGLE"] = strategy_mix.get("SINGLE", 0) + 1

        top_positions.append({
            "symbol":         sym,
            "strategy_label": strategy_label,
            "delta_exposure": round(float(sym_delta_exp), 2),
            "theta_daily":    round(float(sym_theta_day), 2),
            "margin":         round(float(sym_margin), 2),
        })

    # Sort by |delta_exposure| desc; keep top 3
    top_positions.sort(key=lambda x: abs(x["delta_exposure"]), reverse=True)
    top_positions = top_positions[:3]

    # ── Classify risk posture ─────────────────────────────────────────────
    net_delta_f  = float(dashboard.total_net_delta)
    net_gamma_f  = float(dashboard.total_gamma)
    net_theta_f  = float(dashboard.total_theta_daily)
    net_vega_f   = float(dashboard.total_vega)

    # Short gamma = portfolio gamma negative contribution; long = positive
    gamma_sign = "long" if net_gamma_f >= 0 else "short"
    theta_sign = "positive" if net_theta_f >= 0 else "negative"
    risk_posture = f"{gamma_sign}_gamma_{theta_sign}_theta"

    # Dominant risk factor by absolute Greek exposure
    greek_magnitudes = {
        "delta": abs(net_delta_f),
        "gamma": abs(net_gamma_f) * 100,   # scale gamma to comparable units
        "theta": abs(net_theta_f),
        "vega":  abs(net_vega_f),
    }
    dominant_risk = max(greek_magnitudes, key=lambda k: greek_magnitudes[k])

    # ── Natural language hint ─────────────────────────────────────────────
    var_str = f"${float(dashboard.var_1d_95):.0f}" if dashboard.var_1d_95 else "unknown"
    hint_parts = [
        f"Portfolio holds {dashboard.positions_count} position(s) across "
        f"{len(by_sym)} underlying(s).",
        f"Net delta: {net_delta_f:+.1f} | Gamma: {net_gamma_f:+.4f} | "
        f"Theta/day: ${net_theta_f:+.0f} | Vega: {net_vega_f:+.1f}.",
        f"Risk posture: {risk_posture.replace('_', ' ')}.",
        f"Estimated 1-day 95% VaR: {var_str}.",
    ]
    if strategy_mix:
        mix_str = ", ".join(f"{v}x {k.lower()}" for k, v in strategy_mix.items())
        hint_parts.append(f"Strategy mix: {mix_str}.")
    if dashboard.risk_alerts:
        hint_parts.append(f"Active alerts: {'; '.join(dashboard.risk_alerts[:2])}.")

    return PortfolioInsight(
        portfolio_id=portfolio_id,
        as_of=datetime.utcnow(),
        greeks_summary={
            "net_delta": round(net_delta_f, 4),
            "net_gamma": round(net_gamma_f, 6),
            "net_theta": round(net_theta_f, 2),
            "net_vega":  round(net_vega_f, 2),
        },
        risk_posture=risk_posture,
        dominant_risk=dominant_risk,
        var_1d_95=float(dashboard.var_1d_95) if dashboard.var_1d_95 else None,
        strategy_mix=strategy_mix,
        top_positions=top_positions,
        risk_alerts=list(dashboard.risk_alerts),
        natural_language_hint=" ".join(hint_parts),
    )
