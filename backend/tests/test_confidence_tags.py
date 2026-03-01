"""
Tests for Phase 10.5 -- Confidence Record & Strategy Tag System.

Covers:
  - compute_confidence_stats() pure function
  - strategy_tags validation (VALID_STRATEGY_TAGS)
  - avg_confidence and tag_distribution in RiskContext
  - Low confidence diagnostic rule
  - build_risk_context passthrough of confidence data
  - TradeUpdate schema validation
"""
from __future__ import annotations

from datetime import datetime

import pytest

from app.schemas.ai import RiskContext
from app.schemas.trade import TradeUpdate, VALID_STRATEGY_TAGS
from app.services.ai_engine import (
    _evaluate_rules,
    build_risk_context,
    compute_confidence_stats,
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
        as_of=datetime(2026, 3, 1, 12, 0, 0),
    )


# -- Minimal risk_summary for build_risk_context tests ------------------------

def _risk_summary(**overrides) -> dict:
    base = {
        "total_net_delta": 0,
        "total_gamma": 0,
        "total_theta_daily": 0,
        "total_vega": 0,
        "maintenance_margin_total": 0,
        "var_1d_95": None,
        "positions_count": 0,
        "risk_alerts": [],
        "expiry_buckets": [],
        "top_efficient_symbol": None,
        "sector_exposure": {},
    }
    base.update(overrides)
    return base


# =============================================================================
# TestComputeConfidenceStats -- pure function tests
# =============================================================================

class TestComputeConfidenceStats:
    """compute_confidence_stats() -- pure function, no DB."""

    def test_empty_list_returns_nones(self):
        avg, tags = compute_confidence_stats([])
        assert avg is None
        assert tags is None

    def test_all_none_metadata(self):
        avg, tags = compute_confidence_stats([None, None])
        assert avg is None
        assert tags is None

    def test_empty_dicts(self):
        avg, tags = compute_confidence_stats([{}, {}])
        assert avg is None
        assert tags is None

    def test_single_score(self):
        avg, tags = compute_confidence_stats([{"confidence_score": 4}])
        assert avg == 4.0
        assert tags is None

    def test_average_calculation(self):
        metas = [
            {"confidence_score": 5},
            {"confidence_score": 3},
            {"confidence_score": 4},
        ]
        avg, tags = compute_confidence_stats(metas)
        assert avg == 4.0

    def test_tag_distribution(self):
        metas = [
            {"strategy_tags": ["Hedge", "Income"]},
            {"strategy_tags": ["Hedge"]},
            {"strategy_tags": ["Wheel"]},
        ]
        avg, tags = compute_confidence_stats(metas)
        assert avg is None
        assert tags == {"Hedge": 2, "Income": 1, "Wheel": 1}

    def test_mixed_metadata(self):
        metas = [
            {"confidence_score": 5, "strategy_tags": ["Hedge"]},
            {"confidence_score": 3, "strategy_tags": ["Income"]},
            {},
            None,
        ]
        avg, tags = compute_confidence_stats(metas)
        assert avg == 4.0
        assert tags == {"Hedge": 1, "Income": 1}

    def test_float_score_treated_as_int(self):
        avg, tags = compute_confidence_stats([{"confidence_score": 3.7}])
        assert avg == 3.0  # int() truncates

    def test_invalid_score_type_ignored(self):
        avg, tags = compute_confidence_stats([
            {"confidence_score": "high"},
            {"confidence_score": 4},
        ])
        assert avg == 4.0  # only valid score counted


# =============================================================================
# TestRiskContextConfidenceFields
# =============================================================================

class TestRiskContextConfidenceFields:
    """RiskContext schema includes confidence fields with backward compat."""

    def test_default_none(self):
        ctx = _ctx()
        assert ctx.avg_confidence is None
        assert ctx.tag_distribution is None

    def test_populated(self):
        ctx = _ctx(avg_confidence=3.5, tag_distribution={"Hedge": 2})
        assert ctx.avg_confidence == 3.5
        assert ctx.tag_distribution == {"Hedge": 2}


# =============================================================================
# TestBuildRiskContextConfidence
# =============================================================================

class TestBuildRiskContextConfidence:
    """build_risk_context passes through confidence data."""

    def test_without_confidence(self):
        ctx = build_risk_context([], _risk_summary(), [])
        assert ctx.avg_confidence is None
        assert ctx.tag_distribution is None

    def test_with_confidence(self):
        ctx = build_risk_context(
            [], _risk_summary(), [],
            avg_confidence=4.2,
            tag_distribution={"Wheel": 3},
        )
        assert ctx.avg_confidence == 4.2
        assert ctx.tag_distribution == {"Wheel": 3}


# =============================================================================
# TestLowConfidenceRule
# =============================================================================

class TestLowConfidenceRule:
    """Diagnostic rule: low avg confidence triggers warning."""

    def test_low_confidence_warning(self):
        ctx = _ctx(avg_confidence=2.0)
        items = _evaluate_rules(ctx)
        conf_items = [d for d in items if "conviction" in d.title.lower()]
        assert len(conf_items) >= 1
        assert conf_items[0].severity == "warning"
        assert "2.0" in conf_items[0].explanation

    def test_high_confidence_no_warning(self):
        ctx = _ctx(avg_confidence=4.5)
        items = _evaluate_rules(ctx)
        conf_items = [d for d in items if "conviction" in d.title.lower()]
        assert len(conf_items) == 0

    def test_no_confidence_no_warning(self):
        ctx = _ctx(avg_confidence=None)
        items = _evaluate_rules(ctx)
        conf_items = [d for d in items if "conviction" in d.title.lower()]
        assert len(conf_items) == 0

    def test_boundary_2_5_no_warning(self):
        """At exactly 2.5, rule should NOT trigger (< 2.5 required)."""
        ctx = _ctx(avg_confidence=2.5)
        items = _evaluate_rules(ctx)
        conf_items = [d for d in items if "conviction" in d.title.lower()]
        assert len(conf_items) == 0


# =============================================================================
# TestValidStrategyTags
# =============================================================================

class TestValidStrategyTags:
    """VALID_STRATEGY_TAGS contains the expected predefined vocabulary."""

    def test_contains_all_expected(self):
        expected = {"Hedge", "Speculative", "Earnings", "Income",
                    "Momentum", "Mean Reversion", "Wheel", "Volatility"}
        assert VALID_STRATEGY_TAGS == expected

    def test_is_frozenset(self):
        assert isinstance(VALID_STRATEGY_TAGS, frozenset)


# =============================================================================
# TestTradeUpdateSchema
# =============================================================================

class TestTradeUpdateSchema:
    """TradeUpdate Pydantic schema validation."""

    def test_valid_update(self):
        update = TradeUpdate(confidence_score=4, strategy_tags=["Hedge"])
        assert update.confidence_score == 4
        assert update.strategy_tags == ["Hedge"]

    def test_partial_update(self):
        update = TradeUpdate(confidence_score=5)
        assert update.confidence_score == 5
        assert update.strategy_tags is None

    def test_confidence_range_low(self):
        with pytest.raises(Exception):  # ValidationError
            TradeUpdate(confidence_score=0)

    def test_confidence_range_high(self):
        with pytest.raises(Exception):  # ValidationError
            TradeUpdate(confidence_score=6)

    def test_empty_update(self):
        update = TradeUpdate()
        assert update.confidence_score is None
        assert update.strategy_tags is None
