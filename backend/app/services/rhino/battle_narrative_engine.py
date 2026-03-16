"""
Battle narrative engine — converts structured battle report data into
readable analyst-style prose paragraphs.

Pure presentation layer. No analytical logic. Reads upstream outputs only.

Sections:
  1. Fundamental anchor — EPS, growth, PE discipline, fair value, classification
  2. Battlefield structure — support/resistance ladder as tactical description
  3. Macro radar — risk regime interpretation
  4. Tactical playbook — dual-track actionable explanation

Safety rules:
  - No speculative claims or investment guarantees
  - No emotional or promotional language
  - Analytical, neutral, professional tone throughout
"""
from __future__ import annotations

from typing import NamedTuple

from .fundamental_narrative_engine import FundamentalNarrative
from .playbook_engine import determine_playbook_framing


class BattleNarrativeReport(NamedTuple):
    """Four-section narrative output for the battle report."""
    fundamental: str
    battlefield: str
    macro: str
    playbook: str


# ═══════════════════════════════════════════════════════════════════════════
# LABEL MAPS
# ═══════════════════════════════════════════════════════════════════════════

_CLASS_LABELS = {
    "deep_value": "deeply discounted relative to its fair value band",
    "discount":   "trading at a discount to fair value",
    "fair":       "trading within the fair value range",
    "premium":    "trading at a premium above the fair value band",
}

_STYLE_LABELS = {
    "growth":           "growth",
    "quality_mega_cap": "quality mega-cap",
    "cyclical":         "cyclical",
    "financial":        "financial",
    "defensive":        "defensive",
    "unknown":          "general",
}

_LADDER_LABEL_DESC = {
    "Structural Reversal": "a structural reversal threshold where market sentiment would shift decisively",
    "Regime Line":         "a regime line where sustained acceptance would signal trend expansion",
    "Major":               "a major level with significant historical price memory",
    "Structural":          "a structural level with moderate historical significance",
    "Weak":                "a minor level with limited structural importance",
}

_VIX_DESC = {
    "normal":   "calm",
    "elevated": "elevated",
    "crisis":   "stressed",
}

_RATE_DESC = {
    "neutral":     "neutral",
    "restrictive": "restrictive",
    "supportive":  "supportive",
}

_ACTION_DESC = {
    "strong_buy":    "strongly bullish",
    "defensive_buy": "cautiously bullish",
    "hold_watch":    "neutral, favoring observation",
    "reduce":        "defensive, favoring reduction",
    "stop_loss":     "risk-off, requiring strict stop-loss discipline",
}

_BIAS_DESC = {
    "bullish": "bullish",
    "bearish": "bearish",
    "neutral": "neutral",
}


# ═══════════════════════════════════════════════════════════════════════════
# FORMATTING HELPERS
# ═══════════════════════════════════════════════════════════════════════════

def _fmt(n: float | None, decimals: int = 2) -> str:
    if n is None:
        return "N/A"
    return f"{n:,.{decimals}f}"


def _pct(n: float | None) -> str:
    if n is None:
        return "N/A"
    return f"{n * 100:.1f}%"


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 1: FUNDAMENTAL ANCHOR
# ═══════════════════════════════════════════════════════════════════════════

def _build_fundamental_narrative(
    narrative: FundamentalNarrative,
    price: float,
) -> str:
    if narrative.raw_mid is None:
        return (
            "Valuation data is currently insufficient to establish a forward "
            "PE-based fair value range. The stock is classified as fair value "
            "by default due to limited data availability."
        )

    parts: list[str] = []

    # EPS anchor
    if narrative.anchor_eps is not None:
        parts.append(
            f"The valuation anchors on forward EPS of ${_fmt(narrative.anchor_eps)}."
        )

    # Growth outlook
    if narrative.growth_pct is not None:
        parts.append(
            f"Based on a projected growth rate of {_pct(narrative.growth_pct)}, "
            f"the valuation discipline assigns a PE range of "
            f"{_fmt(narrative.pe_band_low, 1)}x\u2013{_fmt(narrative.pe_band_high, 1)}x."
        )
    elif narrative.pe_band_low is not None and narrative.pe_band_high is not None:
        parts.append(
            f"The valuation discipline assigns a PE range of "
            f"{_fmt(narrative.pe_band_low, 1)}x\u2013{_fmt(narrative.pe_band_high, 1)}x."
        )

    # Fair value band
    if narrative.raw_low is not None and narrative.raw_high is not None:
        parts.append(
            f"This implies a fair value band between "
            f"${_fmt(narrative.raw_low)} and ${_fmt(narrative.raw_high)}."
        )

    # Classification
    class_desc = _CLASS_LABELS.get(narrative.classification, narrative.classification)
    parts.append(
        f"With the current price at ${_fmt(price)}, the stock is classified as "
        f"{class_desc}."
    )

    # Valuation style
    style_label = _STYLE_LABELS.get(narrative.valuation_style, narrative.valuation_style)
    parts.append(
        f"The valuation style is identified as {style_label}."
    )

    return " ".join(parts)


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2: BATTLEFIELD STRUCTURE
# ═══════════════════════════════════════════════════════════════════════════

def _build_battlefield_narrative(
    ladder: dict,
    price: float,
) -> str:
    support = ladder.get("support", [])
    resistance = ladder.get("resistance", [])

    if not support and not resistance:
        return (
            "The battlefield structure currently lacks defined support and "
            "resistance levels, limiting the ability to identify tactical "
            "inflection points."
        )

    parts: list[str] = []
    parts.append(
        "The battlefield structure currently centers around several key levels."
    )

    # Resistance description (strongest first, then others)
    if resistance:
        for i, r in enumerate(resistance[:3]):
            label_desc = _LADDER_LABEL_DESC.get(r.get("label", ""), "a notable level")
            level = r["level"]
            dist = r.get("dist_pct", 0)
            if i == 0:
                parts.append(
                    f"The nearest overhead resistance sits at ${_fmt(level)} "
                    f"(+{_fmt(dist, 1)}% from current price), representing {label_desc}."
                )
            else:
                parts.append(
                    f"Above that, ${_fmt(level)} (+{_fmt(dist, 1)}%) represents {label_desc}."
                )

    # Support description
    if support:
        for i, s in enumerate(support[:3]):
            label_desc = _LADDER_LABEL_DESC.get(s.get("label", ""), "a notable level")
            level = s["level"]
            dist = s.get("dist_pct", 0)
            if i == 0:
                parts.append(
                    f"On the downside, the nearest support is identified at ${_fmt(level)} "
                    f"(-{_fmt(dist, 1)}% below current price), representing {label_desc}."
                )
            else:
                parts.append(
                    f"Deeper support sits at ${_fmt(level)} (-{_fmt(dist, 1)}%), "
                    f"representing {label_desc}."
                )

    return " ".join(parts)


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3: MACRO RADAR
# ═══════════════════════════════════════════════════════════════════════════

def _build_macro_narrative(macro: dict) -> str:
    parts: list[str] = []

    vix_regime = macro.get("vix_regime", "unavailable")
    rate_regime = macro.get("rate_regime", "unavailable")
    risks = macro.get("risks", [])
    haircut = macro.get("haircut_pct", 0)

    # Overall regime
    if risks:
        risk_signals = [r["signal"] for r in risks]
        if "high_vix" in risk_signals:
            parts.append("Macro conditions currently show an elevated risk regime.")
        elif "high_yield" in risk_signals or "weak_volume" in risk_signals:
            parts.append("Macro conditions currently show a mixed risk regime.")
        else:
            parts.append("Macro conditions currently show a cautious risk regime.")
    else:
        parts.append("Macro conditions currently show a favorable risk regime.")

    # VIX
    vix_desc = _VIX_DESC.get(vix_regime, "uncertain")
    parts.append(f"Volatility levels indicate {vix_desc} conditions.")

    # Rates
    rate_desc = _RATE_DESC.get(rate_regime, "uncertain")
    parts.append(
        f"Interest rate pressure from the 10-year yield remains {rate_desc}."
    )

    # Volume
    has_weak_vol = any(r["signal"] == "weak_volume" for r in risks)
    if has_weak_vol:
        parts.append("Volume behavior suggests a weak rally with limited conviction.")
    else:
        parts.append("Volume behavior does not signal distribution or weakness.")

    # Overall conclusion
    if not risks:
        parts.append(
            "Overall, the macro radar indicates favorable trading conditions."
        )
    elif any(r["severity"] == "high" for r in risks):
        parts.append(
            "Overall, the macro radar indicates defensive trading conditions."
        )
    else:
        parts.append(
            "Overall, the macro radar indicates mixed trading conditions."
        )

    # Haircut
    if haircut > 0:
        parts.append(
            f"A {haircut}% valuation haircut has been applied to reflect macro headwinds."
        )

    return " ".join(parts)


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 4: TACTICAL PLAYBOOK
# ═══════════════════════════════════════════════════════════════════════════

def _build_playbook_narrative(
    playbook: dict,
    narrative: FundamentalNarrative,
) -> str:
    parts: list[str] = []

    bias = playbook.get("bias_tag", "neutral")
    action = playbook.get("action_tag", "hold_watch")
    upside = playbook.get("upside", {})
    downside = playbook.get("downside", {})
    risk_rule = playbook.get("risk_rule", "")

    # Bias
    bias_desc = _BIAS_DESC.get(bias, bias)
    action_desc = _ACTION_DESC.get(action, action)
    parts.append(f"The current tactical stance is {bias_desc}, with the action bias {action_desc}.")

    # Framing
    framing = determine_playbook_framing(narrative.valuation_style)

    # Upside
    target = upside.get("target")
    if target is not None:
        if framing == "recovery":
            parts.append(
                f"If the price confirms strength, the recovery path opens toward "
                f"${_fmt(target)}."
            )
        else:
            parts.append(
                f"If the price confirms strength, the expansion path opens toward "
                f"${_fmt(target)}."
            )
    else:
        parts.append("No clear upside target is currently identifiable from the structure.")

    # Downside
    stop = downside.get("stop")
    if stop is not None:
        parts.append(
            f"However, failure to hold the current structure may expose "
            f"downside risk toward ${_fmt(stop)}."
        )
    else:
        parts.append(
            "No defined support level is available to anchor a downside stop."
        )

    # Rationale
    rationale = playbook.get("rationale", [])
    if rationale:
        joined = "; ".join(rationale)
        parts.append(f"Key factors: {joined}.")

    # Risk rule
    if risk_rule:
        parts.append(
            "Position sizing should remain disciplined, with no single position "
            "exceeding 15% of portfolio exposure."
        )

    return " ".join(parts)


# ═══════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════

def build_battle_narrative(
    price: float,
    narrative: FundamentalNarrative,
    ladder: dict,
    macro: dict,
    playbook: dict,
) -> BattleNarrativeReport:
    """Build four-section narrative from structured battle report data.

    Pure presentation — no analytical recomputation.
    """
    return BattleNarrativeReport(
        fundamental=_build_fundamental_narrative(narrative, price),
        battlefield=_build_battlefield_narrative(ladder, price),
        macro=_build_macro_narrative(macro),
        playbook=_build_playbook_narrative(playbook, narrative),
    )
