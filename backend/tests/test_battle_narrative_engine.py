"""
Tests for battle_narrative_engine — validates narrative generation
from structured battle report data.

Validates:
  1. All four sections generate non-empty text
  2. Narrative does not crash on edge cases
  3. Valuation style influences wording
  4. Playbook framing respected (expansion vs recovery)
  5. Classification labels appear in narrative
  6. Unavailable data produces safe defaults
  7. Macro risks reflected in narrative
  8. Ladder structure described correctly
"""
from __future__ import annotations

import pytest

from app.services.rhino.battle_narrative_engine import (
    build_battle_narrative,
    BattleNarrativeReport,
)
from app.services.rhino.fundamental_narrative_engine import (
    build_fundamental_narrative,
    FundamentalNarrative,
)
from app.services.rhino.rhino_report_engine import build_battle_report


# ── Shared fixtures ──────────────────────────────────────────────────────

def _val(
    fy0=5.0, fy1=6.0, fy2=7.0, growth=0.18,
    pe_low=25, pe_high=37.5,
    raw_low=175.0, raw_mid=218.75, raw_high=262.5,
    status="fair_value", available=True,
    valuation_style="growth",
):
    return {
        "available": available,
        "fy0_eps_avg": fy0, "fy1_eps_avg": fy1, "fy2_eps_avg": fy2,
        "eps_growth_pct": growth,
        "pe_band_low": pe_low, "pe_band_high": pe_high,
        "raw_fair_value": {"low": raw_low, "mid": raw_mid, "high": raw_high},
        "adjusted_fair_value": {"low": raw_low * 0.96, "mid": raw_mid * 0.96, "high": raw_high * 0.96},
        "status": status,
        "valuation_style": valuation_style,
    }


def _tech(support_zones=None, resistance_zones=None, volume_ratio=None):
    return {
        "sma30": 200, "sma100": 195, "sma200": 190,
        "avg_volume_50": 5_000_000, "atr20": 3.5,
        "today_volume": 4_500_000,
        "volume_ratio": volume_ratio if volume_ratio is not None else 1.2,
        "support_zones": support_zones if support_zones is not None else [
            {"center": 190, "lower": 188, "upper": 192, "strength": 0.75, "sources": ["sma200"]},
            {"center": 180, "lower": 178, "upper": 182, "strength": 0.40, "sources": ["volume"]},
        ],
        "resistance_zones": resistance_zones if resistance_zones is not None else [
            {"center": 220, "lower": 218, "upper": 222, "strength": 0.85, "sources": ["prior_high"]},
            {"center": 240, "lower": 238, "upper": 242, "strength": 0.55, "sources": ["volume"]},
        ],
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


def _build_report(price=200, valuation_style="growth", vix=18.0, us10y=4.0,
                   support_zones=None, resistance_zones=None):
    val = _val(valuation_style=valuation_style)
    tech = _tech(support_zones=support_zones, resistance_zones=resistance_zones)
    macro = _macro(vix=vix, us10y=us10y)
    playbook = _playbook()
    narrative = build_fundamental_narrative(val, price)
    return build_battle_report(price, tech, val, macro, playbook, narrative)


# ══════════════════════════════════════════════════════════════════════════
# PART 1: STRUCTURAL COMPLETENESS
# ══════════════════════════════════════════════════════════════════════════

class TestNarrativeStructure:
    def test_report_has_narrative_key(self):
        report = _build_report()
        assert "narrative" in report

    def test_narrative_has_four_sections(self):
        report = _build_report()
        n = report["narrative"]
        assert "fundamental" in n
        assert "battlefield" in n
        assert "macro" in n
        assert "playbook" in n

    def test_all_sections_non_empty(self):
        report = _build_report()
        n = report["narrative"]
        assert len(n["fundamental"]) > 0
        assert len(n["battlefield"]) > 0
        assert len(n["macro"]) > 0
        assert len(n["playbook"]) > 0

    def test_narrative_is_dict(self):
        report = _build_report()
        assert isinstance(report["narrative"], dict)

    def test_sections_are_strings(self):
        report = _build_report()
        n = report["narrative"]
        for key in ("fundamental", "battlefield", "macro", "playbook"):
            assert isinstance(n[key], str)


# ══════════════════════════════════════════════════════════════════════════
# PART 2: FUNDAMENTAL NARRATIVE
# ══════════════════════════════════════════════════════════════════════════

class TestFundamentalNarrative:
    def test_contains_eps(self):
        report = _build_report()
        assert "EPS" in report["narrative"]["fundamental"]

    def test_contains_pe_range(self):
        report = _build_report()
        assert "PE range" in report["narrative"]["fundamental"]

    def test_contains_fair_value(self):
        report = _build_report()
        assert "fair value" in report["narrative"]["fundamental"].lower()

    def test_contains_classification(self):
        report = _build_report()
        text = report["narrative"]["fundamental"].lower()
        assert any(c in text for c in ["fair value", "discount", "premium", "deep"])

    def test_contains_style(self):
        report = _build_report()
        assert "growth" in report["narrative"]["fundamental"].lower()

    def test_unavailable_valuation(self):
        val = {"available": False, "raw_fair_value": None,
               "fy0_eps_avg": None, "fy1_eps_avg": None, "fy2_eps_avg": None,
               "valuation_style": "unknown"}
        narrative = build_fundamental_narrative(val, 100)
        tech = _tech()
        macro = _macro()
        playbook = _playbook()
        report = build_battle_report(100, tech, val, macro, playbook, narrative)
        text = report["narrative"]["fundamental"]
        assert "insufficient" in text.lower()


# ══════════════════════════════════════════════════════════════════════════
# PART 3: VALUATION STYLE INFLUENCE
# ══════════════════════════════════════════════════════════════════════════

class TestStyleInfluence:
    def test_growth_style_mentioned(self):
        report = _build_report(valuation_style="growth")
        assert "growth" in report["narrative"]["fundamental"].lower()

    def test_defensive_style_mentioned(self):
        report = _build_report(valuation_style="defensive")
        assert "defensive" in report["narrative"]["fundamental"].lower()

    def test_financial_style_mentioned(self):
        report = _build_report(valuation_style="financial")
        assert "financial" in report["narrative"]["fundamental"].lower()

    def test_cyclical_style_mentioned(self):
        report = _build_report(valuation_style="cyclical")
        assert "cyclical" in report["narrative"]["fundamental"].lower()


# ══════════════════════════════════════════════════════════════════════════
# PART 4: PLAYBOOK FRAMING
# ══════════════════════════════════════════════════════════════════════════

class TestPlaybookFraming:
    def test_growth_expansion_framing(self):
        report = _build_report(valuation_style="growth")
        assert "expansion" in report["narrative"]["playbook"].lower()

    def test_defensive_recovery_framing(self):
        report = _build_report(valuation_style="defensive")
        assert "recovery" in report["narrative"]["playbook"].lower()

    def test_financial_recovery_framing(self):
        report = _build_report(valuation_style="financial")
        assert "recovery" in report["narrative"]["playbook"].lower()

    def test_cyclical_recovery_framing(self):
        report = _build_report(valuation_style="cyclical")
        assert "recovery" in report["narrative"]["playbook"].lower()


# ══════════════════════════════════════════════════════════════════════════
# PART 5: BATTLEFIELD NARRATIVE
# ══════════════════════════════════════════════════════════════════════════

class TestBattlefieldNarrative:
    def test_mentions_support(self):
        report = _build_report()
        assert "support" in report["narrative"]["battlefield"].lower()

    def test_mentions_resistance(self):
        report = _build_report()
        assert "resistance" in report["narrative"]["battlefield"].lower()

    def test_empty_zones_graceful(self):
        report = _build_report(support_zones=[], resistance_zones=[])
        text = report["narrative"]["battlefield"]
        assert len(text) > 0
        assert "lacks" in text.lower()

    def test_level_values_appear(self):
        report = _build_report()
        text = report["narrative"]["battlefield"]
        # Support at 190 and resistance at 220 should appear
        assert "190" in text
        assert "220" in text


# ══════════════════════════════════════════════════════════════════════════
# PART 6: MACRO NARRATIVE
# ══════════════════════════════════════════════════════════════════════════

class TestMacroNarrative:
    def test_calm_regime(self):
        report = _build_report(vix=15, us10y=3.5)
        text = report["narrative"]["macro"]
        assert "favorable" in text.lower()

    def test_elevated_regime(self):
        report = _build_report(vix=28, us10y=4.5)
        text = report["narrative"]["macro"]
        assert "elevated" in text.lower() or "defensive" in text.lower()

    def test_weak_volume_mentioned(self):
        val = _val()
        tech = _tech(volume_ratio=0.5)
        macro = _macro()
        playbook = _playbook()
        narrative = build_fundamental_narrative(val, 200)
        report = build_battle_report(200, tech, val, macro, playbook, narrative)
        text = report["narrative"]["macro"]
        assert "weak" in text.lower()

    def test_haircut_mentioned(self):
        val = _val()
        tech = _tech()
        macro = _macro(haircut=7)
        playbook = _playbook()
        narrative = build_fundamental_narrative(val, 200)
        report = build_battle_report(200, tech, val, macro, playbook, narrative)
        text = report["narrative"]["macro"]
        assert "7%" in text


# ══════════════════════════════════════════════════════════════════════════
# PART 7: PLAYBOOK NARRATIVE
# ══════════════════════════════════════════════════════════════════════════

class TestPlaybookNarrative:
    def test_contains_bias(self):
        report = _build_report()
        assert "neutral" in report["narrative"]["playbook"].lower()

    def test_contains_risk_rule(self):
        report = _build_report()
        assert "15%" in report["narrative"]["playbook"]

    def test_contains_rationale(self):
        report = _build_report()
        assert "SMA200" in report["narrative"]["playbook"]

    def test_upside_target_mentioned(self):
        report = _build_report()
        assert "220" in report["narrative"]["playbook"]

    def test_downside_stop_mentioned(self):
        report = _build_report()
        assert "190" in report["narrative"]["playbook"]

    def test_no_zones_graceful(self):
        report = _build_report(support_zones=[], resistance_zones=[])
        text = report["narrative"]["playbook"]
        assert len(text) > 0
        assert "no clear" in text.lower() or "no defined" in text.lower()


# ══════════════════════════════════════════════════════════════════════════
# PART 8: SAFETY RULES
# ══════════════════════════════════════════════════════════════════════════

class TestNarrativeSafety:
    """Narrative must not contain speculative, promotional, or emotional language."""

    _BANNED_WORDS = [
        "guaranteed", "guarantee", "definitely", "surely",
        "amazing", "incredible", "fantastic", "exciting",
        "buy now", "sell now", "act fast", "don't miss",
        "moonshot", "skyrocket", "crash", "explode",
    ]

    def test_no_banned_words(self):
        report = _build_report()
        n = report["narrative"]
        full_text = " ".join([n["fundamental"], n["battlefield"], n["macro"], n["playbook"]])
        lower = full_text.lower()
        for word in self._BANNED_WORDS:
            assert word not in lower, f"Banned word '{word}' found in narrative"

    def test_no_exclamation_marks(self):
        report = _build_report()
        n = report["narrative"]
        full_text = " ".join([n["fundamental"], n["battlefield"], n["macro"], n["playbook"]])
        assert "!" not in full_text


# ══════════════════════════════════════════════════════════════════════════
# PART 9: EXISTING REPORT UNMODIFIED
# ══════════════════════════════════════════════════════════════════════════

class TestExistingReportPreserved:
    """Narrative addition must not break existing structured data."""

    def test_structured_sections_unchanged(self):
        report = _build_report()
        assert "fundamental" in report
        assert "ladder" in report
        assert "macro" in report
        assert "playbook" in report

    def test_fundamental_has_classification(self):
        report = _build_report()
        assert report["fundamental"]["classification"] in ("deep_value", "discount", "fair", "premium")

    def test_ladder_has_support_resistance(self):
        report = _build_report()
        assert "support" in report["ladder"]
        assert "resistance" in report["ladder"]

    def test_playbook_has_dual_track(self):
        report = _build_report()
        assert "upside" in report["playbook"]
        assert "downside" in report["playbook"]

    def test_macro_has_risks(self):
        report = _build_report()
        assert "risks" in report["macro"]
