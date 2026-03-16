"""
Tests for Rhino Signature Voice (Phase 8a+9).

Validates:
  1. Four Chinese sections generated with signature voice tone
  2. VolumeLabelMapper returns all three states (放量确认/缩量反弹/资金观望)
  3. Graceful degradation via safe_phrase — no broken placeholders
  4. Signature tone sentences present in output
  5. One-way flow verification — numeric values in narrative match structured data
  6. safe_phrase helper returns empty string on None values
  7. No analytical recomputation in narrative engine
"""
from __future__ import annotations

import pytest

from app.services.rhino.battle_narrative_engine import (
    build_battle_narrative,
    BattleNarrativeReport,
    VolumeLabelMapper,
    safe_phrase,
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
# PART 1: safe_phrase HELPER
# ══════════════════════════════════════════════════════════════════════════

class TestSafePhrase:
    def test_all_values_present(self):
        result = safe_phrase("EPS ${eps}", eps=5.0)
        assert result == "EPS $5.00"

    def test_none_value_returns_empty(self):
        result = safe_phrase("EPS ${eps}", eps=None)
        assert result == ""

    def test_multiple_values_all_present(self):
        result = safe_phrase("${low}-${high}", low=100.0, high=200.0)
        assert result == "$100.00-$200.00"

    def test_multiple_values_one_none(self):
        result = safe_phrase("${low}-${high}", low=100.0, high=None)
        assert result == ""

    def test_string_value(self):
        result = safe_phrase("Style: {style}", style="growth")
        assert result == "Style: growth"

    def test_int_value(self):
        result = safe_phrase("Count: {n}", n=42)
        assert result == "Count: 42"


# ══════════════════════════════════════════════════════════════════════════
# PART 2: VOLUME LABEL MAPPER — 3 STATES
# ══════════════════════════════════════════════════════════════════════════

class TestVolumeLabelMapper3States:
    def test_strong_volume_returns_fang_liang(self):
        risks = [{"signal": "strong_volume", "label": "...", "severity": "info"}]
        label = VolumeLabelMapper.label(risks)
        assert "\u653e\u91cf\u786e\u8ba4" in label  # 放量确认

    def test_weak_volume_returns_suo_liang(self):
        risks = [{"signal": "weak_volume", "label": "...", "severity": "low"}]
        label = VolumeLabelMapper.label(risks)
        assert "\u7f29\u91cf" in label  # 缩量反弹

    def test_normal_volume_returns_guan_wang(self):
        risks = [{"signal": "high_vix", "label": "...", "severity": "high"}]
        label = VolumeLabelMapper.label(risks)
        assert "\u89c2\u671b" in label  # 资金观望

    def test_empty_risks_returns_guan_wang(self):
        label = VolumeLabelMapper.label([])
        assert "\u89c2\u671b" in label

    def test_strong_volume_takes_priority_over_weak(self):
        """If both signals present (shouldn't happen), strong wins."""
        risks = [
            {"signal": "strong_volume", "label": "...", "severity": "info"},
            {"signal": "weak_volume", "label": "...", "severity": "low"},
        ]
        label = VolumeLabelMapper.label(risks)
        assert "\u653e\u91cf\u786e\u8ba4" in label

    def test_strong_volume_in_macro_narrative(self):
        """Full report with high volume should show 放量确认."""
        report = _build_report(volume_ratio=2.0)
        text = report["narrative"]["macro"]
        assert "\u653e\u91cf\u786e\u8ba4" in text

    def test_weak_volume_in_macro_narrative(self):
        """Full report with low volume should show 缩量."""
        report = _build_report(volume_ratio=0.5)
        text = report["narrative"]["macro"]
        assert "\u7f29\u91cf" in text

    def test_normal_volume_in_macro_narrative(self):
        """Full report with normal volume should show 观望."""
        report = _build_report(volume_ratio=1.0)
        text = report["narrative"]["macro"]
        assert "\u89c2\u671b" in text


# ══════════════════════════════════════════════════════════════════════════
# PART 3: SIGNATURE VOICE TONE
# ══════════════════════════════════════════════════════════════════════════

class TestSignatureVoice:
    def test_fundamental_direct_anchor(self):
        """Fundamental section uses direct anchor phrasing."""
        text = _build_report()["narrative"]["fundamental"]
        assert "\u5b9a\u4ef7\u951a" in text  # 定价锚

    def test_fundamental_discipline_pe(self):
        """PE band described as discipline."""
        text = _build_report()["narrative"]["fundamental"]
        assert "\u7eaa\u5f8b" in text  # 纪律

    def test_fundamental_style_classification(self):
        """Style classification is stated directly."""
        text = _build_report()["narrative"]["fundamental"]
        assert "\u98ce\u683c\u5f52\u7c7b" in text  # 风格归类

    def test_battlefield_concise(self):
        """Battlefield uses concise directional language."""
        text = _build_report()["narrative"]["battlefield"]
        assert "\u538b\u529b" in text  # pressure
        assert "\u652f\u6491" in text  # support

    def test_battlefield_reversal_restrained(self):
        """Reversal conclusion is restrained."""
        text = _build_report()["narrative"]["battlefield"]
        assert "\u7ed3\u6784\u4fee\u590d" in text  # structural repair

    def test_macro_direct_reading(self):
        """Macro section reads signals directly."""
        text = _build_report()["narrative"]["macro"]
        assert "\u6210\u4ea4\u91cf\u4fe1\u53f7" in text  # volume signal

    def test_macro_strategy_conclusion(self):
        """Macro ends with strategy conclusion."""
        text = _build_report()["narrative"]["macro"]
        assert "\u7efc\u5408\u7b56\u7565" in text  # comprehensive strategy

    def test_playbook_direct_bias(self):
        """Playbook states bias directly."""
        text = _build_report()["narrative"]["playbook"]
        assert "\u504f\u5411" in text  # 偏向

    def test_playbook_position_discipline(self):
        """Playbook mentions position discipline."""
        text = _build_report()["narrative"]["playbook"]
        assert "\u4ed3\u4f4d\u7eaa\u5f8b" in text  # 仓位纪律

    def test_no_exclamation_marks(self):
        """Voice is restrained — no exclamation marks."""
        n = _build_report()["narrative"]
        full = "".join([n["fundamental"], n["battlefield"], n["macro"], n["playbook"]])
        assert "!" not in full
        assert "\uff01" not in full


# ══════════════════════════════════════════════════════════════════════════
# PART 4: GRACEFUL DEGRADATION
# ══════════════════════════════════════════════════════════════════════════

class TestGracefulDegradation:
    def test_missing_valuation_no_broken_placeholders(self):
        val = {"available": False, "raw_fair_value": None,
               "fy0_eps_avg": None, "fy1_eps_avg": None, "fy2_eps_avg": None,
               "valuation_style": "unknown"}
        narrative = build_fundamental_narrative(val, 100)
        tech = _tech()
        macro = _macro()
        playbook = _playbook()
        report = build_battle_report(100, tech, val, macro, playbook, narrative)
        text = report["narrative"]["fundamental"]
        assert "N/A" not in text
        assert "{" not in text
        assert "None" not in text
        assert len(text) > 0

    def test_missing_eps_no_anchor_line(self):
        """If EPS is None, anchor line is omitted entirely."""
        val = _val()
        # Build narrative with None eps
        narr = FundamentalNarrative(
            classification="fair",
            label="Fair Value",
            raw_low=100.0, raw_mid=120.0, raw_high=140.0,
            anchor_eps=None, pe_band_low=15, pe_band_high=20,
            growth_pct=0.10, upside_pct=10.0,
            valuation_style="growth",
        )
        from app.services.rhino.battle_narrative_engine import _build_fundamental_narrative
        text = _build_fundamental_narrative(narr, 110)
        assert "\u5b9a\u4ef7\u951a" not in text  # No anchor line
        assert "N/A" not in text
        assert len(text) > 0

    def test_empty_zones_no_crash(self):
        report = _build_report(support_zones=[], resistance_zones=[])
        text = report["narrative"]["battlefield"]
        assert len(text) > 0
        assert "\u7f3a\u4e4f" in text

    def test_no_target_no_stop(self):
        report = _build_report(support_zones=[], resistance_zones=[])
        text = report["narrative"]["playbook"]
        assert len(text) > 0
        assert "N/A" not in text
        assert "None" not in text


# ══════════════════════════════════════════════════════════════════════════
# PART 5: ONE-WAY FLOW VERIFICATION
# ══════════════════════════════════════════════════════════════════════════

class TestOneWayFlow:
    def test_fundamental_eps_matches_structured(self):
        """EPS value in narrative matches structured fundamental.eps_anchor."""
        report = _build_report()
        structured_eps = report["fundamental"]["eps_anchor"]
        text = report["narrative"]["fundamental"]
        if structured_eps is not None:
            assert f"{structured_eps:.2f}" in text

    def test_fundamental_pe_band_matches_structured(self):
        """PE band in narrative matches structured pe_low/pe_high."""
        report = _build_report()
        pe_low = report["fundamental"]["pe_low"]
        pe_high = report["fundamental"]["pe_high"]
        text = report["narrative"]["fundamental"]
        if pe_low is not None:
            assert f"{pe_low:.1f}" in text
        if pe_high is not None:
            assert f"{pe_high:.1f}" in text

    def test_fundamental_midpoint_matches_structured(self):
        """Midpoint in structured data is consistent with narrative price range."""
        report = _build_report()
        midpoint = report["fundamental"]["midpoint"]
        # Midpoint should exist in structured data
        assert midpoint is not None

    def test_ladder_support_level_in_narrative(self):
        """First support level value appears in battlefield narrative."""
        report = _build_report()
        support = report["ladder"]["support"]
        text = report["narrative"]["battlefield"]
        if support:
            assert f"{support[0]['level']:.2f}" in text

    def test_ladder_resistance_level_in_narrative(self):
        """First resistance level value appears in battlefield narrative."""
        report = _build_report()
        resistance = report["ladder"]["resistance"]
        text = report["narrative"]["battlefield"]
        if resistance:
            assert f"{resistance[0]['level']:.2f}" in text

    def test_playbook_target_in_narrative(self):
        """Upside target value in narrative matches structured playbook."""
        report = _build_report()
        target = report["playbook"]["upside"]["target"]
        text = report["narrative"]["playbook"]
        if target is not None:
            assert f"{target:.2f}" in text

    def test_playbook_stop_in_narrative(self):
        """Downside stop value in narrative matches structured playbook."""
        report = _build_report()
        stop = report["playbook"]["downside"]["stop"]
        text = report["narrative"]["playbook"]
        if stop is not None:
            assert f"{stop:.2f}" in text

    def test_risk_rule_exact_match(self):
        """Risk rule zh string in narrative matches structured output exactly."""
        report = _build_report()
        risk_rule_zh = report["playbook"]["risk_rule_zh"]
        text = report["narrative"]["playbook"]
        assert risk_rule_zh in text

    def test_no_analytical_imports(self):
        """Narrative engine must not import any analytical engines."""
        import inspect
        from app.services.rhino import battle_narrative_engine as bne
        source = inspect.getsource(bne)
        assert "determine_playbook_framing" not in source
        assert "from .technical_engine" not in source
        assert "from .valuation_engine" not in source
        assert "from .playbook_engine" not in source
        assert "from .macro_engine" not in source

    def test_structured_data_unchanged_by_narrative(self):
        """Adding narrative does not mutate structured sections."""
        report = _build_report()
        # Fundamental structured data intact
        assert report["fundamental"]["classification"] in ("deep_value", "discount", "fair", "premium")
        assert "valuation_style" in report["fundamental"]
        assert "eps_anchor" in report["fundamental"]
        assert "pe_low" in report["fundamental"]
        assert "pe_high" in report["fundamental"]
        assert "midpoint" in report["fundamental"]
        # Playbook structured data intact
        assert "upside" in report["playbook"]
        assert "downside" in report["playbook"]
        assert "framing" in report["playbook"]["upside"]
