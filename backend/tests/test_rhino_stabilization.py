"""
Rhino Analysis stabilization tests.

Validates:
  1. Index symbol normalization (_fmp_sym adds '^' for indices only)
  2. Chart payload is self-contained (current_price + analysis_close)
  3. Analyst estimate fallback (new + old FMP schema)
  4. Analyst estimate fiscal-year selection (nearest future, not far-future)
  5. Treasury extraction (flat dict, no list[0] regression)
  6. EOD price change derivation (bars-only, no intraday quote)
  7. Boundary guard (0 or 1 bar does not crash)
  8. Valuation pipeline acceptance (must render when valid EPS exists)
  9. _coalesce + _safe_int helpers
"""
from __future__ import annotations

from unittest.mock import patch, AsyncMock

import pytest

from app.services.yfinance_client import (
    normalize_ticker,
    _fmp_sym,
    _coalesce,
    _safe_float_val,
    _safe_int,
    _do_fetch_analyst_estimates,
)


# ── Shared mock helpers ──────────────────────────────────────────────────

def _make_bars(n: int, base_price: float = 100.0) -> list[dict]:
    """Create n ascending-date bars for testing."""
    from datetime import date, timedelta
    start = date(2024, 1, 2)
    bars = []
    for i in range(n):
        d = start + timedelta(days=i)
        p = base_price + i * 0.5
        bars.append({
            "date": d.isoformat(),
            "open": p, "high": p + 1, "low": p - 1, "close": p,
            "volume": 1000000,
        })
    return bars


def _rhino_mocks(bars=None, estimates=None, macro=None):
    """Return a tuple of context managers for patching all Rhino data providers."""
    return (
        patch("app.services.rhino.get_history",
              new_callable=AsyncMock, return_value=bars or []),
        patch("app.services.rhino.get_estimates",
              new_callable=AsyncMock, return_value=estimates or {"fy1_eps_avg": None, "fy2_eps_avg": None}),
        patch("app.services.rhino.get_macro",
              new_callable=AsyncMock, return_value=macro or {"vix": None, "us10y": None}),
    )


# ── 1. Index symbol normalization ─────────────────────────────────────────


class TestIndexSymbolNormalization:
    """Ensure _fmp_sym adds '^' only for known index symbols."""

    def test_vix_gets_caret(self):
        assert _fmp_sym("VIX") == "^VIX"

    def test_gspc_gets_caret(self):
        assert _fmp_sym("GSPC") == "^GSPC"

    def test_spx_gets_caret(self):
        assert _fmp_sym("SPX") == "^SPX"

    def test_ndx_gets_caret(self):
        assert _fmp_sym("NDX") == "^NDX"

    def test_rut_gets_caret(self):
        assert _fmp_sym("RUT") == "^RUT"

    def test_aapl_no_caret(self):
        """Ordinary stock must NOT get a caret prefix."""
        assert _fmp_sym("AAPL") == "AAPL"

    def test_qqq_no_caret(self):
        """ETFs must NOT get a caret prefix."""
        assert _fmp_sym("QQQ") == "QQQ"

    def test_msft_no_caret(self):
        assert _fmp_sym("MSFT") == "MSFT"

    def test_spy_no_caret(self):
        """SPY is an ETF, not an index — must not get caret."""
        assert _fmp_sym("SPY") == "SPY"

    def test_normalize_strips_caret(self):
        assert normalize_ticker("^VIX") == "VIX"
        assert normalize_ticker("^GSPC") == "GSPC"

    def test_normalize_uppercases(self):
        assert normalize_ticker("aapl") == "AAPL"

    def test_fmp_sym_with_caret_input(self):
        """If user passes ^VIX, normalize strips it, _fmp_sym re-adds it."""
        assert _fmp_sym("^VIX") == "^VIX"

    def test_fmp_sym_lowercase_index(self):
        """Lowercase index input should still resolve correctly."""
        assert _fmp_sym("vix") == "^VIX"


# ── 2. Chart payload self-containment ─────────────────────────────────────


class TestChartPayload:
    """Chart section must include current_price and analysis_close."""

    @pytest.mark.asyncio
    async def test_chart_contains_price_fields(self):
        bars = _make_bars(5)
        expected_close = bars[-1]["close"]
        m1, m2, m3 = _rhino_mocks(
            bars=bars, macro={"vix": 18.0, "us10y": 4.2})

        with m1, m2, m3:
            from app.services.rhino import analyze
            result = await analyze("TEST", lang="en")

        chart = result["chart"]
        assert chart["current_price"] == expected_close
        assert chart["analysis_close"] == expected_close
        assert isinstance(chart["current_price"], float)

    @pytest.mark.asyncio
    async def test_degraded_chart_has_zero_prices(self):
        m1, m2, m3 = _rhino_mocks()

        with m1, m2, m3:
            from app.services.rhino import analyze
            result = await analyze("NODATA", lang="en")

        chart = result["chart"]
        assert chart["current_price"] == 0.0
        assert chart["analysis_close"] == 0.0


# ── 3. Analyst estimate helpers ───────────────────────────────────────────


class TestAnalystEstimateHelpers:
    """_coalesce, _safe_float_val, _safe_int must be None-safe."""

    def test_coalesce_prefers_first_key(self):
        d = {"epsAvg": 3.5, "estimatedEpsAvg": 3.0}
        assert _coalesce(d, "epsAvg", "estimatedEpsAvg") == 3.5

    def test_coalesce_falls_back_to_second(self):
        d = {"estimatedEpsAvg": 3.0}
        assert _coalesce(d, "epsAvg", "estimatedEpsAvg") == 3.0

    def test_coalesce_returns_none_if_both_missing(self):
        d = {"other": 1}
        assert _coalesce(d, "epsAvg", "estimatedEpsAvg") is None

    def test_coalesce_zero_is_not_none(self):
        """A value of 0 is legitimate — must not fall through."""
        d = {"epsAvg": 0, "estimatedEpsAvg": 5.0}
        assert _coalesce(d, "epsAvg", "estimatedEpsAvg") == 0

    def test_safe_float_val_handles_valid(self):
        assert _safe_float_val(3.14159) == 3.1416

    def test_safe_float_val_handles_none(self):
        assert _safe_float_val(None) is None

    def test_safe_int_handles_valid(self):
        assert _safe_int(42) == 42

    def test_safe_int_handles_none(self):
        assert _safe_int(None) == 0

    def test_safe_int_handles_zero(self):
        """Zero is a valid analyst count — must remain 0, not default."""
        assert _safe_int(0) == 0


# ── 4. Analyst estimate fiscal-year selection ─────────────────────────────


class TestEstimateFiscalYearSelection:
    """Parser must select nearest future FY, not far-future FY."""

    def test_selects_nearest_from_far_future_ordered_payload(self):
        """FMP returns 2030, 2029, ... 2025. Parser must pick 2025 as FY1."""
        fmp_payload = [
            {"date": "2030-09-30", "epsAvg": 15.0},
            {"date": "2029-09-30", "epsAvg": 13.0},
            {"date": "2028-09-30", "epsAvg": 11.0},
            {"date": "2027-09-30", "epsAvg": 9.5},
            {"date": "2026-09-30", "epsAvg": 8.0},
            {"date": "2025-09-30", "epsAvg": 7.0},
        ]

        with patch("app.services.yfinance_client._fmp_get", return_value=fmp_payload):
            result = _do_fetch_analyst_estimates("AAPL")

        assert result is not None
        estimates = result["estimates"]
        assert len(estimates) >= 2
        # FY1 = nearest future (2025 or 2026 depending on today)
        assert estimates[0]["date"] <= estimates[1]["date"]
        # Must NOT be the far-future year
        assert estimates[0]["date"] != "2030-09-30"

    def test_new_schema_epsAvg_parsed(self):
        """New FMP schema field epsAvg must be parsed correctly."""
        fmp_payload = [
            {"date": "2026-12-31", "epsAvg": 7.25, "revenueAvg": 500000000000},
            {"date": "2027-12-31", "epsAvg": 8.10, "revenueAvg": 550000000000},
        ]

        with patch("app.services.yfinance_client._fmp_get", return_value=fmp_payload):
            result = _do_fetch_analyst_estimates("AAPL")

        estimates = result["estimates"]
        assert estimates[0]["estimated_eps_avg"] == 7.25
        assert estimates[1]["estimated_eps_avg"] == 8.10

    def test_old_schema_estimatedEpsAvg_parsed(self):
        """Old FMP schema field estimatedEpsAvg must still work."""
        fmp_payload = [
            {"date": "2026-12-31", "estimatedEpsAvg": 7.25},
            {"date": "2027-12-31", "estimatedEpsAvg": 8.10},
        ]

        with patch("app.services.yfinance_client._fmp_get", return_value=fmp_payload):
            result = _do_fetch_analyst_estimates("AAPL")

        estimates = result["estimates"]
        assert estimates[0]["estimated_eps_avg"] == 7.25
        assert estimates[1]["estimated_eps_avg"] == 8.10

    def test_analyst_count_new_schema(self):
        """numAnalystsEps (new) must be parsed."""
        fmp_payload = [
            {"date": "2026-12-31", "epsAvg": 7.0, "numAnalystsEps": 30},
        ]

        with patch("app.services.yfinance_client._fmp_get", return_value=fmp_payload):
            result = _do_fetch_analyst_estimates("TEST")

        assert result["estimates"][0]["number_analysts_estimated_eps"] == 30

    def test_analyst_count_zero_preserved(self):
        """Zero analyst coverage must remain 0, not be treated as None."""
        fmp_payload = [
            {"date": "2026-12-31", "epsAvg": 7.0, "numAnalystsEps": 0},
        ]

        with patch("app.services.yfinance_client._fmp_get", return_value=fmp_payload):
            result = _do_fetch_analyst_estimates("TEST")

        assert result["estimates"][0]["number_analysts_estimated_eps"] == 0

    def test_date_canonicalized(self):
        """Dates with time components must be trimmed to YYYY-MM-DD."""
        fmp_payload = [
            {"date": "2026-12-31 00:00:00", "epsAvg": 7.0},
        ]

        with patch("app.services.yfinance_client._fmp_get", return_value=fmp_payload):
            result = _do_fetch_analyst_estimates("TEST")

        assert result["estimates"][0]["date"] == "2026-12-31"


# ── 5. Treasury extraction ────────────────────────────────────────────────


class TestTreasuryExtraction:
    """get_macro() must read year10 from a flat dict, not list[0]."""

    @pytest.mark.asyncio
    async def test_macro_extracts_year10(self):
        treasury_dict = {"date": "2025-03-14", "year10": 4.28, "year2": 3.95}

        with patch("app.services.rhino.providers.get_spot_price", new_callable=AsyncMock, return_value=18.5), \
             patch("app.services.rhino.providers.get_treasury_rates", new_callable=AsyncMock, return_value=treasury_dict):
            from app.services.rhino.providers import get_macro
            result = await get_macro()

        assert result["us10y"] == 4.28
        assert result["vix"] == 18.5

    @pytest.mark.asyncio
    async def test_macro_handles_none_treasury(self):
        with patch("app.services.rhino.providers.get_spot_price", new_callable=AsyncMock, return_value=None), \
             patch("app.services.rhino.providers.get_treasury_rates", new_callable=AsyncMock, return_value=None):
            from app.services.rhino.providers import get_macro
            result = await get_macro()

        assert result["vix"] is None
        assert result["us10y"] is None


# ── 6. EOD price change derivation ───────────────────────────────────────


class TestEodPriceChange:
    """change and change_pct must be derived from the last two bars."""

    @pytest.mark.asyncio
    async def test_change_from_bars(self):
        bars = _make_bars(3)  # closes: 100.0, 100.5, 101.0
        expected_change = 101.0 - 100.5
        expected_pct = expected_change / 100.5 * 100
        m1, m2, m3 = _rhino_mocks(
            bars=bars, macro={"vix": 15.0, "us10y": 4.0})

        with m1, m2, m3:
            from app.services.rhino import analyze
            result = await analyze("TEST", lang="en")

        quote = result["quote"]
        assert quote["price"] == 101.0
        assert quote["previous_close"] == 100.5
        assert abs(quote["change"] - round(expected_change, 4)) < 0.001
        assert abs(quote["change_pct"] - round(expected_pct, 4)) < 0.01


# ── 7. Boundary guard ────────────────────────────────────────────────────


class TestBoundaryGuard:
    """Endpoint must not crash with 0 or 1 bars."""

    @pytest.mark.asyncio
    async def test_zero_bars_returns_degraded(self):
        m1, m2, m3 = _rhino_mocks()

        with m1, m2, m3:
            from app.services.rhino import analyze
            result = await analyze("NODATA", lang="en")

        assert result["confidence"]["grade"] == "D"
        assert result["quote"] is None

    @pytest.mark.asyncio
    async def test_one_bar_no_crash(self):
        bars = _make_bars(1, base_price=50.0)
        m1, m2, m3 = _rhino_mocks(
            bars=bars, macro={"vix": 20.0, "us10y": None})

        with m1, m2, m3:
            from app.services.rhino import analyze
            result = await analyze("ONEBAR", lang="en")

        quote = result["quote"]
        assert quote["price"] == 50.0
        assert quote["previous_close"] is None
        assert quote["change"] is None
        assert quote["change_pct"] is None
        assert result["chart"]["current_price"] == 50.0


# ── 8. Valuation pipeline acceptance ─────────────────────────────────────


class TestValuationAcceptance:
    """MANDATORY: valuation.available must be True when valid FY1 EPS exists.

    This is the acceptance test proving the entire pipeline works end-to-end:
    estimate parser → provider → valuation engine → response contract.
    """

    @pytest.mark.asyncio
    async def test_valuation_renders_with_valid_eps(self):
        """Simulates AAPL-like estimates: FY1=7.25, FY2=8.10, price=195."""
        bars = _make_bars(30, base_price=195.0)
        estimates = {"fy1_eps_avg": 7.25, "fy2_eps_avg": 8.10}
        m1, m2, m3 = _rhino_mocks(
            bars=bars,
            estimates=estimates,
            macro={"vix": 18.0, "us10y": 4.2},
        )

        with m1, m2, m3:
            from app.services.rhino import analyze
            result = await analyze("AAPL", lang="en")

        valuation = result["valuation"]
        assert valuation["available"] is True, (
            "Valuation must render when valid FY1 EPS exists "
            f"(fy1={estimates['fy1_eps_avg']})"
        )
        assert valuation["fy1_eps_avg"] == 7.25
        assert valuation["fy2_eps_avg"] == 8.10
        assert valuation["eps_growth_pct"] is not None
        assert valuation["raw_fair_value"] is not None
        assert valuation["adjusted_fair_value"] is not None
        assert valuation["status"] != "unavailable"

    @pytest.mark.asyncio
    async def test_valuation_unavailable_with_no_eps(self):
        bars = _make_bars(10, base_price=100.0)
        m1, m2, m3 = _rhino_mocks(
            bars=bars, macro={"vix": 15.0, "us10y": 4.0})

        with m1, m2, m3:
            from app.services.rhino import analyze
            result = await analyze("NOEST", lang="en")

        valuation = result["valuation"]
        assert valuation["available"] is False
        assert valuation["status"] == "unavailable"

    @pytest.mark.asyncio
    async def test_valuation_unavailable_with_negative_eps(self):
        bars = _make_bars(10, base_price=50.0)
        estimates = {"fy1_eps_avg": -2.5, "fy2_eps_avg": None}
        m1, m2, m3 = _rhino_mocks(
            bars=bars,
            estimates=estimates,
            macro={"vix": 25.0, "us10y": 4.5},
        )

        with m1, m2, m3:
            from app.services.rhino import analyze
            result = await analyze("LOSS", lang="en")

        valuation = result["valuation"]
        assert valuation["available"] is False

    @pytest.mark.asyncio
    async def test_valuation_zh_no_false_unavailable_message(self):
        """Chinese text report must NOT say '数据不足' when valuation is available."""
        bars = _make_bars(30, base_price=195.0)
        estimates = {"fy1_eps_avg": 7.25, "fy2_eps_avg": 8.10}
        m1, m2, m3 = _rhino_mocks(
            bars=bars,
            estimates=estimates,
            macro={"vix": 18.0, "us10y": 4.2},
        )

        with m1, m2, m3:
            from app.services.rhino import analyze
            result = await analyze("AAPL", lang="zh")

        valuation_text = result["text"]["sections"]["valuation"]
        assert "分析师预估数据不足" not in valuation_text
        assert result["valuation"]["available"] is True


# ── 9. Multi-SMA computation ─────────────────────────────────────────────

class TestMultiSmaComputation:
    """Validates compute_sma_series_multi and chart SMA integration."""

    def test_sma30_valid_with_30_bars(self):
        from app.services.rhino.indicators import compute_sma_series_multi
        bars = _make_bars(30)
        result = compute_sma_series_multi(bars, [30, 100, 200])
        assert len(result[30]) == 1  # exactly enough for 1 SMA point
        assert result[100] == []
        assert result[200] == []

    def test_sma100_valid_with_100_bars(self):
        from app.services.rhino.indicators import compute_sma_series_multi
        bars = _make_bars(100)
        result = compute_sma_series_multi(bars, [30, 100, 200])
        assert len(result[30]) == 71  # 100 - 30 + 1
        assert len(result[100]) == 1
        assert result[200] == []

    def test_sma200_valid_with_200_bars(self):
        from app.services.rhino.indicators import compute_sma_series_multi
        bars = _make_bars(200)
        result = compute_sma_series_multi(bars, [30, 100, 200])
        assert len(result[30]) == 171
        assert len(result[100]) == 101
        assert len(result[200]) == 1

    def test_sma_insufficient_bars(self):
        from app.services.rhino.indicators import compute_sma_series_multi
        bars = _make_bars(10)
        result = compute_sma_series_multi(bars, [30, 100, 200])
        assert result[30] == []
        assert result[100] == []
        assert result[200] == []

    def test_sma_values_correct(self):
        from app.services.rhino.indicators import compute_sma_series_multi
        bars = _make_bars(35)
        result = compute_sma_series_multi(bars, [30])
        # First SMA30 point: avg of bars[0..29]
        expected = sum(b["close"] for b in bars[:30]) / 30
        assert abs(result[30][0]["value"] - round(expected, 4)) < 0.001

    def test_sma_chronological_order(self):
        from app.services.rhino.indicators import compute_sma_series_multi
        bars = _make_bars(50)
        result = compute_sma_series_multi(bars, [30])
        dates = [pt["date"] for pt in result[30]]
        assert dates == sorted(dates)

    def test_sma_date_format(self):
        from app.services.rhino.indicators import compute_sma_series_multi
        bars = _make_bars(35)
        result = compute_sma_series_multi(bars, [30])
        for pt in result[30]:
            assert len(pt["date"]) == 10  # YYYY-MM-DD
            assert pt["date"][4] == "-"

    @pytest.mark.asyncio
    async def test_chart_contains_all_sma_series(self):
        bars = _make_bars(250, base_price=150.0)
        m1, m2, m3 = _rhino_mocks(
            bars=bars,
            estimates={"fy1_eps_avg": 5.0, "fy2_eps_avg": 6.0},
            macro={"vix": 18.0, "us10y": 4.2},
        )
        with m1, m2, m3:
            from app.services.rhino import analyze
            result = await analyze("AAPL")

        chart = result["chart"]
        assert len(chart["sma30"]) > 0
        assert len(chart["sma100"]) > 0
        assert len(chart["sma200"]) > 0
        # All dates are YYYY-MM-DD
        for series_key in ("sma30", "sma100", "sma200"):
            for pt in chart[series_key]:
                assert len(pt["date"]) == 10

    @pytest.mark.asyncio
    async def test_technical_contains_all_sma_scalars(self):
        bars = _make_bars(250, base_price=150.0)
        m1, m2, m3 = _rhino_mocks(
            bars=bars,
            estimates={"fy1_eps_avg": 5.0, "fy2_eps_avg": 6.0},
            macro={"vix": 18.0, "us10y": 4.2},
        )
        with m1, m2, m3:
            from app.services.rhino import analyze
            result = await analyze("AAPL")

        tech = result["technical"]
        assert tech["sma30"] is not None
        assert tech["sma100"] is not None
        assert tech["sma200"] is not None

    @pytest.mark.asyncio
    async def test_chart_200_candle_window(self):
        bars = _make_bars(300, base_price=150.0)
        m1, m2, m3 = _rhino_mocks(
            bars=bars,
            estimates={"fy1_eps_avg": 5.0, "fy2_eps_avg": 6.0},
            macro={"vix": 18.0, "us10y": 4.2},
        )
        with m1, m2, m3:
            from app.services.rhino import analyze
            result = await analyze("AAPL")

        assert len(result["chart"]["candles"]) == 200

    @pytest.mark.asyncio
    async def test_sma_aligned_to_candle_dates(self):
        bars = _make_bars(250, base_price=150.0)
        m1, m2, m3 = _rhino_mocks(
            bars=bars,
            estimates={"fy1_eps_avg": 5.0, "fy2_eps_avg": 6.0},
            macro={"vix": 18.0, "us10y": 4.2},
        )
        with m1, m2, m3:
            from app.services.rhino import analyze
            result = await analyze("AAPL")

        chart = result["chart"]
        candle_dates = {c["date"] for c in chart["candles"]}
        for series_key in ("sma30", "sma100", "sma200"):
            for pt in chart[series_key]:
                assert pt["date"] in candle_dates, \
                    f"{series_key} date {pt['date']} not in candle dates"

    @pytest.mark.asyncio
    async def test_degraded_response_has_all_sma_fields(self):
        m1, m2, m3 = _rhino_mocks(
            bars=[],
            macro={"vix": 18.0, "us10y": 4.2},
        )
        with m1, m2, m3:
            from app.services.rhino import analyze
            result = await analyze("AAPL")

        tech = result["technical"]
        assert tech["sma30"] is None
        assert tech["sma100"] is None
        assert tech["sma200"] is None
        chart = result["chart"]
        assert chart["sma30"] == []
        assert chart["sma100"] == []
        assert chart["sma200"] == []
