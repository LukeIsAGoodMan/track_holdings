"""
Phase 8a — AI Risk Context Synthesizer schemas.

RiskContext:  Sanitized, privacy-safe portfolio risk snapshot.
              No user IDs, no absolute dollar values.
              Only ratios, percentages, and hedge ratios.

AiInsight:    Structured diagnostic output from an AiProvider.
"""
from __future__ import annotations

from datetime import datetime
from pydantic import BaseModel


class PositionContext(BaseModel):
    """Sanitized per-symbol context (no absolute dollar values)."""
    symbol: str
    strategy_label: str                     # "Bull Put Spread", "Covered Call", etc.
    delta_pct_of_total: float               # this symbol's delta as % of total portfolio delta
    theta_pct_of_margin: float              # theta/day / margin for this symbol (efficiency)
    days_to_nearest_expiry: int | None


class ExpiryConcentration(BaseModel):
    """What fraction of contracts fall in each expiry bucket."""
    bucket: str           # "<=7d", "8-30d", "31-90d", ">90d"
    pct_of_total: float   # fraction 0-1


class MarketContext(BaseModel):
    """Market-wide macro context for AI risk analysis (no user/portfolio data)."""
    spx_price: float                      # S&P 500 spot
    spx_change_pct: float                 # % change from prev close
    vix_level: float                      # VIX spot
    vix_term: str                         # "low" | "normal" | "elevated" | "crisis"
    days_to_next_event: int | None        # trading days until next major macro event
    next_event_name: str | None           # "FOMC" | "CPI" | "NFP" | "PCE" | ...
    market_regime: str                    # "low_vol_bullish" | "low_vol_range" | "rising_vol" | "high_vol_selloff" | "crisis"


class RiskContext(BaseModel):
    """
    Sanitized risk snapshot for LLM consumption.

    PRIVACY: No user_id, no account numbers, no absolute dollar values.
    All metrics expressed as ratios, percentages, or hedge ratios.
    """
    # Portfolio shape
    positions_count: int
    underlyings_count: int

    # Greeks as ratios / percentages
    net_delta_normalized: float             # net_delta / positions_count (avg delta per position)
    delta_to_gamma_ratio: float | None      # |net_delta| / |net_gamma| -- convexity measure
    theta_yield_pct: float                  # |theta/day| / margin * 100 (daily theta yield %)
    vega_exposure_ratio: float              # |vega| / margin (vol sensitivity per margin $)

    # Risk ratios
    var_pct_of_margin: float | None         # VaR / margin * 100
    risk_posture: str                       # "short_gamma_positive_theta" etc.
    dominant_risk: str                      # "delta" | "gamma" | "vega" | "theta"

    # Strategy composition
    strategy_mix: dict[str, int]            # {"VERTICAL": 2, "SINGLE": 3}

    # Expiry concentration
    expiry_concentration: list[ExpiryConcentration]

    # Top positions (sanitized -- no dollar values)
    top_positions: list[PositionContext]

    # Active risk alerts (gamma crash warnings)
    risk_alerts: list[str]

    # Trader confidence & strategy tag distribution (Phase 10.5)
    avg_confidence: float | None = None           # weighted avg 1-5 across active trades
    tag_distribution: dict[str, int] | None = None  # {"Hedge": 3, "Income": 2, ...}

    # Market macro context (Phase 12a)
    market_context: MarketContext | None = None    # SPX/VIX/event data for AI

    # Timestamp
    as_of: datetime


class DiagnosticItem(BaseModel):
    """One diagnostic finding."""
    severity: str       # "info" | "warning" | "critical"
    category: str       # "delta", "gamma", "theta", "vega", "expiry", "diversification"
    title: str          # short headline
    explanation: str    # 1-2 sentence explanation
    suggestion: str     # actionable recommendation


class AiInsight(BaseModel):
    """Structured AI diagnostic output."""
    overall_assessment: str                 # "Safe" | "Caution" | "Warning" | "Danger"
    diagnostics: list[DiagnosticItem]
    generated_at: datetime
