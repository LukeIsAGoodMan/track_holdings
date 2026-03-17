"""
Tests for rhino_report_engine and fundamental_narrative_engine.

Validates:
  1. FundamentalNarrative classification (deep_value, discount, fair, premium)
  2. Battle report has all 4 sections
  3. Dual-track playbook (upside + downside always present)
  4. Ladder semantic precedence labels
  5. Macro risk detection rules (VIX>=22, yield>=4.25, volume_ratio<0.8) — analysis.py aligned
  6. Unavailable/degraded inputs produce safe defaults
"""
from __future__ import annotations

import pytest

from app.services.rhino.fundamental_narrative_engine import (
    build_fundamental_narrative,
    FundamentalNarrative,
)
from app.services.rhino.rhino_report_engine import (
    build_battle_report,
    _label_zone,
)


# ── Shared fixtures ──────────────────────────────────────────────────────

def _val(
    fy0=5.0, fy1=6.0, fy2=7.0, growth=0.18,
    pe_low=25, pe_high=37.5,
    raw_low=175.0, raw_mid=218.75, raw_high=262.5,
    adj_low=170.0, adj_mid=212.5, adj_high=255.0,
    status="fair_value", available=True,
    valuation_style="growth",
):
    return {
        "available": available,
        "fy0_eps_avg": fy0, "fy1_eps_avg": fy1, "fy2_eps_avg": fy2,
        "eps_growth_pct": growth,
        "pe_band_low": pe_low, "pe_band_high": pe_high,
        "raw_fair_value": {"low": raw_low, "mid": raw_mid, "high": raw_high},
        "adjusted_fair_value": {"low": adj_low, "mid": adj_mid, "high": adj_high},
        "status": status,
        "valuation_style": valuation_style,
    }


_DEFAULT_SUPPORT = [
    {"center": 190, "lower": 188, "upper": 192, "strength": 0.75, "sources": ["sma200"]},
    {"center": 180, "lower": 178, "upper": 182, "strength": 0.40, "sources": ["volume"]},
]
_DEFAULT_RESISTANCE = [
    {"center": 220, "lower": 218, "upper": 222, "strength": 0.85, "sources": ["prior_high"]},
    {"center": 240, "lower": 238, "upper": 242, "strength": 0.55, "sources": ["volume"]},
]


def _tech(support_zones=None, resistance_zones=None, volume_ratio=None):
    return {
        "sma30": 200, "sma100": 195, "sma200": 190,
        "avg_volume_50": 5_000_000, "atr20": 3.5,
        "today_volume": 4_500_000, "volume_ratio": volume_ratio if volume_ratio is not None else 1.2,
        "support_zones": support_zones if support_zones is not None else _DEFAULT_SUPPORT,
        "resistance_zones": resistance_zones if resistance_zones is not None else _DEFAULT_RESISTANCE,
        "pattern_tags": ["above_sma200"],
    }


def _macro(vix=18.0, us10y=4.0, haircut=4):
    return {
        "vix_level": vix, "vix_regime": "normal" if vix <= 20 else "elevated",
        "treasury_10y": us10y,
        "rate_pressure_regime": "neutral" if us10y <= 4.0 else "restrictive",
        "recommended_haircut_pct": haircut,
        "alerts": [],
    }


def _playbook(action="hold_watch", bias="neutral"):
    return {
        "bias_tag": bias, "action_tag": action,
        "rationale": ["Trading above SMA200"],
    }


# ══════════════════════════════════════════════════════════════════════════
# FUNDAMENTAL NARRATIVE ENGINE
# ══════════════════════════════════════════════════════════════════════════

class TestFundamentalNarrative:
    def test_deep_value(self):
        """Price < raw_low * 0.92 → deep_value."""
        val = _val(raw_low=200, raw_mid=250, raw_high=300)
        n = build_fundamental_narrative(val, price=180)  # 180 < 200*0.92=184
        assert n.classification == "deep_value"
        assert n.label == "Deep Value"

    def test_discount(self):
        """raw_low * 0.92 ≤ price < raw_low → discount."""
        val = _val(raw_low=200, raw_mid=250, raw_high=300)
        n = build_fundamental_narrative(val, price=195)  # 184 < 195 < 200
        assert n.classification == "discount"

    def test_fair(self):
        """raw_low ≤ price ≤ raw_high → fair."""
        val = _val(raw_low=200, raw_mid=250, raw_high=300)
        n = build_fundamental_narrative(val, price=250)
        assert n.classification == "fair"

    def test_premium(self):
        """price > raw_high → premium."""
        val = _val(raw_low=200, raw_mid=250, raw_high=300)
        n = build_fundamental_narrative(val, price=320)
        assert n.classification == "premium"

    def test_upside_positive(self):
        val = _val(raw_mid=250)
        n = build_fundamental_narrative(val, price=200)
        assert n.upside_pct is not None
        assert n.upside_pct > 0

    def test_upside_negative(self):
        val = _val(raw_mid=200)
        n = build_fundamental_narrative(val, price=250)
        assert n.upside_pct is not None
        assert n.upside_pct < 0

    def test_unavailable_valuation(self):
        val = {"available": False, "raw_fair_value": None,
               "fy0_eps_avg": None, "fy1_eps_avg": None, "fy2_eps_avg": None}
        n = build_fundamental_narrative(val, price=100)
        assert n.classification == "fair"
        assert n.raw_low is None

    def test_anchor_eps_prefers_fy2(self):
        val = _val(fy1=6.0, fy2=7.0)
        n = build_fundamental_narrative(val, price=200)
        assert n.anchor_eps == 7.0

    def test_anchor_eps_falls_back_to_fy1(self):
        val = _val(fy1=6.0, fy2=None)
        n = build_fundamental_narrative(val, price=200)
        assert n.anchor_eps == 6.0

    def test_growth_pct_passthrough(self):
        val = _val(growth=0.18)
        n = build_fundamental_narrative(val, price=200)
        assert n.growth_pct == 0.18


# ══════════════════════════════════════════════════════════════════════════
# LADDER ZONE LABELS
# ══════════════════════════════════════════════════════════════════════════

class TestLadderLabels:
    def test_structural_reversal(self):
        lbl = _label_zone(0.95)
        assert lbl["en"] == "Structural Reversal"
        assert lbl["zh"] == "\u7ed3\u6784\u53cd\u8f6c"

    def test_regime_line(self):
        lbl = _label_zone(0.75)
        assert lbl["en"] == "Regime Line"
        assert lbl["zh"] == "\u8d8b\u52bf\u7ebf"

    def test_major(self):
        lbl = _label_zone(0.55)
        assert lbl["en"] == "Major"
        assert lbl["zh"] == "\u4e3b\u8981"

    def test_structural(self):
        lbl = _label_zone(0.35)
        assert lbl["en"] == "Structural"
        assert lbl["zh"] == "\u7ed3\u6784"

    def test_weak(self):
        lbl = _label_zone(0.10)
        assert lbl["en"] == "Weak"
        assert lbl["zh"] == "\u5f31"

    def test_zero(self):
        lbl = _label_zone(0.0)
        assert lbl["en"] == "Weak"
        assert lbl["zh"] == "\u5f31"


# ══════════════════════════════════════════════════════════════════════════
# BATTLE REPORT — STRUCTURE
# ══════════════════════════════════════════════════════════════════════════

class TestBattleReportStructure:
    def test_has_four_sections(self):
        narrative = build_fundamental_narrative(_val(), 200)
        report = build_battle_report(200, _tech(), _val(), _macro(), _playbook(), narrative)
        assert "fundamental" in report
        assert "ladder" in report
        assert "macro" in report
        assert "playbook" in report

    def test_fundamental_section_has_classification(self):
        narrative = build_fundamental_narrative(_val(), 200)
        report = build_battle_report(200, _tech(), _val(), _macro(), _playbook(), narrative)
        assert report["fundamental"]["classification"] in ("deep_value", "discount", "fair", "premium")

    def test_ladder_has_support_and_resistance(self):
        narrative = build_fundamental_narrative(_val(), 200)
        report = build_battle_report(200, _tech(), _val(), _macro(), _playbook(), narrative)
        assert "support" in report["ladder"]
        assert "resistance" in report["ladder"]

    def test_ladder_rungs_have_labels(self):
        narrative = build_fundamental_narrative(_val(), 200)
        report = build_battle_report(200, _tech(), _val(), _macro(), _playbook(), narrative)
        for rung in report["ladder"]["support"]:
            assert "label" in rung
            assert rung["label"] in ("Structural Reversal", "Regime Line", "Major", "Structural", "Weak")

    def test_ladder_distances(self):
        narrative = build_fundamental_narrative(_val(), 200)
        report = build_battle_report(200, _tech(), _val(), _macro(), _playbook(), narrative)
        # Support dist should be positive (price above support)
        for rung in report["ladder"]["support"]:
            assert rung["dist_pct"] >= 0
        # Resistance dist should be positive (resistance above price)
        for rung in report["ladder"]["resistance"]:
            assert rung["dist_pct"] >= 0


# ══════════════════════════════════════════════════════════════════════════
# DUAL-TRACK PLAYBOOK
# ══════════════════════════════════════════════════════════════════════════

class TestDualTrack:
    def test_always_has_upside_and_downside(self):
        narrative = build_fundamental_narrative(_val(), 200)
        report = build_battle_report(200, _tech(), _val(), _macro(), _playbook(), narrative)
        pb = report["playbook"]
        assert "upside" in pb
        assert "downside" in pb
        assert pb["upside"]["scenario"] == "upside"
        assert pb["downside"]["scenario"] == "downside"

    def test_upside_trigger_from_resistance(self):
        narrative = build_fundamental_narrative(_val(), 200)
        report = build_battle_report(200, _tech(), _val(), _macro(), _playbook(), narrative)
        # First resistance center is trigger, second is target
        assert report["playbook"]["upside"]["trigger"] == 220
        assert report["playbook"]["upside"]["target"] == 240

    def test_downside_stop_from_support(self):
        narrative = build_fundamental_narrative(_val(), 200)
        report = build_battle_report(200, _tech(), _val(), _macro(), _playbook(), narrative)
        # First support center is 190
        assert report["playbook"]["downside"]["stop"] == 190

    def test_risk_rule_present(self):
        narrative = build_fundamental_narrative(_val(), 200)
        report = build_battle_report(200, _tech(), _val(), _macro(), _playbook(), narrative)
        assert "15%" in report["playbook"]["risk_rule"]

    def test_empty_zones_graceful(self):
        tech = _tech(support_zones=[], resistance_zones=[])
        narrative = build_fundamental_narrative(_val(raw_high=300), 200)
        report = build_battle_report(200, tech, _val(raw_high=300), _macro(), _playbook(), narrative)
        pb = report["playbook"]
        # Upside falls back to raw_high
        assert pb["upside"]["target"] == 300
        # Downside has no stop
        assert pb["downside"]["stop"] is None


# ══════════════════════════════════════════════════════════════════════════
# MACRO RISK DETECTION
# ══════════════════════════════════════════════════════════════════════════

class TestMacroRisks:
    def test_high_vix_detected(self):
        narrative = build_fundamental_narrative(_val(), 200)
        macro = _macro(vix=28)
        report = build_battle_report(200, _tech(), _val(), macro, _playbook(), narrative)
        signals = [r["signal"] for r in report["macro"]["risks"]]
        assert "high_vix" in signals

    def test_high_yield_detected(self):
        narrative = build_fundamental_narrative(_val(), 200)
        macro = _macro(us10y=4.5)
        report = build_battle_report(200, _tech(), _val(), macro, _playbook(), narrative)
        signals = [r["signal"] for r in report["macro"]["risks"]]
        assert "high_yield" in signals

    def test_weak_volume_detected(self):
        """Volume ratio < 0.8 triggers weak volume (analysis.py: <0.8x严重缩量)."""
        narrative = build_fundamental_narrative(_val(), 200)
        tech = _tech(volume_ratio=0.7)
        report = build_battle_report(200, tech, _val(), _macro(), _playbook(), narrative)
        signals = [r["signal"] for r in report["macro"]["risks"]]
        assert "weak_volume" in signals

    def test_vix_boundary_22(self):
        """VIX exactly 22 should trigger (analysis.py: >= 22)."""
        narrative = build_fundamental_narrative(_val(), 200)
        macro = _macro(vix=22)
        report = build_battle_report(200, _tech(), _val(), macro, _playbook(), narrative)
        signals = [r["signal"] for r in report["macro"]["risks"]]
        assert "high_vix" in signals

    def test_yield_boundary_425(self):
        """Treasury exactly 4.25 should trigger (analysis.py: >= 4.25)."""
        narrative = build_fundamental_narrative(_val(), 200)
        macro = _macro(us10y=4.25)
        report = build_battle_report(200, _tech(), _val(), macro, _playbook(), narrative)
        signals = [r["signal"] for r in report["macro"]["risks"]]
        assert "high_yield" in signals

    def test_no_risks_when_calm(self):
        narrative = build_fundamental_narrative(_val(), 200)
        macro = _macro(vix=15, us10y=3.5)
        report = build_battle_report(200, _tech(), _val(), macro, _playbook(), narrative)
        assert len(report["macro"]["risks"]) == 0

    def test_vix_21_no_trigger(self):
        """VIX at 21 should NOT trigger (below 22 threshold)."""
        narrative = build_fundamental_narrative(_val(), 200)
        macro = _macro(vix=21)
        report = build_battle_report(200, _tech(), _val(), macro, _playbook(), narrative)
        signals = [r["signal"] for r in report["macro"]["risks"]]
        assert "high_vix" not in signals

    def test_severity_levels(self):
        narrative = build_fundamental_narrative(_val(), 200)
        macro = _macro(vix=30, us10y=4.8)
        tech = _tech(volume_ratio=0.5)
        report = build_battle_report(200, tech, _val(), macro, _playbook(), narrative)
        severities = {r["signal"]: r["severity"] for r in report["macro"]["risks"]}
        assert severities["high_vix"] == "high"
        assert severities["high_yield"] == "medium"
        assert severities["weak_volume"] == "low"

    def test_haircut_passthrough(self):
        narrative = build_fundamental_narrative(_val(), 200)
        macro = _macro(haircut=7)
        report = build_battle_report(200, _tech(), _val(), macro, _playbook(), narrative)
        assert report["macro"]["haircut_pct"] == 7
