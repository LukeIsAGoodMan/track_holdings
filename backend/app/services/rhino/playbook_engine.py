"""
Playbook engine — rule-based bias and action derivation from signals.
"""
from __future__ import annotations


def build_playbook(tech: dict, val: dict, vix_regime: str) -> dict:
    rationale: list[str] = []
    bias_score = 0

    # Valuation signal
    status = val.get("status", "unavailable")
    if status == "deeply_undervalued":
        bias_score += 2; rationale.append("Price deeply below fair value band")
    elif status == "undervalued":
        bias_score += 1; rationale.append("Price below fair value band")
    elif status == "overvalued":
        bias_score -= 1; rationale.append("Price above fair value band")
    elif status == "deeply_overvalued":
        bias_score -= 2; rationale.append("Price deeply above fair value band")

    # Technical signals
    tags = tech.get("pattern_tags", [])
    if "above_sma200" in tags:
        bias_score += 1; rationale.append("Trading above SMA200")
    if "below_sma200" in tags:
        bias_score -= 1; rationale.append("Trading below SMA200")
    if "reversal_at_support" in tags:
        bias_score += 1; rationale.append("Reversal at support zone")
    if "break_below_support" in tags:
        bias_score -= 1; rationale.append("Broke below support")
    if "dead_cat_bounce" in tags:
        bias_score -= 1; rationale.append("Dead cat bounce pattern")
    if "high_volume" in tags:
        rationale.append("High relative volume")

    # Macro drag
    if vix_regime == "crisis":
        bias_score -= 1; rationale.append("VIX crisis — risk-off environment")
    if vix_regime == "elevated":
        rationale.append("VIX elevated — caution warranted")

    bias_tag = "bullish" if bias_score >= 2 else "bearish" if bias_score <= -2 else "neutral"
    action_tag = _derive_action(bias_tag, tags, vix_regime)

    return {"bias_tag": bias_tag, "action_tag": action_tag, "rationale": rationale}


def _derive_action(bias: str, tags: list[str], vix_regime: str) -> str:
    if bias == "bullish" and "reversal_at_support" in tags:
        return "strong_buy"
    if bias == "bullish":
        return "defensive_buy"
    if bias == "bearish" and "break_below_support" in tags:
        return "stop_loss"
    if bias == "bearish":
        return "reduce"
    if vix_regime == "crisis":
        return "reduce"
    return "hold_watch"
