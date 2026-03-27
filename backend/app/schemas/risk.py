from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.schemas.base import DecStr


class ExpiryBucket(BaseModel):
    label:         str     # "<=7d" | "8-30d" | "31-90d" | ">90d"
    net_contracts: int     # signed total contracts expiring in this bucket
    delta_exposure: DecStr


class BenchmarkYTD(BaseModel):
    """Year-to-date return for a benchmark index."""
    symbol:       str      # e.g. "SPY", "QQQ"
    ytd_return:   DecStr | None = None   # fraction e.g. "0.052" = +5.2%; None on failure


class ScenarioPnL(BaseModel):
    """Per-symbol estimated PnL for a scenario."""
    symbol:        str
    estimated_pnl: DecStr  # signed dollar estimate


class ScenarioResult(BaseModel):
    """
    Second-order Taylor expansion PnL estimate across all positions.

    Formula per leg:
      dPnL approx (delta_exp x dP) + (0.5 x gamma_exp x dP^2) + (vega_exp x dIV_ppt)

    Where:
      dP          = spot x price_change_pct             (dollar move in underlying)
      gamma_exp   = net_contracts x gamma x 100
      vega_exp    = net_contracts x vega  x 100         (vega already per 1% vol)
      dIV_ppt     = vol_change_ppt                      (percentage-point IV shift)
    """
    price_change_pct:       float   # e.g. -0.15 = -15%
    vol_change_ppt:         float   # e.g. 20.0  = +20 volatility points
    estimated_pnl:          DecStr  # total signed dollar estimate
    by_symbol:              list[ScenarioPnL] = []
    as_of:                  datetime


class AccountHistory(BaseModel):
    """
    Account NLV (Net Liquidation Value) vs benchmark comparison.

    NLV index is normalized so that the first trade date = 100.
    Both account and benchmarks share the same date axis derived from
    market trading days (sourced from yfinance).
    """
    dates:        list[str]           # ISO dates, ascending
    account:      list[float]         # NLV index; 100 = first trade date
    benchmarks:   dict[str, list[float]]  # symbol -> normalized price series
    alpha_vs_spy: float | None = None  # account_return - SPY_return (pp)
    sharpe_ratio: float | None = None  # simplified annualized Sharpe
    first_date:   str | None   = None  # ISO date of first trade


class AttributionItem(BaseModel):
    """P&L breakdown for one open position leg."""
    symbol:           str
    instrument_type:  str             # "OPTION" | "STOCK"
    option_type:      str | None = None    # "CALL" | "PUT" | None for stocks
    strike:           DecStr | None = None
    expiry:           str | None = None    # ISO date
    net_contracts:    int
    cost_basis:       DecStr          # total premium at open (unsigned magnitude)
    time_decay_pnl:   DecStr          # theta component (positive = income for short)
    directional_pnl:  DecStr          # delta/gamma residual (signed)
    total_unrealized: DecStr          # = time_decay_pnl + directional_pnl


class AttributionResponse(BaseModel):
    """Portfolio-wide P&L attribution breakdown."""
    items:                  list[AttributionItem]
    total_time_decay_pnl:   DecStr
    total_directional_pnl:  DecStr
    total_unrealized:       DecStr
    as_of:                  datetime


class RiskDashboard(BaseModel):
    total_net_delta:        DecStr
    total_gamma:            DecStr
    total_theta_daily:      DecStr   # aggregate theta per calendar day (short = positive)
    total_vega:             DecStr   # aggregate vega per 1% vol move
    maintenance_margin_total: DecStr
    expiry_buckets:         list[ExpiryBucket]
    positions_count:        int
    as_of:                  datetime

    # Smart Layer
    top_efficient_symbol:   str | None = None

    # Factor / sector exposure: tag -> aggregate signed delta exposure
    sector_exposure:        dict[str, str] = {}

    # Factor / sector allocation: tag -> signed notional market value
    sector_allocation:      dict[str, str] = {}

    # Alpha benchmarking: SPY + QQQ YTD for comparison
    benchmark_ytd:          list[BenchmarkYTD] = []

    # Risk alerts: human-readable strings about dangerous gamma concentrations
    risk_alerts:            list[str] = []

    # Probabilistic risk: 1-day Value at Risk at 95% confidence (delta-normal method).
    # Expressed as a positive dollar figure (the estimated maximum 1-day loss).
    var_1d_95:              DecStr | None = None


class PortfolioInsight(BaseModel):
    """
    LLM-Ready structured descriptor of the portfolio's risk state.

    Serialized as JSON and surfaced to an AI trading coach for natural-language
    analysis.  Schema contract:
      greeks_summary   -> portfolio aggregate Greeks (signed, position-adjusted)
      risk_posture     -> top-level classification of the risk book
      dominant_risk    -> the Greek that contributes most to VaR
      var_1d_95        -> 1-day 95% VaR in dollars (positive = max expected loss)
      strategy_mix     -> count of each recognized strategy type open
      top_positions    -> the three largest delta contributors (by |delta_exposure|)
      risk_alerts      -> existing gamma crash warnings
      natural_language_hint -> concise English description for LLM context window
    """
    portfolio_id:          int | None = None
    as_of:                 datetime

    greeks_summary:        dict      = {}
    # {net_delta, net_gamma, net_theta, net_vega} -- all floats

    risk_posture:          str       # e.g. "short_gamma_positive_theta"
    dominant_risk:         str       # "delta" | "gamma" | "vega" | "theta"
    var_1d_95:             float | None = None

    strategy_mix:          dict[str, int] = {}
    # strategy_type -> count, e.g. {"VERTICAL": 2, "SINGLE": 3}

    top_positions:         list[dict] = []
    # [{symbol, strategy_label, delta_exposure, theta_daily, margin}]

    risk_alerts:           list[str] = []
    natural_language_hint: str       = ""
