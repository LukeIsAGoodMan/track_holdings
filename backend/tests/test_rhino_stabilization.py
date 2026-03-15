"""
Rhino Analysis stabilization tests.

Validates the data-integrity fixes introduced during the stabilization pass:
  1. Index symbol normalization (_fmp_sym adds '^' for indices only)
  2. Chart payload is self-contained (current_price + analysis_close)
  3. Analyst estimate fallback (new + old FMP schema)
  4. Treasury extraction (flat dict, no list[0] regression)
  5. EOD price change derivation (bars-only, no intraday quote)
  6. Boundary guard (0 or 1 bar does not crash)
  7. _coalesce helper
"""
from __future__ import annotations

import asyncio
from unittest.mock import patch, AsyncMock

import pytest

from app.services.yfinance_client import (
    normalize_ticker,
    _fmp_sym,
    _coalesce,
    _safe_float_val,
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


def _make_bars(n: int, base_price: float = 100.0) -> list[dict]:
    """Create n ascending-date bars for testing."""
    bars = []
    for i in range(n):
        p = base_price + i * 0.5
        bars.append({
            "date": f"2025-01-{i + 1:02d}",
            "open": p, "high": p + 1, "low": p - 1, "close": p,
            "volume": 1000000,
        })
    return bars


class TestChartPayload:
    """Chart section must include current_price and analysis_close."""

    @pytest.mark.asyncio
    async def test_chart_contains_price_fields(self):
        bars = _make_bars(5)
        expected_close = bars[-1]["close"]

        with patch("app.services.rhino.get_history", new_callable=AsyncMock, return_value=bars), \
             patch("app.services.rhino.get_estimates", new_callable=AsyncMock, return_value={"fy1_eps_avg": None, "fy2_eps_avg": None}), \
             patch("app.services.rhino.get_macro", new_callable=AsyncMock, return_value={"vix": 18.0, "us10y": 4.2}):
            from app.services.rhino import analyze
            result = await analyze("TEST", lang="en")

        chart = result["chart"]
        assert chart["current_price"] == expected_close
        assert chart["analysis_close"] == expected_close
        assert isinstance(chart["current_price"], float)

    @pytest.mark.asyncio
    async def test_degraded_chart_has_zero_prices(self):
        with patch("app.services.rhino.get_history", new_callable=AsyncMock, return_value=[]), \
             patch("app.services.rhino.get_estimates", new_callable=AsyncMock, return_value={"fy1_eps_avg": None, "fy2_eps_avg": None}), \
             patch("app.services.rhino.get_macro", new_callable=AsyncMock, return_value={"vix": None, "us10y": None}):
            from app.services.rhino import analyze
            result = await analyze("NODATA", lang="en")

        chart = result["chart"]
        assert chart["current_price"] == 0.0
        assert chart["analysis_close"] == 0.0


# ── 3. Analyst estimate fallback ──────────────────────────────────────────


class TestAnalystEstimateFallback:
    """_coalesce and the shared-layer parser must handle both FMP schemas."""

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


# ── 4. Treasury extraction ────────────────────────────────────────────────


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


# ── 5. EOD price change derivation ───────────────────────────────────────


class TestEodPriceChange:
    """change and change_pct must be derived from the last two bars."""

    @pytest.mark.asyncio
    async def test_change_from_bars(self):
        bars = _make_bars(3)  # closes: 100.0, 100.5, 101.0
        expected_change = 101.0 - 100.5
        expected_pct = expected_change / 100.5 * 100

        with patch("app.services.rhino.get_history", new_callable=AsyncMock, return_value=bars), \
             patch("app.services.rhino.get_estimates", new_callable=AsyncMock, return_value={"fy1_eps_avg": None, "fy2_eps_avg": None}), \
             patch("app.services.rhino.get_macro", new_callable=AsyncMock, return_value={"vix": 15.0, "us10y": 4.0}):
            from app.services.rhino import analyze
            result = await analyze("TEST", lang="en")

        quote = result["quote"]
        assert quote["price"] == 101.0
        assert quote["previous_close"] == 100.5
        assert abs(quote["change"] - round(expected_change, 4)) < 0.001
        assert abs(quote["change_pct"] - round(expected_pct, 4)) < 0.01


# ── 6. Boundary guard ────────────────────────────────────────────────────


class TestBoundaryGuard:
    """Endpoint must not crash with 0 or 1 bars."""

    @pytest.mark.asyncio
    async def test_zero_bars_returns_degraded(self):
        with patch("app.services.rhino.get_history", new_callable=AsyncMock, return_value=[]), \
             patch("app.services.rhino.get_estimates", new_callable=AsyncMock, return_value={"fy1_eps_avg": None, "fy2_eps_avg": None}), \
             patch("app.services.rhino.get_macro", new_callable=AsyncMock, return_value={"vix": None, "us10y": None}):
            from app.services.rhino import analyze
            result = await analyze("NODATA", lang="en")

        assert result["confidence"]["grade"] == "D"
        assert result["quote"] is None

    @pytest.mark.asyncio
    async def test_one_bar_no_crash(self):
        bars = _make_bars(1, base_price=50.0)

        with patch("app.services.rhino.get_history", new_callable=AsyncMock, return_value=bars), \
             patch("app.services.rhino.get_estimates", new_callable=AsyncMock, return_value={"fy1_eps_avg": None, "fy2_eps_avg": None}), \
             patch("app.services.rhino.get_macro", new_callable=AsyncMock, return_value={"vix": 20.0, "us10y": None}):
            from app.services.rhino import analyze
            result = await analyze("ONEBAR", lang="en")

        quote = result["quote"]
        assert quote["price"] == 50.0
        assert quote["previous_close"] is None
        assert quote["change"] is None
        assert quote["change_pct"] is None
        assert result["chart"]["current_price"] == 50.0
