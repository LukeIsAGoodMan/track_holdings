"""
Scenario engine tests — validates priority-based scenario classification.

Covers:
  1. Priority I:   Defensive override (risk_state high, macro stressed)
  2. Priority II:  Macro headwind (restrictive + overvalued/cautious)
  3. Priority III: Technical setups (trend_pullback, bullish_breakout, mean_reversion)
  4. Fallback:     neutral
  5. Confidence:   high / moderate / low assignment
  6. Integration:  semantic → scenario → narrative pipeline
"""
from __future__ import annotations

import pytest
from unittest.mock import patch, AsyncMock

from app.services.rhino.scenario_engine import build_scenario_state, SCENARIOS


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


# ── 1. Priority I — Defensive override ────────────────────────────────────

class TestDefensiveOverride:
    def test_high_risk_triggers_defensive(self):
        result = _build(risk_state="high")
        assert result["scenario"] == "defensive"

    def test_stressed_macro_triggers_defensive(self):
        result = _build(macro_regime="stressed")
        assert result["scenario"] == "defensive"

    def test_both_high_risk_and_stressed_gives_high_confidence(self):
        result = _build(risk_state="high", macro_regime="stressed")
        assert result["scenario"] == "defensive"
        assert result["confidence"] == "high"

    def test_high_risk_alone_gives_moderate_confidence(self):
        result = _build(risk_state="high", macro_regime="supportive")
        assert result["scenario"] == "defensive"
        assert result["confidence"] == "moderate"

    def test_stressed_alone_gives_moderate_confidence(self):
        result = _build(macro_regime="stressed", risk_state="low")
        assert result["scenario"] == "defensive"
        assert result["confidence"] == "moderate"

    def test_defensive_overrides_bullish_technical(self):
        """Defensive must override even a constructive technical setup."""
        result = _build(
            risk_state="high",
            trend_state="above_sma200",
            price_location="breakout_zone",
        )
        assert result["scenario"] == "defensive"


# ── 2. Priority II — Macro headwind ──────────────────────────────────────

class TestMacroHeadwind:
    def test_restrictive_plus_overvalued(self):
        result = _build(macro_regime="restrictive_risk", valuation_zone="overvalued")
        assert result["scenario"] == "macro_headwind"
        assert result["confidence"] == "high"

    def test_restrictive_plus_cautious_stance(self):
        result = _build(macro_regime="restrictive_risk", stance="cautious")
        assert result["scenario"] == "macro_headwind"
        assert result["confidence"] == "moderate"

    def test_restrictive_without_overvalued_or_cautious_falls_through(self):
        """Restrictive alone without overvalued/cautious doesn't trigger macro_headwind."""
        result = _build(
            macro_regime="restrictive_risk",
            valuation_zone="fair_value",
            stance="neutral",
        )
        assert result["scenario"] != "macro_headwind"

    def test_defensive_takes_priority_over_macro_headwind(self):
        result = _build(
            risk_state="high",
            macro_regime="restrictive_risk",
            valuation_zone="overvalued",
        )
        assert result["scenario"] == "defensive"


# ── 3. Priority III — Technical setups ────────────────────────────────────

class TestTrendPullback:
    def test_above_sma200_near_support(self):
        result = _build(
            trend_state="above_sma200",
            price_location="near_support",
        )
        assert result["scenario"] == "trend_pullback"

    def test_trend_pullback_with_undervalued_gives_high_confidence(self):
        result = _build(
            trend_state="above_sma200",
            price_location="near_support",
            valuation_zone="undervalued",
        )
        assert result["scenario"] == "trend_pullback"
        assert result["confidence"] == "high"

    def test_trend_pullback_without_undervalued_gives_moderate(self):
        result = _build(
            trend_state="above_sma200",
            price_location="near_support",
            valuation_zone="fair_value",
        )
        assert result["scenario"] == "trend_pullback"
        assert result["confidence"] == "moderate"


class TestBullishBreakout:
    def test_above_sma200_breakout_zone(self):
        result = _build(
            trend_state="above_sma200",
            price_location="breakout_zone",
        )
        assert result["scenario"] == "bullish_breakout"

    def test_bullish_breakout_with_bullish_alignment_gives_high(self):
        result = _build(
            trend_state="above_sma200",
            price_location="breakout_zone",
            ma_alignment="bullish_alignment",
        )
        assert result["scenario"] == "bullish_breakout"
        assert result["confidence"] == "high"

    def test_bullish_breakout_without_alignment_gives_moderate(self):
        result = _build(
            trend_state="above_sma200",
            price_location="breakout_zone",
            ma_alignment="mixed_alignment",
        )
        assert result["scenario"] == "bullish_breakout"
        assert result["confidence"] == "moderate"


class TestMeanReversion:
    def test_below_sma200_near_support_not_overvalued(self):
        result = _build(
            trend_state="below_sma200",
            price_location="near_support",
            valuation_zone="fair_value",
        )
        assert result["scenario"] == "mean_reversion"

    def test_mean_reversion_blocked_if_overvalued(self):
        result = _build(
            trend_state="below_sma200",
            price_location="near_support",
            valuation_zone="overvalued",
        )
        assert result["scenario"] != "mean_reversion"

    def test_mean_reversion_undervalued_gives_high_confidence(self):
        result = _build(
            trend_state="below_sma200",
            price_location="near_support",
            valuation_zone="undervalued",
        )
        assert result["scenario"] == "mean_reversion"
        assert result["confidence"] == "high"


# ── 4. Neutral fallback ──────────────────────────────────────────────────

class TestNeutralFallback:
    def test_default_is_neutral(self):
        result = _build()
        assert result["scenario"] == "neutral"
        assert result["confidence"] == "low"

    def test_above_sma200_mid_range_is_neutral(self):
        result = _build(
            trend_state="above_sma200",
            price_location="mid_range",
        )
        assert result["scenario"] == "neutral"

    def test_below_sma200_mid_range_is_neutral(self):
        result = _build(
            trend_state="below_sma200",
            price_location="mid_range",
        )
        assert result["scenario"] == "neutral"


# ── 5. Output validation ─────────────────────────────────────────────────

class TestOutputContract:
    def test_return_dict_has_required_keys(self):
        result = _build()
        assert "scenario" in result
        assert "confidence" in result

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
            assert result["scenario"] in SCENARIOS, f"Invalid scenario: {result['scenario']} for {kw}"
            assert result["confidence"] in {"high", "moderate", "low"}

    def test_defensive_access_on_empty_semantic(self):
        """Engine handles completely empty semantic dict without crash."""
        result = build_scenario_state({}, _tech(), _val(), _macro(), _playbook())
        assert result["scenario"] == "neutral"
        assert result["confidence"] == "low"


# ── 6. Integration: full pipeline ─────────────────────────────────────────

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
        assert sc["scenario"] in SCENARIOS
        assert sc["confidence"] in {"high", "moderate", "low"}

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

    def test_scenario_feeds_into_narrative_summary(self):
        """Scenario context appears in narrative summary."""
        from app.services.rhino.narrative_engine import build_rhino_narrative

        sem = _sem(
            trend_state="above_sma200",
            price_location="near_support",
        )
        scenario = build_scenario_state(sem, _tech(), _val(), _macro(), _playbook())
        assert scenario["scenario"] == "trend_pullback"

        narr = build_rhino_narrative(
            "MSFT", 150, _tech(), _val(), _macro(), sem, _playbook(),
            scenario=scenario,
        )
        # Scenario context line should be prepended to summary
        assert "pulled back" in narr["summary"].lower() or "support" in narr["summary"].lower()
