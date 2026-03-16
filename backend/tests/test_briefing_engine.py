"""
Briefing engine tests — validates institutional-grade Chinese tactical briefing.

Covers:
  1. Section 2 ladder degradation (Level A / B / C)
  2. Tactical phrase registry (atomic constants, no concatenation)
  3. One-way computation (no hidden recomputation)
  4. 4-section shape preservation under degraded conditions
  5. Section ownership declarations
  6. Integration with pipeline
  7. Valuation hysteresis classification (±2%)
  8. Ladder semantic labels with precedence
  9. Dual-track playbook symmetry (both paths always present)
  10. Max line counts per section
"""
from __future__ import annotations

import ast
import inspect
import pytest
from unittest.mock import patch, AsyncMock

from app.services.rhino.briefing_engine import (
    build_rhino_briefing,
    select_tactical_phrases,
    ZH_TACTICAL,
    _TACTICAL_VALUES,
    SECTION_OWNERS,
    _determine_ladder_level,
    _build_ladder_a,
    _build_ladder_b,
    _build_ladder_c,
    _build_section_valuation,
    _build_section_macro,
    _classify_price_position,
    _ladder_semantic_label,
    _ladder_interpretation,
    _VAL_POSITION_ZH,
    _LADDER_LABELS_RESISTANCE,
    _LADDER_LABELS_SUPPORT,
    _DUAL_TRACK_KEYS,
)
from app.services.rhino.scenario_engine import ScenarioResult, NEUTRAL_SCENARIO


# ── Helpers ────────────────────────────────────────────────────────────────

def _zone(center, strength=0.75, sources=None):
    return {
        "center": center,
        "lower": center - 1,
        "upper": center + 1,
        "strength": strength,
        "sources": sources or ["volume_profile"],
    }


def _tech(
    support_zones=None, resistance_zones=None,
    sma200=None, atr20=None, **kw,
):
    base = {
        "sma30": None, "sma100": None, "sma200": sma200,
        "atr20": atr20, "avg_volume_50": None,
        "today_volume": None, "volume_ratio": None,
        "support_zones": support_zones or [],
        "resistance_zones": resistance_zones or [],
        "pattern_tags": [],
    }
    base.update(kw)
    return base


def _val(status="fair_value", available=True, fy1=8.0, fy2=9.0, growth=0.125):
    return {
        "available": available, "status": status,
        "fy1_eps_avg": fy1, "fy2_eps_avg": fy2,
        "eps_growth_pct": growth,
        "adjusted_fair_value": {"low": 100, "high": 160},
    }


def _macro(vix=18.0, vix_regime="normal", rate=3.5, rate_regime="neutral"):
    return {
        "vix_level": vix, "vix_regime": vix_regime,
        "treasury_10y": rate, "rate_pressure_regime": rate_regime,
        "recommended_haircut_pct": 0, "alerts": [],
    }


def _playbook(action="hold_watch", bias="neutral"):
    return {"bias_tag": bias, "action_tag": action, "rationale": ["Test reason"]}


def _scenario(scenario="neutral", regime="unavailable", setup="default",
              bias="neutral", confidence="low", constraints=()):
    return ScenarioResult(
        scenario=scenario, regime=regime, setup=setup,
        bias=bias, confidence=confidence, constraints=constraints,
    )


def _full_tech():
    """Technical data with full zones — Level A."""
    return _tech(
        resistance_zones=[_zone(155, 0.9), _zone(165, 0.75)],
        support_zones=[_zone(135, 0.85), _zone(125, 0.7)],
        sma200=140.0,
        atr20=3.5,
    )


def _partial_tech():
    """Technical data with partial zones — Level B."""
    return _tech(
        resistance_zones=[_zone(155, 0.75)],
        support_zones=[],
        sma200=140.0,
        atr20=3.5,
    )


def _empty_tech():
    """Technical data with no zones — Level C."""
    return _tech(sma200=140.0, atr20=3.5)


def _bare_tech():
    """Technical data with nothing — Level C, no SMA/ATR either."""
    return _tech()


# ═══════════════════════════════════════════════════════════════════════════
# 1. Ladder degradation
# ═══════════════════════════════════════════════════════════════════════════

class TestLadderDegradation:
    def test_level_a_with_full_zones(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
        )
        assert result["ladder_level"] == "A"

    def test_level_b_with_partial_zones(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _partial_tech(), _val(), _macro(),
        )
        assert result["ladder_level"] == "B"

    def test_level_c_with_no_zones(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _empty_tech(), _val(), _macro(),
        )
        assert result["ladder_level"] == "C"

    def test_level_c_with_bare_tech(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _bare_tech(), _val(), _macro(),
        )
        assert result["ladder_level"] == "C"

    def test_level_a_contains_price_anchor(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
        )
        assert "142.00" in result["sections"]["ladder"]

    def test_level_b_contains_price_anchor(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _partial_tech(), _val(), _macro(),
        )
        assert "142.00" in result["sections"]["ladder"]

    def test_level_c_contains_price_anchor(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _empty_tech(), _val(), _macro(),
        )
        assert "142.00" in result["sections"]["ladder"]

    def test_level_a_has_semantic_labels(self):
        """Level A ladder uses semantic labels (not R1/R2/S1/S2)."""
        ladder = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
        )["sections"]["ladder"]
        # Should contain semantic labels from the label maps
        has_label = any(
            label in ladder
            for labels in (_LADDER_LABELS_RESISTANCE, _LADDER_LABELS_SUPPORT)
            for label in labels.values()
        )
        assert has_label

    def test_level_a_has_zone_prices(self):
        """Level A ladder contains zone center prices."""
        ladder = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
        )["sections"]["ladder"]
        assert "155.00" in ladder
        assert "165.00" in ladder
        assert "135.00" in ladder
        assert "125.00" in ladder

    def test_level_a_has_interpretation(self):
        """Level A ladder includes structural interpretation paragraph."""
        ladder = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
        )["sections"]["ladder"]
        # Interpretation line from _ladder_interpretation (both above and below)
        assert "\u7a81\u7834" in ladder or "\u65b9\u5411" in ladder

    def test_level_b_has_structural_reference(self):
        ladder = build_rhino_briefing(
            "AAPL", 142.0, _partial_tech(), _val(), _macro(),
        )["sections"]["ladder"]
        assert "200\u65e5\u5747\u7ebf" in ladder

    def test_level_c_has_directional_watch(self):
        ladder = build_rhino_briefing(
            "AAPL", 142.0, _empty_tech(), _val(), _macro(),
        )["sections"]["ladder"]
        assert "\u89c2\u5bdf\u4f4d" in ladder

    def test_level_c_has_caution_line(self):
        ladder = build_rhino_briefing(
            "AAPL", 142.0, _empty_tech(), _val(), _macro(),
        )["sections"]["ladder"]
        assert "\u8b66\u6212\u7ebf" in ladder

    def test_level_c_never_generic_unavailable(self):
        """Section 2 must NOT collapse to a generic unavailable message."""
        ladder = build_rhino_briefing(
            "AAPL", 142.0, _bare_tech(), _val(), _macro(),
        )["sections"]["ladder"]
        assert "\u4e0d\u53ef\u7528" not in ladder
        assert "unavailable" not in ladder.lower()
        assert len(ladder) > 30

    def test_level_c_bullish_scenario_upward_watch(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _empty_tech(), _val(), _macro(),
            scenario=_scenario(bias="constructive"),
        )
        assert "\u4e0a\u65b9" in result["sections"]["ladder"]

    def test_level_c_defensive_scenario_downward_watch(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _empty_tech(), _val(), _macro(),
            scenario=_scenario(bias="defensive"),
        )
        assert "\u4e0b\u65b9" in result["sections"]["ladder"]

    def test_ladder_level_classification(self):
        assert _determine_ladder_level([1, 2], [1, 2]) == "A"
        assert _determine_ladder_level([1, 2], [1]) == "B"
        assert _determine_ladder_level([1], [1, 2]) == "B"
        assert _determine_ladder_level([1], []) == "B"
        assert _determine_ladder_level([], [1]) == "B"
        assert _determine_ladder_level([], []) == "C"


# ═══════════════════════════════════════════════════════════════════════════
# 2. Tactical phrase registry
# ═══════════════════════════════════════════════════════════════════════════

class TestTacticalPhrases:
    def test_all_returned_phrases_from_registry(self):
        """Every tactical phrase must be an exact match from ZH_TACTICAL."""
        for sc_name in ["trend_pullback", "bullish_breakout", "mean_reversion",
                        "defensive", "macro_headwind", "neutral"]:
            result = build_rhino_briefing(
                "AAPL", 142.0, _full_tech(), _val(), _macro(),
                scenario=_scenario(scenario=sc_name),
            )
            for phrase in result["tactical_phrases"]:
                assert phrase in _TACTICAL_VALUES, (
                    f"Phrase not in registry: {phrase!r}"
                )

    def test_select_returns_tuple(self):
        """select_tactical_phrases returns (tracks_dict, flat_list)."""
        tracks, all_phrases = select_tactical_phrases(
            _scenario(scenario="neutral"), _playbook(),
        )
        assert isinstance(tracks, dict)
        assert isinstance(all_phrases, list)

    def test_tracks_has_required_keys(self):
        """Tracks dict has state/downside/upside/risk keys."""
        for sc_name in ["trend_pullback", "bullish_breakout", "mean_reversion",
                        "defensive", "macro_headwind", "neutral"]:
            tracks, _ = select_tactical_phrases(
                _scenario(scenario=sc_name), _playbook(),
            )
            assert "state" in tracks
            assert "downside" in tracks
            assert "upside" in tracks
            assert "risk" in tracks

    def test_all_track_values_from_registry(self):
        """Every value in tracks dict is from ZH_TACTICAL."""
        for sc_name in _DUAL_TRACK_KEYS:
            tracks, _ = select_tactical_phrases(
                _scenario(scenario=sc_name), _playbook(),
            )
            for key, phrase in tracks.items():
                assert phrase in _TACTICAL_VALUES, (
                    f"Track {key} phrase not in registry for {sc_name}: {phrase!r}"
                )

    def test_val_support_constraint_adds_discount(self):
        _, all_phrases = select_tactical_phrases(
            _scenario(constraints=("val_support",)), _playbook(),
        )
        assert ZH_TACTICAL["discount_entry"] in all_phrases

    def test_risk_high_constraint_adds_stop_loss(self):
        _, all_phrases = select_tactical_phrases(
            _scenario(scenario="defensive", constraints=("risk_high",)),
            _playbook(),
        )
        assert ZH_TACTICAL["stop_loss_discipline"] in all_phrases

    def test_stop_loss_action_adds_knife_warning(self):
        _, all_phrases = select_tactical_phrases(
            _scenario(), _playbook(action="stop_loss"),
        )
        assert ZH_TACTICAL["no_catch_falling_knife"] in all_phrases

    def test_no_duplicate_phrases(self):
        """Each phrase appears at most once."""
        _, all_phrases = select_tactical_phrases(
            _scenario(scenario="defensive", constraints=("risk_high",)),
            _playbook(action="stop_loss"),
        )
        assert len(all_phrases) == len(set(all_phrases))

    def test_phrases_are_complete_units(self):
        """Each phrase is a standalone sentence, not a fragment."""
        for key, phrase in ZH_TACTICAL.items():
            assert len(phrase) >= 4, f"Phrase too short to be atomic: {key}={phrase}"
            assert not phrase.endswith("\u7684"), f"Fragment ending: {key}"
            assert not phrase.endswith("\u548c"), f"Fragment ending: {key}"

    def test_playbook_section_contains_track_phrases(self):
        """Track phrases (state/downside/upside/risk) appear in Section 4."""
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
            scenario=_scenario(scenario="trend_pullback"),
        )
        playbook_text = result["sections"]["playbook"]
        tracks, _ = select_tactical_phrases(
            _scenario(scenario="trend_pullback"), _playbook(),
        )
        for key in ("state", "downside", "upside", "risk"):
            assert tracks[key] in playbook_text, (
                f"Track '{key}' phrase missing from playbook section"
            )


# ═══════════════════════════════════════════════════════════════════════════
# 3. One-way computation rule
# ═══════════════════════════════════════════════════════════════════════════

class TestOneWayComputation:
    def test_no_upstream_computation_imports(self):
        """briefing_engine must not import computation modules."""
        import app.services.rhino.briefing_engine as mod
        source = inspect.getsource(mod)
        tree = ast.parse(source)
        imported_names: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                if node.module:
                    imported_names.append(node.module)
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    imported_names.append(alias.name)
        forbidden = [
            "valuation_engine", "technical_engine", "macro_engine",
            "semantic_engine", "confidence_engine", "indicators",
        ]
        for f in forbidden:
            assert not any(f in n for n in imported_names), (
                f"briefing_engine imports forbidden module: {f}"
            )

    def test_valuation_band_passed_through(self):
        """Fair-value band values appear in output without recomputation."""
        val = _val()
        val["adjusted_fair_value"] = {"low": 111.11, "high": 155.55}
        result = build_rhino_briefing(
            "AAPL", 130.0, _full_tech(), val, _macro(),
        )
        section = result["sections"]["valuation"]
        assert "111.11" in section
        assert "155.55" in section

    def test_eps_values_passed_through(self):
        """EPS values appear in output without recomputation."""
        val = _val(fy1=7.77, fy2=8.88, growth=0.143)
        result = build_rhino_briefing(
            "AAPL", 130.0, _full_tech(), val, _macro(),
        )
        section = result["sections"]["valuation"]
        assert "7.77" in section
        assert "8.88" in section
        assert "14.3%" in section

    def test_vix_value_passed_through(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(vix=27.5),
        )
        assert "27.5" in result["sections"]["macro"]

    def test_treasury_value_passed_through(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(rate=4.35),
        )
        assert "4.35" in result["sections"]["macro"]


# ═══════════════════════════════════════════════════════════════════════════
# 4. Four-section shape preservation
# ═══════════════════════════════════════════════════════════════════════════

class TestBriefingShape:
    def test_four_sections_present_full_data(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
        )
        assert set(result["sections"].keys()) == {
            "valuation", "ladder", "macro", "playbook",
        }
        for key, text in result["sections"].items():
            assert isinstance(text, str), f"Section {key} is not str"
            assert len(text) > 0, f"Section {key} is empty"

    def test_four_sections_present_empty_data(self):
        result = build_rhino_briefing(
            "AAPL", 0.0, _bare_tech(),
            _val(available=False, status="unavailable", fy1=None, fy2=None, growth=None),
            _macro(vix=None, rate=None),
        )
        assert set(result["sections"].keys()) == {
            "valuation", "ladder", "macro", "playbook",
        }
        for key, text in result["sections"].items():
            assert isinstance(text, str), f"Section {key} is not str"
            assert len(text) > 0, f"Section {key} is empty"

    def test_four_sections_present_minimal_data(self):
        result = build_rhino_briefing(
            "AAPL", 100.0, _empty_tech(),
            _val(available=False, status="unavailable", fy1=None, fy2=None, growth=None),
            _macro(vix=None, vix_regime="unavailable", rate=None, rate_regime="unavailable"),
        )
        assert len(result["sections"]) == 4
        for text in result["sections"].values():
            assert len(text) > 0

    def test_deterministic_output(self):
        """Same inputs always produce same output."""
        args = ("AAPL", 142.0, _full_tech(), _val(), _macro())
        r1 = build_rhino_briefing(*args)
        r2 = build_rhino_briefing(*args)
        assert r1 == r2

    def test_ladder_level_in_response(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
        )
        assert result["ladder_level"] in {"A", "B", "C"}

    def test_tactical_phrases_in_response(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
        )
        assert isinstance(result["tactical_phrases"], list)
        assert len(result["tactical_phrases"]) > 0

    def test_none_scenario_uses_neutral(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
            scenario=None,
        )
        assert result["ladder_level"] in {"A", "B", "C"}
        assert len(result["sections"]) == 4

    def test_none_playbook_uses_default(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
            playbook=None,
        )
        assert len(result["sections"]) == 4


# ═══════════════════════════════════════════════════════════════════════════
# 5. Section ownership
# ═══════════════════════════════════════════════════════════════════════════

class TestSectionOwnership:
    def test_ownership_declared(self):
        assert SECTION_OWNERS["valuation"] == "valuation_engine"
        assert SECTION_OWNERS["ladder"] == "technical_engine"
        assert SECTION_OWNERS["macro"] == "macro_engine"
        assert SECTION_OWNERS["playbook"] == "scenario_engine + playbook_engine"

    def test_all_sections_have_owners(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
        )
        for key in result["sections"]:
            assert key in SECTION_OWNERS, f"Section {key} has no owner"


# ═══════════════════════════════════════════════════════════════════════════
# 6. Integration
# ═══════════════════════════════════════════════════════════════════════════

class TestBriefingIntegration:
    @pytest.mark.asyncio
    async def test_analyze_response_contains_briefing(self):
        from datetime import date, timedelta
        start = date(2024, 1, 2)
        bars = []
        for i in range(250):
            d = start + timedelta(days=i)
            p = 150.0 + i * 0.5
            bars.append({
                "date": d.isoformat(),
                "open": p, "high": p + 1, "low": p - 1, "close": p,
                "volume": 1000000,
            })
        with (
            patch("app.services.rhino.get_history",
                  new_callable=AsyncMock, return_value=bars),
            patch("app.services.rhino.get_estimates",
                  new_callable=AsyncMock,
                  return_value={"fy1_eps_avg": 8.0, "fy2_eps_avg": 9.0}),
            patch("app.services.rhino.get_macro",
                  new_callable=AsyncMock,
                  return_value={"vix": 18.0, "us10y": 3.5}),
        ):
            from app.services.rhino import analyze
            result = await analyze("AAPL")

        assert "briefing" in result
        briefing = result["briefing"]
        assert "sections" in briefing
        assert "ladder_level" in briefing
        assert "tactical_phrases" in briefing
        assert set(briefing["sections"].keys()) == {
            "valuation", "ladder", "macro", "playbook",
        }
        assert briefing["ladder_level"] in {"A", "B", "C"}

    @pytest.mark.asyncio
    async def test_degraded_response_has_briefing(self):
        with (
            patch("app.services.rhino.get_history",
                  new_callable=AsyncMock, return_value=[]),
            patch("app.services.rhino.get_estimates",
                  new_callable=AsyncMock,
                  return_value={"fy1_eps_avg": None, "fy2_eps_avg": None}),
            patch("app.services.rhino.get_macro",
                  new_callable=AsyncMock,
                  return_value={"vix": None, "us10y": None}),
        ):
            from app.services.rhino import analyze
            result = await analyze("AAPL")

        assert "briefing" in result
        briefing = result["briefing"]
        assert len(briefing["sections"]) == 4
        assert len(briefing["sections"]["ladder"]) > 0


# ═══════════════════════════════════════════════════════════════════════════
# 7. Valuation hysteresis classification
# ═══════════════════════════════════════════════════════════════════════════

class TestHysteresisClassification:
    def test_deep_value_below_band(self):
        assert _classify_price_position(90, {"low": 100, "high": 160}) == "deep_value"

    def test_premium_above_band(self):
        assert _classify_price_position(170, {"low": 100, "high": 160}) == "premium"

    def test_fair_at_midpoint(self):
        # midpoint = 130, price = 130 → within ±2%
        assert _classify_price_position(130, {"low": 100, "high": 160}) == "fair"

    def test_fair_within_hysteresis_band_above(self):
        # midpoint = 130, 2% above = 132.6, price = 131 → within ±2%
        assert _classify_price_position(131, {"low": 100, "high": 160}) == "fair"

    def test_fair_within_hysteresis_band_below(self):
        # midpoint = 130, 2% below = 127.4, price = 129 → within ±2%
        assert _classify_price_position(129, {"low": 100, "high": 160}) == "fair"

    def test_discount_below_midpoint_outside_hysteresis(self):
        # midpoint = 130, 2% below = 127.4, price = 110 → discount
        assert _classify_price_position(110, {"low": 100, "high": 160}) == "discount"

    def test_fair_above_midpoint_outside_hysteresis(self):
        # midpoint = 130, price = 150 → above mid but below high → fair
        assert _classify_price_position(150, {"low": 100, "high": 160}) == "fair"

    def test_unavailable_zero_price(self):
        assert _classify_price_position(0, {"low": 100, "high": 160}) == "unavailable"

    def test_unavailable_negative_price(self):
        assert _classify_price_position(-5, {"low": 100, "high": 160}) == "unavailable"

    def test_unavailable_none_band(self):
        assert _classify_price_position(130, None) == "unavailable"

    def test_unavailable_empty_band(self):
        assert _classify_price_position(130, {}) == "unavailable"

    def test_unavailable_partial_band(self):
        assert _classify_price_position(130, {"low": 100}) == "unavailable"

    def test_unavailable_zero_midpoint(self):
        assert _classify_price_position(5, {"low": 0, "high": 0}) == "unavailable"

    def test_val_position_labels_exist_for_all_positions(self):
        """Every position returned by _classify has a label in _VAL_POSITION_ZH."""
        for pos in ("deep_value", "discount", "fair", "premium", "unavailable"):
            assert pos in _VAL_POSITION_ZH

    def test_valuation_section_shows_position_text(self):
        """Valuation section contains the position description."""
        val = _val()
        val["adjusted_fair_value"] = {"low": 100, "high": 160}
        result = build_rhino_briefing("AAPL", 90, _full_tech(), val, _macro())
        section = result["sections"]["valuation"]
        assert _VAL_POSITION_ZH["deep_value"] in section

    def test_valuation_section_premium_text(self):
        val = _val()
        val["adjusted_fair_value"] = {"low": 100, "high": 160}
        result = build_rhino_briefing("AAPL", 170, _full_tech(), val, _macro())
        section = result["sections"]["valuation"]
        assert _VAL_POSITION_ZH["premium"] in section


# ═══════════════════════════════════════════════════════════════════════════
# 8. Ladder semantic labels with precedence
# ═══════════════════════════════════════════════════════════════════════════

class TestLadderSemanticLabels:
    def test_structural_reversal_sma200_high_strength(self):
        """SMA200 + strength >= 0.8 → structural reversal (highest precedence)."""
        zone = {"center": 150, "strength": 0.85, "sources": ["sma200"]}
        label = _ladder_semantic_label(zone, is_resistance=True)
        assert label == _LADDER_LABELS_RESISTANCE["structural_reversal"]

    def test_regime_line_sma200_low_strength(self):
        """SMA200 + strength < 0.8 → regime line."""
        zone = {"center": 150, "strength": 0.6, "sources": ["sma200"]}
        label = _ladder_semantic_label(zone, is_resistance=True)
        assert label == _LADDER_LABELS_RESISTANCE["regime_line"]

    def test_major_high_strength_no_sma200(self):
        """Strength >= 0.8 without SMA200 → major."""
        zone = {"center": 150, "strength": 0.85, "sources": ["volume_profile"]}
        label = _ladder_semantic_label(zone, is_resistance=True)
        assert label == _LADDER_LABELS_RESISTANCE["major"]

    def test_structural_medium_strength(self):
        """Strength >= 0.6, < 0.8 → structural."""
        zone = {"center": 150, "strength": 0.65, "sources": ["volume_profile"]}
        label = _ladder_semantic_label(zone, is_resistance=True)
        assert label == _LADDER_LABELS_RESISTANCE["structural"]

    def test_weak_low_strength(self):
        """Strength < 0.6 → weak."""
        zone = {"center": 150, "strength": 0.4, "sources": ["volume_profile"]}
        label = _ladder_semantic_label(zone, is_resistance=True)
        assert label == _LADDER_LABELS_RESISTANCE["weak"]

    def test_support_labels_differ_from_resistance(self):
        """Support and resistance use different label text for major/structural/weak."""
        zone = {"center": 150, "strength": 0.85, "sources": ["volume_profile"]}
        r_label = _ladder_semantic_label(zone, is_resistance=True)
        s_label = _ladder_semantic_label(zone, is_resistance=False)
        assert r_label != s_label
        assert r_label == _LADDER_LABELS_RESISTANCE["major"]
        assert s_label == _LADDER_LABELS_SUPPORT["major"]

    def test_default_strength_when_missing(self):
        """Missing strength defaults to 0.5 → weak."""
        zone = {"center": 150, "sources": ["volume_profile"]}
        label = _ladder_semantic_label(zone, is_resistance=True)
        assert label == _LADDER_LABELS_RESISTANCE["weak"]

    def test_default_sources_when_missing(self):
        """Missing sources defaults to [] → no SMA200 match."""
        zone = {"center": 150, "strength": 0.9}
        label = _ladder_semantic_label(zone, is_resistance=True)
        # High strength but no SMA200 → major
        assert label == _LADDER_LABELS_RESISTANCE["major"]

    def test_precedence_sma200_beats_high_strength(self):
        """SMA200 + high strength → structural_reversal, not major."""
        zone = {"center": 150, "strength": 0.9, "sources": ["sma200", "volume_profile"]}
        label = _ladder_semantic_label(zone, is_resistance=True)
        assert label == _LADDER_LABELS_RESISTANCE["structural_reversal"]


# ═══════════════════════════════════════════════════════════════════════════
# 9. Dual-track playbook symmetry
# ═══════════════════════════════════════════════════════════════════════════

class TestDualTrackSymmetry:
    def test_all_scenarios_have_dual_track_mapping(self):
        """Every known scenario has a dual-track key mapping."""
        for sc_name in ["trend_pullback", "bullish_breakout", "mean_reversion",
                        "defensive", "macro_headwind", "neutral"]:
            assert sc_name in _DUAL_TRACK_KEYS, f"Missing dual-track for {sc_name}"

    def test_all_mappings_have_four_keys(self):
        """Every dual-track mapping has state/downside/upside/risk."""
        for sc_name, mapping in _DUAL_TRACK_KEYS.items():
            assert "state" in mapping, f"{sc_name} missing 'state'"
            assert "downside" in mapping, f"{sc_name} missing 'downside'"
            assert "upside" in mapping, f"{sc_name} missing 'upside'"
            assert "risk" in mapping, f"{sc_name} missing 'risk'"

    def test_all_mapping_values_exist_in_registry(self):
        """Every key referenced in dual-track maps exists in ZH_TACTICAL."""
        for sc_name, mapping in _DUAL_TRACK_KEYS.items():
            for track, key in mapping.items():
                assert key in ZH_TACTICAL, (
                    f"Dual-track {sc_name}.{track} references missing key: {key}"
                )

    def test_playbook_always_has_downside_and_upside(self):
        """Both downside and upside scripts appear in playbook text for every scenario."""
        for sc_name in _DUAL_TRACK_KEYS:
            result = build_rhino_briefing(
                "AAPL", 142.0, _full_tech(), _val(), _macro(),
                scenario=_scenario(scenario=sc_name),
            )
            playbook = result["sections"]["playbook"]
            tracks, _ = select_tactical_phrases(
                _scenario(scenario=sc_name), _playbook(),
            )
            assert tracks["downside"] in playbook, (
                f"Downside script missing from playbook for {sc_name}"
            )
            assert tracks["upside"] in playbook, (
                f"Upside script missing from playbook for {sc_name}"
            )

    def test_playbook_header_contains_scenario_and_confidence(self):
        """Playbook header line contains scenario name and confidence in Chinese."""
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
            scenario=_scenario(scenario="trend_pullback", confidence="high"),
        )
        playbook = result["sections"]["playbook"]
        assert "\u8d8b\u52bf\u56de\u6492" in playbook  # scenario ZH name
        assert "\u9ad8" in playbook  # confidence "high" in ZH

    def test_unknown_scenario_falls_back_to_neutral(self):
        """Unknown scenario name uses neutral dual-track mapping."""
        tracks, _ = select_tactical_phrases(
            _scenario(scenario="unknown_scenario"), _playbook(),
        )
        neutral_tracks, _ = select_tactical_phrases(
            _scenario(scenario="neutral"), _playbook(),
        )
        assert tracks == neutral_tracks


# ═══════════════════════════════════════════════════════════════════════════
# 10. Max line counts per section
# ═══════════════════════════════════════════════════════════════════════════

class TestMaxLineCounts:
    def test_valuation_max_6_lines(self):
        result = build_rhino_briefing(
            "AAPL", 130.0, _full_tech(), _val(), _macro(),
        )
        lines = result["sections"]["valuation"].strip().split("\n")
        assert len(lines) <= 6

    def test_ladder_max_8_lines(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
        )
        lines = result["sections"]["ladder"].strip().split("\n")
        assert len(lines) <= 8

    def test_macro_max_4_lines(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(),
            _macro(vix=27.5, rate=4.35),
        )
        lines = result["sections"]["macro"].strip().split("\n")
        assert len(lines) <= 4

    def test_playbook_max_6_lines(self):
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), _macro(),
            scenario=_scenario(scenario="defensive", constraints=("risk_high",)),
            playbook=_playbook(action="stop_loss"),
        )
        lines = result["sections"]["playbook"].strip().split("\n")
        assert len(lines) <= 6

    def test_macro_with_alert_stays_within_limit(self):
        mac = _macro(vix=30.0, rate=5.0)
        mac["alerts"] = ["VIX spike detected", "Second alert ignored"]
        result = build_rhino_briefing(
            "AAPL", 142.0, _full_tech(), _val(), mac,
        )
        lines = result["sections"]["macro"].strip().split("\n")
        assert len(lines) <= 4


# ═══════════════════════════════════════════════════════════════════════════
# 11. Ladder interpretation helper
# ═══════════════════════════════════════════════════════════════════════════

class TestLadderInterpretation:
    def test_both_sides(self):
        text = _ladder_interpretation([{"center": 155}], [{"center": 135}])
        assert len(text) > 10

    def test_above_only(self):
        text = _ladder_interpretation([{"center": 155}], [])
        assert len(text) > 10

    def test_below_only(self):
        text = _ladder_interpretation([], [{"center": 135}])
        assert len(text) > 10

    def test_empty(self):
        text = _ladder_interpretation([], [])
        assert len(text) > 10

    def test_each_variant_unique(self):
        """All four interpretation variants are distinct."""
        both = _ladder_interpretation([1], [1])
        above = _ladder_interpretation([1], [])
        below = _ladder_interpretation([], [1])
        empty = _ladder_interpretation([], [])
        assert len({both, above, below, empty}) == 4


# ═══════════════════════════════════════════════════════════════════════════
# 12. Valuation section narrative
# ═══════════════════════════════════════════════════════════════════════════

class TestValuationSection:
    def test_eps_trajectory_with_growth(self):
        section = _build_section_valuation(130, _val(fy1=8.0, fy2=9.0, growth=0.125))
        assert "FY1" in section
        assert "FY2" in section
        assert "8.00" in section
        assert "9.00" in section
        assert "12.5%" in section

    def test_eps_trajectory_fy1_only(self):
        section = _build_section_valuation(130, _val(fy1=8.0, fy2=None, growth=None))
        assert "FY1" in section
        assert "\u6682\u4e0d\u53ef\u7528" in section  # FY2 unavailable

    def test_no_eps_no_trajectory_line(self):
        section = _build_section_valuation(130, _val(fy1=None, fy2=None, growth=None))
        assert "FY1" not in section

    def test_valuation_band_line(self):
        val = _val()
        val["adjusted_fair_value"] = {"low": 100, "high": 160}
        section = _build_section_valuation(130, val)
        assert "100.00" in section
        assert "160.00" in section
        assert "\u4e2d\u67a2" in section  # midpoint reference

    def test_no_band_no_band_line(self):
        val = _val()
        val["adjusted_fair_value"] = None
        section = _build_section_valuation(130, val)
        assert "\u4f30\u503c\u7eaa\u5f8b" not in section
