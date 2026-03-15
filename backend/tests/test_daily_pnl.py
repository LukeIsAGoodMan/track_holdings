"""
Tests for daily P&L (bs_pnl_1d) computation via PriceFeedService._build_daily_pnl_map.

Covers:
  - Stock-only daily P&L from prev_close
  - Option BS mark-to-market P&L from prev_close
  - Mixed group (stock + option) aggregation
  - Missing prev_close → symbol excluded
  - prev_close_map bulk pre-fetch
  - Empty bs_pnl_map semantics ({} vs None)
  - Snapshot/recompute parity guarantee
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest

from app.services.price_feed import PriceFeedService


# ── Helpers ──────────────────────────────────────────────────────────────────

@dataclass
class FakeInstrument:
    id: int
    symbol: str
    instrument_type: "InstrumentType"
    option_type: object = None
    strike: Decimal = Decimal("0")
    expiry: date | None = None
    tags: dict | None = None


@dataclass
class FakePositionRow:
    instrument: FakeInstrument
    net_contracts: int
    avg_open_price: Decimal = Decimal("0")
    total_open_premium: Decimal = Decimal("0")
    first_trade_date: datetime = datetime(2025, 1, 1)
    days_elapsed: int = 0


def _stock_instrument(sym: str, inst_id: int = 1) -> FakeInstrument:
    from app.models import InstrumentType
    return FakeInstrument(id=inst_id, symbol=sym, instrument_type=InstrumentType.STOCK)


def _option_instrument(
    sym: str, option_type: str, strike: Decimal, expiry: date, inst_id: int = 2,
) -> FakeInstrument:
    from app.models import InstrumentType, OptionType
    ot = OptionType.CALL if option_type == "CALL" else OptionType.PUT
    return FakeInstrument(
        id=inst_id, symbol=sym, instrument_type=InstrumentType.OPTION,
        option_type=ot, strike=strike, expiry=expiry,
    )


# ═════════════════════════════════════════════════════════════════════════════
# Test 1 — Stock daily P&L: net_shares × (spot − prev_close)
# ═════════════════════════════════════════════════════════════════════════════

def test_stock_daily_pnl():
    """100 shares of NVDA, spot=175, prev_close=170 → P&L = +$500."""
    positions = [
        FakePositionRow(
            instrument=_stock_instrument("NVDA"),
            net_contracts=100,
        )
    ]
    spot_map = {"NVDA": Decimal("175")}
    vol_map = {"NVDA": Decimal("0.35")}
    prev_close_map = {"NVDA": Decimal("170")}

    result = PriceFeedService._build_daily_pnl_map(
        positions, spot_map, vol_map, prev_close_map,
    )

    assert "NVDA" in result
    assert result["NVDA"] == Decimal("500")


# ═════════════════════════════════════════════════════════════════════════════
# Test 2 — Short stock: negative net_contracts
# ═════════════════════════════════════════════════════════════════════════════

def test_short_stock_daily_pnl():
    """-50 shares of TSLA, spot=345, prev_close=340 → P&L = -$250 (loss for short)."""
    positions = [
        FakePositionRow(
            instrument=_stock_instrument("TSLA"),
            net_contracts=-50,
        )
    ]
    spot_map = {"TSLA": Decimal("345")}
    vol_map = {"TSLA": Decimal("0.50")}
    prev_close_map = {"TSLA": Decimal("340")}

    result = PriceFeedService._build_daily_pnl_map(
        positions, spot_map, vol_map, prev_close_map,
    )

    assert result["TSLA"] == Decimal("-250")


# ═════════════════════════════════════════════════════════════════════════════
# Test 3 — Option BS mark-to-market P&L
# ═════════════════════════════════════════════════════════════════════════════

def test_option_bs_pnl():
    """Long 5 NVDA calls: BS(spot_now) − BS(prev_close) should be positive when spot rises."""
    expiry = date.today() + timedelta(days=30)
    positions = [
        FakePositionRow(
            instrument=_option_instrument("NVDA", "CALL", Decimal("170"), expiry),
            net_contracts=5,
            avg_open_price=Decimal("3.50"),
        )
    ]
    spot_map = {"NVDA": Decimal("175")}
    vol_map = {"NVDA": Decimal("0.35")}
    prev_close_map = {"NVDA": Decimal("170")}

    result = PriceFeedService._build_daily_pnl_map(
        positions, spot_map, vol_map, prev_close_map,
    )

    assert "NVDA" in result
    # Spot rose $5 on a call → P&L should be positive
    assert result["NVDA"] > Decimal("0")
    # 5 contracts × 100 multiplier × ~$5 delta move → should be material
    assert result["NVDA"] > Decimal("100")


# ═════════════════════════════════════════════════════════════════════════════
# Test 4 — Short put option P&L
# ═════════════════════════════════════════════════════════════════════════════

def test_short_put_pnl_when_spot_rises():
    """Short 3 puts, spot rises → put value decreases → positive P&L for short."""
    expiry = date.today() + timedelta(days=30)
    positions = [
        FakePositionRow(
            instrument=_option_instrument("NVDA", "PUT", Decimal("170"), expiry),
            net_contracts=-3,
            avg_open_price=Decimal("4.00"),
        )
    ]
    spot_map = {"NVDA": Decimal("175")}
    vol_map = {"NVDA": Decimal("0.35")}
    prev_close_map = {"NVDA": Decimal("170")}

    result = PriceFeedService._build_daily_pnl_map(
        positions, spot_map, vol_map, prev_close_map,
    )

    assert "NVDA" in result
    # Short put profits when spot rises (put becomes cheaper)
    assert result["NVDA"] > Decimal("0")


# ═════════════════════════════════════════════════════════════════════════════
# Test 5 — Missing prev_close → symbol excluded
# ═════════════════════════════════════════════════════════════════════════════

def test_missing_prev_close_excludes_symbol():
    """When prev_close is absent from the map, symbol is excluded from P&L."""
    positions = [
        FakePositionRow(
            instrument=_stock_instrument("XYZ"),
            net_contracts=100,
        )
    ]
    spot_map = {"XYZ": Decimal("50")}
    vol_map = {"XYZ": Decimal("0.30")}
    prev_close_map = {}  # no prev_close for XYZ

    result = PriceFeedService._build_daily_pnl_map(
        positions, spot_map, vol_map, prev_close_map,
    )

    assert "XYZ" not in result


# ═════════════════════════════════════════════════════════════════════════════
# Test 6 — Missing spot → symbol excluded
# ═════════════════════════════════════════════════════════════════════════════

def test_missing_spot_excludes_symbol():
    """When spot is None, P&L cannot be computed → symbol absent."""
    positions = [
        FakePositionRow(
            instrument=_stock_instrument("XYZ"),
            net_contracts=100,
        )
    ]
    spot_map = {"XYZ": None}
    vol_map = {"XYZ": Decimal("0.30")}
    prev_close_map = {"XYZ": Decimal("48")}

    result = PriceFeedService._build_daily_pnl_map(
        positions, spot_map, vol_map, prev_close_map,
    )

    assert "XYZ" not in result


# ═════════════════════════════════════════════════════════════════════════════
# Test 7 — Mixed group: stock + option aggregation
# ═════════════════════════════════════════════════════════════════════════════

def test_mixed_group_aggregation():
    """Stock + option under same symbol → P&L is summed."""
    expiry = date.today() + timedelta(days=30)
    positions = [
        FakePositionRow(
            instrument=_stock_instrument("NVDA", inst_id=1),
            net_contracts=100,
        ),
        FakePositionRow(
            instrument=_option_instrument("NVDA", "CALL", Decimal("170"), expiry, inst_id=2),
            net_contracts=2,
            avg_open_price=Decimal("5.00"),
        ),
    ]
    spot_map = {"NVDA": Decimal("175")}
    vol_map = {"NVDA": Decimal("0.35")}
    prev_close_map = {"NVDA": Decimal("170")}

    result = PriceFeedService._build_daily_pnl_map(
        positions, spot_map, vol_map, prev_close_map,
    )

    assert "NVDA" in result
    # Stock: 100 × (175 - 170) = $500
    # Option: BS(175) - BS(170) should be positive, × 2 × 100
    # Total should be > $500
    assert result["NVDA"] > Decimal("500")


# ═════════════════════════════════════════════════════════════════════════════
# Test 8 — Zero price movement → P&L = 0
# ═════════════════════════════════════════════════════════════════════════════

def test_zero_movement_zero_pnl():
    """spot == prev_close → P&L = 0."""
    positions = [
        FakePositionRow(
            instrument=_stock_instrument("SPY"),
            net_contracts=50,
        )
    ]
    spot_map = {"SPY": Decimal("590")}
    vol_map = {"SPY": Decimal("0.15")}
    prev_close_map = {"SPY": Decimal("590")}

    result = PriceFeedService._build_daily_pnl_map(
        positions, spot_map, vol_map, prev_close_map,
    )

    assert result["SPY"] == Decimal("0")


# ═════════════════════════════════════════════════════════════════════════════
# Test 9 — Multiple symbols independent
# ═════════════════════════════════════════════════════════════════════════════

def test_multiple_symbols_independent():
    """Each symbol gets its own P&L entry."""
    positions = [
        FakePositionRow(
            instrument=_stock_instrument("NVDA", inst_id=1),
            net_contracts=100,
        ),
        FakePositionRow(
            instrument=_stock_instrument("AAPL", inst_id=2),
            net_contracts=50,
        ),
    ]
    positions[1].instrument.symbol = "AAPL"

    spot_map = {"NVDA": Decimal("175"), "AAPL": Decimal("245")}
    vol_map = {"NVDA": Decimal("0.35"), "AAPL": Decimal("0.20")}
    prev_close_map = {"NVDA": Decimal("170"), "AAPL": Decimal("240")}

    result = PriceFeedService._build_daily_pnl_map(
        positions, spot_map, vol_map, prev_close_map,
    )

    assert result["NVDA"] == Decimal("500")   # 100 × 5
    assert result["AAPL"] == Decimal("250")   # 50 × 5


# ═════════════════════════════════════════════════════════════════════════════
# Test 10 — _build_prev_close_map bulk pre-fetch
# ═════════════════════════════════════════════════════════════════════════════

def test_build_prev_close_map():
    """_build_prev_close_map reads from cache and excludes None values."""
    with patch("app.services.price_feed.yfinance_client") as mock_yf:
        def _mock_prev_close(sym):
            return {"NVDA": Decimal("170"), "AAPL": Decimal("240")}.get(sym)
        mock_yf.get_prev_close_cached_only.side_effect = _mock_prev_close

        result = PriceFeedService._build_prev_close_map(["NVDA", "AAPL", "XYZ"])

    assert result == {"NVDA": Decimal("170"), "AAPL": Decimal("240")}
    assert "XYZ" not in result
    # Verify it was called once per symbol (bulk, not N+1 inside loop)
    assert mock_yf.get_prev_close_cached_only.call_count == 3


# ═════════════════════════════════════════════════════════════════════════════
# Test 11 — Empty bs_pnl_map semantics: {} is not None
# ═════════════════════════════════════════════════════════════════════════════

def test_empty_dict_is_not_none():
    """
    When all symbols lack prev_close, _build_daily_pnl_map returns {}
    (not None). Callers must pass {} directly — NOT use `or None`.
    """
    positions = [
        FakePositionRow(
            instrument=_stock_instrument("XYZ"),
            net_contracts=100,
        )
    ]
    spot_map = {"XYZ": Decimal("50")}
    vol_map = {"XYZ": Decimal("0.30")}
    prev_close_map = {}

    result = PriceFeedService._build_daily_pnl_map(
        positions, spot_map, vol_map, prev_close_map,
    )

    # Result is {} (empty dict), NOT None
    assert result == {}
    assert result is not None


# ═════════════════════════════════════════════════════════════════════════════
# Test 12 — Partial prev_close: only symbols with data get P&L
# ═════════════════════════════════════════════════════════════════════════════

def test_partial_prev_close():
    """Only symbols present in prev_close_map get P&L computed."""
    positions = [
        FakePositionRow(
            instrument=_stock_instrument("NVDA", inst_id=1),
            net_contracts=100,
        ),
        FakePositionRow(
            instrument=_stock_instrument("AAPL", inst_id=2),
            net_contracts=50,
        ),
    ]
    positions[1].instrument.symbol = "AAPL"

    spot_map = {"NVDA": Decimal("175"), "AAPL": Decimal("245")}
    vol_map = {"NVDA": Decimal("0.35"), "AAPL": Decimal("0.20")}
    # Only NVDA has prev_close
    prev_close_map = {"NVDA": Decimal("170")}

    result = PriceFeedService._build_daily_pnl_map(
        positions, spot_map, vol_map, prev_close_map,
    )

    assert result["NVDA"] == Decimal("500")
    assert "AAPL" not in result  # excluded, not zero
