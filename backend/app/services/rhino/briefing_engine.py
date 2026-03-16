"""
Briefing engine — institutional-grade Chinese tactical briefing.

Produces a 4-section briefing resembling a sell-side investment desk report.
Pure rendering layer: no recomputation of valuation, technical, or macro logic.

Section ownership:
  Section 1 (valuation)  — owner: valuation_engine
  Section 2 (ladder)     — owner: technical_engine
  Section 3 (macro)      — owner: macro_engine
  Section 4 (playbook)   — owner: scenario_engine + playbook_engine

Design:
  - Section 2 implements tiered degradation (Level A / B / C)
  - All tactical phrases from atomic registry — no fragment concatenation
  - Dual-track tactical playbook: always renders both downside and upside paths
  - One-way data flow: upstream engines → briefing renderer
  - Deterministic output: same inputs → same briefing
  - Valuation midpoint hysteresis (±2%) prevents label oscillation
  - Ladder semantic precedence resolves overlapping labels
"""
from __future__ import annotations

from .scenario_engine import ScenarioResult, NEUTRAL_SCENARIO


# ═══════════════════════════════════════════════════════════════════════════
# SECTION OWNERSHIP
# ═══════════════════════════════════════════════════════════════════════════

SECTION_OWNERS: dict[str, str] = {
    "valuation": "valuation_engine",
    "ladder": "technical_engine",
    "macro": "macro_engine",
    "playbook": "scenario_engine + playbook_engine",
}


# ═══════════════════════════════════════════════════════════════════════════
# TACTICAL PHRASE REGISTRY (Chinese atomic phrases)
#
# Every value is a complete, self-contained institutional sentence.
# Renderer selects by key — never concatenates fragments.
# ═══════════════════════════════════════════════════════════════════════════

ZH_TACTICAL: dict[str, str] = {
    # ── Entry / Accumulation ──────────────────────────────────────────
    "left_side_accumulate":     "\u5de6\u4fa7\u8bd5\u63a2\u6027\u5206\u6279\u5efa\u4ed3",
    "right_side_confirm":       "\u53f3\u4fa7\u786e\u8ba4\u540e\u987a\u52bf\u8ddf\u8fdb",
    "wait_zone":                "\u5f53\u524d\u5904\u4e8e\u7b49\u5f85\u533a\uff0c\u4e0d\u5b9c\u4e3b\u52a8\u51fa\u51fb",
    "no_catch_falling_knife":   "\u5207\u52ff\u6284\u5e95\u63a5\u98de\u5200",
    "volume_stabilize_confirm": "\u9700\u7b49\u5f85\u7f29\u91cf\u4f01\u7a33\u786e\u8ba4",
    "weak_rebound":             "\u53cd\u5f39\u529b\u5ea6\u504f\u5f31\uff0c\u6682\u4e0d\u5177\u5907\u53c2\u4e0e\u4ef7\u503c",
    "structural_reversal_line": "\u5173\u6ce8\u7ed3\u6784\u6027\u53cd\u8f6c\u7ebf",
    "risk_control_rule":        "\u4e25\u683c\u6267\u884c\u98ce\u63a7\u7eaa\u5f8b",

    # ── Breakout / Momentum ───────────────────────────────────────────
    "momentum_follow":          "\u52a8\u80fd\u5ef6\u7eed\uff0c\u53ef\u987a\u52bf\u52a0\u4ed3",
    "breakout_confirm_volume":  "\u7a81\u7834\u9700\u6210\u4ea4\u91cf\u914d\u5408\u786e\u8ba4",
    "false_break_risk":         "\u5b58\u5728\u5047\u7a81\u7834\u98ce\u9669\uff0c\u9700\u89c2\u5bdf\u56de\u8e29\u786e\u8ba4",

    # ── Defensive ─────────────────────────────────────────────────────
    "reduce_exposure":              "\u5efa\u8bae\u9002\u5ea6\u964d\u4f4e\u4ed3\u4f4d",
    "capital_preservation_first":   "\u8d44\u672c\u4fdd\u5168\u4f18\u5148\u4e8e\u6536\u76ca\u8ffd\u6c42",
    "stop_loss_discipline":         "\u4e25\u683c\u6b62\u635f\uff0c\u4e0d\u62b1\u4fa5\u5e78",

    # ── Valuation ─────────────────────────────────────────────────────
    "discount_entry":       "\u4f30\u503c\u6298\u4ef7\u63d0\u4f9b\u5b89\u5168\u8fb9\u9645",
    "premium_caution":      "\u4f30\u503c\u6ea2\u4ef7\u9650\u5236\u4e0a\u884c\u7a7a\u95f4",
    "fair_value_patience":  "\u4f30\u503c\u4e2d\u6027\uff0c\u9700\u7b49\u5f85\u50ac\u5316\u5242",

    # ── Dual-Track: Current State ─────────────────────────────────────
    "state_neutral_consolidation":
        "\u4ef7\u683c\u5728\u5173\u952e\u7ed3\u6784\u533a\u95f4\u5185\u6574\u7406\uff0c\u77ed\u671f\u65b9\u5411\u5c1a\u672a\u786e\u8ba4",
    "state_constructive":
        "\u4ef7\u683c\u7ad9\u7a33\u4e3b\u8981\u652f\u6491\u4e0a\u65b9\uff0c\u7ed3\u6784\u504f\u5411\u591a\u5934",
    "state_cautious":
        "\u4ef7\u683c\u53d7\u538b\u4e8e\u4e0a\u65b9\u963b\u529b\uff0c\u77ed\u671f\u4e0a\u884c\u7a7a\u95f4\u53d7\u9650",
    "state_defensive":
        "\u98ce\u9669\u4fe1\u53f7\u4e3b\u5bfc\u5f53\u524d\u683c\u5c40\uff0c\u9632\u5fa1\u59ff\u6001\u4f18\u5148",

    # ── Dual-Track: Downside Script ───────────────────────────────────
    "downside_pullback_accumulate":
        "\u82e5\u4ef7\u683c\u56de\u6492\u81f3\u652f\u6491\u5e26\u9644\u8fd1\uff0c\u53ef\u542f\u52a8\u5de6\u4fa7\u5206\u6279\u8bd5\u63a2\u5efa\u4ed3",
    "downside_support_defense":
        "\u82e5\u4ef7\u683c\u63a5\u8fd1\u5173\u952e\u652f\u6491\uff0c\u9700\u89c2\u5bdf\u91cf\u4ef7\u9632\u5b88\u529b\u5ea6\u540e\u518d\u884c\u51b3\u7b56",
    "downside_defensive_reduce":
        "\u82e5\u4ef7\u683c\u7ee7\u7eed\u8d70\u5f31\uff0c\u5e94\u9022\u53cd\u5f39\u9002\u5ea6\u964d\u4f4e\u4ed3\u4f4d\u63a7\u5236\u98ce\u9669",
    "downside_avoid_knife":
        "\u82e5\u652f\u6491\u5931\u5b88\u8fdb\u5165\u52a0\u901f\u4e0b\u8dcc\u9636\u6bb5\uff0c\u5207\u52ff\u76f2\u76ee\u6284\u5e95",

    # ── Dual-Track: Upside Script ─────────────────────────────────────
    "upside_breakout_follow":
        "\u82e5\u4ef7\u683c\u6709\u6548\u7a81\u7834\u4e0a\u65b9\u538b\u529b\uff0c\u53ef\u8f6c\u5411\u53f3\u4fa7\u786e\u8ba4\u540e\u987a\u52bf\u8ddf\u8fdb",
    "upside_momentum_add":
        "\u7a81\u7834\u786e\u8ba4\u540e\u82e5\u52a8\u80fd\u6301\u7eed\uff0c\u53ef\u987a\u52bf\u52a0\u4ed3\u8ddf\u968f\u8d8b\u52bf\u6269\u5c55",
    "upside_resistance_patience":
        "\u63a5\u8fd1\u538b\u529b\u4f4d\u65f6\u4fdd\u6301\u8010\u5fc3\uff0c\u7b49\u5f85\u91cf\u4ef7\u7a81\u7834\u4fe1\u53f7\u786e\u8ba4",
    "upside_cautious_rally":
        "\u5373\u4f7f\u51fa\u73b0\u53cd\u5f39\uff0c\u5728\u8d8b\u52bf\u786e\u8ba4\u524d\u4ecd\u9700\u4fdd\u6301\u5ba1\u614e\u4ed3\u4f4d",

    # ── Dual-Track: Risk Discipline ───────────────────────────────────
    "risk_support_fail_exit":
        "\u82e5\u7ed3\u6784\u6027\u652f\u6491\u5931\u5b88\uff0c\u5fc5\u987b\u4e25\u683c\u6267\u884c\u98ce\u63a7\u7eaa\u5f8b",
    "risk_mandatory_discipline":
        "\u65e0\u8bba\u65b9\u5411\u5982\u4f55\u6f14\u53d8\uff0c\u98ce\u63a7\u7eaa\u5f8b\u59cb\u7ec8\u662f\u7b2c\u4e00\u4f18\u5148\u7ea7",
}

_TACTICAL_VALUES: frozenset[str] = frozenset(ZH_TACTICAL.values())


# ═══════════════════════════════════════════════════════════════════════════
# DUAL-TRACK MAPPING  (scenario → 4-part playbook structure)
# ═══════════════════════════════════════════════════════════════════════════

_DUAL_TRACK_KEYS: dict[str, dict[str, str]] = {
    "trend_pullback": {
        "state": "state_constructive",
        "downside": "downside_pullback_accumulate",
        "upside": "upside_breakout_follow",
        "risk": "risk_support_fail_exit",
    },
    "bullish_breakout": {
        "state": "state_constructive",
        "downside": "downside_support_defense",
        "upside": "upside_momentum_add",
        "risk": "risk_support_fail_exit",
    },
    "mean_reversion": {
        "state": "state_cautious",
        "downside": "downside_support_defense",
        "upside": "upside_breakout_follow",
        "risk": "risk_support_fail_exit",
    },
    "defensive": {
        "state": "state_defensive",
        "downside": "downside_defensive_reduce",
        "upside": "upside_cautious_rally",
        "risk": "risk_mandatory_discipline",
    },
    "macro_headwind": {
        "state": "state_cautious",
        "downside": "downside_support_defense",
        "upside": "upside_resistance_patience",
        "risk": "risk_support_fail_exit",
    },
    "neutral": {
        "state": "state_neutral_consolidation",
        "downside": "downside_pullback_accumulate",
        "upside": "upside_breakout_follow",
        "risk": "risk_support_fail_exit",
    },
}


# ═══════════════════════════════════════════════════════════════════════════
# LABEL MAPS
# ═══════════════════════════════════════════════════════════════════════════

_SOURCE_ZH: dict[str, str] = {
    "volume_profile": "\u91cf\u4ef7\u805a\u96c6\u533a",
    "sma200": "200\u65e5\u5747\u7ebf",
    "pivot_high": "\u67a2\u8f74\u9ad8\u70b9",
    "pivot_low": "\u67a2\u8f74\u4f4e\u70b9",
}

_SCENARIO_ZH: dict[str, str] = {
    "trend_pullback": "\u8d8b\u52bf\u56de\u6492",
    "bullish_breakout": "\u770b\u6da8\u7a81\u7834",
    "mean_reversion": "\u5747\u503c\u56de\u5f52",
    "macro_headwind": "\u5b8f\u89c2\u9006\u98ce",
    "defensive": "\u9632\u5fa1\u6a21\u5f0f",
    "neutral": "\u4e2d\u6027\u89c2\u671b",
}

_CONFIDENCE_ZH: dict[str, str] = {
    "high": "\u9ad8", "moderate": "\u4e2d", "low": "\u4f4e",
}

_VIX_REGIME_ZH: dict[str, str] = {
    "calm": "\u5e73\u9759", "normal": "\u6b63\u5e38",
    "elevated": "\u504f\u9ad8", "crisis": "\u5371\u673a",
    "unavailable": "\u4e0d\u53ef\u7528",
}

_RATE_REGIME_ZH: dict[str, str] = {
    "supportive": "\u5bbd\u677e", "neutral": "\u4e2d\u6027",
    "restrictive": "\u7d27\u7f29", "hostile": "\u6572\u5bf9",
    "unavailable": "\u4e0d\u53ef\u7528",
}


# ═══════════════════════════════════════════════════════════════════════════
# LADDER SEMANTIC LABELS (with precedence)
#
# Precedence: Structural Reversal > Regime Line > Major > Structural > Weak
# ═══════════════════════════════════════════════════════════════════════════

_LADDER_LABELS_RESISTANCE: dict[str, str] = {
    "structural_reversal":  "\u8d8b\u52bf\u6027\u53cd\u8f6c\u7ebf",
    "regime_line":          "\u957f\u671f\u8d8b\u52bf\u5206\u754c\u7ebf",
    "major":                "\u4e3b\u8981\u538b\u529b\u96c6\u805a\u533a",
    "structural":           "\u7ed3\u6784\u6027\u538b\u529b\u4f4d",
    "weak":                 "\u77ed\u671f\u4f9b\u7ed9\u538b\u529b",
}

_LADDER_LABELS_SUPPORT: dict[str, str] = {
    "structural_reversal":  "\u8d8b\u52bf\u6027\u53cd\u8f6c\u7ebf",
    "regime_line":          "\u957f\u671f\u8d8b\u52bf\u5206\u754c\u7ebf",
    "major":                "\u4e3b\u8981\u9700\u6c42\u652f\u6491\u533a",
    "structural":           "\u7ed3\u6784\u6027\u652f\u6491\u4f4d",
    "weak":                 "\u77ed\u671f\u9632\u5b88\u4f4d",
}


# ═══════════════════════════════════════════════════════════════════════════
# VALUATION POSITION LABELS (with hysteresis)
# ═══════════════════════════════════════════════════════════════════════════

_VAL_POSITION_ZH: dict[str, str] = {
    "deep_value":
        "\u5f53\u524d\u4ef7\u683c\u663e\u8457\u4f4e\u4e8e\u5408\u7406\u4ef7\u503c\u533a\u95f4\u4e0b\u6cbe"
        "\uff0c\u5e02\u573a\u7ed9\u4e88\u6df1\u5ea6\u6298\u4ef7\uff0c\u5b89\u5168\u8fb9\u9645\u5145\u88d5\u3002",
    "discount":
        "\u5f53\u524d\u4ef7\u683c\u7565\u4f4e\u4e8e\u5408\u7406\u4ef7\u503c\u4e2d\u67a2"
        "\uff0c\u5e02\u573a\u4ecd\u7ed9\u4e88\u9002\u5ea6\u6298\u4ef7\uff0c\u4f30\u503c\u5177\u5907\u4fee\u590d\u7a7a\u95f4\u3002",
    "fair":
        "\u5f53\u524d\u4ef7\u683c\u5904\u4e8e\u5408\u7406\u4ef7\u503c\u4e2d\u67a2\u9644\u8fd1"
        "\uff0c\u5e02\u573a\u5b9a\u4ef7\u57fa\u672c\u53cd\u6620\u524d\u77bb\u76c8\u5229\u9884\u671f\u3002",
    "premium":
        "\u5f53\u524d\u4ef7\u683c\u5df2\u8d85\u51fa\u5408\u7406\u4ef7\u503c\u533a\u95f4\u4e0a\u6cbe"
        "\uff0c\u5e02\u573a\u7ed9\u4e88\u663e\u8457\u6ea2\u4ef7\uff0c\u5bb9\u9519\u7a7a\u95f4\u6709\u9650\u3002",
    "unavailable":
        "\u4f30\u503c\u6570\u636e\u4e0d\u8db3\uff0c\u6682\u65e0\u6cd5\u5efa\u7acb\u5408\u7406\u4ef7\u503c\u53c2\u8003\u6846\u67b6\u3002",
}


# ═══════════════════════════════════════════════════════════════════════════
# FORMAT HELPERS (simple display mapping — no recomputation)
# ═══════════════════════════════════════════════════════════════════════════

def _fp(n: float | None) -> str:
    return f"{n:.2f}" if n is not None else "N/A"


def _classify_price_position(price: float, band: dict | None) -> str:
    """Classify price vs fair-value band with ±2% midpoint hysteresis.

    This is a rendering-stability rule, not a signal-generation rule.
    Order: deep_value → premium → hysteresis fair → discount → fair.
    """
    if price <= 0:
        return "unavailable"
    if not band or not isinstance(band, dict):
        return "unavailable"
    low = band.get("low")
    high = band.get("high")
    if low is None or high is None:
        return "unavailable"
    mid = (low + high) / 2
    if mid <= 0:
        return "unavailable"

    if price < low:
        return "deep_value"
    if price > high:
        return "premium"
    if abs(price - mid) / mid <= 0.02:
        return "fair"
    if price < mid:
        return "discount"
    return "fair"


def _ladder_semantic_label(zone: dict, is_resistance: bool) -> str:
    """Map zone strength + provenance to semantic label with precedence.

    Precedence (highest first):
      1. Structural Reversal Line  (SMA200 + strength >= 0.8)
      2. Long-Term Regime Line     (SMA200 source)
      3. Major                     (strength >= 0.8)
      4. Structural                (strength >= 0.6)
      5. Weak                      (default)
    """
    labels = _LADDER_LABELS_RESISTANCE if is_resistance else _LADDER_LABELS_SUPPORT
    sources = zone.get("sources", [])
    strength = zone.get("strength", 0.5)

    if "sma200" in sources and strength >= 0.8:
        return labels["structural_reversal"]
    if "sma200" in sources:
        return labels["regime_line"]
    if strength >= 0.8:
        return labels["major"]
    if strength >= 0.6:
        return labels["structural"]
    return labels["weak"]


def _ladder_interpretation(above: list[dict], below: list[dict]) -> str:
    """One-line structural interpretation of price position within ladder."""
    if above and below:
        return (
            "\u4ef7\u683c\u4f4d\u4e8e\u652f\u6491\u4e0e\u538b\u529b\u4e4b\u95f4\u8fd0\u884c"
            "\uff0c\u8fd1\u671f\u7ed3\u6784\u5747\u8861\uff0c\u65b9\u5411\u5f85\u7a81\u7834\u786e\u8ba4\u3002"
        )
    if above:
        return (
            "\u4e0a\u65b9\u538b\u529b\u4f4d\u6e05\u6670\u4f46\u4e0b\u65b9\u652f\u6491\u6709\u9650"
            "\uff0c\u5173\u6ce8\u538b\u529b\u533a\u57df\u7684\u7a81\u7834\u4e0e\u538b\u5236\u3002"
        )
    if below:
        return (
            "\u4e0b\u65b9\u652f\u6491\u7ed3\u6784\u660e\u786e\uff0c\u4e0a\u65b9\u538b\u529b\u6709\u9650"
            "\uff0c\u5173\u6ce8\u652f\u6491\u4f4d\u7684\u9632\u5b88\u529b\u5ea6\u3002"
        )
    return "\u6280\u672f\u53c2\u8003\u70b9\u6709\u9650\uff0c\u5f53\u524d\u7ed3\u6784\u5224\u65ad\u9700\u4fdd\u6301\u8c28\u614e\u3002"


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 1 — VALUATION ANCHOR  (owner: valuation_engine)
#
# Narrative style: EPS trajectory → valuation band → price positioning
# Max 6 lines.
# ═══════════════════════════════════════════════════════════════════════════

def _build_section_valuation(price: float, valuation: dict) -> str:
    """Render valuation anchor from precomputed valuation_engine output."""
    lines: list[str] = []
    band = valuation.get("adjusted_fair_value")

    # 1. EPS trajectory
    fy1 = valuation.get("fy1_eps_avg")
    fy2 = valuation.get("fy2_eps_avg")
    growth = valuation.get("eps_growth_pct")

    if fy1 is not None:
        if fy2 is not None and growth is not None:
            lines.append(
                f"\u524d\u77bb\u76c8\u5229\u5c55\u671b\uff1a"
                f"FY1\u6bcf\u80a1\u6536\u76ca\u9884\u4f30${_fp(fy1)}\uff0c"
                f"FY2\u9884\u4f30${_fp(fy2)}\uff0c"
                f"\u9690\u542b\u589e\u957f\u7ea6{growth * 100:.1f}%\u3002"
            )
        else:
            lines.append(
                f"\u524d\u77bb\u76c8\u5229\u5c55\u671b\uff1a"
                f"FY1\u6bcf\u80a1\u6536\u76ca\u9884\u4f30${_fp(fy1)}\uff0c"
                f"FY2\u6682\u4e0d\u53ef\u7528\u3002"
            )

    # 2. Valuation discipline band
    if band and isinstance(band, dict):
        low = band.get("low")
        high = band.get("high")
        if low is not None and high is not None:
            mid = (low + high) / 2
            lines.append(
                f"\u4f30\u503c\u7eaa\u5f8b\u6846\u67b6\uff1a"
                f"\u5408\u7406\u4ef7\u503c\u533a\u95f4${_fp(low)}\u2013${_fp(high)}\uff0c"
                f"\u4e2d\u67a2\u7ea6${_fp(mid)}\u3002"
            )

    # 3. Price positioning + anchor statement
    position = _classify_price_position(price, band)
    lines.append(_VAL_POSITION_ZH.get(position, _VAL_POSITION_ZH["unavailable"]))

    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2 — LADDER MAP  (owner: technical_engine)
#
# Hierarchical price roadmap with semantic labels.
# Degradation: Level A (full) → B (reduced) → C (minimal).
# Ladder never collapses.  Max 8 lines.
# ═══════════════════════════════════════════════════════════════════════════

def _determine_ladder_level(above: list[dict], below: list[dict]) -> str:
    """Classify ladder degradation level from precomputed zone counts."""
    if len(above) >= 2 and len(below) >= 2:
        return "A"
    if above or below:
        return "B"
    return "C"


def _build_ladder_a(
    price: float, above: list[dict], below: list[dict],
) -> str:
    """Level A — full ladder with semantic labels and structural interpretation."""
    lines: list[str] = []

    # Resistance: furthest first (top of ladder)
    for z in reversed(above):
        label = _ladder_semantic_label(z, is_resistance=True)
        lines.append(f"${_fp(z['center'])} \u2013 {label}")

    lines.append(f"\u2500\u2500 \u5f53\u524d\u4ef7\u683c  ${_fp(price)} \u2500\u2500")

    # Support: nearest first
    for z in below:
        label = _ladder_semantic_label(z, is_resistance=False)
        lines.append(f"${_fp(z['center'])} \u2013 {label}")

    lines.append(_ladder_interpretation(above, below))
    return "\n".join(lines)


def _build_ladder_b(
    price: float, above: list[dict], below: list[dict],
    sma200: float | None, atr20: float | None,
) -> str:
    """Level B — reduced ladder, fill gaps with structural references."""
    lines: list[str] = []

    if above:
        z = above[0]
        label = _ladder_semantic_label(z, is_resistance=True)
        lines.append(f"${_fp(z['center'])} \u2013 {label}")
    elif sma200 is not None and sma200 > price:
        lines.append(
            f"${_fp(sma200)} \u2013 "
            f"{_LADDER_LABELS_RESISTANCE['regime_line']}"
        )
    elif atr20 is not None:
        lines.append(
            f"${_fp(price + atr20)} \u2013 "
            f"\u6ce2\u52a8\u533a\u95f4\u4e0a\u6cbe"
        )

    lines.append(f"\u2500\u2500 \u5f53\u524d\u4ef7\u683c  ${_fp(price)} \u2500\u2500")

    if below:
        z = below[0]
        label = _ladder_semantic_label(z, is_resistance=False)
        lines.append(f"${_fp(z['center'])} \u2013 {label}")
    elif sma200 is not None and sma200 < price:
        lines.append(
            f"${_fp(sma200)} \u2013 "
            f"{_LADDER_LABELS_SUPPORT['regime_line']}"
        )
    elif atr20 is not None:
        lines.append(
            f"${_fp(price - atr20)} \u2013 "
            f"\u6ce2\u52a8\u533a\u95f4\u4e0b\u6cbe"
        )

    if sma200 is not None:
        lines.append(
            f"\u7ed3\u6784\u53c2\u8003\u7ebf  200\u65e5\u5747\u7ebf  ${_fp(sma200)}"
        )

    lines.append(_ladder_interpretation(above, below))
    return "\n".join(lines)


def _build_ladder_c(
    price: float, scenario: ScenarioResult,
    atr20: float | None, sma200: float | None,
) -> str:
    """Level C — minimal ladder for sparse data.  Shape always preserved."""
    offset = atr20 if atr20 is not None else price * 0.03

    # Scenario-driven directional boundary
    bullish = scenario.bias in ("constructive", "opportunistic")
    if bullish:
        watch_price = price + offset
        watch_label = "\u65b9\u5411\u89c2\u5bdf\u4f4d\uff08\u4e0a\u65b9\uff09"
    else:
        watch_price = price - offset
        watch_label = "\u65b9\u5411\u89c2\u5bdf\u4f4d\uff08\u4e0b\u65b9\uff09"

    # Deterministic structural caution line
    if sma200 is not None:
        caution_price = sma200
        caution_label = "\u7ed3\u6784\u8b66\u6212\u7ebf\uff08200\u65e5\u5747\u7ebf\uff09"
    else:
        caution_price = price * 0.95
        caution_label = "\u7ed3\u6784\u8b66\u6212\u7ebf\uff08\u4f30\u7b97\uff09"

    lines = [
        f"\u2500\u2500 \u5f53\u524d\u4ef7\u683c  ${_fp(price)} \u2500\u2500",
        f"${_fp(watch_price)} \u2013 {watch_label}",
        f"${_fp(caution_price)} \u2013 {caution_label}",
        _ladder_interpretation([], []),
    ]
    return "\n".join(lines)


def _build_section_ladder(
    price: float, technical: dict, scenario: ScenarioResult,
) -> tuple[str, str]:
    """Build Section 2 ladder with tiered degradation.  Returns (text, level).

    Allowed operations: sorting, grouping, selecting levels, semantic labeling.
    No recomputation of zone strength or technical indicators.
    """
    resistance = technical.get("resistance_zones", [])
    support = technical.get("support_zones", [])
    sma200 = technical.get("sma200")
    atr20 = technical.get("atr20")

    above = sorted(
        [z for z in resistance if z.get("center", 0) > price],
        key=lambda z: z["center"],
    )
    below = sorted(
        [z for z in support if z.get("center", 0) < price],
        key=lambda z: z["center"],
        reverse=True,
    )

    level = _determine_ladder_level(above, below)

    if level == "A":
        text = _build_ladder_a(price, above, below)
    elif level == "B":
        text = _build_ladder_b(price, above, below, sma200, atr20)
    else:
        text = _build_ladder_c(price, scenario, atr20, sma200)

    return text, level


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3 — MACRO RADAR  (owner: macro_engine)
#
# Informational, not directional.  Max 4 lines.
# ═══════════════════════════════════════════════════════════════════════════

_REGIME_NARRATIVE_ZH: dict[str, str] = {
    "supportive":
        "\u5b8f\u89c2\u73af\u5883\u6574\u4f53\u53cb\u597d\uff0c\u6ce2\u52a8\u7387\u53d7\u63a7"
        "\u4e14\u6d41\u52a8\u6027\u7a33\u5b9a\uff0c\u6743\u76ca\u4f30\u503c\u73af\u5883\u504f\u6696\u3002",
    "mixed":
        "\u5b8f\u89c2\u6761\u4ef6\u559c\u5fe7\u53c2\u534a\uff0c\u6ce2\u52a8\u7387\u4e0e\u5229\u7387"
        "\u5904\u4e8e\u4e2d\u6027\u533a\u95f4\uff0c\u65e0\u5373\u65f6\u5a01\u80c1\u4f46\u9700\u4fdd\u6301\u5173\u6ce8\u3002",
    "restrictive":
        "\u5229\u7387\u73af\u5883\u504f\u7d27\uff0c\u5bf9\u6743\u76ca\u8d44\u4ea7\u8d34\u73b0\u6548\u5e94"
        "\u660e\u663e\uff0c\u4f30\u503c\u6269\u5f20\u7a7a\u95f4\u53d7\u9650\u3002",
    "restrictive_overvalued":
        "\u5b8f\u89c2\u7d27\u7f29\u53e0\u52a0\u4f30\u503c\u504f\u9ad8"
        "\uff0c\u5e02\u573a\u5bb9\u9519\u7a7a\u95f4\u6781\u7a84\u3002",
    "restrictive_fair":
        "\u5b8f\u89c2\u7d27\u7f29\u9650\u5236\u4f30\u503c\u6269\u5f20"
        "\uff0c\u4f46\u5f53\u524d\u5b9a\u4ef7\u5c1a\u5728\u5408\u7406\u533a\u95f4\u3002",
    "stressed":
        "\u6ce2\u52a8\u7387\u663e\u8457\u4e0a\u5347\uff0c\u98ce\u9669\u89c4\u907f\u60c5\u7eea"
        "\u4e3b\u5bfc\u5e02\u573a\uff0c\u7cfb\u7edf\u6027\u538b\u529b\u4fe1\u53f7\u660e\u786e\u3002",
    "unavailable":
        "\u5b8f\u89c2\u6570\u636e\u4e0d\u8db3\uff0c\u65e0\u6cd5\u5b8c\u6574\u8bc4\u4f30\u5916\u90e8\u98ce\u9669\u73af\u5883\u3002",
}


def _build_section_macro(macro: dict, scenario: ScenarioResult) -> str:
    """Render macro radar from precomputed macro_engine output + scenario.regime."""
    regime_zh = _REGIME_NARRATIVE_ZH.get(
        scenario.regime, "\u5b8f\u89c2\u8bc4\u4f30\u53d7\u9650\u3002",
    )
    lines = [regime_zh]

    vix = macro.get("vix_level")
    if vix is not None:
        vix_label = _VIX_REGIME_ZH.get(macro.get("vix_regime", ""), "")
        lines.append(f"VIX {vix:.1f}\uff0c\u6ce2\u52a8\u7387\u73af\u5883{vix_label}\u3002")

    rate = macro.get("treasury_10y")
    if rate is not None:
        rate_label = _RATE_REGIME_ZH.get(
            macro.get("rate_pressure_regime", ""), "",
        )
        lines.append(
            f"10Y\u56fd\u503a{rate:.2f}%\uff0c\u5229\u7387\u59ff\u6001{rate_label}\u3002"
        )

    # Cap at 1 alert to stay within 4-line limit
    alerts = macro.get("alerts", [])
    if alerts:
        lines.append(f"\u26a0 {alerts[0]}")

    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 4 — TACTICAL PLAYBOOK  (owner: scenario_engine + playbook_engine)
#
# Dual-track structure: Current State → Downside → Upside → Risk Discipline
# Both tracks ALWAYS rendered — this is mandatory institutional discipline.
# Max 6 lines.
# ═══════════════════════════════════════════════════════════════════════════

def select_tactical_phrases(
    scenario: ScenarioResult, playbook: dict,
) -> tuple[dict[str, str], list[str]]:
    """Select atomic tactical phrases for dual-track playbook.

    Returns (tracks, all_phrases):
      tracks: dict with keys state/downside/upside/risk → phrase string
      all_phrases: flat list of all phrases used (for response transparency)

    Every returned string is a complete, immutable phrase from ZH_TACTICAL.
    No fragment concatenation.
    """
    key_map = _DUAL_TRACK_KEYS.get(
        scenario.scenario, _DUAL_TRACK_KEYS["neutral"],
    )
    tracks = {k: ZH_TACTICAL[v] for k, v in key_map.items()}

    seen: set[str] = set(tracks.values())
    all_phrases = list(tracks.values())

    def _add(key: str) -> None:
        phrase = ZH_TACTICAL[key]
        if phrase not in seen:
            seen.add(phrase)
            all_phrases.append(phrase)

    # Constraint-driven supplements
    if "val_support" in scenario.constraints:
        _add("discount_entry")
    if "risk_high" in scenario.constraints:
        _add("stop_loss_discipline")

    # Action-driven supplements
    action = playbook.get("action_tag", "")
    if action == "stop_loss":
        _add("no_catch_falling_knife")
    if action == "strong_buy":
        _add("discount_entry")

    return tracks, all_phrases


def _build_section_playbook(
    scenario: ScenarioResult, playbook: dict,
    tracks: dict[str, str],
) -> str:
    """Render dual-track tactical playbook.

    Fixed structure — both downside and upside always present:
      [header]  current state  downside script  upside script  risk discipline
    """
    scenario_zh = _SCENARIO_ZH.get(scenario.scenario, "\u4e2d\u6027\u89c2\u671b")
    confidence_zh = _CONFIDENCE_ZH.get(scenario.confidence, "\u4f4e")

    lines = [
        f"[{scenario_zh} \u00b7 \u4fe1\u5fc3\u5ea6\uff1a{confidence_zh}]",
        tracks["state"],
        tracks["downside"],
        tracks["upside"],
        tracks["risk"],
    ]
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════

def build_rhino_briefing(
    symbol: str,
    price: float,
    technical: dict,
    valuation: dict,
    macro: dict,
    scenario: "ScenarioResult | None" = None,
    playbook: dict | None = None,
) -> dict:
    """Build institutional-grade Chinese tactical briefing.

    Pure rendering layer — no recomputation of valuation, technical, or macro.
    All values are mapped from upstream engine outputs into section templates.

    Returns:
        {
            "sections": {valuation, ladder, macro, playbook},
            "ladder_level": "A" | "B" | "C",
            "tactical_phrases": list[str],
        }
    """
    sc = scenario if scenario is not None else NEUTRAL_SCENARIO
    pb = playbook or {
        "bias_tag": "neutral", "action_tag": "hold_watch", "rationale": [],
    }

    ladder_text, ladder_level = _build_section_ladder(price, technical, sc)
    tracks, all_phrases = select_tactical_phrases(sc, pb)

    return {
        "sections": {
            "valuation": _build_section_valuation(price, valuation),
            "ladder": ladder_text,
            "macro": _build_section_macro(macro, sc),
            "playbook": _build_section_playbook(sc, pb, tracks),
        },
        "ladder_level": ladder_level,
        "tactical_phrases": all_phrases,
    }
