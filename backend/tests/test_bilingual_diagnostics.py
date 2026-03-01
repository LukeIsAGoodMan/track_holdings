"""
Tests for Phase 11 -- Bilingual AI Diagnostics & Professional Terminology.

Covers:
  - _evaluate_rules() bilingual output (EN/ZH)
  - MockAiProvider.analyze() with language parameter
  - AiProvider interface language parameter
  - WSConnection language field
  - _get_system_prompt() language selection
  - build_narration() professional ZH broadcaster tone
"""
from __future__ import annotations

from datetime import datetime

import pytest

from app.schemas.ai import RiskContext, DiagnosticItem
from app.services.ai_engine import (
    MockAiProvider,
    _evaluate_rules,
    _get_system_prompt,
    build_risk_context,
)
from app.services.voice_service import build_narration
from app.services.ws_manager import WSConnection


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


# =============================================================================
# TestEvaluateRulesLanguage -- bilingual diagnostic text
# =============================================================================

class TestEvaluateRulesLanguage:
    """_evaluate_rules() produces bilingual diagnostics."""

    def test_default_language_is_english(self):
        """Default language is English."""
        ctx = _ctx()
        items = _evaluate_rules(ctx)
        # Padding items should be English
        assert any("Portfolio" in d.title or "Greeks" in d.title or "Diversification" in d.title
                    for d in items)

    def test_zh_padding_items_are_chinese(self):
        """With language='zh', padding items use Chinese text."""
        ctx = _ctx()
        items = _evaluate_rules(ctx, language="zh")
        titles = [d.title for d in items]
        # Should contain Chinese characters, not English rule titles
        assert any("\u7ec4\u5408\u7ed3\u6784\u5747\u8861" in t  # "Portfolio structure balanced"
                   or "\u5e0c\u814a\u503c" in t       # "Greeks"
                   or "\u5206\u6563\u5316" in t        # "Diversification"
                   for t in titles)
        # Should NOT contain English padding titles
        assert not any("Portfolio structure is balanced" in t for t in titles)

    def test_zh_critical_rule_chinese(self):
        """Rule 1 critical in ZH produces Chinese title/explanation."""
        ctx = _ctx(
            net_delta_normalized=-8.0,
            risk_posture="short_gamma_positive_theta",
        )
        items = _evaluate_rules(ctx, language="zh")
        critical = [d for d in items if d.severity == "critical"]
        assert len(critical) >= 1
        item = critical[0]
        assert "\u65b9\u5411\u6027\u98ce\u9669" in item.title  # "directional risk"
        assert "\u8d1f\u51f8\u6027" in item.title  # "negative convexity"
        assert "Delta" in item.explanation
        assert "\u5bf9\u51b2" in item.suggestion or "\u4fdd\u62a4\u6027\u671f\u6743" in item.suggestion

    def test_en_critical_rule_english(self):
        """Rule 1 critical in EN produces English title/explanation."""
        ctx = _ctx(
            net_delta_normalized=-8.0,
            risk_posture="short_gamma_positive_theta",
        )
        items = _evaluate_rules(ctx, language="en")
        critical = [d for d in items if d.severity == "critical"]
        assert len(critical) >= 1
        item = critical[0]
        assert "Concentrated directional risk" in item.title

    def test_zh_theta_efficient_rule(self):
        """Rule 2 in ZH uses Chinese financial terminology."""
        ctx = _ctx(theta_yield_pct=0.08)
        items = _evaluate_rules(ctx, language="zh")
        theta_items = [d for d in items if d.category == "theta" and "Theta" in d.title]
        assert len(theta_items) >= 1
        assert "\u6536\u5272\u6548\u7387\u826f\u597d" in theta_items[0].title  # "harvest efficiency good"

    def test_zh_var_critical_rule(self):
        """Rule 6 in ZH uses VaR/margin Chinese terminology."""
        ctx = _ctx(var_pct_of_margin=20.0)
        items = _evaluate_rules(ctx, language="zh")
        var_items = [d for d in items if d.severity == "critical" and "VaR" in d.title]
        assert len(var_items) >= 1
        assert "\u4fdd\u8bc1\u91d1" in var_items[0].title  # "margin"

    def test_zh_vega_warning_rule(self):
        """Rule 7 in ZH uses volatility sensitivity terminology."""
        ctx = _ctx(vega_exposure_ratio=0.8)
        items = _evaluate_rules(ctx, language="zh")
        vega_items = [d for d in items if d.category == "vega"]
        assert len(vega_items) >= 1
        assert "\u6ce2\u52a8\u7387\u654f\u611f\u5ea6" in vega_items[0].title  # "volatility sensitivity"

    def test_zh_low_confidence_rule(self):
        """Rule 10 in ZH uses Chinese conviction terminology."""
        ctx = _ctx(avg_confidence=2.0)
        items = _evaluate_rules(ctx, language="zh")
        conf_items = [d for d in items if "\u4fe1\u5fc3" in d.title]  # "conviction/confidence"
        assert len(conf_items) >= 1
        assert "2.0" in conf_items[0].explanation

    def test_zh_gamma_crash_rule(self):
        """Rule 9 in ZH uses Gamma crash terminology."""
        ctx = _ctx(risk_alerts=["NVDA short gamma alert"])
        items = _evaluate_rules(ctx, language="zh")
        gamma_items = [d for d in items if d.severity == "critical" and "Gamma" in d.title]
        assert len(gamma_items) >= 1
        assert "\u5d29\u6e83" in gamma_items[0].title  # "crash"


# =============================================================================
# TestMockAiProviderLanguage
# =============================================================================

class TestMockAiProviderLanguage:
    """MockAiProvider.analyze() respects language parameter."""

    @pytest.mark.asyncio
    async def test_default_english(self):
        provider = MockAiProvider()
        ctx = _ctx(theta_yield_pct=0.08)
        insight = await provider.analyze(ctx)
        # Default is English
        assert any("Theta" in d.title and "efficient" in d.title
                    for d in insight.diagnostics)

    @pytest.mark.asyncio
    async def test_zh_produces_chinese(self):
        provider = MockAiProvider()
        ctx = _ctx(theta_yield_pct=0.08)
        insight = await provider.analyze(ctx, language="zh")
        # Should produce Chinese diagnostics
        assert any("Theta" in d.title and "\u6536\u5272" in d.title
                    for d in insight.diagnostics)


# =============================================================================
# TestGetSystemPrompt
# =============================================================================

class TestGetSystemPrompt:
    """_get_system_prompt() returns language-specific system prompts."""

    def test_en_prompt(self):
        prompt = _get_system_prompt("en")
        assert "senior options portfolio risk analyst" in prompt
        # EN prompt should NOT contain Chinese language directives
        assert "\u884c\u6743\u4ef7" not in prompt

    def test_zh_prompt(self):
        prompt = _get_system_prompt("zh")
        assert "Chinese-speaking" in prompt
        assert "\u884c\u6743\u4ef7" in prompt  # strike price in Chinese
        assert "\u4fdd\u8bc1\u91d1" in prompt  # margin in Chinese
        assert "\u5bf9\u51b2" in prompt  # hedge in Chinese

    def test_default_is_en(self):
        assert _get_system_prompt() == _get_system_prompt("en")


# =============================================================================
# TestWSConnectionLanguage
# =============================================================================

class TestWSConnectionLanguage:
    """WSConnection dataclass includes language field."""

    def test_default_language_en(self):
        from unittest.mock import MagicMock
        conn = WSConnection(ws=MagicMock(), user_id=1)
        assert conn.language == "en"

    def test_custom_language(self):
        from unittest.mock import MagicMock
        conn = WSConnection(ws=MagicMock(), user_id=1, language="zh")
        assert conn.language == "zh"


# =============================================================================
# TestBuildNarrationZhTone -- professional broadcaster tone
# =============================================================================

class TestBuildNarrationZhTone:
    """ZH narration uses professional Chinese financial broadcaster tone."""

    def _make_diags(self, *specs):
        items = []
        for sev, cat, title, expl, sugg in specs:
            items.append(DiagnosticItem(
                severity=sev, category=cat,
                title=title, explanation=expl, suggestion=sugg,
            ))
        return items

    def test_zh_professional_opening(self):
        diags = self._make_diags(
            ("info", "theta", "\u7ec4\u5408\u7ed3\u6784\u5747\u8861", "\u8bf4\u660e\u6587\u672c", "\u5efa\u8bae\u6587\u672c"),
        )
        text = build_narration(diags, "Safe", "zh")
        assert "\u5404\u4f4d\u6295\u8d44\u8005" in text

    def test_zh_critical_gets_emphasis(self):
        diags = self._make_diags(
            ("critical", "delta", "\u65b9\u5411\u6027\u98ce\u9669", "\u8bf4\u660e", "\u5efa\u8bae"),
        )
        text = build_narration(diags, "Danger", "zh")
        assert "\u91cd\u70b9\u5173\u6ce8" in text
        assert "\u4e25\u91cd\u7ea7\u522b" in text

    def test_zh_warning_label(self):
        diags = self._make_diags(
            ("warning", "gamma", "\u6d4b\u8bd5\u8b66\u544a", "\u8bf4\u660e", "\u5efa\u8bae"),
        )
        text = build_narration(diags, "Warning", "zh")
        assert "\u8b66\u544a\u7ea7\u522b" in text

    def test_zh_info_label(self):
        diags = self._make_diags(
            ("info", "theta", "\u6d4b\u8bd5\u4fe1\u606f", "\u8bf4\u660e", "\u5efa\u8bae"),
        )
        text = build_narration(diags, "Caution", "zh")
        assert "\u4fe1\u606f\u63d0\u793a" in text

    def test_zh_analyst_recommendation(self):
        diags = self._make_diags(
            ("critical", "delta", "\u6d4b\u8bd5", "\u8bf4\u660e", "\u5bf9\u51b2Delta\u66b4\u9732"),
        )
        text = build_narration(diags, "Danger", "zh")
        assert "\u5206\u6790\u5e08\u5efa\u8bae" in text
        assert "\u5bf9\u51b2Delta\u66b4\u9732" in text

    def test_zh_severity_ordering(self):
        """Critical items appear before warning and info in ZH narration."""
        diags = self._make_diags(
            ("info", "theta", "\u4fe1\u606f\u6807\u9898", "\u4fe1\u606f\u5185\u5bb9", "\u5efa\u8bae1"),
            ("critical", "delta", "\u4e25\u91cd\u6807\u9898", "\u4e25\u91cd\u5185\u5bb9", "\u5efa\u8bae2"),
            ("warning", "gamma", "\u8b66\u544a\u6807\u9898", "\u8b66\u544a\u5185\u5bb9", "\u5efa\u8bae3"),
        )
        text = build_narration(diags, "Danger", "zh")
        # Critical should appear before warning, which appears before info
        crit_pos = text.index("\u4e25\u91cd\u6807\u9898")
        warn_pos = text.index("\u8b66\u544a\u6807\u9898")
        info_pos = text.index("\u4fe1\u606f\u6807\u9898")
        assert crit_pos < warn_pos < info_pos
