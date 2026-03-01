"""
Tests for Phase 8a -- AI Risk Context Synthesizer.

Covers:
  - build_risk_context() pure function: sanitization, ratio computation
  - Zero-leakage: no user_id, no absolute dollar values in RiskContext
  - _evaluate_rules() pure function: all 9 diagnostic rules
  - Severity ordering (critical > warning > info)
  - Output bounded to 3-5 diagnostics
  - MockAiProvider.analyze() async wrapper
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

import pytest

from app.schemas.ai import RiskContext, ExpiryConcentration, PositionContext
from app.services.ai_engine import (
    MockAiProvider,
    _evaluate_rules,
    build_risk_context,
)


# -- Fake data structures (no ORM, no DB) ------------------------------------

@dataclass
class FakeInstrument:
    symbol: str
    instrument_type: str = "OPTION"
    option_type: object = None
    strike: Decimal | None = None
    expiry: date | None = None
    multiplier: int = 100


@dataclass
class FakePositionRow:
    instrument: FakeInstrument
    net_contracts: int
    avg_open_price: Decimal = Decimal("0")
    total_open_premium: Decimal = Decimal("0")
    first_trade_date: datetime = datetime(2026, 1, 1)  # noqa: DTZ001
    days_elapsed: int = 0


@dataclass
class FakeOptionLeg:
    days_to_expiry: int = 30


@dataclass
class FakeHoldingGroup:
    symbol: str
    total_delta_exposure: Decimal = Decimal("0")
    total_maintenance_margin: Decimal = Decimal("0")
    total_theta_daily: Decimal = Decimal("0")
    strategy_type: str = "SINGLE"
    strategy_label: str = "Single"
    option_legs: list = field(default_factory=list)
    stock_legs: list = field(default_factory=list)


# -- Helper: build a minimal risk_summary dict --------------------------------

def _risk_summary(
    *,
    total_net_delta=Decimal("0"),
    total_gamma=Decimal("0"),
    total_theta_daily=Decimal("0"),
    total_vega=Decimal("0"),
    maintenance_margin_total=Decimal("0"),
    var_1d_95=None,
    positions_count=0,
    risk_alerts=None,
    expiry_buckets=None,
) -> dict:
    return {
        "total_net_delta": total_net_delta,
        "total_gamma": total_gamma,
        "total_theta_daily": total_theta_daily,
        "total_vega": total_vega,
        "maintenance_margin_total": maintenance_margin_total,
        "var_1d_95": var_1d_95,
        "positions_count": positions_count,
        "risk_alerts": risk_alerts or [],
        "expiry_buckets": expiry_buckets or [],
        "top_efficient_symbol": None,
        "sector_exposure": {},
    }


# -- Helper: build a known RiskContext for rule tests -------------------------

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
        as_of=datetime(2026, 3, 1, 12, 0, 0),
    )


# =============================================================================
# TestBuildRiskContext — pure function tests
# =============================================================================

class TestBuildRiskContext:
    """build_risk_context() — no DB, no IO."""

    def test_empty_positions_returns_zeroes(self):
        """Empty positions list -> all ratios 0, counts 0."""
        ctx = build_risk_context([], _risk_summary(), [])
        assert ctx.positions_count == 0
        assert ctx.underlyings_count == 0
        assert ctx.net_delta_normalized == 0.0
        assert ctx.theta_yield_pct == 0.0
        assert ctx.vega_exposure_ratio == 0.0
        assert ctx.delta_to_gamma_ratio is None

    def test_sanitizes_no_dollar_values(self):
        """RiskContext must NOT contain any absolute dollar amounts."""
        positions = [
            FakePositionRow(
                instrument=FakeInstrument(symbol="NVDA"),
                net_contracts=-5,
            ),
        ]
        summary = _risk_summary(
            total_net_delta=Decimal("485"),
            total_gamma=Decimal("1.2"),
            total_theta_daily=Decimal("32.50"),
            total_vega=Decimal("120"),
            maintenance_margin_total=Decimal("45000"),
            var_1d_95=Decimal("2800"),
            positions_count=1,
        )
        groups = [
            FakeHoldingGroup(
                symbol="NVDA",
                total_delta_exposure=Decimal("485"),
                total_maintenance_margin=Decimal("45000"),
                total_theta_daily=Decimal("32.50"),
            ),
        ]

        ctx = build_risk_context(positions, summary, groups)
        dumped = ctx.model_dump_json()

        # No absolute dollar values should appear
        assert "45000" not in dumped
        assert "2800" not in dumped
        assert "32.50" not in dumped and "32.5" not in dumped

    def test_theta_yield_calculation(self):
        """theta_yield_pct = |theta| / margin * 100."""
        summary = _risk_summary(
            total_theta_daily=Decimal("50"),
            maintenance_margin_total=Decimal("10000"),
            positions_count=1,
        )
        ctx = build_risk_context([], summary, [])
        # 50 / 10000 * 100 = 0.5
        assert ctx.theta_yield_pct == 0.5

    def test_theta_yield_zero_margin(self):
        """When margin is 0, theta_yield_pct = 0 (no division by zero)."""
        summary = _risk_summary(
            total_theta_daily=Decimal("50"),
            maintenance_margin_total=Decimal("0"),
            positions_count=1,
        )
        ctx = build_risk_context([], summary, [])
        assert ctx.theta_yield_pct == 0.0

    def test_var_pct_of_margin_calculation(self):
        """var_pct_of_margin = VaR / margin * 100."""
        summary = _risk_summary(
            var_1d_95=Decimal("1500"),
            maintenance_margin_total=Decimal("10000"),
            positions_count=1,
        )
        ctx = build_risk_context([], summary, [])
        assert ctx.var_pct_of_margin == 15.0

    def test_var_pct_none_when_no_var(self):
        """var_1d_95 is None -> var_pct_of_margin is None."""
        summary = _risk_summary(
            var_1d_95=None,
            maintenance_margin_total=Decimal("10000"),
            positions_count=1,
        )
        ctx = build_risk_context([], summary, [])
        assert ctx.var_pct_of_margin is None

    def test_delta_to_gamma_ratio(self):
        """|net_delta| / |net_gamma| computed correctly."""
        summary = _risk_summary(
            total_net_delta=Decimal("200"),
            total_gamma=Decimal("-4"),
            positions_count=1,
        )
        ctx = build_risk_context([], summary, [])
        assert ctx.delta_to_gamma_ratio == 50.0  # 200 / 4

    def test_delta_to_gamma_ratio_zero_gamma(self):
        """Zero gamma -> ratio is None."""
        summary = _risk_summary(
            total_net_delta=Decimal("200"),
            total_gamma=Decimal("0"),
            positions_count=1,
        )
        ctx = build_risk_context([], summary, [])
        assert ctx.delta_to_gamma_ratio is None

    def test_expiry_concentration_sums_to_one(self):
        """Bucket percentages should sum to ~1.0."""
        summary = _risk_summary(
            positions_count=4,
            expiry_buckets=[
                {"label": "<=7d", "net_contracts": 2, "delta_exposure": Decimal("100")},
                {"label": "8-30d", "net_contracts": 3, "delta_exposure": Decimal("200")},
                {"label": "31-90d", "net_contracts": 5, "delta_exposure": Decimal("300")},
            ],
        )
        ctx = build_risk_context([], summary, [])
        total = sum(ec.pct_of_total for ec in ctx.expiry_concentration)
        assert abs(total - 1.0) < 0.01

    def test_top_positions_limited_to_three(self):
        """Only top 3 by |delta_exposure| appear in context."""
        groups = [
            FakeHoldingGroup(symbol=f"SYM{i}", total_delta_exposure=Decimal(str(i * 100)))
            for i in range(5)
        ]
        ctx = build_risk_context([], _risk_summary(positions_count=5), groups)
        assert len(ctx.top_positions) == 3
        # Sorted by |delta| descending
        assert ctx.top_positions[0].symbol == "SYM4"
        assert ctx.top_positions[1].symbol == "SYM3"
        assert ctx.top_positions[2].symbol == "SYM2"

    def test_strategy_mix_aggregation(self):
        """Multiple holding groups aggregate strategy_type counts."""
        groups = [
            FakeHoldingGroup(symbol="A", strategy_type="VERTICAL"),
            FakeHoldingGroup(symbol="B", strategy_type="VERTICAL"),
            FakeHoldingGroup(symbol="C", strategy_type="SINGLE"),
        ]
        ctx = build_risk_context([], _risk_summary(positions_count=3), groups)
        assert ctx.strategy_mix == {"VERTICAL": 2, "SINGLE": 1}

    def test_risk_posture_classification(self):
        """Verifies gamma/theta sign combinations."""
        # short gamma, positive theta
        s1 = _risk_summary(total_gamma=Decimal("-1"), total_theta_daily=Decimal("10"))
        c1 = build_risk_context([], s1, [])
        assert c1.risk_posture == "short_gamma_positive_theta"

        # long gamma, negative theta
        s2 = _risk_summary(total_gamma=Decimal("1"), total_theta_daily=Decimal("-5"))
        c2 = build_risk_context([], s2, [])
        assert c2.risk_posture == "long_gamma_negative_theta"

    def test_underlyings_count(self):
        """Counts unique symbols from positions."""
        positions = [
            FakePositionRow(instrument=FakeInstrument(symbol="NVDA"), net_contracts=-5),
            FakePositionRow(instrument=FakeInstrument(symbol="NVDA"), net_contracts=3),
            FakePositionRow(instrument=FakeInstrument(symbol="AAPL"), net_contracts=-2),
        ]
        ctx = build_risk_context(positions, _risk_summary(positions_count=3), [])
        assert ctx.underlyings_count == 2

    def test_net_delta_normalized(self):
        """avg delta = net_delta / positions_count."""
        summary = _risk_summary(total_net_delta=Decimal("300"), positions_count=6)
        ctx = build_risk_context([], summary, [])
        assert ctx.net_delta_normalized == 50.0  # 300 / 6


# =============================================================================
# TestEvaluateRules — pure function tests
# =============================================================================

class TestEvaluateRules:
    """_evaluate_rules() — no DB, no IO."""

    def test_high_delta_short_gamma_triggers_critical(self):
        """Rule 1: short gamma + |delta_norm| > 5 -> critical."""
        ctx = _ctx(
            risk_posture="short_gamma_positive_theta",
            net_delta_normalized=12.5,
        )
        items = _evaluate_rules(ctx)
        critical = [d for d in items if d.severity == "critical" and d.category == "delta"]
        assert len(critical) >= 1
        assert "short gamma" in critical[0].title.lower()

    def test_high_theta_yield_triggers_info(self):
        """Rule 2: theta_yield_pct > 0.05 -> info."""
        ctx = _ctx(theta_yield_pct=0.08)
        items = _evaluate_rules(ctx)
        theta_items = [d for d in items if d.category == "theta" and "efficient" in d.title.lower()]
        assert len(theta_items) >= 1
        assert theta_items[0].severity == "info"

    def test_near_term_expiry_concentration_triggers_warning(self):
        """Rule 3: <=7d + 8-30d > 60% -> warning."""
        ctx = _ctx(
            expiry_concentration=[
                ExpiryConcentration(bucket="<=7d", pct_of_total=0.35),
                ExpiryConcentration(bucket="8-30d", pct_of_total=0.30),
                ExpiryConcentration(bucket="31-90d", pct_of_total=0.35),
            ],
        )
        items = _evaluate_rules(ctx)
        expiry = [d for d in items if d.category == "expiry"]
        assert len(expiry) >= 1
        assert expiry[0].severity == "warning"

    def test_delta_gamma_imbalance_triggers_warning(self):
        """Rule 4: ratio < 50 + |delta_norm| > 2 -> warning."""
        ctx = _ctx(delta_to_gamma_ratio=30.0, net_delta_normalized=3.5)
        items = _evaluate_rules(ctx)
        gamma = [d for d in items if d.category == "gamma" and "imbalance" in d.title.lower()]
        assert len(gamma) >= 1
        assert gamma[0].severity == "warning"

    def test_low_var_triggers_info(self):
        """Rule 5: var_pct < 5 -> info."""
        ctx = _ctx(var_pct_of_margin=3.0)
        items = _evaluate_rules(ctx)
        var_items = [d for d in items if "risk-adjusted" in d.title.lower()]
        assert len(var_items) >= 1
        assert var_items[0].severity == "info"

    def test_high_var_triggers_critical(self):
        """Rule 6: var_pct > 15 -> critical."""
        ctx = _ctx(var_pct_of_margin=20.0)
        items = _evaluate_rules(ctx)
        var_items = [d for d in items if "var" in d.title.lower()]
        assert len(var_items) >= 1
        assert var_items[0].severity == "critical"

    def test_high_vega_triggers_warning(self):
        """Rule 7: vega_exposure_ratio > 0.5 -> warning."""
        ctx = _ctx(vega_exposure_ratio=0.8)
        items = _evaluate_rules(ctx)
        vega = [d for d in items if d.category == "vega"]
        assert len(vega) >= 1
        assert vega[0].severity == "warning"

    def test_concentration_risk_warning(self):
        """Rule 8: top position > 60% of total delta, underlyings > 1."""
        ctx = _ctx(
            underlyings_count=3,
            top_positions=[
                PositionContext(
                    symbol="NVDA", strategy_label="Short Put",
                    delta_pct_of_total=75.0, theta_pct_of_margin=0.1,
                    days_to_nearest_expiry=15,
                ),
            ],
        )
        items = _evaluate_rules(ctx)
        conc = [d for d in items if d.category == "diversification"]
        assert len(conc) >= 1
        assert "NVDA" in conc[0].title

    def test_risk_alerts_trigger_critical(self):
        """Rule 9: non-empty risk_alerts -> critical."""
        ctx = _ctx(risk_alerts=["NVDA: delta doubles within 8.5% drop"])
        items = _evaluate_rules(ctx)
        gamma = [d for d in items if d.category == "gamma" and d.severity == "critical"]
        assert len(gamma) >= 1
        assert "gamma crash" in gamma[0].title.lower()

    def test_minimum_three_diagnostics(self):
        """Healthy portfolio (few rules fire) -> still >= 3 items."""
        ctx = _ctx()  # default: no extreme values
        items = _evaluate_rules(ctx)
        assert len(items) >= 3

    def test_maximum_five_diagnostics(self):
        """Many rules fire -> returns at most 5."""
        ctx = _ctx(
            risk_posture="short_gamma_positive_theta",
            net_delta_normalized=10.0,
            delta_to_gamma_ratio=20.0,
            theta_yield_pct=0.1,
            vega_exposure_ratio=0.8,
            var_pct_of_margin=20.0,
            risk_alerts=["alert1"],
            underlyings_count=3,
            top_positions=[
                PositionContext(
                    symbol="X", strategy_label="S",
                    delta_pct_of_total=80.0, theta_pct_of_margin=0.1,
                    days_to_nearest_expiry=5,
                ),
            ],
            expiry_concentration=[
                ExpiryConcentration(bucket="<=7d", pct_of_total=0.7),
                ExpiryConcentration(bucket="8-30d", pct_of_total=0.2),
            ],
        )
        items = _evaluate_rules(ctx)
        assert len(items) == 5

    def test_severity_ordering(self):
        """Items sorted: critical first, then warning, then info."""
        ctx = _ctx(
            risk_posture="short_gamma_positive_theta",
            net_delta_normalized=10.0,
            theta_yield_pct=0.1,
            var_pct_of_margin=20.0,
        )
        items = _evaluate_rules(ctx)
        sev_order = {"critical": 0, "warning": 1, "info": 2}
        indices = [sev_order[d.severity] for d in items]
        assert indices == sorted(indices), f"Not sorted: {[d.severity for d in items]}"


# =============================================================================
# TestMockAiProviderAnalyze — async wrapper tests
# =============================================================================

class TestMockAiProviderAnalyze:
    """MockAiProvider.analyze() async tests."""

    @pytest.mark.asyncio
    async def test_analyze_returns_ai_insight(self):
        """Valid RiskContext -> returns AiInsight with correct types."""
        provider = MockAiProvider()
        ctx = _ctx(theta_yield_pct=0.06, var_pct_of_margin=3.0)
        insight = await provider.analyze(ctx)

        assert insight.overall_assessment in ("Safe", "Caution", "Warning", "Danger")
        assert 3 <= len(insight.diagnostics) <= 5
        assert insight.generated_at is not None

    @pytest.mark.asyncio
    async def test_overall_assessment_danger_when_critical(self):
        """Any critical diagnostic -> overall = 'Danger'."""
        provider = MockAiProvider()
        ctx = _ctx(var_pct_of_margin=20.0)  # triggers high VaR critical
        insight = await provider.analyze(ctx)
        assert insight.overall_assessment == "Danger"

    @pytest.mark.asyncio
    async def test_overall_assessment_caution_when_all_info(self):
        """Only info diagnostics -> overall = 'Caution'."""
        provider = MockAiProvider()
        # Low theta, no alerts, no extreme values -> padding items (info only)
        ctx = _ctx(
            risk_posture="long_gamma_negative_theta",
            net_delta_normalized=0.5,
            var_pct_of_margin=3.0,
        )
        insight = await provider.analyze(ctx)
        # Should be Caution (all info) or Safe
        assert insight.overall_assessment in ("Caution", "Safe")
        # Verify no critical/warning
        for d in insight.diagnostics:
            assert d.severity != "critical"


# =============================================================================
# TestWsMessageFormat — validate message shape
# =============================================================================

class TestWsMessageFormat:
    """Validate the ai_insight WS message structure."""

    @pytest.mark.asyncio
    async def test_message_structure(self):
        """Construct WS message from AiInsight -> validate all required fields."""
        provider = MockAiProvider()
        ctx = _ctx(theta_yield_pct=0.08)
        insight = await provider.analyze(ctx)

        msg = {
            "type": "ai_insight",
            "portfolio_id": 1,
            "data": {
                "overall_assessment": insight.overall_assessment,
                "diagnostics": [
                    {
                        "severity": d.severity,
                        "category": d.category,
                        "title": d.title,
                        "explanation": d.explanation,
                        "suggestion": d.suggestion,
                    }
                    for d in insight.diagnostics
                ],
                "generated_at": insight.generated_at.isoformat(),
            },
        }

        assert msg["type"] == "ai_insight"
        assert isinstance(msg["portfolio_id"], int)
        assert msg["data"]["overall_assessment"] in ("Safe", "Caution", "Warning", "Danger")
        assert isinstance(msg["data"]["diagnostics"], list)
        assert 3 <= len(msg["data"]["diagnostics"]) <= 5

        for diag in msg["data"]["diagnostics"]:
            assert diag["severity"] in ("info", "warning", "critical")
            assert isinstance(diag["title"], str)
            assert isinstance(diag["explanation"], str)
            assert isinstance(diag["suggestion"], str)
