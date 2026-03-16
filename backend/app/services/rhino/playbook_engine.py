"""
Playbook engine — rule-based bias and action derivation from signals.

Aligned with analysis.py decision logic:
  - Valuation status drives conviction (+/-2 for deep, +/-1 for moderate)
  - SMA200 is the bull/bear dividing line
  - Volume confirmation required for reversal_at_support (analysis.py: "放量止跌")
  - Dead cat bounce = bearish (analysis.py: "缩量反弹")
  - VIX crisis = hard risk-off override
  - Single stock <=15% portfolio (enforced at report layer)

Rationale is bilingual — each item has code, en, and zh fields.
"""
from __future__ import annotations


# ═══════════════════════════════════════════════════════════════════════════
# BILINGUAL RATIONALE ITEMS
# ═══════════════════════════════════════════════════════════════════════════

def _r(code: str, en: str, zh: str) -> dict:
    """Create a structured bilingual rationale item."""
    return {"code": code, "en": en, "zh": zh}


def build_playbook(tech: dict, val: dict, vix_regime: str) -> dict:
    rationale: list[dict] = []
    bias_score = 0

    # Valuation signal
    status = val.get("status", "unavailable")
    if status == "deeply_undervalued":
        bias_score += 2
        rationale.append(_r("deep_value", "Price deeply below fair value band", "\u4ef7\u683c\u6df1\u5ea6\u4f4e\u4e8e\u5408\u7406\u4f30\u503c\u533a\u95f4"))
    elif status == "undervalued":
        bias_score += 1
        rationale.append(_r("undervalued", "Price below fair value band", "\u4ef7\u683c\u4f4e\u4e8e\u5408\u7406\u4f30\u503c\u533a\u95f4"))
    elif status == "overvalued":
        bias_score -= 1
        rationale.append(_r("overvalued", "Price above fair value band", "\u4ef7\u683c\u9ad8\u4e8e\u5408\u7406\u4f30\u503c\u533a\u95f4"))
    elif status == "deeply_overvalued":
        bias_score -= 2
        rationale.append(_r("deep_overvalued", "Price deeply above fair value band", "\u4ef7\u683c\u6df1\u5ea6\u9ad8\u4e8e\u5408\u7406\u4f30\u503c\u533a\u95f4"))

    # Technical signals
    tags = tech.get("pattern_tags", [])
    if "above_sma200" in tags:
        bias_score += 1
        rationale.append(_r("above_sma200", "Trading above SMA200", "\u4ef7\u683c\u5728SMA200\u4e4b\u4e0a"))
    if "below_sma200" in tags:
        bias_score -= 1
        rationale.append(_r("below_sma200", "Trading below SMA200", "\u4ef7\u683c\u5728SMA200\u4e4b\u4e0b"))

    # Reversal at support — analysis.py requires volume confirmation
    # "止跌形态：在关键支撑附近放量，说明有大资金接盘"
    if "reversal_at_support" in tags:
        if "high_volume" in tags:
            bias_score += 1
            rationale.append(_r("reversal_vol", "Reversal at support with volume confirmation", "\u652f\u6491\u4f4d\u653e\u91cf\u53cd\u8f6c"))
        else:
            rationale.append(_r("reversal_no_vol", "Reversal at support (awaiting volume confirmation)", "\u652f\u6491\u4f4d\u53cd\u8f6c\uff08\u5f85\u91cf\u80fd\u786e\u8ba4\uff09"))

    if "break_below_support" in tags:
        bias_score -= 1
        rationale.append(_r("break_support", "Broke below support", "\u8dcc\u7834\u652f\u6491\u4f4d"))

    # Dead cat bounce — analysis.py: "缩量反弹，空头回补，买盘缺失"
    if "dead_cat_bounce" in tags:
        bias_score -= 1
        rationale.append(_r("dead_cat", "Dead cat bounce \u2014 low volume recovery", "\u7f29\u91cf\u53cd\u5f39\u2014\u2014\u4e70\u76d8\u7f3a\u5931"))

    if "high_volume" in tags and "reversal_at_support" not in tags:
        rationale.append(_r("high_volume", "High relative volume", "\u6210\u4ea4\u91cf\u653e\u5927"))

    # Low volume — analysis.py: "严重缩量，买盘缺失"
    if "low_volume" in tags:
        rationale.append(_r("low_volume", "Low volume \u2014 buyer conviction weak", "\u7f29\u91cf\u2014\u2014\u4e70\u65b9\u4fe1\u5fc3\u4e0d\u8db3"))

    # Macro drag
    if vix_regime == "crisis":
        bias_score -= 1
        rationale.append(_r("vix_crisis", "VIX crisis \u2014 risk-off environment", "VIX\u5371\u673a\u2014\u2014\u98ce\u63a7\u4f18\u5148"))
    if vix_regime == "elevated":
        rationale.append(_r("vix_elevated", "VIX elevated \u2014 caution warranted", "VIX\u5347\u9ad8\u2014\u2014\u9700\u8c28\u614e"))

    bias_tag = "bullish" if bias_score >= 2 else "bearish" if bias_score <= -2 else "neutral"
    action_tag = _derive_action(bias_tag, tags, vix_regime)

    return {"bias_tag": bias_tag, "action_tag": action_tag, "rationale": rationale}


_RECOVERY_STYLES = frozenset({"defensive", "cyclical", "financial"})


def determine_playbook_framing(style: str) -> str:
    """Determine upside framing based on valuation style.

    growth / quality_mega_cap / hyper_growth / unknown / pre_profit → expansion
    cyclical / defensive / financial → recovery
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
