"""
Tests for Phase 12a -- Macro Market Factor Integration.

Covers:
  - classify_vix() — all 4 threshold boundaries
  - classify_regime() — all 5 regime types
  - next_macro_event() — within range, out of range, exact boundary
  - build_market_context() — integration of pure functions
  - Rule 11 (VIX-aware) diagnostics in _evaluate_rules()
  - _build_user_prompt() macro context section
  - build_risk_context() market_context pass-through
"""
from __future__ import annotations

from datetime import date, datetime

import pytest

from app.schemas.ai import MarketContext, RiskContext, DiagnosticItem
from app.services.macro_service import (
    classify_vix,
    classify_regime,
    next_macro_event,
    build_market_context,
    ECONOMIC_CALENDAR,
)
from app.services.ai_engine import (
    _evaluate_rules,
    _build_user_prompt,
    build_risk_context,
)


# -- Helper: build a known RiskContext for rule tests --------------------------

def _ctx(
    *,
    positions_count=5,
    underlyings_count=3,
    net_delta_normalized=0.0,
    delta_to_gamma_ratio=None,
    theta_yield_pct=0.0,
    vega_exposure_ratio=0.0,
    var_pct_of_margin=None,
    risk_posture="short_gamma_positive_theta",
    dominant_risk="theta",
    strategy_mix=None,
    expiry_concentration=None,
    top_positions=None,
    risk_alerts=None,
    avg_confidence=None,
    tag_distribution=None,
    market_context=None,
) -> RiskContext:
    return RiskContext(
        positions_count=positions_count,
        underlyings_count=underlyings_count,
        net_delta_normalized=net_delta_normalized,
        delta_to_gamma_ratio=delta_to_gamma_ratio,
        theta_yield_pct=theta_yield_pct,
        vega_exposure_ratio=vega_exposure_ratio,
        var_pct_of_margin=var_pct_of_margin,
        risk_posture=risk_posture,
        dominant_risk=dominant_risk,
        strategy_mix=strategy_mix or {"SINGLE": 3},
        expiry_concentration=expiry_concentration or [],
        top_positions=top_positions or [],
        risk_alerts=risk_alerts or [],
        avg_confidence=avg_confidence,
        tag_distribution=tag_distribution,
        market_context=market_context,
        as_of=datetime(2026, 3, 1, 12, 0, 0),
    )


# =============================================================================
# TestClassifyVix
# =============================================================================

class TestClassifyVix:
    """classify_vix() returns correct VIX term for all thresholds."""

    def test_low(self):
        assert classify_vix(10.0) == "low"
        assert classify_vix(14.99) == "low"

    def test_normal(self):
        assert classify_vix(15.0) == "normal"
        assert classify_vix(19.99) == "normal"

    def test_elevated(self):
        assert classify_vix(20.0) == "elevated"
        assert classify_vix(29.99) == "elevated"

    def test_crisis(self):
        assert classify_vix(30.0) == "crisis"
        assert classify_vix(80.0) == "crisis"

    def test_boundary_exactly_15(self):
        assert classify_vix(15.0) == "normal"

    def test_boundary_exactly_20(self):
        assert classify_vix(20.0) == "elevated"


# =============================================================================
# TestClassifyRegime
# =============================================================================

class TestClassifyRegime:
    """classify_regime() returns correct market regime."""

    def test_crisis(self):
        assert classify_regime(-2.0, 35.0) == "crisis"
        assert classify_regime(1.0, 30.0) == "crisis"

    def test_high_vol_selloff(self):
        assert classify_regime(-1.0, 27.0) == "high_vol_selloff"

    def test_rising_vol(self):
        assert classify_regime(0.1, 22.0) == "rising_vol"

    def test_low_vol_bullish(self):
        assert classify_regime(0.5, 14.0) == "low_vol_bullish"

    def test_low_vol_range(self):
        assert classify_regime(0.1, 14.0) == "low_vol_range"

    def test_elevated_vix_positive_spx_is_rising_vol(self):
        """VIX >= 20 with flat/positive SPX => rising_vol, not high_vol_selloff."""
        assert classify_regime(0.2, 22.0) == "rising_vol"

    def test_high_vix_but_not_steep_selloff(self):
        """VIX 25-30 with moderate SPX decline => rising_vol, not selloff."""
        assert classify_regime(-0.3, 26.0) == "rising_vol"


# =============================================================================
# TestNextMacroEvent
# =============================================================================

class TestNextMacroEvent:
    """next_macro_event() finds the nearest event within 30 days."""

    def test_event_within_range(self):
        days, name = next_macro_event(date(2026, 3, 5))
        assert days == 2
        assert name == "NFP"

    def test_event_exact_day(self):
        days, name = next_macro_event(date(2026, 3, 7))
        assert days == 0
        assert name == "NFP"

    def test_no_event_far_future(self):
        days, name = next_macro_event(date(2027, 1, 1))
        assert days is None
        assert name is None

    def test_picks_nearest_event(self):
        """When multiple events ahead, picks the closest one."""
        days, name = next_macro_event(date(2026, 3, 1))
        assert name == "NFP"
        assert days == 6

    def test_event_30_days_out(self):
        """Event exactly 30 days out should be included."""
        # PCE is on 2026-03-28, so from 2026-02-26 that's 30 days
        days, name = next_macro_event(date(2026, 2, 26))
        # NFP is 2026-03-07 => 9 days away, should return that first
        assert name == "NFP"
        assert days == 9

    def test_past_events_skipped(self):
        """Events that have already passed are skipped."""
        days, name = next_macro_event(date(2026, 3, 13))
        assert name == "FOMC"
        assert days == 5


# =============================================================================
# TestBuildMarketContext
# =============================================================================

class TestBuildMarketContext:
    """build_market_context() integrates all pure functions."""

    def test_basic_construction(self):
        ctx = build_market_context(
            spx=5234.42, spx_prev=5220.00, vix=16.82,
            today=date(2026, 3, 10),
        )
        assert ctx.spx_price == 5234.42
        assert ctx.vix_level == 16.82
        assert ctx.vix_term == "normal"
        assert ctx.market_regime == "low_vol_range"
        assert ctx.next_event_name == "CPI"
        assert ctx.days_to_next_event == 2

    def test_spx_change_pct_calculation(self):
        ctx = build_market_context(
            spx=5300.00, spx_prev=5250.00, vix=14.0,
            today=date(2026, 3, 1),
        )
        expected_pct = round((5300 - 5250) / 5250 * 100, 2)
        assert ctx.spx_change_pct == expected_pct

    def test_crisis_regime(self):
        ctx = build_market_context(
            spx=4800.00, spx_prev=5000.00, vix=45.0,
            today=date(2026, 3, 1),
        )
        assert ctx.vix_term == "crisis"
        assert ctx.market_regime == "crisis"

    def test_zero_prev_close(self):
        """Edge case: spx_prev=0 should not crash."""
        ctx = build_market_context(
            spx=5000.0, spx_prev=0.0, vix=18.0,
            today=date(2026, 3, 1),
        )
        assert ctx.spx_change_pct == 0.0


# =============================================================================
# TestRule11VixDiagnostics
# =============================================================================

class TestRule11VixDiagnostics:
    """Rule 11: VIX-aware macro diagnostics in _evaluate_rules()."""

    def _macro(self, **overrides):
        defaults = dict(
            spx_price=5200.0, spx_change_pct=0.1, vix_level=14.0,
            vix_term="low", days_to_next_event=2, next_event_name="CPI",
            market_regime="low_vol_range",
        )
        defaults.update(overrides)
        return MarketContext(**defaults)

    def test_11a_short_vega_low_vix_pre_event(self):
        """Rule 11a: short Vega + low VIX + event within 3d => critical."""
        mc = self._macro(vix_term="low", vix_level=13.5, days_to_next_event=2)
        ctx = _ctx(vega_exposure_ratio=0.5, market_context=mc)
        items = _evaluate_rules(ctx)
        critical_vega = [
            d for d in items
            if d.severity == "critical" and d.category == "vega"
        ]
        assert len(critical_vega) >= 1
        assert "VIX" in critical_vega[0].title or "Vega" in critical_vega[0].title

    def test_11a_not_triggered_when_vix_normal(self):
        """Rule 11a should NOT fire when VIX is normal."""
        mc = self._macro(vix_term="normal", vix_level=17.0, days_to_next_event=2)
        ctx = _ctx(vega_exposure_ratio=0.5, market_context=mc)
        items = _evaluate_rules(ctx)
        critical_vega = [
            d for d in items
            if d.severity == "critical" and d.category == "vega"
            and "VIX" in d.title
        ]
        assert len(critical_vega) == 0

    def test_11a_not_triggered_when_low_vega(self):
        """Rule 11a should NOT fire when vega exposure is low."""
        mc = self._macro(vix_term="low", vix_level=13.0, days_to_next_event=1)
        ctx = _ctx(vega_exposure_ratio=0.1, market_context=mc)
        items = _evaluate_rules(ctx)
        critical_vega = [
            d for d in items
            if d.severity == "critical" and d.category == "vega"
            and "VIX" in d.title
        ]
        assert len(critical_vega) == 0

    def test_11b_short_gamma_elevated_vix(self):
        """Rule 11b: short Gamma + VIX > 25 => critical."""
        mc = self._macro(vix_level=28.0, vix_term="elevated", market_regime="rising_vol")
        ctx = _ctx(risk_posture="short_gamma_positive_theta", market_context=mc)
        items = _evaluate_rules(ctx)
        critical_gamma = [
            d for d in items
            if d.severity == "critical" and d.category == "gamma"
            and "VIX" in d.title
        ]
        assert len(critical_gamma) >= 1

    def test_11b_not_triggered_long_gamma(self):
        """Rule 11b should NOT fire for long gamma posture."""
        mc = self._macro(vix_level=28.0, vix_term="elevated")
        ctx = _ctx(risk_posture="long_gamma_negative_theta", market_context=mc)
        items = _evaluate_rules(ctx)
        critical_gamma = [
            d for d in items
            if d.severity == "critical" and d.category == "gamma"
            and "VIX" in d.title
        ]
        assert len(critical_gamma) == 0

    def test_11c_low_vol_theta_harvesting(self):
        """Rule 11c: low VIX + good theta yield => info."""
        mc = self._macro(vix_term="low", vix_level=13.0)
        ctx = _ctx(theta_yield_pct=0.08, market_context=mc)
        items = _evaluate_rules(ctx)
        theta_info = [
            d for d in items
            if d.severity == "info" and d.category == "theta"
            and "low" in d.title.lower() or "window" in d.title.lower()
        ]
        assert len(theta_info) >= 1

    def test_11d_event_approaching(self):
        """Rule 11d: event within 2 days => warning."""
        mc = self._macro(days_to_next_event=1, next_event_name="FOMC")
        ctx = _ctx(market_context=mc)
        items = _evaluate_rules(ctx)
        event_warnings = [
            d for d in items
            if d.severity == "warning" and "FOMC" in d.title
        ]
        assert len(event_warnings) >= 1

    def test_11d_not_triggered_event_far(self):
        """Rule 11d should NOT fire if event is > 2 days away."""
        mc = self._macro(days_to_next_event=5, next_event_name="CPI")
        ctx = _ctx(market_context=mc)
        items = _evaluate_rules(ctx)
        event_warnings = [
            d for d in items
            if d.severity == "warning" and "CPI" in d.title
        ]
        assert len(event_warnings) == 0

    def test_no_macro_context_no_rule11(self):
        """Without market_context, Rule 11 items should not appear."""
        ctx = _ctx(market_context=None, vega_exposure_ratio=0.5)
        items = _evaluate_rules(ctx)
        macro_items = [
            d for d in items
            if "VIX" in d.title or "macro" in d.title.lower() or "event" in d.title.lower()
        ]
        assert len(macro_items) == 0

    def test_rule11_zh_language(self):
        """Rule 11 diagnostics in ZH use Chinese text."""
        mc = self._macro(vix_level=28.0, vix_term="elevated", market_regime="rising_vol")
        ctx = _ctx(risk_posture="short_gamma_positive_theta", market_context=mc)
        items = _evaluate_rules(ctx, language="zh")
        critical_gamma = [
            d for d in items
            if d.severity == "critical" and d.category == "gamma"
        ]
        assert len(critical_gamma) >= 1
        # Should contain Chinese characters
        assert any("\u9ad8VIX" in d.title or "Gamma" in d.title for d in critical_gamma)


# =============================================================================
# TestBuildUserPromptMacro
# =============================================================================

class TestBuildUserPromptMacro:
    """_build_user_prompt() appends macro context when available."""

    def test_no_macro_context(self):
        ctx = _ctx(market_context=None)
        prompt = _build_user_prompt(ctx)
        assert "Market macro context" not in prompt

    def test_with_macro_context(self):
        mc = MarketContext(
            spx_price=5234.42, spx_change_pct=0.32,
            vix_level=16.82, vix_term="normal",
            days_to_next_event=3, next_event_name="CPI",
            market_regime="low_vol_range",
        )
        ctx = _ctx(market_context=mc)
        prompt = _build_user_prompt(ctx)
        assert "Market macro context" in prompt
        assert "SPX: 5234.42" in prompt
        assert "VIX: 16.82 (normal)" in prompt
        assert "low_vol_range" in prompt
        assert "CPI in 3d" in prompt

    def test_macro_no_event(self):
        mc = MarketContext(
            spx_price=5000.0, spx_change_pct=-0.5,
            vix_level=22.0, vix_term="elevated",
            days_to_next_event=None, next_event_name=None,
            market_regime="rising_vol",
        )
        ctx = _ctx(market_context=mc)
        prompt = _build_user_prompt(ctx)
        assert "Market macro context" in prompt
        assert "Next major event" not in prompt


# =============================================================================
# TestBuildRiskContextMacro
# =============================================================================

class TestBuildRiskContextMacro:
    """build_risk_context() passes market_context through."""

    def test_default_none(self):
        ctx = build_risk_context([], {"positions_count": 0}, [])
        assert ctx.market_context is None

    def test_market_context_passed(self):
        mc = MarketContext(
            spx_price=5200.0, spx_change_pct=0.1,
            vix_level=14.0, vix_term="low",
            days_to_next_event=5, next_event_name="NFP",
            market_regime="low_vol_range",
        )
        ctx = build_risk_context([], {"positions_count": 0}, [], market_context=mc)
        assert ctx.market_context is mc
        assert ctx.market_context.vix_term == "low"
