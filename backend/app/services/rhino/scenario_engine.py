"""
Scenario engine — the single interpretation layer of the Rhino pipeline.

Sits between semantic_engine and narrative_engine:

    semantic_state → scenario_engine → ScenarioResult → narrative_engine

All joint reasoning, priority resolution, and cross-factor interpretation
is consolidated here.  Narrative receives a fully resolved ScenarioResult
and never re-infers relationships.

Design:
  - ScenarioResult is an immutable NamedTuple — fast access, no dict churn.
  - Strict four-tier priority prevents rule conflicts.
  - constraints tuple preserves trigger transparency for downstream reporting.
  - O(1) — no loops, no history access, only pre-computed semantic states.
"""
from __future__ import annotations

from typing import NamedTuple


# ═══════════════════════════════════════════════════════════════════════════
# SCHEMA
# ═══════════════════════════════════════════════════════════════════════════

class ScenarioResult(NamedTuple):
    scenario: str               # trend_pullback | bullish_breakout | mean_reversion | macro_headwind | defensive | neutral
    regime: str                 # macro interpretation for narrative macro section
    setup: str                  # structural setup for narrative structure section
    bias: str                   # directional bias for narrative playbook section
    confidence: str             # high | moderate | low
    constraints: tuple[str, ...]  # trigger transparency tags


SCENARIOS = frozenset({
    "trend_pullback",
    "bullish_breakout",
    "mean_reversion",
    "macro_headwind",
    "defensive",
    "neutral",
})

NEUTRAL_SCENARIO = ScenarioResult(
    scenario="neutral",
    regime="unavailable",
    setup="default",
    bias="neutral",
    confidence="low",
    constraints=(),
)


# ═══════════════════════════════════════════════════════════════════════════
# SECONDARY RESOLVERS — pure lookups, no priority logic
# ═══════════════════════════════════════════════════════════════════════════

def _resolve_regime(macro_regime: str, valuation_zone: str) -> str:
    """Resolve macro regime interpretation for narrative macro section."""
    if macro_regime == "restrictive_risk":
        if valuation_zone == "overvalued":
            return "restrictive_overvalued"
        if valuation_zone == "fair_value":
            return "restrictive_fair"
        return "restrictive"
    return {
        "supportive": "supportive",
        "mixed_macro": "mixed",
        "stressed": "stressed",
    }.get(macro_regime, "unavailable")


def _resolve_setup(
    risk_state: str, trend_state: str, price_location: str,
) -> str:
    """Resolve structural setup interpretation for narrative structure section.

    Priority matches the joint-reasoning templates in the lexicon pool:
      risk+breakdown > trend+breakout > below+support > above+resistance > single-factor
    """
    if risk_state == "high" and price_location == "breakdown_risk":
        return "risk_breakdown"
    if trend_state == "above_sma200" and price_location == "breakout_zone":
        return "momentum_breakout"
    if trend_state == "below_sma200" and price_location == "near_support":
        return "below_support"
    if trend_state == "above_sma200" and price_location == "near_resistance":
        return "above_resistance"
    return {
        "above_sma200": "above_trend",
        "below_sma200": "below_trend",
        "near_sma200": "near_trend",
    }.get(trend_state, "default")


# ═══════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════

def build_scenario_state(
    semantic: dict,
    technical: dict,
    valuation: dict,
    macro: dict,
    playbook: dict,
) -> ScenarioResult:
    """Classify the current market situation into a fully resolved ScenarioResult.

    All joint reasoning is resolved here.  Narrative engine receives this
    result and renders without re-interpreting semantic relationships.
    """
    # ── Extract semantic facts ───────────────────────────────────────
    risk_state = semantic.get("risk_state", "moderate")
    macro_regime = semantic.get("macro_regime", "unavailable")
    trend_state = semantic.get("trend_state", "unavailable")
    price_location = semantic.get("price_location", "unavailable")
    valuation_zone = semantic.get("valuation_zone", "unavailable")
    stance = semantic.get("stance", "neutral")
    ma_alignment = semantic.get("ma_alignment", "unavailable")

    # ── Resolve secondary fields (scenario-independent) ──────────────
    regime = _resolve_regime(macro_regime, valuation_zone)
    setup = _resolve_setup(risk_state, trend_state, price_location)
    bias = stance

    # ── Build constraints — trigger transparency ─────────────────────
    constraints: list[str] = []
    if risk_state == "high":
        constraints.append("risk_high")
    if macro_regime == "stressed":
        constraints.append("macro_stress")
    if valuation_zone == "undervalued" and price_location == "near_support":
        constraints.append("val_support")

    # ── Priority I — Defensive override (HARD) ──────────────────────
    if risk_state == "high" or macro_regime == "stressed":
        confidence = "high" if len(constraints) >= 2 and "risk_high" in constraints and "macro_stress" in constraints else "moderate"
        return ScenarioResult("defensive", regime, setup, bias, confidence, tuple(constraints))

    # ── Priority II — Macro headwind ─────────────────────────────────
    if macro_regime == "restrictive_risk":
        if valuation_zone == "overvalued":
            return ScenarioResult("macro_headwind", regime, setup, bias, "high", tuple(constraints))
        if stance == "cautious":
            return ScenarioResult("macro_headwind", regime, setup, bias, "moderate", tuple(constraints))

    # ── Priority III — Technical setups ──────────────────────────────
    if trend_state == "above_sma200":
        if price_location == "near_support":
            confidence = "high" if valuation_zone == "undervalued" else "moderate"
            return ScenarioResult("trend_pullback", regime, setup, bias, confidence, tuple(constraints))
        if price_location == "breakout_zone":
            confidence = "high" if ma_alignment == "bullish_alignment" else "moderate"
            return ScenarioResult("bullish_breakout", regime, setup, bias, confidence, tuple(constraints))

    if trend_state == "below_sma200" and price_location == "near_support":
        if valuation_zone != "overvalued":
            confidence = "high" if valuation_zone == "undervalued" else "moderate"
            return ScenarioResult("mean_reversion", regime, setup, bias, confidence, tuple(constraints))

    # ── Priority IV — Neutral fallback ───────────────────────────────
    return ScenarioResult("neutral", regime, setup, bias, "low", tuple(constraints))
