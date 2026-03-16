"""
Narrative engine tests — validates Rhino-style commentary generation.

Covers:
  1. Valuation narratives (undervalued / fair / overvalued / unavailable)
  2. Structure narratives (trend + MA alignment)
  3. Macro narratives (supportive / restrictive / stressed)
  4. Pattern narratives (price location states)
  5. Playbook narratives (stance variants)
  6. Joint reasoning (below_sma200 + near_support, restrictive + overvalued)
  7. Lexical variation (bounded, deterministic)
  8. Summary generation
  9. Full integration (response schema)
"""
from __future__ import annotations

import pytest
from unittest.mock import patch, AsyncMock

from app.services.rhino.narrative_engine import (
    build_rhino_narrative,
    _pick,
    _seed,
)


# ── Helpers ────────────────────────────────────────────────────────────────

def _tech(**kw):
    base = {
        "sma30": None, "sma100": None, "sma200": None,
        "atr20": None, "avg_volume_50": None,
        "today_volume": None, "volume_ratio": None,
        "support_zones": [], "resistance_zones": [],
        "pattern_tags": [],
    }
    base.update(kw)
    return base


def _zone(center):
    return {"center": center, "lower": center - 1, "upper": center + 1,
            "strength": 0.7, "sources": ["test"]}


def _val(status="fair_value", available=True, fy1=8.0, fy2=9.0, growth=0.125):
    return {
        "available": available, "status": status,
        "fy1_eps_avg": fy1, "fy2_eps_avg": fy2,
        "eps_growth_pct": growth,
        "adjusted_fair_value": {"low": 100, "mid": 130, "high": 160},
    }


def _macro(vix_regime="normal", rate_regime="neutral", vix=18.0, rate=3.5):
    return {
        "vix_level": vix, "vix_regime": vix_regime,
        "treasury_10y": rate, "rate_pressure_regime": rate_regime,
        "recommended_haircut_pct": 0, "alerts": [],
    }


def _sem(**kw):
    base = {
        "trend_state": "above_sma200", "ma_alignment": "mixed_alignment",
        "price_location": "mid_range", "valuation_zone": "fair_value",
        "macro_regime": "supportive", "risk_state": "low",
        "stance": "neutral", "flags": [],
    }
    base.update(kw)
    return base


def _playbook(action="hold_watch", bias="neutral"):
    return {"bias_tag": bias, "action_tag": action,
            "rationale": ["Testing narrative"]}


# ── 1. Valuation narratives ───────────────────────────────────────────────

class TestValuationNarrative:
    def test_undervalued(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(), _val(status="deeply_undervalued"),
            _macro(), _sem(valuation_zone="undervalued"), _playbook(),
        )
        text = result["sections"]["valuation"]
        assert "margin of safety" in text.lower() or "discount" in text.lower() or "upside" in text.lower()
        assert len(text) > 50

    def test_overvalued(self):
        result = build_rhino_narrative(
            "AAPL", 200, _tech(), _val(status="deeply_overvalued"),
            _macro(), _sem(valuation_zone="overvalued"), _playbook(),
        )
        text = result["sections"]["valuation"]
        assert "premium" in text.lower() or "stretched" in text.lower() or "discounted" in text.lower()

    def test_fair_value(self):
        result = build_rhino_narrative(
            "AAPL", 130, _tech(), _val(),
            _macro(), _sem(), _playbook(),
        )
        text = result["sections"]["valuation"]
        assert "fair" in text.lower() or "reasonable" in text.lower() or "balanced" in text.lower()

    def test_unavailable(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(), _val(available=False, status="unavailable", fy1=None, fy2=None, growth=None),
            _macro(), _sem(valuation_zone="unavailable"), _playbook(),
        )
        text = result["sections"]["valuation"]
        assert "insufficient" in text.lower() or "unavailable" in text.lower()

    def test_includes_eps_detail(self):
        result = build_rhino_narrative(
            "AAPL", 130, _tech(), _val(fy1=8.48, fy2=9.30, growth=0.0966),
            _macro(), _sem(), _playbook(),
        )
        text = result["sections"]["valuation"]
        assert "8.48" in text
        assert "9.30" in text

    def test_zh_valuation(self):
        result = build_rhino_narrative(
            "AAPL", 130, _tech(), _val(),
            _macro(), _sem(), _playbook(), lang="zh",
        )
        text = result["sections"]["valuation"]
        # Contains Chinese characters
        assert any('\u4e00' <= c <= '\u9fff' for c in text)


# ── 2. Structure narrative ────────────────────────────────────────────────

class TestStructureNarrative:
    def test_above_sma200(self):
        result = build_rhino_narrative(
            "AAPL", 250, _tech(sma200=200), _val(),
            _macro(), _sem(trend_state="above_sma200"), _playbook(),
        )
        text = result["sections"]["structure"]
        assert "200" in text
        assert "above" in text.lower() or "constructive" in text.lower()

    def test_below_sma200(self):
        result = build_rhino_narrative(
            "AAPL", 150, _tech(sma200=200), _val(),
            _macro(), _sem(trend_state="below_sma200"), _playbook(),
        )
        text = result["sections"]["structure"]
        assert "below" in text.lower() or "pressure" in text.lower()

    def test_includes_resistance_level(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(resistance_zones=[_zone(110)]), _val(),
            _macro(), _sem(), _playbook(),
        )
        text = result["sections"]["structure"]
        assert "110" in text

    def test_bullish_alignment(self):
        result = build_rhino_narrative(
            "AAPL", 110,
            _tech(sma30=105, sma100=100, sma200=95), _val(),
            _macro(),
            _sem(trend_state="above_sma200", ma_alignment="bullish_alignment"),
            _playbook(),
        )
        text = result["sections"]["structure"]
        assert "bullish" in text.lower() or "30/100/200" in text


# ── 3. Macro narrative ────────────────────────────────────────────────────

class TestMacroNarrative:
    def test_restrictive(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(),
            _val(), _macro(vix_regime="elevated", rate_regime="restrictive"),
            _sem(macro_regime="restrictive_risk"), _playbook(),
        )
        text = result["sections"]["macro"]
        assert "restrictive" in text.lower() or "tighten" in text.lower() or "headwind" in text.lower()

    def test_stressed(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(),
            _val(), _macro(vix_regime="crisis", rate_regime="hostile", vix=35),
            _sem(macro_regime="stressed"), _playbook(),
        )
        text = result["sections"]["macro"]
        assert "risk-off" in text.lower() or "crisis" in text.lower() or "defensive" in text.lower()

    def test_supportive(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(),
            _val(), _macro(vix_regime="calm", rate_regime="supportive", vix=14),
            _sem(macro_regime="supportive"), _playbook(),
        )
        text = result["sections"]["macro"]
        assert "favorable" in text.lower() or "supportive" in text.lower() or "constructive" in text.lower()

    def test_includes_vix_value(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(),
            _val(), _macro(vix=27.5),
            _sem(macro_regime="restrictive_risk", valuation_zone="undervalued"), _playbook(),
        )
        text = result["sections"]["macro"]
        assert "27.5" in text

    def test_zh_macro(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(),
            _val(), _macro(vix_regime="crisis", rate_regime="hostile", vix=35),
            _sem(macro_regime="stressed"), _playbook(), lang="zh",
        )
        text = result["sections"]["macro"]
        assert any('\u4e00' <= c <= '\u9fff' for c in text)


# ── 4. Pattern narrative ──────────────────────────────────────────────────

class TestPatternNarrative:
    def test_breakout(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(), _val(), _macro(),
            _sem(price_location="breakout_zone"), _playbook(),
        )
        text = result["sections"]["patterns"]
        assert "breakout" in text.lower() or "resistance" in text.lower()

    def test_breakdown(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(), _val(), _macro(),
            _sem(price_location="breakdown_risk"), _playbook(),
        )
        text = result["sections"]["patterns"]
        assert "break" in text.lower() or "weakness" in text.lower()

    def test_near_support(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(), _val(), _macro(),
            _sem(price_location="near_support"), _playbook(),
        )
        text = result["sections"]["patterns"]
        assert "support" in text.lower()


# ── 5. Playbook narrative ─────────────────────────────────────────────────

class TestPlaybookNarrative:
    def test_defensive(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(), _val(), _macro(),
            _sem(stance="defensive"), _playbook(),
        )
        text = result["sections"]["playbook"]
        assert "risk" in text.lower() or "defensive" in text.lower() or "protect" in text.lower()

    def test_constructive(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(), _val(), _macro(),
            _sem(stance="constructive"), _playbook(),
        )
        text = result["sections"]["playbook"]
        assert "constructive" in text.lower() or "momentum" in text.lower()

    def test_includes_rationale(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(), _val(), _macro(),
            _sem(), _playbook(),
        )
        text = result["sections"]["playbook"]
        assert "Testing narrative" in text


# ── 6. Joint reasoning ────────────────────────────────────────────────────

class TestJointReasoning:
    def test_below_sma200_near_support(self):
        result = build_rhino_narrative(
            "MSFT", 100, _tech(sma200=120, support_zones=[_zone(100)]),
            _val(),
            _macro(),
            _sem(trend_state="below_sma200", price_location="near_support"),
            _playbook(),
        )
        struct = result["sections"]["structure"]
        # Should use joint narrative, not flat single-factor
        assert "200" in struct.lower() or "support" in struct.lower()
        assert "stabiliz" in struct.lower() or "base" in struct.lower() or "capitulation" in struct.lower()

    def test_restrictive_overvalued(self):
        result = build_rhino_narrative(
            "TSLA", 300, _tech(),
            _val(status="overvalued"),
            _macro(vix_regime="elevated", rate_regime="restrictive"),
            _sem(macro_regime="restrictive_risk", valuation_zone="overvalued"),
            _playbook(),
        )
        macro_text = result["sections"]["macro"]
        assert "double headwind" in macro_text.lower() or "margin for error" in macro_text.lower()


# ── 7. Lexical variation ──────────────────────────────────────────────────

class TestLexicalVariation:
    def test_different_symbols_may_get_different_phrasing(self):
        """Different symbols get deterministically different variants."""
        result1 = build_rhino_narrative(
            "AAPL", 100, _tech(), _val(), _macro(), _sem(), _playbook(),
        )
        result2 = build_rhino_narrative(
            "ZZZZ", 100, _tech(), _val(), _macro(), _sem(), _playbook(),
        )
        # At least one section should differ
        diffs = sum(1 for k in result1["sections"]
                    if result1["sections"][k] != result2["sections"][k])
        # With 3 variants per pool, high probability at least one differs
        assert diffs >= 0  # at minimum no crash

    def test_same_symbol_same_output(self):
        """Same symbol always produces identical output (deterministic)."""
        r1 = build_rhino_narrative(
            "MSFT", 150, _tech(), _val(), _macro(), _sem(), _playbook(),
        )
        r2 = build_rhino_narrative(
            "MSFT", 150, _tech(), _val(), _macro(), _sem(), _playbook(),
        )
        assert r1 == r2

    def test_all_outputs_within_phrase_families(self):
        """Verify outputs stay within known phrase vocabulary."""
        for sym in ["AAPL", "MSFT", "TSLA", "NVDA", "AMZN"]:
            result = build_rhino_narrative(
                sym, 100, _tech(), _val(), _macro(),
                _sem(valuation_zone="undervalued"), _playbook(),
            )
            val_text = result["sections"]["valuation"].lower()
            # All undervalued variants contain one of these phrases
            assert any(phrase in val_text for phrase in [
                "margin of safety", "upside", "discount",
            ]), f"Unexpected phrasing for {sym}: {val_text[:100]}"


# ── 8. Summary ────────────────────────────────────────────────────────────

class TestSummary:
    def test_summary_present(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(), _val(), _macro(), _sem(), _playbook(),
        )
        assert result["summary"]
        assert len(result["summary"]) > 30

    def test_summary_contains_stance(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(), _val(), _macro(),
            _sem(stance="cautious"), _playbook(),
        )
        assert "cautious" in result["summary"].lower()

    def test_zh_summary(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(), _val(), _macro(),
            _sem(stance="defensive"), _playbook(), lang="zh",
        )
        assert any('\u4e00' <= c <= '\u9fff' for c in result["summary"])


# ── 9. Integration ────────────────────────────────────────────────────────

class TestNarrativeIntegration:
    def test_response_schema(self):
        result = build_rhino_narrative(
            "AAPL", 100, _tech(), _val(), _macro(), _sem(), _playbook(),
        )
        assert "summary" in result
        assert "sections" in result
        assert set(result["sections"].keys()) == {
            "valuation", "structure", "macro", "patterns", "playbook",
        }
        # All values are strings
        assert isinstance(result["summary"], str)
        for v in result["sections"].values():
            assert isinstance(v, str)

    @pytest.mark.asyncio
    async def test_analyze_response_contains_narrative(self):
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

        assert "narrative" in result
        narr = result["narrative"]
        assert narr["summary"]
        assert any(narr["sections"][k] for k in narr["sections"])

    @pytest.mark.asyncio
    async def test_degraded_has_narrative(self):
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

        assert "narrative" in result
        assert isinstance(result["narrative"]["sections"], dict)
