"""
Scenario engine tests — validates priority-based scenario classification.

Covers:
  1. Priority I:   Defensive override (risk_state high, macro stressed)
  2. Priority II:  Macro headwind (restrictive + overvalued/cautious)
  3. Priority III: Technical setups (trend_pullback, bullish_breakout, mean_reversion)
  4. Fallback:     neutral
  5. Confidence:   high / moderate / low assignment
  6. ScenarioResult schema (NamedTuple fields, constraints, regime, setup)
  7. Integration:  semantic → scenario → narrative pipeline
"""
from __future__ import annotations

import pytest
from unittest.mock import patch, AsyncMock

from app.services.rhino.scenario_engine import (
    build_scenario_state, ScenarioResult, SCENARIOS, NEUTRAL_SCENARIO,
)


# ── Helpers ────────────────────────────────────────────────────────────────

def _sem(**kw):
    base = {
        "trend_state": "above_sma200", "ma_alignment": "mixed_alignment",
        "price_location": "mid_range", "valuation_zone": "fair_value",
        "macro_regime": "supportive", "risk_state": "low",
        "stance": "neutral", "flags": [],
    }
    base.update(kw)
    return base


def _tech():
    return {
        "sma30": None, "sma100": None, "sma200": None,
        "atr20": None, "avg_volume_50": None,
        "today_volume": None, "volume_ratio": None,
        "support_zones": [], "resistance_zones": [],
        "pattern_tags": [],
    }


def _val():
    return {"available": True, "status": "fair_value"}


def _macro():
    return {"vix_level": 18, "vix_regime": "normal"}


def _playbook():
    return {"bias_tag": "neutral", "action_tag": "hold_watch", "rationale": []}


def _build(**sem_kw):
    """Shortcut: build scenario from semantic overrides."""
    return build_scenario_state(_sem(**sem_kw), _tech(), _val(), _macro(), _playbook())


# ── 0. ScenarioResult schema ───────────────────────────────────────────────

class TestScenarioResultSchema:
    def test_is_namedtuple(self):
        result = _build()
        assert isinstance(result, tuple)
        assert isinstance(result, ScenarioResult)

    def test_has_six_fields(self):
        result = _build()
        assert len(result) == 6
        assert hasattr(result, "scenario")
        assert hasattr(result, "regime")
        assert hasattr(result, "setup")
        assert hasattr(result, "bias")
        assert hasattr(result, "confidence")
        assert hasattr(result, "constraints")

    def test_immutable(self):
        result = _build()
        with pytest.raises(AttributeError):
            result.scenario = "other"

    def test_constraints_is_tuple(self):
        result = _build(risk_state="high")
        assert isinstance(result.constraints, tuple)

    def test_asdict_returns_dict(self):
        result = _build()
        d = result._asdict()
        assert isinstance(d, dict)
        assert "scenario" in d
        assert "constraints" in d

    def test_neutral_scenario_constant(self):
        assert NEUTRAL_SCENARIO.scenario == "neutral"
        assert NEUTRAL_SCENARIO.confidence == "low"
        assert NEUTRAL_SCENARIO.constraints == ()
        assert NEUTRAL_SCENARIO.regime == "unavailable"
        assert NEUTRAL_SCENARIO.setup == "default"
        assert NEUTRAL_SCENARIO.bias == "neutral"


# ── 1. Priority I — Defensive override ────────────────────────────────────

class TestDefensiveOverride:
    def test_high_risk_triggers_defensive(self):
        result = _build(risk_state="high")
        assert result.scenario == "defensive"

    def test_stressed_macro_triggers_defensive(self):
        result = _build(macro_regime="stressed")
        assert result.scenario == "defensive"

    def test_both_high_risk_and_stressed_gives_high_confidence(self):
        result = _build(risk_state="high", macro_regime="stressed")
        assert result.scenario == "defensive"
        assert result.confidence == "high"

    def test_high_risk_alone_gives_moderate_confidence(self):
        result = _build(risk_state="high", macro_regime="supportive")
        assert result.scenario == "defensive"
        assert result.confidence == "moderate"

    def test_stressed_alone_gives_moderate_confidence(self):
        result = _build(macro_regime="stressed", risk_state="low")
        assert result.scenario == "defensive"
        assert result.confidence == "moderate"

    def test_defensive_overrides_bullish_technical(self):
        """Defensive must override even a constructive technical setup."""
        result = _build(
            risk_state="high",
            trend_state="above_sma200",
            price_location="breakout_zone",
        )
        assert result.scenario == "defensive"

    def test_defensive_constraints_both(self):
        result = _build(risk_state="high", macro_regime="stressed")
        assert "risk_high" in result.constraints
        assert "macro_stress" in result.constraints

    def test_defensive_constraints_risk_only(self):
        result = _build(risk_state="high", macro_regime="supportive")
        assert "risk_high" in result.constraints
        assert "macro_stress" not in result.constraints


# ── 2. Priority II — Macro headwind ──────────────────────────────────────

class TestMacroHeadwind:
    def test_restrictive_plus_overvalued(self):
        result = _build(macro_regime="restrictive_risk", valuation_zone="overvalued")
        assert result.scenario == "macro_headwind"
        assert result.confidence == "high"

    def test_restrictive_plus_cautious_stance(self):
        result = _build(macro_regime="restrictive_risk", stance="cautious")
        assert result.scenario == "macro_headwind"
        assert result.confidence == "moderate"

    def test_restrictive_without_overvalued_or_cautious_falls_through(self):
        """Restrictive alone without overvalued/cautious doesn't trigger macro_headwind."""
        result = _build(
            macro_regime="restrictive_risk",
            valuation_zone="fair_value",
            stance="neutral",
        )
        assert result.scenario != "macro_headwind"

    def test_defensive_takes_priority_over_macro_headwind(self):
        result = _build(
            risk_state="high",
            macro_regime="restrictive_risk",
            valuation_zone="overvalued",
        )
        assert result.scenario == "defensive"

    def test_macro_headwind_regime_field(self):
        result = _build(macro_regime="restrictive_risk", valuation_zone="overvalued")
        assert result.regime == "restrictive_overvalued"


# ── 3. Priority III — Technical setups ────────────────────────────────────

class TestTrendPullback:
    def test_above_sma200_near_support(self):
        result = _build(
            trend_state="above_sma200",
            price_location="near_support",
        )
        assert result.scenario == "trend_pullback"

    def test_trend_pullback_with_undervalued_gives_high_confidence(self):
        result = _build(
            trend_state="above_sma200",
            price_location="near_support",
            valuation_zone="undervalued",
        )
        assert result.scenario == "trend_pullback"
        assert result.confidence == "high"

    def test_trend_pullback_without_undervalued_gives_moderate(self):
        result = _build(
            trend_state="above_sma200",
            price_location="near_support",
            valuation_zone="fair_value",
        )
        assert result.scenario == "trend_pullback"
        assert result.confidence == "moderate"


class TestBullishBreakout:
    def test_above_sma200_breakout_zone(self):
        result = _build(
            trend_state="above_sma200",
            price_location="breakout_zone",
        )
        assert result.scenario == "bullish_breakout"

    def test_bullish_breakout_with_bullish_alignment_gives_high(self):
        result = _build(
            trend_state="above_sma200",
            price_location="breakout_zone",
            ma_alignment="bullish_alignment",
        )
        assert result.scenario == "bullish_breakout"
        assert result.confidence == "high"

    def test_bullish_breakout_without_alignment_gives_moderate(self):
        result = _build(
            trend_state="above_sma200",
            price_location="breakout_zone",
            ma_alignment="mixed_alignment",
        )
        assert result.scenario == "bullish_breakout"
        assert result.confidence == "moderate"

    def test_bullish_breakout_setup_field(self):
        result = _build(
            trend_state="above_sma200",
            price_location="breakout_zone",
        )
        assert result.setup == "momentum_breakout"


class TestMeanReversion:
    def test_below_sma200_near_support_not_overvalued(self):
        result = _build(
            trend_state="below_sma200",
            price_location="near_support",
            valuation_zone="fair_value",
        )
        assert result.scenario == "mean_reversion"

    def test_mean_reversion_blocked_if_overvalued(self):
        result = _build(
            trend_state="below_sma200",
            price_location="near_support",
            valuation_zone="overvalued",
        )
        assert result.scenario != "mean_reversion"

    def test_mean_reversion_undervalued_gives_high_confidence(self):
        result = _build(
            trend_state="below_sma200",
            price_location="near_support",
            valuation_zone="undervalued",
        )
        assert result.scenario == "mean_reversion"
        assert result.confidence == "high"

    def test_mean_reversion_setup_field(self):
        result = _build(
            trend_state="below_sma200",
            price_location="near_support",
            valuation_zone="fair_value",
        )
        assert result.setup == "below_support"


# ── 4. Neutral fallback ──────────────────────────────────────────────────

class TestNeutralFallback:
    def test_default_is_neutral(self):
        result = _build()
        assert result.scenario == "neutral"
        assert result.confidence == "low"

    def test_above_sma200_mid_range_is_neutral(self):
        result = _build(
            trend_state="above_sma200",
            price_location="mid_range",
        )
        assert result.scenario == "neutral"

    def test_below_sma200_mid_range_is_neutral(self):
        result = _build(
            trend_state="below_sma200",
            price_location="mid_range",
        )
        assert result.scenario == "neutral"


# ── 5. Output validation ─────────────────────────────────────────────────

class TestOutputContract:
    def test_return_has_required_attributes(self):
        result = _build()
        assert hasattr(result, "scenario")
        assert hasattr(result, "confidence")
        assert hasattr(result, "regime")
        assert hasattr(result, "setup")
        assert hasattr(result, "bias")
        assert hasattr(result, "constraints")

    def test_all_scenarios_are_valid(self):
        """Every returned scenario must be in the allowed set."""
        test_cases = [
            {},
            {"risk_state": "high"},
            {"macro_regime": "stressed"},
            {"macro_regime": "restrictive_risk", "valuation_zone": "overvalued"},
            {"trend_state": "above_sma200", "price_location": "near_support"},
            {"trend_state": "above_sma200", "price_location": "breakout_zone"},
            {"trend_state": "below_sma200", "price_location": "near_support"},
        ]
        for kw in test_cases:
            result = _build(**kw)
            assert result.scenario in SCENARIOS, f"Invalid scenario: {result.scenario} for {kw}"
            assert result.confidence in {"high", "moderate", "low"}

    def test_defensive_access_on_empty_semantic(self):
        """Engine handles completely empty semantic dict without crash."""
        result = build_scenario_state({}, _tech(), _val(), _macro(), _playbook())
        assert result.scenario == "neutral"
        assert result.confidence == "low"


# ── 6. Regime and setup fields ────────────────────────────────────────────

class TestRegimeField:
    def test_supportive_regime(self):
        result = _build(macro_regime="supportive")
        assert result.regime == "supportive"

    def test_mixed_regime(self):
        result = _build(macro_regime="mixed_macro")
        assert result.regime == "mixed"

    def test_stressed_regime(self):
        result = _build(macro_regime="stressed")
        assert result.regime == "stressed"

    def test_restrictive_overvalued_regime(self):
        result = _build(macro_regime="restrictive_risk", valuation_zone="overvalued")
        assert result.regime == "restrictive_overvalued"

    def test_restrictive_fair_regime(self):
        result = _build(macro_regime="restrictive_risk", valuation_zone="fair_value",
                        stance="cautious")
        assert result.regime == "restrictive_fair"

    def test_unavailable_regime(self):
        result = _build(macro_regime="unknown_thing")
        assert result.regime == "unavailable"


class TestSetupField:
    def test_risk_breakdown_setup(self):
        result = _build(risk_state="high", price_location="breakdown_risk")
        assert result.setup == "risk_breakdown"

    def test_momentum_breakout_setup(self):
        result = _build(trend_state="above_sma200", price_location="breakout_zone")
        assert result.setup == "momentum_breakout"

    def test_below_support_setup(self):
        result = _build(trend_state="below_sma200", price_location="near_support")
        assert result.setup == "below_support"

    def test_above_resistance_setup(self):
        result = _build(trend_state="above_sma200", price_location="near_resistance")
        assert result.setup == "above_resistance"

    def test_above_trend_setup(self):
        result = _build(trend_state="above_sma200", price_location="mid_range")
        assert result.setup == "above_trend"

    def test_default_setup_on_unknown(self):
        result = _build(trend_state="unknown")
        assert result.setup == "default"


class TestConstraints:
    def test_risk_high_constraint(self):
        result = _build(risk_state="high")
        assert "risk_high" in result.constraints

    def test_macro_stress_constraint(self):
        result = _build(macro_regime="stressed")
        assert "macro_stress" in result.constraints

    def test_val_support_constraint(self):
        result = _build(valuation_zone="undervalued", price_location="near_support")
        assert "val_support" in result.constraints

    def test_no_constraints_on_neutral(self):
        result = _build()
        assert result.constraints == ()


# ── 7. Integration: full pipeline ─────────────────────────────────────────

class TestScenarioIntegration:
    @pytest.mark.asyncio
    async def test_analyze_response_contains_scenario(self):
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

        assert "scenario" in result
        sc = result["scenario"]
        # After _asdict(), it's a plain dict in the API response
        assert sc["scenario"] in SCENARIOS
        assert sc["confidence"] in {"high", "moderate", "low"}
        assert "regime" in sc
        assert "setup" in sc
        assert "bias" in sc
        assert "constraints" in sc

    @pytest.mark.asyncio
    async def test_degraded_response_has_neutral_scenario(self):
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

        assert result["scenario"]["scenario"] == "neutral"
        assert result["scenario"]["confidence"] == "low"
        assert result["scenario"]["constraints"] == ()

    def test_scenario_feeds_into_narrative_summary(self):
        """Scenario context appears in narrative summary."""
        from app.services.rhino.narrative_engine import build_rhino_narrative

        sem = _sem(
            trend_state="above_sma200",
            price_location="near_support",
        )
        scenario = build_scenario_state(sem, _tech(), _val(), _macro(), _playbook())
        assert scenario.scenario == "trend_pullback"

        narr = build_rhino_narrative(
            "MSFT", 150, _tech(), _val(), _macro(), sem, _playbook(),
            scenario=scenario,
        )
        # Scenario context line should be prepended to summary
        assert "pulled back" in narr["summary"].lower() or "support" in narr["summary"].lower()
