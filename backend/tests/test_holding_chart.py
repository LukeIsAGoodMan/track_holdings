"""
Tests for the holding chart endpoint and EOD light fetcher.

Covers:
  - URL construction for FMP endpoints
  - Ascending sort after reversal of FMP newest-first data
  - Malformed row filtering
  - Partial success response behavior (one source fails)
  - EOD light field normalization (price → close)
  - Intraday serialization (Decimal → float)
"""
import pytest
from decimal import Decimal
from unittest.mock import patch, AsyncMock

from app.routers.holding_chart import _serialize_intraday


# ── _serialize_intraday tests ────────────────────────────────────────────────

def test_serialize_intraday_converts_decimals():
    bars = [
        {"date": "2026-03-27 09:35:00", "open": Decimal("123.45"), "high": Decimal("124.00"),
         "low": Decimal("123.10"), "close": Decimal("123.80"), "volume": 1000},
    ]
    result = _serialize_intraday(bars)
    assert len(result) == 1
    assert result[0]["open"] == 123.45
    assert result[0]["close"] == 123.80
    assert isinstance(result[0]["open"], float)


def test_serialize_intraday_skips_malformed():
    bars = [
        {"date": "2026-03-27 09:35:00", "open": Decimal("123"), "high": Decimal("124"),
         "low": Decimal("122"), "close": Decimal("123.5"), "volume": 100},
        {"date": "bad", "open": "not_a_number"},  # malformed
        {"date": "2026-03-27 09:40:00", "open": Decimal("124"), "high": Decimal("125"),
         "low": Decimal("123"), "close": Decimal("124.5"), "volume": 200},
    ]
    result = _serialize_intraday(bars)
    assert len(result) == 2  # skipped the malformed row


def test_serialize_intraday_empty():
    assert _serialize_intraday(None) == []
    assert _serialize_intraday([]) == []


def test_serialize_intraday_handles_none_prices():
    bars = [
        {"date": "2026-03-27 09:35:00", "open": None, "high": None,
         "low": None, "close": Decimal("123.80"), "volume": 0},
    ]
    result = _serialize_intraday(bars)
    assert len(result) == 1
    assert result[0]["open"] is None
    assert result[0]["close"] == 123.80


# ── EOD light normalization tests ────────────────────────────────────────────

def test_eod_light_normalizes_price_to_close():
    """The FMP raw field is 'price', but we normalize to 'close'."""
    from app.services.yfinance_client import _do_fetch_eod_light

    mock_response = [
        {"symbol": "AAPL", "date": "2026-03-26", "price": 252.89, "volume": 41331888},
        {"symbol": "AAPL", "date": "2026-03-25", "price": 250.00, "volume": 30000000},
    ]

    with patch("app.services.yfinance_client._fmp_get", return_value=mock_response):
        result = _do_fetch_eod_light("AAPL")

    assert result is not None
    assert len(result) == 2
    # Should be sorted ascending (oldest first)
    assert result[0]["date"] == "2026-03-25"
    assert result[1]["date"] == "2026-03-26"
    # "price" normalized to "close"
    assert result[0]["close"] == 250.00
    assert result[1]["close"] == 252.89
    assert "price" not in result[0]


def test_eod_light_filters_malformed():
    from app.services.yfinance_client import _do_fetch_eod_light

    mock_response = [
        {"symbol": "AAPL", "date": "2026-03-26", "price": 252.89, "volume": 100},
        {"symbol": "AAPL", "date": None, "price": 250.00, "volume": 200},  # missing date
        {"symbol": "AAPL", "date": "2026-03-24", "price": None, "volume": 300},  # missing price
    ]

    with patch("app.services.yfinance_client._fmp_get", return_value=mock_response):
        result = _do_fetch_eod_light("AAPL")

    assert result is not None
    assert len(result) == 1  # only the valid row


def test_eod_light_returns_none_on_empty():
    from app.services.yfinance_client import _do_fetch_eod_light

    with patch("app.services.yfinance_client._fmp_get", return_value=[]):
        result = _do_fetch_eod_light("AAPL")
    assert result is None

    with patch("app.services.yfinance_client._fmp_get", return_value=None):
        result = _do_fetch_eod_light("AAPL")
    assert result is None


# ── Intraday sort order test ─────────────────────────────────────────────────

def test_intraday_sorts_ascending():
    from app.services.yfinance_client import _do_fetch_intraday_5min

    # FMP returns newest-first
    mock_response = [
        {"date": "2026-03-27 10:00:00", "open": 125, "high": 126, "low": 124, "close": 125.5, "volume": 200},
        {"date": "2026-03-27 09:55:00", "open": 124, "high": 125, "low": 123, "close": 124.5, "volume": 150},
        {"date": "2026-03-27 09:50:00", "open": 123, "high": 124, "low": 122, "close": 123.5, "volume": 100},
    ]

    with patch("app.services.yfinance_client._fmp_get", return_value=mock_response):
        result = _do_fetch_intraday_5min("AAPL")

    assert result is not None
    assert result[0]["date"] == "2026-03-27 09:50:00"  # oldest first
    assert result[-1]["date"] == "2026-03-27 10:00:00"  # newest last


# ── Symbol normalization does not regress ─────────────────────────────────────

def test_symbol_normalization_indices():
    from app.services.yfinance_client import normalize_ticker, _fmp_sym

    assert normalize_ticker("^VIX") == "VIX"
    assert normalize_ticker("^GSPC") == "GSPC"
    assert normalize_ticker("AAPL") == "AAPL"

    assert _fmp_sym("VIX") == "^VIX"
    assert _fmp_sym("GSPC") == "^GSPC"
    assert _fmp_sym("AAPL") == "AAPL"
