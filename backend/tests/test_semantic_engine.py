"""
Semantic engine tests — validates all classification rules.

Covers:
  1. Trend state (above/below/near SMA200, ATR-aware, unavailable)
  2. MA alignment (bullish/bearish/mixed/unavailable)
  3. Valuation zone (undervalued/fair_value/overvalued/unavailable)
  4. Macro regime (supportive/mixed/restrictive/stressed/unavailable)
  5. Price location (priority ordering, breakout/breakdown precedence)
  6. Stance (macro veto, constructive, cautious, opportunistic)
  7. Risk state roll-up
  8. Flags
  9. Full integration via build_semantic_state
"""
from __future__ import annotations

import pytest
from unittest.mock import patch, AsyncMock

from app.services.rhino.semantic_engine import (
    build_semantic_state,
    _classify_trend,
    _classify_ma_alignment,
    _classify_price_location,
    _classify_valuation_zone,
    _classify_macro_regime,
    _classify_risk,
    _classify_stance,
    _build_flags,
)


# ── Helpers ────────────────────────────────────────────────────────────────

def _tech(sma30=None, sma100=None, sma200=None, atr20=None,
          support_zones=None, resistance_zones=None, **kw):
    return {
        "sma30": sma30, "sma100": sma100, "sma200": sma200,
        "atr20": atr20, "avg_volume_50": None,
        "today_volume": None, "volume_ratio": None,
        "support_zones": support_zones or [],
        "resistance_zones": resistance_zones or [],
        "pattern_tags": [],
        **kw,
    }


def _zone(center, lower=None, upper=None, strength=0.7):
    hw = (center * 0.01) if lower is None else (center - lower)
    return {
        "center": center,
        "lower": lower if lower is not None else center - hw,
        "upper": upper if upper is not None else center + hw,
        "strength": strength,
        "sources": ["test"],
    }


# ── 1. Trend state ────────────────────────────────────────────────────────

class TestTrendState:
    def test_above_sma200(self):
        assert _classify_trend(250, _tech(sma200=200, atr20=5)) == "above_sma200"

    def test_below_sma200(self):
        assert _classify_trend(150, _tech(sma200=200, atr20=5)) == "below_sma200"

    def test_near_sma200_atr_aware(self):
        # price=202, sma200=200, atr20=5 → distance 2 <= 1.5*5=7.5 → near
        assert _classify_trend(202, _tech(sma200=200, atr20=5)) == "near_sma200"

    def test_near_sma200_below_atr(self):
        # price=195, sma200=200, atr20=5 → distance 5 <= 7.5 → near
        assert _classify_trend(195, _tech(sma200=200, atr20=5)) == "near_sma200"

    def test_near_sma200_fallback_pct(self):
        # No ATR: distance 1 / 200 = 0.005 <= 0.01 → near
        assert _classify_trend(201, _tech(sma200=200)) == "near_sma200"

    def test_unavailable(self):
        assert _classify_trend(100, _tech()) == "unavailable"

    def test_not_near_with_atr(self):
        # price=220, sma200=200, atr20=5 → distance 20 > 7.5 → above
        assert _classify_trend(220, _tech(sma200=200, atr20=5)) == "above_sma200"


# ── 2. MA alignment ───────────────────────────────────────────────────────

class TestMaAlignment:
    def test_bullish(self):
        assert _classify_ma_alignment(110, _tech(sma30=105, sma100=100, sma200=95)) == "bullish_alignment"

    def test_bearish(self):
        assert _classify_ma_alignment(80, _tech(sma30=85, sma100=90, sma200=95)) == "bearish_alignment"

    def test_mixed(self):
        assert _classify_ma_alignment(100, _tech(sma30=95, sma100=105, sma200=90)) == "mixed_alignment"

    def test_unavailable_missing_sma(self):
        assert _classify_ma_alignment(100, _tech(sma30=95, sma100=90)) == "unavailable"
        assert _classify_ma_alignment(100, _tech(sma200=90)) == "unavailable"


# ── 3. Valuation zone ─────────────────────────────────────────────────────

class TestValuationZone:
    def test_deeply_undervalued(self):
        assert _classify_valuation_zone({"status": "deeply_undervalued"}) == "undervalued"

    def test_undervalued(self):
        assert _classify_valuation_zone({"status": "undervalued"}) == "undervalued"

    def test_fair_value(self):
        assert _classify_valuation_zone({"status": "fair_value"}) == "fair_value"

    def test_overvalued(self):
        assert _classify_valuation_zone({"status": "overvalued"}) == "overvalued"

    def test_deeply_overvalued(self):
        assert _classify_valuation_zone({"status": "deeply_overvalued"}) == "overvalued"

    def test_unavailable(self):
        assert _classify_valuation_zone({"status": "unavailable"}) == "unavailable"
        assert _classify_valuation_zone({}) == "unavailable"


# ── 4. Macro regime ───────────────────────────────────────────────────────

class TestMacroRegime:
    def test_supportive(self):
        macro = {"vix_regime": "calm", "rate_pressure_regime": "supportive"}
        assert _classify_macro_regime(macro) == "supportive"

    def test_supportive_normal_neutral(self):
        macro = {"vix_regime": "normal", "rate_pressure_regime": "neutral"}
        assert _classify_macro_regime(macro) == "supportive"

    def test_stressed_crisis(self):
        macro = {"vix_regime": "crisis", "rate_pressure_regime": "supportive"}
        assert _classify_macro_regime(macro) == "stressed"

    def test_restrictive_risk_elevated_restrictive(self):
        macro = {"vix_regime": "elevated", "rate_pressure_regime": "restrictive"}
        assert _classify_macro_regime(macro) == "restrictive_risk"

    def test_restrictive_risk_elevated_hostile(self):
        macro = {"vix_regime": "elevated", "rate_pressure_regime": "hostile"}
        assert _classify_macro_regime(macro) == "restrictive_risk"

    def test_mixed_macro(self):
        macro = {"vix_regime": "normal", "rate_pressure_regime": "restrictive"}
        assert _classify_macro_regime(macro) == "restrictive_risk"

    def test_calm_restrictive(self):
        macro = {"vix_regime": "calm", "rate_pressure_regime": "restrictive"}
        assert _classify_macro_regime(macro) == "restrictive_risk"

    def test_unavailable_both(self):
        macro = {"vix_regime": "unavailable", "rate_pressure_regime": "unavailable"}
        assert _classify_macro_regime(macro) == "unavailable"

    def test_elevated_alone(self):
        macro = {"vix_regime": "elevated", "rate_pressure_regime": "supportive"}
        assert _classify_macro_regime(macro) == "restrictive_risk"


# ── 5. Price location ─────────────────────────────────────────────────────

class TestPriceLocation:
    def test_breakout_zone_takes_precedence(self):
        tech = _tech(
            atr20=2,
            resistance_zones=[_zone(100, 99, 101)],
            support_zones=[_zone(90, 89, 91)],
        )
        # Price 105 > resistance upper 101 + threshold 1 → breakout
        assert _classify_price_location(105, tech) == "breakout_zone"

    def test_breakdown_risk_takes_precedence(self):
        tech = _tech(
            atr20=2,
            support_zones=[_zone(100, 99, 101)],
            resistance_zones=[_zone(110, 109, 111)],
        )
        # Price 97 < support lower 99 - threshold 1 → breakdown
        assert _classify_price_location(97, tech) == "breakdown_risk"

    def test_near_resistance(self):
        tech = _tech(
            atr20=2,
            resistance_zones=[_zone(100, 99, 101)],
            support_zones=[_zone(90, 89, 91)],
        )
        # Price 100.5 within threshold of resistance center 100
        assert _classify_price_location(100.5, tech) == "near_resistance"

    def test_near_support(self):
        tech = _tech(
            atr20=2,
            support_zones=[_zone(100, 99, 101)],
            resistance_zones=[_zone(120, 119, 121)],
        )
        # Price 99.5 within threshold of support center 100
        assert _classify_price_location(99.5, tech) == "near_support"

    def test_mid_range(self):
        tech = _tech(
            atr20=2,
            support_zones=[_zone(90, 89, 91)],
            resistance_zones=[_zone(110, 109, 111)],
        )
        # Price 100, far from both zones
        assert _classify_price_location(100, tech) == "mid_range"

    def test_unavailable_no_zones(self):
        assert _classify_price_location(100, _tech()) == "unavailable"

    def test_near_resistance_beats_near_support_when_overlapping(self):
        # Narrow range: both zones are close. Resistance is checked first.
        tech = _tech(
            atr20=3,
            resistance_zones=[_zone(101, 100, 102)],
            support_zones=[_zone(99, 98, 100)],
        )
        # Price 100.5 is within threshold of resistance center 101
        assert _classify_price_location(100.5, tech) == "near_resistance"


# ── 6. Stance ─────────────────────────────────────────────────────────────

class TestStance:
    def test_constructive(self):
        result = _classify_stance(
            trend="above_sma200",
            alignment="bullish_alignment",
            location="mid_range",
            val_zone="fair_value",
            macro_regime="supportive",
            flags=["trend_strong", "ma_bullish"],
        )
        assert result == "constructive"

    def test_defensive_via_stressed_macro(self):
        # Macro veto overrides everything
        result = _classify_stance(
            trend="above_sma200",
            alignment="bullish_alignment",
            location="mid_range",
            val_zone="undervalued",
            macro_regime="stressed",
            flags=[],
        )
        assert result == "defensive"

    def test_cautious_via_restrictive_bullish(self):
        result = _classify_stance(
            trend="above_sma200",
            alignment="bullish_alignment",
            location="mid_range",
            val_zone="fair_value",
            macro_regime="restrictive_risk",
            flags=[],
        )
        assert result == "cautious"

    def test_defensive_bearish_restrictive(self):
        result = _classify_stance(
            trend="below_sma200",
            alignment="bearish_alignment",
            location="mid_range",
            val_zone="overvalued",
            macro_regime="restrictive_risk",
            flags=[],
        )
        assert result == "defensive"

    def test_opportunistic_near_support(self):
        result = _classify_stance(
            trend="below_sma200",
            alignment="mixed_alignment",
            location="near_support",
            val_zone="undervalued",
            macro_regime="mixed_macro",
            flags=["price_near_support", "valuation_reasonable"],
        )
        assert result == "opportunistic"

    def test_neutral_default(self):
        result = _classify_stance(
            trend="above_sma200",
            alignment="mixed_alignment",
            location="mid_range",
            val_zone="fair_value",
            macro_regime="supportive",
            flags=[],
        )
        assert result == "neutral"


# ── 7. Risk state ─────────────────────────────────────────────────────────

class TestRiskState:
    def test_low_risk(self):
        assert _classify_risk("above_sma200", "bullish_alignment", "mid_range",
                              "fair_value", "supportive") == "low"

    def test_high_risk(self):
        assert _classify_risk("below_sma200", "bearish_alignment", "breakdown_risk",
                              "overvalued", "stressed") == "high"

    def test_elevated_risk(self):
        assert _classify_risk("below_sma200", "bearish_alignment", "mid_range",
                              "fair_value", "mixed_macro") == "elevated"

    def test_moderate_risk(self):
        assert _classify_risk("near_sma200", "mixed_alignment", "mid_range",
                              "fair_value", "supportive") == "moderate"


# ── 8. Flags ──────────────────────────────────────────────────────────────

class TestFlags:
    def test_trend_strong_flag(self):
        flags = _build_flags("above_sma200", "bullish_alignment", "mid_range",
                             "fair_value", "supportive")
        assert "trend_strong" in flags
        assert "macro_supportive" in flags
        assert "ma_bullish" in flags

    def test_bearish_flags(self):
        flags = _build_flags("below_sma200", "bearish_alignment", "near_resistance",
                             "overvalued", "stressed")
        assert "trend_weak" in flags
        assert "price_near_resistance" in flags
        assert "valuation_expensive" in flags
        assert "macro_restrictive" in flags
        assert "ma_bearish" in flags

    def test_near_support_flag(self):
        flags = _build_flags("near_sma200", "mixed_alignment", "near_support",
                             "undervalued", "mixed_macro")
        assert "price_near_support" in flags
        assert "valuation_reasonable" in flags


# ── 9. Full integration ──────────────────────────────────────────────────

class TestBuildSemanticState:
    def test_complete_output(self):
        tech = _tech(sma30=105, sma100=100, sma200=95, atr20=3)
        val = {"status": "fair_value", "available": True}
        macro = {"vix_regime": "calm", "rate_pressure_regime": "supportive"}
        result = build_semantic_state(110, tech, val, macro)

        # All keys present
        assert set(result.keys()) == {
            "trend_state", "ma_alignment", "price_location",
            "valuation_zone", "macro_regime", "risk_state",
            "stance", "flags",
        }
        # All values are serializable
        import json
        json.dumps(result)  # should not raise

    def test_bullish_scenario(self):
        tech = _tech(sma30=105, sma100=100, sma200=95, atr20=3)
        val = {"status": "undervalued", "available": True}
        macro = {"vix_regime": "calm", "rate_pressure_regime": "supportive"}
        result = build_semantic_state(110, tech, val, macro)

        assert result["trend_state"] == "above_sma200"
        assert result["ma_alignment"] == "bullish_alignment"
        assert result["valuation_zone"] == "undervalued"
        assert result["macro_regime"] == "supportive"
        assert result["stance"] == "constructive"
        assert result["risk_state"] == "low"

    def test_stressed_scenario(self):
        tech = _tech(sma30=90, sma100=95, sma200=100, atr20=5)
        val = {"status": "overvalued", "available": True}
        macro = {"vix_regime": "crisis", "rate_pressure_regime": "hostile"}
        result = build_semantic_state(85, tech, val, macro)

        assert result["trend_state"] == "below_sma200"
        assert result["ma_alignment"] == "bearish_alignment"
        assert result["macro_regime"] == "stressed"
        assert result["stance"] == "defensive"
        assert result["risk_state"] == "high"

    def test_degraded_data(self):
        tech = _tech()
        val = {"status": "unavailable"}
        macro = {"vix_regime": "unavailable", "rate_pressure_regime": "unavailable"}
        result = build_semantic_state(100, tech, val, macro)

        assert result["trend_state"] == "unavailable"
        assert result["ma_alignment"] == "unavailable"
        assert result["valuation_zone"] == "unavailable"
        assert result["macro_regime"] == "unavailable"
        assert result["stance"] == "neutral"


class TestSemanticInAnalyze:
    """Integration: semantic section appears in full analysis response."""

    @pytest.mark.asyncio
    async def test_response_contains_semantic(self):
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

        assert "semantic" in result
        sem = result["semantic"]
        assert set(sem.keys()) == {
            "trend_state", "ma_alignment", "price_location",
            "valuation_zone", "macro_regime", "risk_state",
            "stance", "flags",
        }
        assert isinstance(sem["flags"], list)
        assert sem["trend_state"] != "unavailable"  # 250 bars → SMA200 available

    @pytest.mark.asyncio
    async def test_degraded_has_semantic(self):
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

        assert "semantic" in result
        assert result["semantic"]["stance"] == "neutral"
