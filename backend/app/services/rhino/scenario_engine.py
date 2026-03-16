"""
Scenario engine — classifies the current market situation into a named scenario.

Sits between semantic_engine and narrative_engine in the pipeline:

    semantic_state → scenario_engine → scenario_type → narrative_engine

Design:
  - Strict priority ordering prevents rule conflicts.
  - Priority I:   Defensive override (risk_state high OR macro stressed)
  - Priority II:  Macro headwind (restrictive + overvalued/cautious)
  - Priority III: Technical setups (trend_pullback, bullish_breakout, mean_reversion)
  - Fallback:     neutral
  - O(1) — no loops over price history, uses only pre-computed states.
"""
from __future__ import annotations

# Allowed scenario values
SCENARIOS = frozenset({
    "trend_pullback",
    "bullish_breakout",
    "mean_reversion",
    "macro_headwind",
    "defensive",
    "neutral",
})


def build_scenario_state(
    semantic: dict,
    technical: dict,
    valuation: dict,
    macro: dict,
    playbook: dict,
) -> dict:
    """Classify the current market situation into a named scenario.

    Returns:
        {"scenario": str, "confidence": str}
    """
    risk_state = semantic.get("risk_state", "moderate")
    macro_regime = semantic.get("macro_regime", "unavailable")
    trend_state = semantic.get("trend_state", "unavailable")
    price_location = semantic.get("price_location", "unavailable")
    valuation_zone = semantic.get("valuation_zone", "unavailable")
    stance = semantic.get("stance", "neutral")

    # ── Priority I — Defensive override (HARD) ──────────────────────────
    if risk_state == "high" or macro_regime == "stressed":
        confidence = "high" if risk_state == "high" and macro_regime == "stressed" else "moderate"
        return {"scenario": "defensive", "confidence": confidence}

    # ── Priority II — Macro headwind ─────────────────────────────────────
    if macro_regime == "restrictive_risk":
        if valuation_zone == "overvalued":
            return {"scenario": "macro_headwind", "confidence": "high"}
        if stance == "cautious":
            return {"scenario": "macro_headwind", "confidence": "moderate"}

    # ── Priority III — Technical setups ──────────────────────────────────
    if trend_state == "above_sma200":
        if price_location == "near_support":
            confidence = "high" if valuation_zone == "undervalued" else "moderate"
            return {"scenario": "trend_pullback", "confidence": confidence}
        if price_location == "breakout_zone":
            ma_alignment = semantic.get("ma_alignment", "unavailable")
            confidence = "high" if ma_alignment == "bullish_alignment" else "moderate"
            return {"scenario": "bullish_breakout", "confidence": confidence}

    if trend_state == "below_sma200" and price_location == "near_support":
        if valuation_zone != "overvalued":
            confidence = "high" if valuation_zone == "undervalued" else "moderate"
            return {"scenario": "mean_reversion", "confidence": confidence}

    # ── Fallback — neutral ───────────────────────────────────────────────
    return {"scenario": "neutral", "confidence": "low"}
