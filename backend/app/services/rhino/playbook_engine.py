"""
Playbook engine — rule-based bias and action derivation from signals.

Aligned with analysis.py decision logic:
  - Valuation status drives conviction (±2 for deep, ±1 for moderate)
  - SMA200 is the bull/bear dividing line
  - Volume confirmation required for reversal_at_support (analysis.py: "放量止跌")
  - Dead cat bounce = bearish (analysis.py: "缩量反弹")
  - VIX crisis = hard risk-off override
  - Single stock ≤15% portfolio (enforced at report layer)
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

    # Reversal at support — analysis.py requires volume confirmation
    # "止跌形态：在关键支撑附近放量，说明有大资金接盘"
    if "reversal_at_support" in tags:
        if "high_volume" in tags:
            bias_score += 1; rationale.append("Reversal at support with volume confirmation")
        else:
            rationale.append("Reversal at support (awaiting volume confirmation)")

    if "break_below_support" in tags:
        bias_score -= 1; rationale.append("Broke below support")

    # Dead cat bounce — analysis.py: "缩量反弹，空头回补，买盘缺失"
    if "dead_cat_bounce" in tags:
        bias_score -= 1; rationale.append("Dead cat bounce — low volume recovery")

    if "high_volume" in tags and "reversal_at_support" not in tags:
        rationale.append("High relative volume")

    # Low volume — analysis.py: "严重缩量，买盘缺失"
    if "low_volume" in tags:
        rationale.append("Low volume — buyer conviction weak")

    # Macro drag
    if vix_regime == "crisis":
        bias_score -= 1; rationale.append("VIX crisis — risk-off environment")
    if vix_regime == "elevated":
        rationale.append("VIX elevated — caution warranted")

    bias_tag = "bullish" if bias_score >= 2 else "bearish" if bias_score <= -2 else "neutral"
    action_tag = _derive_action(bias_tag, tags, vix_regime)

    return {"bias_tag": bias_tag, "action_tag": action_tag, "rationale": rationale}


_RECOVERY_STYLES = frozenset({"defensive", "cyclical", "financial"})


def determine_playbook_framing(style: str) -> str:
    """Determine upside framing based on valuation style.

    growth / quality_mega_cap / unknown → expansion
    cyclical / defensive / financial   → recovery
    """
    if style in _RECOVERY_STYLES:
        return "recovery"
    return "expansion"


def _derive_action(bias: str, tags: list[str], vix_regime: str) -> str:
    # analysis.py: reversal at support + volume = left-side defense buy
    if bias == "bullish" and "reversal_at_support" in tags and "high_volume" in tags:
        return "strong_buy"
    if bias == "bullish":
        return "defensive_buy"
    # analysis.py: broke support = "挨打立正，严格止损"
    if bias == "bearish" and "break_below_support" in tags:
        return "stop_loss"
    if bias == "bearish":
        return "reduce"
    if vix_regime == "crisis":
        return "reduce"
    return "hold_watch"
