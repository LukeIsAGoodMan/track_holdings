"""
Rhino logic alignment tests — validates that Rhino decision logic
matches the reference analysis.py framework.

Tests:
  1. Valuation classification matches analysis.py thresholds
  2. Valuation style layer adjusts PE bands correctly
  3. Macro risk detection matches analysis.py rules
  4. Playbook decisions match analysis.py decision tree
  5. Volume thresholds match analysis.py (1.5x high, 0.8x low)
  6. Dead cat bounce requires no high volume
  7. Reversal at support requires volume confirmation for strong_buy
"""
from __future__ import annotations

import pytest

from app.services.rhino.valuation_engine import build_valuation, _compute_avg_growth, MIN_VALID_EPS
from app.services.rhino.valuation_style_engine import (
    detect_valuation_style,
    apply_style_adjustment,
    StyleResult,
    PeAuditTrail,
    TICKER_SECTOR_OVERRIDE,
)
from app.services.rhino.playbook_engine import build_playbook, determine_playbook_framing
from app.services.rhino.technical_engine import _detect_patterns
from app.services.rhino.macro_engine import build_macro
from app.services.rhino.rhino_report_engine import build_battle_report
from app.services.rhino.fundamental_narrative_engine import (
    build_fundamental_narrative,
    _classify as narrative_classify,
)


# ══════════════════════════════════════════════════════════════════════════
# FIXTURES
# ══════════════════════════════════════════════════════════════════════════

def _make_bars(n, base=100.0, volume=1_000_000):
    from datetime import date, timedelta
    start = date(2024, 1, 2)
    bars = []
    for i in range(n):
        d = start + timedelta(days=i)
        p = base + i * 0.1
        bars.append({
            "date": d.isoformat(),
            "open": p, "high": p + 1, "low": p - 1, "close": p,
            "volume": volume,
        })
    return bars


# ══════════════════════════════════════════════════════════════════════════
# PART 1: VALUATION CLASSIFICATION — analysis.py PE discipline
# ══════════════════════════════════════════════════════════════════════════

class TestValuationClassification:
    """analysis.py PE discipline: growth → PE band, eps_ny → fair value range."""

    def test_high_growth_pe_band(self):
        """growth > 50% → PE 35-45x (analysis.py)."""
        # CAGR(3.0→7.0)^0.5 - 1 = 52.8% > 50%
        est = {"fy0_eps_avg": 3.0, "fy1_eps_avg": 5.0, "fy2_eps_avg": 7.0}
        result = build_valuation(est, 350, 0)
        assert result["pe_band_low"] == 35
        assert result["pe_band_high"] == 45

    def test_moderate_growth_pe_band(self):
        """growth > 20% → PE 25-37.5x (analysis.py)."""
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 6.0, "fy2_eps_avg": 7.5}
        result = build_valuation(est, 200, 0)
        assert result["pe_band_low"] == 25
        assert result["pe_band_high"] == 37.5

    def test_low_growth_pe_band(self):
        """growth > 10% → PE 22.5-32.5x (analysis.py)."""
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 5.5, "fy2_eps_avg": 6.1}
        result = build_valuation(est, 150, 0)
        assert result["pe_band_low"] == 22.5
        assert result["pe_band_high"] == 32.5

    def test_no_growth_pe_band(self):
        """growth ≤ 10% → base PE 15-25x (analysis.py).

        With no sector_hint and low growth → defensive style (0.85x).
        """
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 5.0, "fy2_eps_avg": 5.2}
        result = build_valuation(est, 100, 0)
        # CAGR ~2% → base PE 15-25, growth <8% → defensive style → 0.85x
        assert result["valuation_style"] == "defensive"
        assert result["pe_band_low"] == 15 * 0.85
        assert result["pe_band_high"] == 25 * 0.85

    def test_fy2_anchor(self):
        """FY2 is used as valuation anchor when available."""
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 6.0, "fy2_eps_avg": 7.0}
        result = build_valuation(est, 200, 0)
        raw = result["raw_fair_value"]
        # FY2 (7.0) * PE_low should equal raw_low
        assert raw["low"] == 7.0 * result["pe_band_low"]

    def test_deeply_undervalued(self):
        """Price < adjusted_low * 0.85 → deeply_undervalued."""
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 6.0, "fy2_eps_avg": 7.0}
        # FY2=7, growth~18%, PE 25-37.5, raw_low=175
        # Price well below 175*0.85=148.75
        result = build_valuation(est, 100, 0)
        assert result["status"] == "deeply_undervalued"

    def test_deeply_overvalued(self):
        """Price > adjusted_high * 1.15 → deeply_overvalued."""
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 6.0, "fy2_eps_avg": 7.0}
        # FY2=7, PE 25-37.5, raw_high=262.5
        # Price well above 262.5*1.15=301.875
        result = build_valuation(est, 350, 0)
        assert result["status"] == "deeply_overvalued"

    def test_haircut_applied(self):
        """Macro haircut reduces adjusted band but not raw band."""
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 6.0, "fy2_eps_avg": 7.0}
        result = build_valuation(est, 200, 10)  # 10% haircut
        raw = result["raw_fair_value"]
        adj = result["adjusted_fair_value"]
        assert adj["low"] == raw["low"] * 0.9
        assert adj["mid"] == raw["mid"] * 0.9

    def test_unavailable_when_no_fy1(self):
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": None, "fy2_eps_avg": None}
        result = build_valuation(est, 200, 0)
        assert result["status"] == "unavailable"
        assert result["available"] is False


# ══════════════════════════════════════════════════════════════════════════
# PART 2: VALUATION STYLE LAYER
# ══════════════════════════════════════════════════════════════════════════

class TestValuationStyle:
    """Style layer prevents PE distortion for non-growth stocks."""

    def test_financial_from_sector_hint(self):
        style = detect_valuation_style({"eps_growth_pct": 0.25}, sector_hint="Financial")
        assert style.style == "financial"

    def test_cyclical_from_sector_hint(self):
        style = detect_valuation_style({"eps_growth_pct": 0.30}, sector_hint="Energy")
        assert style.style == "cyclical"

    def test_sector_hint_overrides_growth(self):
        """High growth cyclical should NOT be classified as growth."""
        style = detect_valuation_style({"eps_growth_pct": 0.60}, sector_hint="Materials")
        assert style.style == "cyclical"

    def test_financial_from_ticker(self):
        style = detect_valuation_style({"eps_growth_pct": 0.20}, symbol="JPM")
        assert style.style == "financial"

    def test_cyclical_from_ticker(self):
        style = detect_valuation_style({"eps_growth_pct": 0.20}, symbol="XOM")
        assert style.style == "cyclical"

    def test_growth_from_heuristic(self):
        style = detect_valuation_style({"eps_growth_pct": 0.25})
        assert style.style == "growth"

    def test_defensive_from_heuristic(self):
        style = detect_valuation_style({"eps_growth_pct": 0.05})
        assert style.style == "defensive"

    def test_unknown_fallback_with_eps(self):
        """No growth data but valid EPS → unknown."""
        style = detect_valuation_style({"eps_growth_pct": None, "fy1_eps_avg": 5.0, "fy2_eps_avg": 6.0})
        assert style.style == "unknown"

    def test_no_eps_no_growth_pre_profit(self):
        """No growth + no EPS → pre_profit safety guard."""
        style = detect_valuation_style({"eps_growth_pct": None})
        assert style.style == "pre_profit"

    def test_moderate_growth_unknown(self):
        """Growth 8-15% with no sector hint → unknown."""
        style = detect_valuation_style({"eps_growth_pct": 0.12})
        assert style.style == "unknown"


class TestPeAdjustment:
    """PE adjustments applied correctly per style."""

    def test_growth_no_change(self):
        style = detect_valuation_style({"eps_growth_pct": 0.25})
        adj_lo, adj_hi = apply_style_adjustment(25, 37.5, style)
        assert adj_lo == 25
        assert adj_hi == 37.5

    def test_cyclical_compressed(self):
        style = detect_valuation_style({"eps_growth_pct": 0.20}, sector_hint="Energy")
        adj_lo, adj_hi = apply_style_adjustment(25, 37.5, style)
        assert adj_lo == 25 * 0.75  # 18.75
        assert adj_hi == round(37.5 * 0.75, 2)  # 28.12

    def test_financial_clamped(self):
        style = detect_valuation_style({"eps_growth_pct": 0.20}, sector_hint="Financials")
        adj_lo, adj_hi = apply_style_adjustment(25, 37.5, style)
        assert adj_lo <= 15
        assert adj_hi <= 18

    def test_defensive_compressed(self):
        style = detect_valuation_style({"eps_growth_pct": 0.05})
        adj_lo, adj_hi = apply_style_adjustment(15, 25, style)
        assert adj_lo == 15 * 0.85
        assert adj_hi == 25 * 0.85

    def test_unknown_no_change(self):
        style = detect_valuation_style({"eps_growth_pct": 0.12})
        adj_lo, adj_hi = apply_style_adjustment(22.5, 32.5, style)
        assert adj_lo == 22.5
        assert adj_hi == 32.5

    def test_pe_audit_trail(self):
        """Audit trail records base vs adjusted PE."""
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 6.0, "fy2_eps_avg": 7.0}
        result = build_valuation(est, 200, 0, symbol="JPM")
        audit = result["_pe_audit"]
        assert audit is not None
        assert audit["valuation_style"] == "financial"
        assert audit["base_pe_low"] > audit["adjusted_pe_low"] or \
               audit["base_pe_high"] > audit["adjusted_pe_high"]

    def test_style_in_valuation_output(self):
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 6.0, "fy2_eps_avg": 7.0}
        result = build_valuation(est, 200, 0, symbol="XOM")
        assert result["valuation_style"] == "cyclical"

    def test_financial_valuation_much_lower(self):
        """Financial stock PE should be much tighter than growth."""
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 6.0, "fy2_eps_avg": 7.0}
        growth_val = build_valuation(est, 200, 0)
        fin_val = build_valuation(est, 200, 0, symbol="JPM")
        assert fin_val["raw_fair_value"]["high"] < growth_val["raw_fair_value"]["high"]


# ══════════════════════════════════════════════════════════════════════════
# PART 3: MACRO RISK DETECTION — analysis.py aligned
# ══════════════════════════════════════════════════════════════════════════

class TestMacroAlignment:
    """Macro thresholds match analysis.py exactly."""

    def test_vix_22_triggers(self):
        """analysis.py: if vix >= 22 → alert."""
        macro = build_macro({"vix": 22.0, "us10y": 3.5})
        # Macro engine classifies regime; report engine fires risk signal.
        # VIX 22 falls in "elevated" regime (20-30), report fires at >= 22.
        assert macro["vix_regime"] == "elevated"

    def test_vix_18_safe(self):
        """analysis.py: if vix <= 18 → safe."""
        macro = build_macro({"vix": 18.0, "us10y": 3.5})
        assert macro["vix_regime"] == "normal"

    def test_treasury_425_alert(self):
        """analysis.py: if treasury >= 4.25 → DCF headwind."""
        macro = build_macro({"vix": 15.0, "us10y": 4.25})
        assert macro["rate_pressure_regime"] == "restrictive"

    def test_macro_haircuts(self):
        """VIX + rate haircuts sum correctly."""
        macro = build_macro({"vix": 25.0, "us10y": 4.5})
        # elevated VIX (5%) + restrictive rates (5%) = 10%
        assert macro["recommended_haircut_pct"] == 10


# ══════════════════════════════════════════════════════════════════════════
# PART 4: PLAYBOOK — analysis.py decision tree
# ══════════════════════════════════════════════════════════════════════════

class TestPlaybookAlignment:
    """Playbook decisions match analysis.py patterns."""

    def test_reversal_with_volume_strong_buy(self):
        """analysis.py: reversal at support + high volume = left-side defense buy."""
        tech = {
            "pattern_tags": ["above_sma200", "reversal_at_support", "high_volume"],
            "support_zones": [{"center": 190}],
            "resistance_zones": [],
        }
        val = {"status": "undervalued"}
        result = build_playbook(tech, val, "normal")
        assert result["action_tag"] == "strong_buy"

    def test_reversal_without_volume_not_strong_buy(self):
        """Without volume confirmation, reversal is not strong_buy."""
        tech = {
            "pattern_tags": ["above_sma200", "reversal_at_support"],
            "support_zones": [{"center": 190}],
            "resistance_zones": [],
        }
        val = {"status": "undervalued"}
        result = build_playbook(tech, val, "normal")
        # Should still be bullish (valuation + above_sma200 = +2) but not strong_buy
        assert result["action_tag"] == "defensive_buy"

    def test_break_below_support_stop_loss(self):
        """analysis.py: broke support = '挨打立正，严格止损'."""
        tech = {
            "pattern_tags": ["below_sma200", "break_below_support"],
            "support_zones": [],
            "resistance_zones": [],
        }
        val = {"status": "overvalued"}
        result = build_playbook(tech, val, "normal")
        assert result["action_tag"] == "stop_loss"

    def test_dead_cat_bounce_bearish(self):
        """Dead cat bounce = bearish signal."""
        tech = {
            "pattern_tags": ["below_sma200", "break_below_support", "dead_cat_bounce"],
            "support_zones": [],
            "resistance_zones": [],
        }
        val = {"status": "fair_value"}
        result = build_playbook(tech, val, "normal")
        assert result["bias_tag"] == "bearish"

    def test_vix_crisis_override(self):
        """VIX crisis forces reduce regardless of other signals."""
        tech = {
            "pattern_tags": ["above_sma200"],
            "support_zones": [],
            "resistance_zones": [],
        }
        val = {"status": "fair_value"}
        result = build_playbook(tech, val, "crisis")
        assert result["action_tag"] == "reduce"

    def test_limbo_zone_hold_watch(self):
        """analysis.py: limbo zone = 多看少动."""
        tech = {
            "pattern_tags": ["above_sma200", "limbo_zone"],
            "support_zones": [],
            "resistance_zones": [],
        }
        val = {"status": "fair_value"}
        result = build_playbook(tech, val, "normal")
        assert result["action_tag"] == "hold_watch"


# ══════════════════════════════════════════════════════════════════════════
# PART 5: VOLUME THRESHOLDS — analysis.py aligned
# ══════════════════════════════════════════════════════════════════════════

class TestVolumeThresholds:
    """Volume thresholds match analysis.py: 1.5x high, 0.8x low."""

    def test_high_volume_at_150pct(self):
        """≥1.5x average = high volume."""
        bars = _make_bars(20, volume=1_000_000)
        bars[-1]["volume"] = 1_500_000  # exactly 1.5x
        support = [{"center": 80, "lower": 78, "upper": 82, "strength": 0.5, "sources": []}]
        tags = _detect_patterns(bars, bars[-1]["close"], 95.0, support, 1.5)
        assert "high_volume" in tags

    def test_low_volume_at_079(self):
        """<0.8x average = low volume (analysis.py: <0.8x严重缩量)."""
        bars = _make_bars(20, volume=1_000_000)
        support = [{"center": 80, "lower": 78, "upper": 82, "strength": 0.5, "sources": []}]
        tags = _detect_patterns(bars, bars[-1]["close"], 95.0, support, 0.79)
        assert "low_volume" in tags

    def test_volume_081_not_low(self):
        """0.81x should NOT trigger low volume (threshold is 0.8)."""
        bars = _make_bars(20, volume=1_000_000)
        support = [{"center": 80, "lower": 78, "upper": 82, "strength": 0.5, "sources": []}]
        tags = _detect_patterns(bars, bars[-1]["close"], 95.0, support, 0.81)
        assert "low_volume" not in tags

    def test_dead_cat_bounce_requires_no_high_volume(self):
        """analysis.py: dead cat bounce only when not high volume."""
        bars = _make_bars(20, base=100.0, volume=1_000_000)
        # Price broke below support
        support_center = bars[-1]["close"] + 5
        support = [{"center": support_center, "lower": support_center - 2,
                     "upper": support_center + 2, "strength": 0.5, "sources": []}]
        # Set up dead cat bounce conditions: price > recent_low, price < support
        bars[-1]["close"] = support_center - 3
        bars[-1]["low"] = support_center - 5  # recent low
        bars[-2]["low"] = support_center - 8  # deeper low
        bars[-3]["low"] = support_center - 10
        bars[-4]["low"] = support_center - 10
        bars[-5]["low"] = support_center - 10

        # With low volume (< 1.5x) → should get dead_cat_bounce
        tags_low_vol = _detect_patterns(bars, bars[-1]["close"], 200.0, support, 1.0)
        assert "dead_cat_bounce" in tags_low_vol

        # With high volume (≥ 1.5x) → should NOT get dead_cat_bounce
        tags_high_vol = _detect_patterns(bars, bars[-1]["close"], 200.0, support, 1.5)
        assert "dead_cat_bounce" not in tags_high_vol


# ══════════════════════════════════════════════════════════════════════════
# PART 6: BATTLE REPORT — UPSIDE FRAMING
# ══════════════════════════════════════════════════════════════════════════

class TestUpsideFraming:
    """Defensive/cyclical styles use recovery framing, growth uses expansion."""

    def _report(self, valuation_style="growth"):
        val = {
            "available": True, "fy0_eps_avg": 5, "fy1_eps_avg": 6, "fy2_eps_avg": 7,
            "eps_growth_pct": 0.18, "pe_band_low": 25, "pe_band_high": 37.5,
            "raw_fair_value": {"low": 175, "mid": 218.75, "high": 262.5},
            "adjusted_fair_value": {"low": 170, "mid": 212.5, "high": 255},
            "status": "fair_value", "valuation_style": valuation_style,
        }
        tech = {
            "sma30": 200, "sma100": 195, "sma200": 190,
            "avg_volume_50": 5_000_000, "atr20": 3.5,
            "today_volume": 4_500_000, "volume_ratio": 1.2,
            "support_zones": [{"center": 190, "lower": 188, "upper": 192, "strength": 0.75, "sources": []}],
            "resistance_zones": [{"center": 220, "lower": 218, "upper": 222, "strength": 0.85, "sources": []}],
            "pattern_tags": [],
        }
        macro = {
            "vix_level": 18, "vix_regime": "normal",
            "treasury_10y": 4.0, "rate_pressure_regime": "neutral",
            "recommended_haircut_pct": 4, "alerts": [],
        }
        playbook = {"bias_tag": "neutral", "action_tag": "hold_watch", "rationale": []}
        narrative = build_fundamental_narrative(val, 200)
        return build_battle_report(200, tech, val, macro, playbook, narrative)

    def test_growth_expansion_framing(self):
        report = self._report("growth")
        assert report["playbook"]["upside"]["framing"] == "expansion"

    def test_defensive_recovery_framing(self):
        report = self._report("defensive")
        assert report["playbook"]["upside"]["framing"] == "recovery"

    def test_cyclical_recovery_framing(self):
        report = self._report("cyclical")
        assert report["playbook"]["upside"]["framing"] == "recovery"

    def test_financial_recovery_framing(self):
        report = self._report("financial")
        assert report["playbook"]["upside"]["framing"] == "recovery"

    def test_unknown_expansion_framing(self):
        report = self._report("unknown")
        assert report["playbook"]["upside"]["framing"] == "expansion"


# ══════════════════════════════════════════════════════════════════════════
# PART 7: TICKER SECTOR OVERRIDE — Priority 1 classification
# ══════════════════════════════════════════════════════════════════════════

class TestTickerSectorOverride:
    """TICKER_SECTOR_OVERRIDE is the highest priority in style detection."""

    def test_nvda_is_hyper_growth(self):
        style = detect_valuation_style({"eps_growth_pct": 0.05}, symbol="NVDA")
        assert style.style == "hyper_growth"

    def test_aapl_is_quality_mega_cap(self):
        style = detect_valuation_style({"eps_growth_pct": 0.05}, symbol="AAPL")
        assert style.style == "quality_mega_cap"

    def test_brk_b_is_defensive(self):
        style = detect_valuation_style({"eps_growth_pct": 0.25}, symbol="BRK.B")
        assert style.style == "defensive"

    def test_override_beats_sector_hint(self):
        """TICKER_SECTOR_OVERRIDE takes precedence over sector_hint."""
        style = detect_valuation_style(
            {"eps_growth_pct": 0.25}, sector_hint="Financials", symbol="NVDA"
        )
        assert style.style == "hyper_growth"

    def test_override_beats_ticker_set(self):
        """BRK.B is in _FINANCIAL_TICKERS, but override says defensive."""
        style = detect_valuation_style({"eps_growth_pct": 0.25}, symbol="BRK.B")
        assert style.style == "defensive"

    def test_all_overrides_valid_styles(self):
        """Every value in TICKER_SECTOR_OVERRIDE maps to a known style."""
        valid_styles = {"growth", "quality_mega_cap", "cyclical", "financial", "defensive", "hyper_growth", "pre_profit", "unknown"}
        for ticker, style_name in TICKER_SECTOR_OVERRIDE.items():
            assert style_name in valid_styles, f"{ticker} → {style_name} is not a valid style"

    def test_meta_growth_through_valuation(self):
        """Full pipeline: META should get growth PE bands."""
        est = {"fy0_eps_avg": 10.0, "fy1_eps_avg": 15.0, "fy2_eps_avg": 20.0}
        result = build_valuation(est, 500, 0, symbol="META")
        assert result["valuation_style"] == "growth"


# ══════════════════════════════════════════════════════════════════════════
# PART 8: EPS SANITY CAP
# ══════════════════════════════════════════════════════════════════════════

class TestEpsSanityCap:
    """MIN_VALID_EPS forces fair_value + low confidence when anchor EPS is tiny."""

    def test_eps_below_minimum(self):
        est = {"fy0_eps_avg": 0.1, "fy1_eps_avg": 0.3, "fy2_eps_avg": 0.4}
        result = build_valuation(est, 100, 0)
        assert result["status"] == "fair_value"
        assert result["valuation_confidence"] == "low"

    def test_eps_at_minimum_ok(self):
        est = {"fy0_eps_avg": 0.3, "fy1_eps_avg": 0.4, "fy2_eps_avg": 0.5}
        result = build_valuation(est, 100, 0)
        assert result["valuation_confidence"] == "normal"

    def test_eps_well_above_minimum(self):
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 6.0, "fy2_eps_avg": 7.0}
        result = build_valuation(est, 200, 0)
        assert result["valuation_confidence"] == "normal"

    def test_negative_eps_unavailable(self):
        """Negative FY1 → unavailable (before sanity cap is checked)."""
        est = {"fy0_eps_avg": -1.0, "fy1_eps_avg": -2.0, "fy2_eps_avg": -1.5}
        result = build_valuation(est, 100, 0)
        assert result["status"] == "unavailable"
        assert result["available"] is False


# ══════════════════════════════════════════════════════════════════════════
# PART 9: CLASSIFICATION BOUNDARY GUARDS
# ══════════════════════════════════════════════════════════════════════════

class TestClassificationGuards:
    """Narrative _classify() handles degenerate fair-value bands gracefully."""

    def test_raw_low_zero(self):
        assert narrative_classify(100, 0, 200) == "fair"

    def test_raw_high_zero(self):
        assert narrative_classify(100, 50, 0) == "fair"

    def test_raw_low_negative(self):
        assert narrative_classify(100, -10, 200) == "fair"

    def test_raw_high_negative(self):
        assert narrative_classify(100, 50, -10) == "fair"

    def test_inverted_band(self):
        """raw_low >= raw_high → degenerate, fallback to fair."""
        assert narrative_classify(100, 200, 100) == "fair"

    def test_equal_band(self):
        """raw_low == raw_high → degenerate."""
        assert narrative_classify(100, 150, 150) == "fair"

    def test_normal_band_still_works(self):
        """Valid band should still classify normally."""
        assert narrative_classify(100, 200, 300) == "deep_value"
        assert narrative_classify(250, 200, 300) == "fair"
        assert narrative_classify(350, 200, 300) == "premium"


# ══════════════════════════════════════════════════════════════════════════
# PART 10: PLAYBOOK FRAMING DISPATCHER
# ══════════════════════════════════════════════════════════════════════════

class TestPlaybookFramingDispatcher:
    """determine_playbook_framing() returns correct framing per style."""

    def test_growth_expansion(self):
        assert determine_playbook_framing("growth") == "expansion"

    def test_quality_mega_cap_expansion(self):
        assert determine_playbook_framing("quality_mega_cap") == "expansion"

    def test_unknown_expansion(self):
        assert determine_playbook_framing("unknown") == "expansion"

    def test_defensive_recovery(self):
        assert determine_playbook_framing("defensive") == "recovery"

    def test_cyclical_recovery(self):
        assert determine_playbook_framing("cyclical") == "recovery"

    def test_financial_recovery(self):
        assert determine_playbook_framing("financial") == "recovery"


# ══════════════════════════════════════════════════════════════════════════
# PART 11: NEGATIVE / EDGE-CASE INPUTS
# ══════════════════════════════════════════════════════════════════════════

class TestNegativeEdgeCases:
    """Negative EPS, negative growth, EPS near zero."""

    def test_negative_growth_lowest_bucket(self):
        """Negative growth → lowest PE bucket (15-25x base)."""
        est = {"fy0_eps_avg": 10.0, "fy1_eps_avg": 8.0, "fy2_eps_avg": 6.0}
        result = build_valuation(est, 100, 0)
        # CAGR(10→6)^0.5 -1 is negative → base 15-25
        # Negative growth < 8% → defensive style (0.85x)
        assert result["pe_band_low"] == round(15 * 0.85, 2)
        assert result["pe_band_high"] == round(25 * 0.85, 2)

    def test_zero_fy1_unavailable(self):
        """FY1 EPS = 0 → unavailable."""
        est = {"fy0_eps_avg": 5.0, "fy1_eps_avg": 0, "fy2_eps_avg": 7.0}
        result = build_valuation(est, 100, 0)
        assert result["available"] is False

    def test_narrative_with_negative_raw(self):
        """Narrative engine handles negative raw values gracefully."""
        val = {
            "available": True,
            "raw_fair_value": {"low": -10, "mid": 0, "high": 10},
            "fy0_eps_avg": None, "fy1_eps_avg": 1.0, "fy2_eps_avg": None,
            "pe_band_low": 15, "pe_band_high": 25,
            "eps_growth_pct": None,
            "valuation_style": "unknown",
        }
        n = build_fundamental_narrative(val, 100)
        assert n.classification == "fair"  # Guard kicks in

    def test_eps_just_below_sanity_cap(self):
        """EPS at 0.49 (just below 0.5) → low confidence."""
        est = {"fy0_eps_avg": 0.2, "fy1_eps_avg": 0.3, "fy2_eps_avg": 0.49}
        result = build_valuation(est, 100, 0)
        assert result["valuation_confidence"] == "low"
        assert result["status"] == "fair_value"
