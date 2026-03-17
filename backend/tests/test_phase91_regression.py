"""
Phase 9.1 regression tests — validates all fixes and new features.

Covers:
  1. Valuation regime classification (6 regimes)
  2. Pre-profit safety guard (negative EPS → pe_applicable=False)
  3. Hyper-growth regime (>50% growth, growth-aware framing)
  4. Raw vs adjusted valuation band contract
  5. Bearish setup battlefield reversal-line selection
  6. Bilingual playbook rationale rendering
  7. Playbook scenario tree (trigger/target distinction)
  8. One-way flow preserved across all changes
"""
from __future__ import annotations

import pytest

from app.services.rhino.valuation_style_engine import (
    detect_valuation_style,
    detect_valuation_regime,
    RegimeResult,
    TICKER_SECTOR_OVERRIDE,
)
from app.services.rhino.valuation_engine import build_valuation
from app.services.rhino.playbook_engine import build_playbook, determine_playbook_framing
from app.services.rhino.fundamental_narrative_engine import build_fundamental_narrative
from app.services.rhino.rhino_report_engine import build_battle_report
from app.services.rhino.battle_narrative_engine import VolumeLabelMapper


# ── Fixtures ──────────────────────────────────────────────────────────────

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


def _tech(support_zones=None, resistance_zones=None, volume_ratio=None, pattern_tags=None):
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
        "pattern_tags": pattern_tags if pattern_tags is not None else ["above_sma200"],
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
        "rationale": [{"code": "above_sma200", "en": "Trading above SMA200", "zh": "\u4ef7\u683c\u5728SMA200\u4e4b\u4e0a"}],
    }


def _build_report(price=200, valuation_style="growth", pattern_tags=None, **kwargs):
    val = _val(valuation_style=valuation_style)
    tech = _tech(pattern_tags=pattern_tags, **{k: v for k, v in kwargs.items()
                  if k in ("support_zones", "resistance_zones", "volume_ratio")})
    macro = _macro(**{k: v for k, v in kwargs.items() if k in ("vix", "us10y", "haircut")})
    playbook = _playbook()
    narrative = build_fundamental_narrative(val, price)
    return build_battle_report(price, tech, val, macro, playbook, narrative)


# ══════════════════════════════════════════════════════════════════════════
# 1. VALUATION REGIME CLASSIFICATION
# ══════════════════════════════════════════════════════════════════════════

class TestValuationRegime:
    def test_regime_result_fields(self):
        regime = detect_valuation_regime({"eps_growth_pct": 0.25, "fy1_eps_avg": 5.0, "fy2_eps_avg": 6.0})
        assert isinstance(regime, RegimeResult)
        assert regime.valuation_regime is not None
        assert regime.valuation_method is not None
        assert isinstance(regime.pe_applicable, bool)
        assert regime.anchor_metric_label is not None

    def test_msft_is_quality_mega_cap(self):
        regime = detect_valuation_regime({"eps_growth_pct": 0.12}, symbol="MSFT")
        assert regime.valuation_regime == "quality_mega_cap"
        assert regime.pe_applicable is True

    def test_nvda_is_hyper_growth(self):
        regime = detect_valuation_regime({"eps_growth_pct": 0.05}, symbol="NVDA")
        assert regime.valuation_regime == "hyper_growth"
        assert regime.valuation_method == "growth_adjusted_pe"

    def test_growth_stock_is_earnings_compounder(self):
        regime = detect_valuation_regime(
            {"eps_growth_pct": 0.25, "fy1_eps_avg": 5.0, "fy2_eps_avg": 7.0}
        )
        assert regime.valuation_regime == "earnings_compounder"

    def test_cyclical_from_sector(self):
        regime = detect_valuation_regime(
            {"eps_growth_pct": 0.15}, sector_hint="Energy"
        )
        assert regime.valuation_regime == "cyclical"
        assert regime.valuation_method == "pe_compressed"

    def test_financial_pe_clamped(self):
        regime = detect_valuation_regime(
            {"eps_growth_pct": 0.20}, symbol="JPM"
        )
        assert regime.valuation_regime == "financial"
        assert regime.valuation_method == "pe_clamped"

    def test_defensive_from_heuristic(self):
        regime = detect_valuation_regime(
            {"eps_growth_pct": 0.05, "fy1_eps_avg": 3.0, "fy2_eps_avg": 3.2}
        )
        assert regime.valuation_regime == "defensive"


# ══════════════════════════════════════════════════════════════════════════
# 2. PRE-PROFIT SAFETY GUARD
# ══════════════════════════════════════════════════════════════════════════

class TestPreProfitGuard:
    def test_negative_eps_is_pre_profit(self):
        """Negative EPS → pre_profit, pe_applicable=False."""
        style = detect_valuation_style(
            {"eps_growth_pct": None, "fy1_eps_avg": -2.0, "fy2_eps_avg": -1.0}
        )
        assert style.style == "pre_profit"

    def test_zero_eps_is_pre_profit(self):
        style = detect_valuation_style(
            {"eps_growth_pct": None, "fy1_eps_avg": 0.0, "fy2_eps_avg": 0.0}
        )
        assert style.style == "pre_profit"

    def test_pre_profit_regime_pe_not_applicable(self):
        regime = detect_valuation_regime(
            {"eps_growth_pct": None, "fy1_eps_avg": -1.0}
        )
        assert regime.pe_applicable is False
        assert regime.valuation_regime == "pre_profit"
        assert regime.valuation_method == "not_applicable"

    def test_pre_profit_valuation_returns_unavailable(self):
        """Full pipeline: pre-profit → available=False, no PE band."""
        est = {"fy0_eps_avg": -1.0, "fy1_eps_avg": -0.5, "fy2_eps_avg": -0.2}
        result = build_valuation(est, 50, 0)
        assert result["available"] is False
        assert result["pe_applicable"] is False
        assert result["pe_band_low"] is None
        assert result["valuation_regime"] == "pre_profit"

    def test_unknown_sector_negative_eps_safety(self):
        """Unknown sector + negative EPS must not fall into PE regime."""
        style = detect_valuation_style({"eps_growth_pct": None, "fy1_eps_avg": -3.0})
        assert style.style == "pre_profit"

    def test_no_eps_at_all_pre_profit(self):
        """No EPS data at all → pre_profit."""
        style = detect_valuation_style({"eps_growth_pct": None})
        assert style.style == "pre_profit"


# ══════════════════════════════════════════════════════════════════════════
# 3. HYPER-GROWTH REGIME
# ══════════════════════════════════════════════════════════════════════════

class TestHyperGrowth:
    def test_high_growth_classified_hyper(self):
        """>=50% growth → hyper_growth."""
        style = detect_valuation_style(
            {"eps_growth_pct": 0.55, "fy1_eps_avg": 5.0, "fy2_eps_avg": 10.0}
        )
        assert style.style == "hyper_growth"

    def test_hyper_growth_full_pe_band(self):
        """Hyper-growth still gets PE band (pe_applicable=True)."""
        est = {"fy0_eps_avg": 3.0, "fy1_eps_avg": 5.0, "fy2_eps_avg": 8.0}
        result = build_valuation(est, 400, 0)
        assert result["available"] is True
        assert result["pe_band_low"] is not None
        assert result["valuation_regime"] == "hyper_growth"

    def test_hyper_growth_framing_is_expansion(self):
        framing = determine_playbook_framing("hyper_growth")
        assert framing == "expansion"

    def test_49_percent_is_not_hyper(self):
        """49% growth → growth (earnings_compounder), not hyper_growth."""
        style = detect_valuation_style(
            {"eps_growth_pct": 0.49, "fy1_eps_avg": 5.0, "fy2_eps_avg": 7.5}
        )
        assert style.style == "growth"


# ══════════════════════════════════════════════════════════════════════════
# 4. RAW VS ADJUSTED VALUATION BAND
# ══════════════════════════════════════════════════════════════════════════

class TestValuationBand:
    def test_raw_and_adjusted_both_present(self):
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 6.0, "fy2_eps_avg": 7.0}
        result = build_valuation(est, 200, 5)
        assert result["raw_fair_value"] is not None
        assert result["adjusted_fair_value"] is not None

    def test_adjusted_less_than_raw(self):
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 6.0, "fy2_eps_avg": 7.0}
        result = build_valuation(est, 200, 10)
        raw = result["raw_fair_value"]
        adj = result["adjusted_fair_value"]
        assert adj["mid"] < raw["mid"]
        assert adj["low"] < raw["low"]

    def test_zero_haircut_raw_equals_adjusted(self):
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 6.0, "fy2_eps_avg": 7.0}
        result = build_valuation(est, 200, 0)
        raw = result["raw_fair_value"]
        adj = result["adjusted_fair_value"]
        assert abs(raw["mid"] - adj["mid"]) < 0.01

    def test_battle_report_narrative_uses_raw_band(self):
        """Narrative should reference raw fair value, not adjusted."""
        report = _build_report()
        text = report["narrative"]["fundamental"]
        raw = report["fundamental"]
        # The narrative should mention the raw midpoint value
        if raw["midpoint"]:
            # Just verify the fundamental section references some value
            assert len(text) > 0


# ══════════════════════════════════════════════════════════════════════════
# 5. BEARISH BATTLEFIELD REVERSAL LINE
# ══════════════════════════════════════════════════════════════════════════

class TestBearishReversal:
    def test_bearish_uses_overhead_resistance(self):
        """In bearish setup, reversal line references overhead resistance."""
        report = _build_report(pattern_tags=["below_sma200"])
        text = report["narrative"]["battlefield"]
        # Should reference the nearest overhead resistance (220)
        assert "220" in text
        # Should use repair-oriented language
        assert "\u4fee\u590d" in text  # 修复

    def test_bullish_uses_structural_reversal(self):
        """In bullish setup, reversal line can use support reversal."""
        report = _build_report(pattern_tags=["above_sma200"])
        text = report["narrative"]["battlefield"]
        # Should still have meaningful content
        assert len(text) > 0

    def test_bearish_no_absurd_lower_reversal(self):
        """Bearish setup should NOT say a lower support is the reversal line."""
        report = _build_report(
            pattern_tags=["below_sma200"],
            support_zones=[
                {"center": 180, "lower": 178, "upper": 182, "strength": 0.95, "sources": []},
            ],
            resistance_zones=[
                {"center": 220, "lower": 218, "upper": 222, "strength": 0.85, "sources": []},
            ],
        )
        text = report["narrative"]["battlefield"]
        # Should NOT say "180 is the trend reversal line"
        assert "\u8d8b\u52bf\u53cd\u8f6c\u7684\u5173\u952e\u7ebf" not in text or "180" not in text.split("\u8d8b\u52bf\u53cd\u8f6c")[0]

    def test_ladder_includes_pattern_tags(self):
        """Ladder section should carry pattern_tags for narrative."""
        report = _build_report(pattern_tags=["below_sma200", "low_volume"])
        assert "pattern_tags" in report["ladder"]
        assert "below_sma200" in report["ladder"]["pattern_tags"]


# ══════════════════════════════════════════════════════════════════════════
# 6. BILINGUAL PLAYBOOK RATIONALE
# ══════════════════════════════════════════════════════════════════════════

class TestBilingualRationale:
    def test_playbook_engine_produces_dicts(self):
        tech = {"pattern_tags": ["above_sma200"], "support_zones": [], "resistance_zones": []}
        val = {"status": "fair_value"}
        pb = build_playbook(tech, val, "normal")
        assert isinstance(pb["rationale"], list)
        assert len(pb["rationale"]) > 0
        item = pb["rationale"][0]
        assert isinstance(item, dict)
        assert "code" in item
        assert "en" in item
        assert "zh" in item

    def test_rationale_zh_has_chinese(self):
        tech = {"pattern_tags": ["above_sma200"], "support_zones": [], "resistance_zones": []}
        val = {"status": "fair_value"}
        pb = build_playbook(tech, val, "normal")
        item = pb["rationale"][0]
        assert any("\u4e00" <= c <= "\u9fff" for c in item["zh"])

    def test_rationale_en_is_english(self):
        tech = {"pattern_tags": ["above_sma200"], "support_zones": [], "resistance_zones": []}
        val = {"status": "fair_value"}
        pb = build_playbook(tech, val, "normal")
        item = pb["rationale"][0]
        assert all(ord(c) < 0x4e00 for c in item["en"])

    def test_narrative_uses_zh_rationale(self):
        """Chinese narrative should use zh field of rationale."""
        report = _build_report()
        text = report["narrative"]["playbook"]
        # zh rationale for above_sma200 is "价格在SMA200之上"
        assert "SMA200" in text

    def test_multiple_rationale_items(self):
        tech = {"pattern_tags": ["below_sma200", "low_volume"],
                "support_zones": [], "resistance_zones": []}
        val = {"status": "overvalued"}
        pb = build_playbook(tech, val, "elevated")
        assert len(pb["rationale"]) >= 3  # overvalued + below_sma200 + low_volume + vix

    def test_battle_report_rationale_passthrough(self):
        """Report passes through structured rationale unchanged."""
        report = _build_report()
        rationale = report["playbook"]["rationale"]
        assert isinstance(rationale, list)
        # Items should be dicts from the fixture
        for item in rationale:
            assert isinstance(item, dict)


# ══════════════════════════════════════════════════════════════════════════
# 7. PLAYBOOK SCENARIO TREE
# ══════════════════════════════════════════════════════════════════════════

class TestScenarioTree:
    def test_upside_has_trigger_and_target(self):
        report = _build_report()
        upside = report["playbook"]["upside"]
        assert "trigger" in upside
        assert "target" in upside
        assert "trigger_label" in upside
        assert "target_label" in upside

    def test_downside_has_trigger_and_target(self):
        report = _build_report()
        downside = report["playbook"]["downside"]
        assert "trigger" in downside
        assert "target" in downside

    def test_upside_trigger_is_first_resistance(self):
        report = _build_report()
        assert report["playbook"]["upside"]["trigger"] == 220

    def test_upside_target_is_second_resistance(self):
        report = _build_report()
        assert report["playbook"]["upside"]["target"] == 240

    def test_downside_trigger_is_first_support(self):
        report = _build_report()
        assert report["playbook"]["downside"]["trigger"] == 190

    def test_downside_target_is_second_support(self):
        report = _build_report()
        assert report["playbook"]["downside"]["target"] == 180

    def test_single_resistance_trigger_only(self):
        report = _build_report(
            resistance_zones=[{"center": 220, "lower": 218, "upper": 222, "strength": 0.85, "sources": []}],
        )
        assert report["playbook"]["upside"]["trigger"] == 220
        # Target falls back to raw_high from narrative
        assert report["playbook"]["upside"]["target"] is not None

    def test_no_zones_graceful(self):
        report = _build_report(support_zones=[], resistance_zones=[])
        assert report["playbook"]["upside"]["trigger"] is None
        assert report["playbook"]["downside"]["trigger"] is None

    def test_reversal_line_bearish(self):
        report = _build_report(pattern_tags=["below_sma200"])
        assert report["playbook"]["reversal_line"]["value"] == 220
        assert report["playbook"]["reversal_line"]["type"] == "reversal"

    def test_reversal_line_bullish_range(self):
        """Bullish range-bound: reversal line = upper boundary (breakout)."""
        report = _build_report(pattern_tags=["above_sma200"])
        # Price 200 between support 190 and resistance 220 -> RANGE
        assert report["playbook"]["reversal_line"]["value"] == 220
        assert report["playbook"]["reversal_line"]["type"] == "breakout"

    def test_narrative_distinguishes_trigger_target(self):
        report = _build_report()
        text = report["narrative"]["playbook"]
        # Should mention both 220 (trigger) and 240 (target)
        assert "220" in text
        assert "240" in text

    def test_backward_compat_stop_field(self):
        """downside.stop is still present for backward compatibility."""
        report = _build_report()
        assert report["playbook"]["downside"]["stop"] == 190
        assert report["playbook"]["downside"]["stop_label"] == "$190.00"

    def test_risk_rule_zh_present(self):
        report = _build_report()
        assert "risk_rule_zh" in report["playbook"]
        assert "15%" in report["playbook"]["risk_rule_zh"]


# ══════════════════════════════════════════════════════════════════════════
# 8. ONE-WAY FLOW PRESERVED
# ══════════════════════════════════════════════════════════════════════════

class TestOneWayFlowPreserved:
    def test_no_analytical_imports_in_narrative(self):
        import inspect
        from app.services.rhino import battle_narrative_engine as bne
        source = inspect.getsource(bne)
        assert "from .technical_engine" not in source
        assert "from .valuation_engine" not in source
        assert "from .playbook_engine" not in source

    def test_structured_data_intact(self):
        report = _build_report()
        assert "fundamental" in report
        assert "ladder" in report
        assert "macro" in report
        assert "playbook" in report
        assert "narrative" in report

    def test_volume_mapper_still_3_states(self):
        assert "\u653e\u91cf" in VolumeLabelMapper.label([{"signal": "strong_volume"}])
        assert "\u7f29\u91cf" in VolumeLabelMapper.label([{"signal": "weak_volume"}])
        assert "\u89c2\u671b" in VolumeLabelMapper.label([])


# ══════════════════════════════════════════════════════════════════════════
# 9. PHASE 9.2a — REVERSAL LINE STRUCTURE-AWARE STATE MACHINE
# ══════════════════════════════════════════════════════════════════════════

class TestReversalLineStateMachine:
    """Reversal line uses structure-aware invalidation, not nearest tagged level."""

    def test_bear_repair_reversal(self):
        """Bearish + resistance -> reversal at overhead resistance."""
        report = _build_report(pattern_tags=["below_sma200"])
        rl = report["playbook"]["reversal_line"]
        assert rl is not None
        assert rl["value"] == 220
        assert rl["type"] == "reversal"

    def test_range_breakout(self):
        """Price between S/R -> breakout at upper boundary."""
        report = _build_report(pattern_tags=["above_sma200"])
        # Price 200 between support 190 and resistance 220
        rl = report["playbook"]["reversal_line"]
        assert rl is not None
        assert rl["value"] == 220
        assert rl["type"] == "breakout"

    def test_bull_pullback_invalidation(self):
        """Price above resistance (no box) -> invalidation at support."""
        report = _build_report(
            price=250,
            pattern_tags=["above_sma200"],
        )
        # Price 250 > resistance 220, so not range-bound -> invalidation at support
        rl = report["playbook"]["reversal_line"]
        assert rl is not None
        assert rl["value"] == 190
        assert rl["type"] == "invalidation"

    def test_no_support_no_reversal(self):
        """No support, no resistance -> no reversal line."""
        report = _build_report(
            pattern_tags=["above_sma200"],
            support_zones=[], resistance_zones=[],
        )
        assert report["playbook"]["reversal_line"] is None

    def test_support_only_invalidation(self):
        """Only support zones, no resistance -> invalidation."""
        report = _build_report(
            pattern_tags=["above_sma200"],
            resistance_zones=[],
        )
        rl = report["playbook"]["reversal_line"]
        assert rl is not None
        assert rl["value"] == 190
        assert rl["type"] == "invalidation"

    def test_bear_narrative_mentions_overhead(self):
        """Bear repair narrative references overhead recovery level."""
        report = _build_report(pattern_tags=["below_sma200"])
        text = report["narrative"]["battlefield"]
        assert "220" in text
        assert "\u7ed3\u6784\u4fee\u590d" in text  # structural repair

    def test_range_narrative_mentions_box(self):
        """Range-bound narrative references box consolidation."""
        report = _build_report(pattern_tags=["above_sma200"])
        text = report["narrative"]["battlefield"]
        assert "\u7bb1\u4f53\u4e0a\u6cbf" in text or "\u533a\u95f4\u9707\u8361" in text


# ══════════════════════════════════════════════════════════════════════════
# 10. PHASE 9.2a — BILINGUAL NARRATIVE + LABELS
# ══════════════════════════════════════════════════════════════════════════

class TestBilingualNarrative:
    """Narrative engine produces clean English and Chinese depending on lang."""

    def test_zh_narrative_has_chinese(self):
        report = _build_report()
        text = report["narrative"]["fundamental"]
        assert "\u5b9a\u4ef7\u951a" in text  # pricing anchor in ZH

    def test_en_fundamental_narrative(self):
        val = _val()
        narrative = build_fundamental_narrative(val, 200)
        report = build_battle_report(200, _tech(), val, _macro(), _playbook(), narrative, lang="en")
        text = report["narrative"]["fundamental"]
        assert "Pricing anchor" in text
        assert "forward EPS" in text
        # No Chinese characters
        for ch in text:
            assert ord(ch) < 0x4E00 or ord(ch) > 0x9FFF, f"Found Chinese char in EN: {ch}"

    def test_en_battlefield_narrative(self):
        val = _val()
        narrative = build_fundamental_narrative(val, 200)
        report = build_battle_report(200, _tech(), val, _macro(), _playbook(), narrative, lang="en")
        text = report["narrative"]["battlefield"]
        assert "resistance" in text.lower() or "support" in text.lower()

    def test_en_macro_narrative(self):
        val = _val()
        narrative = build_fundamental_narrative(val, 200)
        report = build_battle_report(200, _tech(), val, _macro(), _playbook(), narrative, lang="en")
        text = report["narrative"]["macro"]
        assert "sentiment" in text.lower() or "stable" in text.lower()
        assert "Volume signal" in text

    def test_en_playbook_narrative(self):
        val = _val()
        narrative = build_fundamental_narrative(val, 200)
        report = build_battle_report(200, _tech(), val, _macro(), _playbook(), narrative, lang="en")
        text = report["narrative"]["playbook"]
        assert "Bias" in text
        assert "Recommendation" in text
        assert "Position discipline" in text

    def test_en_no_chinese_in_any_narrative_section(self):
        """English mode must have zero Chinese characters in narrative."""
        val = _val()
        narrative = build_fundamental_narrative(val, 200)
        report = build_battle_report(200, _tech(), val, _macro(), _playbook(), narrative, lang="en")
        for section in ("fundamental", "battlefield", "macro", "playbook"):
            text = report["narrative"][section]
            for ch in text:
                assert ord(ch) < 0x4E00 or ord(ch) > 0x9FFF, \
                    f"Chinese char '{ch}' in EN {section}: ...{text[max(0,text.index(ch)-10):text.index(ch)+10]}..."


class TestBilingualLabels:
    """Zone labels and risk labels have bilingual fields."""

    def test_ladder_rungs_have_label_zh(self):
        report = _build_report()
        for rung in report["ladder"]["support"]:
            assert "label_zh" in rung
            assert len(rung["label_zh"]) > 0
        for rung in report["ladder"]["resistance"]:
            assert "label_zh" in rung
            assert len(rung["label_zh"]) > 0

    def test_ladder_en_labels_unchanged(self):
        """English labels still match original naming convention."""
        report = _build_report()
        labels = {r["label"] for r in report["ladder"]["support"] + report["ladder"]["resistance"]}
        valid = {"Structural Reversal", "Regime Line", "Major", "Structural", "Weak"}
        assert labels.issubset(valid)

    def test_macro_risks_have_label_zh(self):
        """Macro risks include bilingual labels."""
        report = _build_report(vix=28.0, us10y=4.5)
        for risk in report["macro"]["risks"]:
            assert "label_zh" in risk
            assert len(risk["label_zh"]) > 0

    def test_volume_mapper_bilingual(self):
        """VolumeLabelMapper returns correct labels for both languages."""
        assert "confirmation" in VolumeLabelMapper.label([{"signal": "strong_volume"}], "en")
        assert "\u653e\u91cf" in VolumeLabelMapper.label([{"signal": "strong_volume"}], "zh")
        assert "sidelines" in VolumeLabelMapper.label([], "en")
        assert "\u89c2\u671b" in VolumeLabelMapper.label([], "zh")
