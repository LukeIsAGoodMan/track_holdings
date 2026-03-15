"""
Rhino Analysis Engine — Pydantic response schemas.

All models here are read-only output contracts (no DB persistence).
Monetary/price fields are plain float (display-only, not DecStr).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


# ── Quote ────────────────────────────────────────────────────────────────────

class QuoteData(BaseModel):
    symbol: str
    price: float
    previous_close: float | None = None
    change: float | None = None
    change_pct: float | None = None
    volume: int | None = None
    market_cap: float | None = None
    name: str | None = None


# ── Estimates ────────────────────────────────────────────────────────────────

class EstimateData(BaseModel):
    fy1_eps_avg: float | None = None
    fy2_eps_avg: float | None = None
    fy1_revenue_avg: float | None = None
    fy2_revenue_avg: float | None = None


# ── Macro ────────────────────────────────────────────────────────────────────

VixRegime = Literal["calm", "normal", "elevated", "crisis"]
RatePressureRegime = Literal["supportive", "neutral", "restrictive", "hostile"]

class MacroData(BaseModel):
    vix_level: float | None = None
    vix_regime: VixRegime = "normal"
    treasury_10y: float | None = None
    rate_pressure_regime: RatePressureRegime = "neutral"
    recommended_haircut_pct: float = 0
    alerts: list[str] = []


# ── Zones ────────────────────────────────────────────────────────────────────

ZoneSource = Literal["volume_profile", "pivot_high", "pivot_low", "sma200"]

class PriceZone(BaseModel):
    center: float
    lower: float
    upper: float
    strength: float        # 0–1 normalized
    sources: list[ZoneSource]


# ── Technical ────────────────────────────────────────────────────────────────

PatternTag = Literal[
    "break_below_support", "false_break_recovery", "reversal_at_support",
    "dead_cat_bounce", "limbo_zone", "above_sma200", "below_sma200",
    "high_volume", "low_volume",
]

class TechnicalData(BaseModel):
    sma200: float | None = None
    avg_volume_50: float | None = None
    atr20: float | None = None
    today_volume: float | None = None
    volume_ratio: float | None = None
    support_zones: list[PriceZone] = []
    resistance_zones: list[PriceZone] = []
    pattern_tags: list[PatternTag] = []


# ── Valuation ────────────────────────────────────────────────────────────────

ValuationStatus = Literal[
    "deeply_undervalued", "undervalued", "fair_value",
    "overvalued", "deeply_overvalued", "unavailable",
]

class ValuationBand(BaseModel):
    low: float
    mid: float
    high: float

class ValuationData(BaseModel):
    available: bool = False
    fy1_eps_avg: float | None = None
    fy2_eps_avg: float | None = None
    eps_growth_pct: float | None = None
    raw_fair_value: ValuationBand | None = None
    adjusted_fair_value: ValuationBand | None = None
    status: ValuationStatus = "unavailable"


# ── Playbook ─────────────────────────────────────────────────────────────────

BiasTag = Literal["bullish", "neutral", "bearish"]
ActionTag = Literal["strong_buy", "defensive_buy", "hold_watch", "reduce", "stop_loss"]

class PlaybookData(BaseModel):
    bias_tag: BiasTag = "neutral"
    action_tag: ActionTag = "hold_watch"
    rationale: list[str] = []


# ── Confidence ───────────────────────────────────────────────────────────────

ConfidenceGrade = Literal["A", "B", "C", "D"]

class ConfidenceData(BaseModel):
    score: int = 0
    grade: ConfidenceGrade = "D"
    reasons: list[str] = []


# ── Data Quality ─────────────────────────────────────────────────────────────

class DataQuality(BaseModel):
    has_quote: bool = False
    has_history: bool = False
    history_days: int = 0
    has_estimates: bool = False
    has_vix: bool = False
    has_treasury: bool = False


# ── Chart ────────────────────────────────────────────────────────────────────

class OhlcvBar(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int

class SmaPoint(BaseModel):
    date: str
    value: float

class ChartData(BaseModel):
    candles: list[OhlcvBar] = []
    sma200: list[SmaPoint] = []
    support_zones: list[PriceZone] = []
    resistance_zones: list[PriceZone] = []


# ── Text Output ──────────────────────────────────────────────────────────────

class TextOutput(BaseModel):
    lang: str = "en"
    sections: dict[str, str] = {}


# ── Full Analysis Result ─────────────────────────────────────────────────────

class AnalysisResult(BaseModel):
    symbol: str
    as_of: str
    data_quality: DataQuality
    confidence: ConfidenceData
    quote: QuoteData | None = None
    technical: TechnicalData
    valuation: ValuationData
    macro: MacroData
    playbook: PlaybookData
    text: TextOutput
    chart: ChartData
