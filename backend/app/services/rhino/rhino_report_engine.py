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
    if vol_ratio is not None and vol_ratio < 0.8:
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
    """Section 4: Tactical playbook — always dual-track (upside + downside).

    Risk rule: single stock should be ≤15% of portfolio.
    """
    support_zones = technical.get("support_zones", [])
    resistance_zones = technical.get("resistance_zones", [])

    # Upside script
    upside_target = None
    if resistance_zones:
        upside_target = resistance_zones[0]["center"]
    elif narrative.raw_high is not None:
        upside_target = narrative.raw_high

    upside_framing = determine_playbook_framing(narrative.valuation_style)

    upside = {
        "scenario": "upside",
        "target": upside_target,
        "target_label": (
            f"${upside_target:.2f}" if upside_target else "—"
        ),
        "framing": upside_framing,
    }

    # Downside script
    downside_stop = None
    if support_zones:
        downside_stop = support_zones[0]["center"]

    downside = {
        "scenario": "downside",
        "stop": downside_stop,
        "stop_label": (
            f"${downside_stop:.2f}" if downside_stop else "—"
        ),
    }

    return {
        "title": "Tactical Playbook",
        "action_tag": playbook.get("action_tag", "hold_watch"),
        "bias_tag": playbook.get("bias_tag", "neutral"),
        "rationale": playbook.get("rationale", []),
        "upside": upside,
        "downside": downside,
        "risk_rule": "Single stock ≤15% of portfolio",
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
    return {
        "fundamental": _build_fundamental_section(narrative, price),
        "ladder": _build_ladder_section(technical, price),
        "macro": _build_macro_section(macro, technical),
        "playbook": _build_playbook_section(playbook, narrative, technical, price),
    }
