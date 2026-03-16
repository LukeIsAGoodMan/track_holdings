"""
Rhino Battle Report Engine — 4-section structured report for the analysis page.

Sections:
  1. Fundamental & valuation anchor
  2. Support/resistance ladder
  3. Macro radar
  4. Tactical playbook (always dual-track: upside + downside)

One-way consumption: reads outputs from valuation_engine, macro_engine,
technical_engine, playbook_engine, fundamental_narrative_engine.
Never recomputes upstream values.
"""
from __future__ import annotations

from .fundamental_narrative_engine import FundamentalNarrative
from .playbook_engine import determine_playbook_framing
from .battle_narrative_engine import build_battle_narrative


# ═══════════════════════════════════════════════════════════════════════════
# LADDER PRECEDENCE — semantic labels for support/resistance levels
# ═══════════════════════════════════════════════════════════════════════════

# Higher precedence wins when assigning labels to zones.
# Structural Reversal > Regime Line > Major > Structural > Weak
_ZONE_LABELS = [
    (0.90, "Structural Reversal"),
    (0.70, "Regime Line"),
    (0.50, "Major"),
    (0.30, "Structural"),
    (0.00, "Weak"),
]


def _label_zone(strength: float) -> str:
    """Assign semantic label based on zone strength (0–1)."""
    for threshold, label in _ZONE_LABELS:
        if strength >= threshold:
            return label
    return "Weak"


# ═══════════════════════════════════════════════════════════════════════════
# SECTION BUILDERS
# ═══════════════════════════════════════════════════════════════════════════

def _build_fundamental_section(
    narrative: FundamentalNarrative,
    price: float,
) -> dict:
    """Section 1: Fundamental & valuation anchor."""
    lines: list[str] = []

    if narrative.raw_mid is not None and narrative.upside_pct is not None:
        direction = "upside" if narrative.upside_pct > 0 else "downside"
        lines.append(
            f"Fair value midpoint ${narrative.raw_mid:.2f} "
            f"({abs(narrative.upside_pct):.1f}% {direction} from ${price:.2f})"
        )

    if narrative.anchor_eps is not None:
        lines.append(f"Anchor EPS ${narrative.anchor_eps:.2f}")

    if narrative.pe_band_low is not None and narrative.pe_band_high is not None:
        lines.append(f"PE band {narrative.pe_band_low}–{narrative.pe_band_high}x")

    if narrative.growth_pct is not None:
        lines.append(f"Avg growth {narrative.growth_pct * 100:.1f}%")

    return {
        "title": "Fundamental & Valuation Anchor",
        "classification": narrative.classification,
        "label": narrative.label,
        "valuation_style": narrative.valuation_style,
        "eps_anchor": narrative.anchor_eps,
        "pe_low": narrative.pe_band_low,
        "pe_high": narrative.pe_band_high,
        "midpoint": narrative.raw_mid,
        "lines": lines,
    }


def _build_ladder_section(
    technical: dict,
    price: float,
) -> dict:
    """Section 2: Support/resistance ladder with semantic precedence labels."""
    support_rungs: list[dict] = []
    resistance_rungs: list[dict] = []

    for z in technical.get("support_zones", [])[:5]:
        center = z["center"]
        dist_pct = (price - center) / price * 100 if price > 0 else 0
        support_rungs.append({
            "level": center,
            "dist_pct": round(dist_pct, 1),
            "label": _label_zone(z.get("strength", 0)),
            "strength": z.get("strength", 0),
        })

    for z in technical.get("resistance_zones", [])[:5]:
        center = z["center"]
        dist_pct = (center - price) / price * 100 if price > 0 else 0
        resistance_rungs.append({
            "level": center,
            "dist_pct": round(dist_pct, 1),
            "label": _label_zone(z.get("strength", 0)),
            "strength": z.get("strength", 0),
        })

    return {
        "title": "Support / Resistance Ladder",
        "support": support_rungs,
        "resistance": resistance_rungs,
        "pattern_tags": technical.get("pattern_tags", []),
    }


def _build_macro_section(
    macro: dict,
    technical: dict,
) -> dict:
    """Section 3: Macro radar with specific risk rules (analysis.py aligned).

    Rules:
      - VIX >= 22 → high risk flag (analysis.py: "VIX高达{vix}，大波动系统性风险未解除")
      - treasury_10y >= 4.25 → valuation pressure flag (analysis.py: "10年期美债收益率突破")
      - volume_ratio < 0.8 → weak rally flag (analysis.py: "<0.8x严重缩量")
    """
    risks: list[dict] = []

    vix = macro.get("vix_level")
    if vix is not None and vix >= 22:
        risks.append({
            "signal": "high_vix",
            "label": f"VIX at {vix:.1f} — elevated volatility risk",
            "severity": "high",
        })

    treasury = macro.get("treasury_10y")
    if treasury is not None and treasury >= 4.25:
        risks.append({
            "signal": "high_yield",
            "label": f"10Y yield at {treasury:.2f}% — valuation pressure",
            "severity": "medium",
        })

    vol_ratio = technical.get("volume_ratio")
    if vol_ratio is not None and vol_ratio >= 1.5:
        risks.append({
            "signal": "strong_volume",
            "label": f"Volume ratio {vol_ratio:.1f}x — strong volume confirmation",
            "severity": "info",
        })
    elif vol_ratio is not None and vol_ratio < 0.8:
        risks.append({
            "signal": "weak_volume",
            "label": f"Volume ratio {vol_ratio:.1f}x — weak conviction rally",
            "severity": "low",
        })

    haircut = macro.get("recommended_haircut_pct", 0)

    return {
        "title": "Macro Radar",
        "vix_regime": macro.get("vix_regime", "unavailable"),
        "rate_regime": macro.get("rate_pressure_regime", "unavailable"),
        "haircut_pct": haircut,
        "risks": risks,
    }


def _build_playbook_section(
    playbook: dict,
    narrative: FundamentalNarrative,
    technical: dict,
    price: float,
) -> dict:
    """Section 4: Tactical playbook — scenario tree with trigger/target distinction.

    Risk rule: single stock should be ≤15% of portfolio.
    """
    support_zones = technical.get("support_zones", [])
    resistance_zones = technical.get("resistance_zones", [])
    pattern_tags = technical.get("pattern_tags", [])
    is_bearish = "below_sma200" in pattern_tags

    upside_framing = determine_playbook_framing(narrative.valuation_style)

    # Upside scenario tree
    upside_trigger = None
    upside_target = None
    if resistance_zones:
        upside_trigger = resistance_zones[0]["center"]
        if len(resistance_zones) >= 2:
            upside_target = resistance_zones[1]["center"]
        elif narrative.raw_high is not None:
            upside_target = narrative.raw_high
    elif narrative.raw_high is not None:
        upside_target = narrative.raw_high

    upside = {
        "scenario": "upside",
        "trigger": upside_trigger,
        "trigger_label": f"${upside_trigger:.2f}" if upside_trigger else "\u2014",
        "target": upside_target,
        "target_label": f"${upside_target:.2f}" if upside_target else "\u2014",
        "framing": upside_framing,
    }

    # Downside scenario tree
    downside_trigger = None
    downside_target = None
    if support_zones:
        downside_trigger = support_zones[0]["center"]
        if len(support_zones) >= 2:
            downside_target = support_zones[1]["center"]
    # Backward compat alias
    downside_stop = downside_trigger

    downside = {
        "scenario": "downside",
        "trigger": downside_trigger,
        "trigger_label": f"${downside_trigger:.2f}" if downside_trigger else "\u2014",
        "target": downside_target,
        "target_label": f"${downside_target:.2f}" if downside_target else "\u2014",
        "stop": downside_stop,
        "stop_label": f"${downside_stop:.2f}" if downside_stop else "\u2014",
    }

    # Reversal confirmation line — overhead recovery line for bearish setups
    reversal_line = None
    if is_bearish and resistance_zones:
        reversal_line = resistance_zones[0]["center"]

    return {
        "title": "Tactical Playbook",
        "action_tag": playbook.get("action_tag", "hold_watch"),
        "bias_tag": playbook.get("bias_tag", "neutral"),
        "rationale": playbook.get("rationale", []),
        "upside": upside,
        "downside": downside,
        "reversal_confirmation_line": reversal_line,
        "risk_rule": "Single stock \u226415% of portfolio",
        "risk_rule_zh": "\u5355\u4e00\u4e2a\u80a1\u4e0d\u8d85\u8fc7\u7ec4\u5408\u768415%",
    }


# ═══════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════

def build_battle_report(
    price: float,
    technical: dict,
    valuation: dict,
    macro: dict,
    playbook: dict,
    narrative: FundamentalNarrative,
) -> dict:
    """Build the 4-section Rhino Battle Report.

    All inputs are upstream engine outputs — no recomputation.
    """
    ladder_section = _build_ladder_section(technical, price)
    macro_section = _build_macro_section(macro, technical)
    playbook_section = _build_playbook_section(playbook, narrative, technical, price)

    # Build narrative after all structured sections
    battle_narrative = build_battle_narrative(
        price, narrative, ladder_section, macro_section, playbook_section,
    )

    return {
        "fundamental": _build_fundamental_section(narrative, price),
        "ladder": ladder_section,
        "macro": macro_section,
        "playbook": playbook_section,
        "narrative": battle_narrative._asdict(),
    }
