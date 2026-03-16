"""
Tests for battle_narrative_engine -- Chinese Rhino War Report.

Validates:
  1. All four Chinese sections generate non-empty text
  2. Narrative does not crash on edge cases / missing fields
  3. Valuation style influences wording
  4. Playbook framing consumed from structured output (not recomputed)
  5. Risk rule propagated from structured output
  6. Volume label mapper consistent with technical_engine thresholds
  7. Graceful degradation when optional fields are absent
  8. Safety rules: no speculative/emotional language
  9. Structured data unchanged by narrative addition
"""
from __future__ import annotations

import pytest

from app.services.rhino.battle_narrative_engine import (
    build_battle_narrative,
    BattleNarrativeReport,
    VolumeLabelMapper,
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
                   support_zones=None, resistance_zones=None,
                   volume_ratio=None, haircut=4):
    val = _val(valuation_style=valuation_style)
    tech = _tech(support_zones=support_zones, resistance_zones=resistance_zones,
                 volume_ratio=volume_ratio)
    macro = _macro(vix=vix, us10y=us10y, haircut=haircut)
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
        n = _build_report()["narrative"]
        assert "fundamental" in n
        assert "battlefield" in n
        assert "macro" in n
        assert "playbook" in n

    def test_all_sections_non_empty(self):
        n = _build_report()["narrative"]
        for key in ("fundamental", "battlefield", "macro", "playbook"):
            assert len(n[key]) > 0, f"{key} is empty"

    def test_sections_are_strings(self):
        n = _build_report()["narrative"]
        for key in ("fundamental", "battlefield", "macro", "playbook"):
            assert isinstance(n[key], str)


# ══════════════════════════════════════════════════════════════════════════
# PART 2: CHINESE CONTENT VERIFICATION
# ══════════════════════════════════════════════════════════════════════════

class TestChineseContent:
    def test_fundamental_contains_chinese(self):
        text = _build_report()["narrative"]["fundamental"]
        # Should contain Chinese characters
        assert any("\u4e00" <= c <= "\u9fff" for c in text)

    def test_battlefield_contains_chinese(self):
        text = _build_report()["narrative"]["battlefield"]
        assert any("\u4e00" <= c <= "\u9fff" for c in text)

    def test_macro_contains_chinese(self):
        text = _build_report()["narrative"]["macro"]
        assert any("\u4e00" <= c <= "\u9fff" for c in text)

    def test_playbook_contains_chinese(self):
        text = _build_report()["narrative"]["playbook"]
        assert any("\u4e00" <= c <= "\u9fff" for c in text)

    def test_fundamental_contains_eps(self):
        text = _build_report()["narrative"]["fundamental"]
        assert "EPS" in text

    def test_fundamental_contains_pe(self):
        text = _build_report()["narrative"]["fundamental"]
        assert "PE" in text


# ══════════════════════════════════════════════════════════════════════════
# PART 3: VALUATION STYLE INFLUENCE
# ══════════════════════════════════════════════════════════════════════════

class TestStyleInfluence:
    def test_growth_style_explanation(self):
        text = _build_report(valuation_style="growth")["narrative"]["fundamental"]
        # Should contain growth explanation about valuation expansion
        assert "\u6269\u5f20" in text  # expansion

    def test_cyclical_style_explanation(self):
        text = _build_report(valuation_style="cyclical")["narrative"]["fundamental"]
        assert "\u5747\u503c\u56de\u5f52" in text  # mean reversion

    def test_defensive_style_explanation(self):
        text = _build_report(valuation_style="defensive")["narrative"]["fundamental"]
        assert "\u4fee\u590d" in text  # recovery

    def test_financial_style_explanation(self):
        text = _build_report(valuation_style="financial")["narrative"]["fundamental"]
        assert "\u5229\u5dee" in text  # spread


# ══════════════════════════════════════════════════════════════════════════
# PART 4: PLAYBOOK FRAMING — consumed from structured output
# ══════════════════════════════════════════════════════════════════════════

class TestPlaybookFraming:
    def test_growth_expansion_framing(self):
        text = _build_report(valuation_style="growth")["narrative"]["playbook"]
        assert "\u6269\u5f20" in text  # expansion

    def test_defensive_recovery_framing(self):
        text = _build_report(valuation_style="defensive")["narrative"]["playbook"]
        assert "\u4fee\u590d" in text  # recovery

    def test_financial_recovery_framing(self):
        text = _build_report(valuation_style="financial")["narrative"]["playbook"]
        assert "\u4fee\u590d" in text

    def test_cyclical_recovery_framing(self):
        text = _build_report(valuation_style="cyclical")["narrative"]["playbook"]
        assert "\u4fee\u590d" in text

    def test_no_determine_playbook_framing_import(self):
        """Narrative engine must NOT import determine_playbook_framing."""
        import inspect
        from app.services.rhino import battle_narrative_engine as bne
        source = inspect.getsource(bne)
        assert "determine_playbook_framing" not in source


# ══════════════════════════════════════════════════════════════════════════
# PART 5: RISK RULE FROM STRUCTURED OUTPUT
# ══════════════════════════════════════════════════════════════════════════

class TestRiskRule:
    def test_risk_rule_propagated(self):
        text = _build_report()["narrative"]["playbook"]
        assert "15%" in text

    def test_risk_rule_from_structured_output(self):
        """Should contain the zh risk rule string from playbook output."""
        report = _build_report()
        risk_rule_zh = report["playbook"]["risk_rule_zh"]
        text = report["narrative"]["playbook"]
        assert risk_rule_zh in text


# ══════════════════════════════════════════════════════════════════════════
# PART 6: VOLUME LABEL MAPPER
# ══════════════════════════════════════════════════════════════════════════

class TestVolumeLabelMapper:
    def test_weak_volume_label(self):
        risks = [{"signal": "weak_volume", "label": "...", "severity": "low"}]
        label = VolumeLabelMapper.label(risks)
        assert "\u7f29\u91cf" in label  # shrinking volume

    def test_no_weak_volume_label(self):
        risks = [{"signal": "high_vix", "label": "...", "severity": "high"}]
        label = VolumeLabelMapper.label(risks)
        assert "\u89c2\u671b" in label  # on sidelines

    def test_empty_risks_label(self):
        label = VolumeLabelMapper.label([])
        assert "\u89c2\u671b" in label

    def test_macro_narrative_uses_volume_label(self):
        """Macro narrative should use centralized volume mapping."""
        report = _build_report()
        text = report["narrative"]["macro"]
        # Should contain volume state description
        assert "\u6210\u4ea4\u91cf" in text  # volume


# ══════════════════════════════════════════════════════════════════════════
# PART 7: GRACEFUL DEGRADATION
# ══════════════════════════════════════════════════════════════════════════

class TestGracefulDegradation:
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
        assert len(text) > 0
        assert "\u4e0d\u8db3" in text  # insufficient

    def test_empty_zones(self):
        report = _build_report(support_zones=[], resistance_zones=[])
        text = report["narrative"]["battlefield"]
        assert len(text) > 0
        assert "\u7f3a\u4e4f" in text  # lacks

    def test_no_zones_playbook(self):
        report = _build_report(support_zones=[], resistance_zones=[])
        text = report["narrative"]["playbook"]
        assert len(text) > 0

    def test_single_support_no_r2(self):
        """Single resistance should not break the narrative."""
        report = _build_report(
            resistance_zones=[{"center": 220, "lower": 218, "upper": 222, "strength": 0.85, "sources": []}],
        )
        text = report["narrative"]["battlefield"]
        assert "220" in text
        assert len(text) > 0

    def test_single_support_no_s2(self):
        """Single support should not break the narrative."""
        report = _build_report(
            support_zones=[{"center": 190, "lower": 188, "upper": 192, "strength": 0.75, "sources": []}],
        )
        text = report["narrative"]["battlefield"]
        assert "190" in text


# ══════════════════════════════════════════════════════════════════════════
# PART 8: BATTLEFIELD LEVEL VALUES
# ══════════════════════════════════════════════════════════════════════════

class TestBattlefieldLevels:
    def test_support_level_appears(self):
        text = _build_report()["narrative"]["battlefield"]
        assert "190" in text

    def test_resistance_level_appears(self):
        text = _build_report()["narrative"]["battlefield"]
        assert "220" in text

    def test_secondary_resistance_appears(self):
        text = _build_report()["narrative"]["battlefield"]
        assert "240" in text

    def test_secondary_support_appears(self):
        text = _build_report()["narrative"]["battlefield"]
        assert "180" in text


# ══════════════════════════════════════════════════════════════════════════
# PART 9: MACRO NARRATIVE
# ══════════════════════════════════════════════════════════════════════════

class TestMacroNarrative:
    def test_calm_regime_favorable(self):
        text = _build_report(vix=15, us10y=3.5, haircut=0)["narrative"]["macro"]
        assert "\u8fdb\u653b" in text  # offensive/favorable

    def test_elevated_regime_defensive(self):
        text = _build_report(vix=28, us10y=4.5)["narrative"]["macro"]
        assert "\u9632\u5b88" in text  # defensive

    def test_haircut_mentioned(self):
        text = _build_report(haircut=7)["narrative"]["macro"]
        assert "7%" in text

    def test_weak_volume_reflected(self):
        val = _val()
        tech = _tech(volume_ratio=0.5)
        macro = _macro()
        playbook = _playbook()
        narrative = build_fundamental_narrative(val, 200)
        report = build_battle_report(200, tech, val, macro, playbook, narrative)
        text = report["narrative"]["macro"]
        assert "\u7f29\u91cf" in text  # shrinking volume


# ══════════════════════════════════════════════════════════════════════════
# PART 10: PLAYBOOK NARRATIVE
# ══════════════════════════════════════════════════════════════════════════

class TestPlaybookNarrative:
    def test_contains_bias(self):
        text = _build_report()["narrative"]["playbook"]
        assert "\u89c2\u671b" in text  # neutral = observation

    def test_upside_target(self):
        text = _build_report()["narrative"]["playbook"]
        assert "220" in text

    def test_downside_stop(self):
        text = _build_report()["narrative"]["playbook"]
        assert "190" in text

    def test_rationale_propagated(self):
        text = _build_report()["narrative"]["playbook"]
        assert "SMA200" in text


# ══════════════════════════════════════════════════════════════════════════
# PART 11: SAFETY RULES
# ══════════════════════════════════════════════════════════════════════════

class TestNarrativeSafety:
    _BANNED = [
        "\u4fdd\u8bc1\u6536\u76ca",  # guaranteed returns
        "\u5fc5\u5b9a\u4e0a\u6da8",  # will definitely rise
        "\u4e0d\u4f1a\u4e0b\u8dcc",  # will not fall
        "guaranteed", "definitely",
        "moonshot", "skyrocket", "crash", "explode",
    ]

    def test_no_banned_words(self):
        n = _build_report()["narrative"]
        full = "".join([n["fundamental"], n["battlefield"], n["macro"], n["playbook"]])
        for word in self._BANNED:
            assert word not in full, f"Banned word '{word}' found"

    def test_no_exclamation_marks(self):
        n = _build_report()["narrative"]
        full = "".join([n["fundamental"], n["battlefield"], n["macro"], n["playbook"]])
        assert "!" not in full
        assert "\uff01" not in full  # fullwidth exclamation


# ══════════════════════════════════════════════════════════════════════════
# PART 12: STRUCTURED DATA PRESERVED
# ══════════════════════════════════════════════════════════════════════════

class TestStructuredPreserved:
    def test_four_sections_exist(self):
        report = _build_report()
        for key in ("fundamental", "ladder", "macro", "playbook"):
            assert key in report

    def test_fundamental_has_classification(self):
        report = _build_report()
        assert report["fundamental"]["classification"] in ("deep_value", "discount", "fair", "premium")

    def test_fundamental_has_valuation_style(self):
        report = _build_report()
        assert "valuation_style" in report["fundamental"]

    def test_playbook_has_framing(self):
        report = _build_report()
        assert report["playbook"]["upside"]["framing"] in ("expansion", "recovery")

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
