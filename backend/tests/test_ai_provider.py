"""
Tests for Phase 9a -- GeminiAiProvider + CircuitBreakerProvider + prompt builder.

Covers:
  - _build_user_prompt(): template rendering, field formatting
  - _parse_llm_response(): valid JSON, malformed JSON, missing fields, markdown fences
  - CircuitBreakerProvider: fallback after N failures, cooldown reset, half-open
  - create_provider(): factory returns correct type based on config
"""
from __future__ import annotations

import json
import time
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas.ai import (
    AiInsight,
    DiagnosticItem,
    ExpiryConcentration,
    PositionContext,
    RiskContext,
)
from app.services.ai_engine import (
    CircuitBreakerProvider,
    GeminiAiProvider,
    MockAiProvider,
    _build_user_prompt,
    _parse_llm_response,
    create_provider,
)


# -- Shared helpers -----------------------------------------------------------

def _ctx(**overrides) -> RiskContext:
    """Build a minimal RiskContext for testing."""
    defaults = dict(
        positions_count=5,
        underlyings_count=3,
        net_delta_normalized=-2.50,
        delta_to_gamma_ratio=45.0,
        theta_yield_pct=0.072,
        vega_exposure_ratio=0.35,
        var_pct_of_margin=8.5,
        risk_posture="short_gamma_positive_theta",
        dominant_risk="delta",
        strategy_mix={"VERTICAL": 2, "SINGLE": 3},
        expiry_concentration=[
            ExpiryConcentration(bucket="<=7d", pct_of_total=0.15),
            ExpiryConcentration(bucket="8-30d", pct_of_total=0.45),
            ExpiryConcentration(bucket="31-90d", pct_of_total=0.40),
        ],
        top_positions=[
            PositionContext(
                symbol="NVDA", strategy_label="Bull Put Spread",
                delta_pct_of_total=55.0, theta_pct_of_margin=0.085,
                days_to_nearest_expiry=12,
            ),
            PositionContext(
                symbol="TSLA", strategy_label="Short Strangle",
                delta_pct_of_total=30.0, theta_pct_of_margin=0.120,
                days_to_nearest_expiry=25,
            ),
        ],
        risk_alerts=[],
        as_of=datetime(2026, 3, 1, 15, 30, 0),
    )
    defaults.update(overrides)
    return RiskContext(**defaults)


def _valid_llm_json() -> str:
    """A well-formed LLM response matching the expected schema."""
    return json.dumps({
        "overall_assessment": "Warning",
        "diagnostics": [
            {
                "severity": "warning",
                "category": "gamma",
                "title": "Delta-gamma imbalance detected",
                "explanation": "Delta/gamma ratio of 45.0 with -2.50 avg delta per position creates negative convexity risk.",
                "suggestion": "Buy protective puts to reduce gamma exposure on short positions.",
            },
            {
                "severity": "warning",
                "category": "expiry",
                "title": "Near-term expiry clustering",
                "explanation": "60.0% of contracts expire within 30 days, increasing pin risk and gamma acceleration.",
                "suggestion": "Roll 8-30d positions to 45-60 DTE to smooth theta decay curve.",
            },
            {
                "severity": "info",
                "category": "theta",
                "title": "Theta harvesting is efficient",
                "explanation": "Daily theta yield of 0.072% of margin indicates healthy premium capture rate.",
                "suggestion": "Maintain current theta positions and monitor for IV regime changes.",
            },
        ],
    })


# =============================================================================
# Test _build_user_prompt
# =============================================================================

class TestBuildUserPrompt:
    """Validate user prompt template rendering."""

    def test_contains_all_risk_fields(self):
        ctx = _ctx()
        prompt = _build_user_prompt(ctx)

        assert "5 across 3 underlyings" in prompt
        assert "short_gamma_positive_theta" in prompt
        assert "-2.50" in prompt
        assert "45.0" in prompt
        assert "0.072%" in prompt
        assert "0.3500" in prompt
        assert "8.5%" in prompt

    def test_contains_strategy_mix(self):
        ctx = _ctx()
        prompt = _build_user_prompt(ctx)
        assert "2x vertical" in prompt
        assert "3x single" in prompt

    def test_contains_expiry_concentration(self):
        ctx = _ctx()
        prompt = _build_user_prompt(ctx)
        assert "<=7d: 15.0%" in prompt
        assert "8-30d: 45.0%" in prompt

    def test_contains_top_positions(self):
        ctx = _ctx()
        prompt = _build_user_prompt(ctx)
        assert "NVDA [Bull Put Spread]" in prompt
        assert "delta=+55.0%" in prompt
        assert "DTE=12" in prompt

    def test_none_values_show_na(self):
        ctx = _ctx(delta_to_gamma_ratio=None, var_pct_of_margin=None)
        prompt = _build_user_prompt(ctx)
        assert "Delta/gamma ratio: N/A" in prompt
        assert "VaR (1d 95%): N/A" in prompt

    def test_risk_alerts_included(self):
        ctx = _ctx(risk_alerts=["NVDA: delta doubles within 8.5% drop"])
        prompt = _build_user_prompt(ctx)
        assert "NVDA: delta doubles" in prompt

    def test_empty_portfolio_shows_placeholders(self):
        ctx = _ctx(
            positions_count=0,
            top_positions=[],
            expiry_concentration=[],
            strategy_mix={},
            risk_alerts=[],
        )
        prompt = _build_user_prompt(ctx)
        assert "(no positions)" in prompt
        assert "(no expiry data)" in prompt
        assert "none" in prompt  # strategy mix and alerts


# =============================================================================
# Test _parse_llm_response
# =============================================================================

class TestParseLlmResponse:
    """Validate JSON parsing and validation of LLM output."""

    def test_valid_json_parsed_correctly(self):
        insight = _parse_llm_response(_valid_llm_json())
        assert insight.overall_assessment == "Warning"
        assert len(insight.diagnostics) == 3
        assert insight.diagnostics[0].severity == "warning"
        assert insight.diagnostics[0].category == "gamma"

    def test_markdown_fences_stripped(self):
        """LLM wraps JSON in ```json ... ``` — should still parse."""
        wrapped = f"```json\n{_valid_llm_json()}\n```"
        insight = _parse_llm_response(wrapped)
        assert insight.overall_assessment == "Warning"
        assert len(insight.diagnostics) == 3

    def test_invalid_json_raises_valueerror(self):
        with pytest.raises((ValueError, json.JSONDecodeError)):
            _parse_llm_response("This is not JSON at all.")

    def test_missing_assessment_raises_valueerror(self):
        bad = json.dumps({"diagnostics": [{"severity": "info", "category": "delta", "title": "x", "explanation": "y", "suggestion": "z"}]})
        with pytest.raises(ValueError, match="Invalid overall_assessment"):
            _parse_llm_response(bad)

    def test_invalid_severity_raises_valueerror(self):
        bad = json.dumps({
            "overall_assessment": "Warning",
            "diagnostics": [{"severity": "EXTREME", "category": "delta", "title": "x", "explanation": "y", "suggestion": "z"}],
        })
        with pytest.raises(ValueError, match="Invalid severity"):
            _parse_llm_response(bad)

    def test_invalid_category_raises_valueerror(self):
        bad = json.dumps({
            "overall_assessment": "Warning",
            "diagnostics": [{"severity": "info", "category": "margin", "title": "x", "explanation": "y", "suggestion": "z"}],
        })
        with pytest.raises(ValueError, match="Invalid category"):
            _parse_llm_response(bad)

    def test_empty_diagnostics_raises_valueerror(self):
        bad = json.dumps({"overall_assessment": "Safe", "diagnostics": []})
        with pytest.raises(ValueError, match="Expected 1-5"):
            _parse_llm_response(bad)

    def test_caps_at_five_diagnostics(self):
        """More than 5 diagnostics -> only first 5 kept."""
        diags = [
            {"severity": "info", "category": "delta", "title": f"Item {i}", "explanation": "e", "suggestion": "s"}
            for i in range(8)
        ]
        raw = json.dumps({"overall_assessment": "Caution", "diagnostics": diags})
        insight = _parse_llm_response(raw)
        assert len(insight.diagnostics) == 5


# =============================================================================
# Test CircuitBreakerProvider
# =============================================================================

class TestCircuitBreakerProvider:
    """Circuit breaker: fallback after N failures, cooldown, half-open."""

    @pytest.mark.asyncio
    async def test_success_uses_primary(self):
        """When primary succeeds, use primary result."""
        primary = AsyncMock(spec=MockAiProvider)
        primary.analyze = AsyncMock(return_value=AiInsight(
            overall_assessment="Warning",
            diagnostics=[DiagnosticItem(severity="warning", category="delta", title="t", explanation="e", suggestion="s")],
            generated_at=datetime(2026, 3, 1),
        ))
        cb = CircuitBreakerProvider(primary, max_failures=3)
        ctx = _ctx()

        result = await cb.analyze(ctx)
        assert result.overall_assessment == "Warning"
        primary.analyze.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_single_failure_uses_fallback_then_resets(self):
        """One failure -> falls back, but counter < max -> circuit stays closed."""
        primary = AsyncMock(spec=MockAiProvider)
        primary.analyze = AsyncMock(side_effect=Exception("API error"))
        fallback = MockAiProvider()
        cb = CircuitBreakerProvider(primary, fallback=fallback, max_failures=3)
        ctx = _ctx()

        result = await cb.analyze(ctx)
        # Should have used fallback (MockAiProvider)
        assert result.overall_assessment in ("Safe", "Caution", "Warning", "Danger")
        assert cb._consecutive_failures == 1
        assert not cb.is_open

    @pytest.mark.asyncio
    async def test_three_failures_opens_circuit(self):
        """3 consecutive failures -> circuit opens."""
        primary = AsyncMock(spec=MockAiProvider)
        primary.analyze = AsyncMock(side_effect=Exception("timeout"))
        cb = CircuitBreakerProvider(primary, max_failures=3, cooldown_seconds=300)
        ctx = _ctx()

        for _ in range(3):
            await cb.analyze(ctx)

        assert cb._consecutive_failures == 3
        assert cb.is_open

    @pytest.mark.asyncio
    async def test_circuit_open_skips_primary(self):
        """When circuit is open, don't call primary at all."""
        primary = AsyncMock(spec=MockAiProvider)
        primary.analyze = AsyncMock(side_effect=Exception("timeout"))
        cb = CircuitBreakerProvider(primary, max_failures=3, cooldown_seconds=300)
        ctx = _ctx()

        # Open the circuit
        for _ in range(3):
            await cb.analyze(ctx)
        primary.analyze.reset_mock()

        # Next call should skip primary entirely
        result = await cb.analyze(ctx)
        primary.analyze.assert_not_awaited()
        assert result.overall_assessment in ("Safe", "Caution", "Warning", "Danger")

    @pytest.mark.asyncio
    async def test_success_after_failure_resets_counter(self):
        """A success resets the failure counter to 0."""
        call_count = 0

        async def intermittent(ctx, language="en", scanner_tops=None):
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                raise Exception("transient error")
            return AiInsight(
                overall_assessment="Safe",
                diagnostics=[DiagnosticItem(severity="info", category="theta", title="t", explanation="e", suggestion="s")],
                generated_at=datetime(2026, 3, 1),
            )

        primary = AsyncMock(spec=MockAiProvider)
        primary.analyze = AsyncMock(side_effect=intermittent)
        cb = CircuitBreakerProvider(primary, max_failures=3)
        ctx = _ctx()

        # 2 failures
        await cb.analyze(ctx)
        await cb.analyze(ctx)
        assert cb._consecutive_failures == 2

        # 1 success
        result = await cb.analyze(ctx)
        assert result.overall_assessment == "Safe"
        assert cb._consecutive_failures == 0

    @pytest.mark.asyncio
    async def test_half_open_after_cooldown(self):
        """After cooldown expires, circuit becomes half-open (tries primary again)."""
        primary = AsyncMock(spec=MockAiProvider)
        primary.analyze = AsyncMock(side_effect=Exception("timeout"))
        cb = CircuitBreakerProvider(primary, max_failures=3, cooldown_seconds=0.1)
        ctx = _ctx()

        # Open circuit
        for _ in range(3):
            await cb.analyze(ctx)
        assert cb.is_open

        # Wait for cooldown
        await asyncio.sleep(0.15)
        assert not cb.is_open  # cooldown expired -> half-open

        # Next call tries primary again
        primary.analyze.reset_mock()
        primary.analyze.side_effect = Exception("still broken")
        await cb.analyze(ctx)
        primary.analyze.assert_awaited_once()  # tried primary (half-open)


# =============================================================================
# Test create_provider factory
# =============================================================================

class TestCreateProvider:
    """Factory function: config -> correct provider type."""

    def test_mock_provider(self):
        with patch("app.config.settings") as mock_settings:
            mock_settings.ai_provider_type = "mock"
            provider = create_provider()
            assert isinstance(provider, MockAiProvider)

    def test_gemini_provider_with_key(self):
        with patch("app.config.settings") as mock_settings:
            mock_settings.ai_provider_type = "gemini"
            mock_settings.google_api_key = "AIza-test-key"
            mock_settings.ai_api_key = ""
            mock_settings.ai_timeout = 15
            provider = create_provider()
            assert isinstance(provider, CircuitBreakerProvider)
            assert isinstance(provider._primary, GeminiAiProvider)

    def test_any_non_mock_type_with_key_uses_gemini(self):
        with patch("app.config.settings") as mock_settings:
            mock_settings.ai_provider_type = "claude"
            mock_settings.google_api_key = "AIza-test-key"
            mock_settings.ai_api_key = ""
            mock_settings.ai_timeout = 15
            provider = create_provider()
            assert isinstance(provider, CircuitBreakerProvider)
            assert isinstance(provider._primary, GeminiAiProvider)

    def test_no_key_falls_back_to_mock(self):
        with patch("app.config.settings") as mock_settings:
            mock_settings.ai_provider_type = "gemini"
            mock_settings.google_api_key = ""
            mock_settings.ai_api_key = ""
            provider = create_provider()
            assert isinstance(provider, MockAiProvider)

    def test_unknown_type_no_key_falls_back(self):
        with patch("app.config.settings") as mock_settings:
            mock_settings.ai_provider_type = "gpt-99"
            mock_settings.google_api_key = ""
            mock_settings.ai_api_key = ""
            provider = create_provider()
            assert isinstance(provider, MockAiProvider)


# Need asyncio import for sleep in half-open test
import asyncio
