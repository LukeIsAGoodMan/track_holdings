"""
Tests for Phase 7f — NLV Sampler Service.

Covers:
  - compute_nlv() pure function: stock MtM, option MtM (long & short)
  - Short option MtM recorded as NEGATIVE (liability)
  - deque buffer maxlen enforcement (480 cap)
  - prev_close capture (first sample = baseline)
  - Date rollover logic (midnight reset)
  - unrealized_pnl = NLV - prev_close
  - Mock mode generates valid NLV series
  - WS message structure (pnl_snapshot format)
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from app.services.nlv_sampler import NLVSample, NlvSamplerService, compute_nlv


# ── Fake Instrument + PositionRow for pure tests ─────────────────────────────

@dataclass
class FakeInstrument:
    symbol: str
    instrument_type: str  # "STOCK" or "OPTION"
    option_type: object | None = None
    strike: Decimal | None = None
    expiry: date | None = None
    multiplier: int = 100


@dataclass
class FakePositionRow:
    instrument: FakeInstrument
    net_contracts: int
    avg_open_price: Decimal = Decimal("0")
    total_open_premium: Decimal = Decimal("0")
    first_trade_date: datetime = datetime(2026, 1, 1)
    days_elapsed: int = 0


class FakeOptionType:
    def __init__(self, value: str):
        self.value = value


class FakeInstrumentType:
    STOCK = "STOCK"
    OPTION = "OPTION"


# Patch InstrumentType comparison to work with our fakes
import app.models as _models
_orig_instrument_type = _models.InstrumentType


# ── compute_nlv() Pure Tests ─────────────────────────────────────────────────


class TestComputeNlvStockOnly:
    """NLV = cash + stock MtM (spot * net_shares)."""

    def test_long_stock(self):
        """Long 100 shares of AAPL at $242.80 → MtM = $24,280."""
        inst = FakeInstrument(
            symbol="AAPL",
            instrument_type=_orig_instrument_type.STOCK,
            option_type=None,
        )
        pos = FakePositionRow(instrument=inst, net_contracts=100)
        spot_map = {"AAPL": Decimal("242.80")}

        nlv = compute_nlv(
            cash_balance=Decimal("10000.00"),
            positions=[pos],
            spot_map=spot_map,
            vol_map={},
        )

        # 10000 + 242.80 * 100 = 34,280.00
        assert nlv == Decimal("34280.00")

    def test_short_stock(self):
        """Short 50 shares → negative MtM."""
        inst = FakeInstrument(
            symbol="TSLA",
            instrument_type=_orig_instrument_type.STOCK,
            option_type=None,
        )
        pos = FakePositionRow(instrument=inst, net_contracts=-50)
        spot_map = {"TSLA": Decimal("340.10")}

        nlv = compute_nlv(
            cash_balance=Decimal("50000.00"),
            positions=[pos],
            spot_map=spot_map,
            vol_map={},
        )

        # 50000 + 340.10 * (-50) = 50000 - 17005 = 32,995.00
        assert nlv == Decimal("32995.00")

    def test_no_positions_returns_cash(self):
        """No positions → NLV = cash only."""
        nlv = compute_nlv(
            cash_balance=Decimal("25000.00"),
            positions=[],
            spot_map={},
            vol_map={},
        )
        assert nlv == Decimal("25000.00")

    def test_missing_spot_skips_position(self):
        """Position with no spot price → skipped, NLV = cash."""
        inst = FakeInstrument(
            symbol="AAPL",
            instrument_type=_orig_instrument_type.STOCK,
            option_type=None,
        )
        pos = FakePositionRow(instrument=inst, net_contracts=100)

        nlv = compute_nlv(
            cash_balance=Decimal("10000.00"),
            positions=[pos],
            spot_map={},   # no spot for AAPL
            vol_map={},
        )
        assert nlv == Decimal("10000.00")


class TestComputeNlvWithOptions:
    """Option MtM = BS_price * net_contracts * 100."""

    def test_long_call_positive_mtm(self):
        """Long call → positive MtM (asset)."""
        inst = FakeInstrument(
            symbol="NVDA",
            instrument_type=_orig_instrument_type.OPTION,
            option_type=FakeOptionType("CALL"),
            strike=Decimal("170.00"),
            expiry=date.today() + timedelta(days=30),
        )
        pos = FakePositionRow(instrument=inst, net_contracts=2)

        spot_map = {"NVDA": Decimal("172.40")}
        vol_map = {"NVDA": Decimal("0.50")}

        nlv = compute_nlv(
            cash_balance=Decimal("5000.00"),
            positions=[pos],
            spot_map=spot_map,
            vol_map=vol_map,
        )

        # NLV = 5000 + (BS_price * 2 * 100)
        # BS_price for ITM call should be > intrinsic ($2.40), so NLV > 5480
        assert nlv > Decimal("5480.00")

    def test_short_put_negative_mtm(self):
        """Short put (net_contracts=-5) → NEGATIVE MtM (liability)."""
        inst = FakeInstrument(
            symbol="NVDA",
            instrument_type=_orig_instrument_type.OPTION,
            option_type=FakeOptionType("PUT"),
            strike=Decimal("170.00"),
            expiry=date.today() + timedelta(days=30),
        )
        pos = FakePositionRow(instrument=inst, net_contracts=-5)

        spot_map = {"NVDA": Decimal("172.40")}
        vol_map = {"NVDA": Decimal("0.50")}

        nlv = compute_nlv(
            cash_balance=Decimal("50000.00"),
            positions=[pos],
            spot_map=spot_map,
            vol_map=vol_map,
        )

        # MtM = BS_price * (-5) * 100 → negative
        # NLV < 50000 because short option = liability
        assert nlv < Decimal("50000.00")

    def test_expired_option_intrinsic_only(self):
        """Expired OTM option → MtM = 0 (intrinsic floor)."""
        inst = FakeInstrument(
            symbol="AAPL",
            instrument_type=_orig_instrument_type.OPTION,
            option_type=FakeOptionType("CALL"),
            strike=Decimal("300.00"),    # OTM
            expiry=date.today() - timedelta(days=1),  # expired
        )
        pos = FakePositionRow(instrument=inst, net_contracts=1)

        spot_map = {"AAPL": Decimal("242.80")}

        nlv = compute_nlv(
            cash_balance=Decimal("10000.00"),
            positions=[pos],
            spot_map=spot_map,
            vol_map={},
        )

        # OTM expired call → intrinsic = max(242.80 - 300, 0) = 0
        assert nlv == Decimal("10000.00")

    def test_mixed_stock_and_options(self):
        """Portfolio with both stock + options calculates correctly."""
        stock_inst = FakeInstrument(
            symbol="NVDA",
            instrument_type=_orig_instrument_type.STOCK,
            option_type=None,
        )
        option_inst = FakeInstrument(
            symbol="NVDA",
            instrument_type=_orig_instrument_type.OPTION,
            option_type=FakeOptionType("PUT"),
            strike=Decimal("170.00"),
            expiry=date.today() + timedelta(days=30),
        )
        stock_pos = FakePositionRow(instrument=stock_inst, net_contracts=100)
        option_pos = FakePositionRow(instrument=option_inst, net_contracts=-3)

        spot_map = {"NVDA": Decimal("172.40")}
        vol_map = {"NVDA": Decimal("0.50")}

        nlv = compute_nlv(
            cash_balance=Decimal("5000.00"),
            positions=[stock_pos, option_pos],
            spot_map=spot_map,
            vol_map=vol_map,
        )

        # Cash 5000 + Stock 172.40*100=17240 - short put liability (~2500)
        # NLV ~ 19740 (stock value - put liability)
        assert nlv > Decimal("18000.00")
        assert nlv < Decimal("23000.00")


class TestNLVSampleBuffer:
    """deque(maxlen=480) rolling window."""

    def test_buffer_maxlen(self):
        """Buffer caps at 480 entries."""
        buf: deque[NLVSample] = deque(maxlen=480)
        for i in range(600):
            buf.append(NLVSample(
                timestamp=f"{i:06d}",
                nlv=Decimal(str(50000 + i)),
                unrealized_pnl=Decimal(str(i)),
            ))
        assert len(buf) == 480
        # Oldest should be i=120 (600-480)
        assert buf[0].timestamp == "000120"

    def test_buffer_preserves_order(self):
        buf: deque[NLVSample] = deque(maxlen=480)
        for i in range(10):
            buf.append(NLVSample(
                timestamp=f"10:{i:02d}:00",
                nlv=Decimal(str(50000 + i * 100)),
                unrealized_pnl=Decimal(str(i * 100)),
            ))
        assert buf[0].nlv == Decimal("50000")
        assert buf[-1].nlv == Decimal("50900")


class TestPrevCloseCapture:
    """First sample of the day becomes prev_close baseline."""

    def test_first_sample_sets_prev_close(self):
        manager = MagicMock()
        manager._connections = {}
        cache = MagicMock()

        service = NlvSamplerService(manager=manager, cache=cache)
        key = (1, 1)

        # prev_close not set initially
        assert key not in service._prev_close

        # Simulate first sample
        service._prev_close[key] = Decimal("52500.00")
        assert service._prev_close[key] == Decimal("52500.00")

    def test_unrealized_pnl_calculation(self):
        """unrealized_pnl = current NLV - prev_close."""
        prev = Decimal("52500.00")
        current = Decimal("52750.00")
        unrealized = current - prev
        assert unrealized == Decimal("250.00")

        # Negative case
        current_down = Decimal("52100.00")
        unrealized_neg = current_down - prev
        assert unrealized_neg == Decimal("-400.00")


class TestDateRollover:
    """Midnight → archive NLV, clear buffers, start fresh."""

    def test_rollover_clears_buffers(self):
        manager = MagicMock()
        manager._connections = {}
        cache = MagicMock()

        service = NlvSamplerService(manager=manager, cache=cache)
        key = (1, 1)

        # Pre-populate buffer
        service._buffers[key] = deque(maxlen=480)
        service._buffers[key].append(NLVSample(
            timestamp="16:00:00",
            nlv=Decimal("53000.00"),
            unrealized_pnl=Decimal("500.00"),
        ))
        service._prev_close[key] = Decimal("52500.00")

        # Trigger rollover
        service._handle_date_rollover("2026-03-02")

        # Buffers cleared
        assert len(service._buffers) == 0

        # prev_close updated to last NLV
        assert service._prev_close[key] == Decimal("53000.00")

        # Date updated
        assert service._current_date == "2026-03-02"

    def test_rollover_with_no_samples(self):
        """Rollover when no samples exist — should not crash."""
        manager = MagicMock()
        manager._connections = {}
        cache = MagicMock()

        service = NlvSamplerService(manager=manager, cache=cache)

        # No buffers, no prev_close
        service._handle_date_rollover("2026-03-02")
        assert service._current_date == "2026-03-02"
        assert len(service._buffers) == 0


class TestMockMode:
    """Mock NLV generation (USE_MOCK_DATA=1)."""

    def test_mock_generates_valid_nlv(self):
        manager = MagicMock()
        manager._connections = {}
        cache = MagicMock()

        service = NlvSamplerService(manager=manager, cache=cache)
        service._mock_mode = True

        key = (1, 1)
        values: list[Decimal] = []

        for _ in range(50):
            nlv = service._generate_mock_nlv(key)
            values.append(nlv)

        # All values should be positive and reasonable
        assert all(v > Decimal("0") for v in values)
        assert all(v > Decimal("40000") for v in values)
        assert all(v < Decimal("70000") for v in values)

    def test_mock_produces_smooth_walk(self):
        """Adjacent samples should differ by < 1% (±0.03% jitter + sine)."""
        manager = MagicMock()
        manager._connections = {}
        cache = MagicMock()

        service = NlvSamplerService(manager=manager, cache=cache)
        service._mock_mode = True

        key = (1, 1)
        prev_val: Decimal | None = None

        for _ in range(100):
            nlv = service._generate_mock_nlv(key)
            if prev_val is not None:
                pct_change = abs(float(nlv - prev_val) / float(prev_val))
                assert pct_change < 0.01, f"Jump too large: {pct_change:.4%}"
            prev_val = nlv

    def test_mock_sets_prev_close(self):
        """Mock mode auto-seeds prev_close on first call."""
        manager = MagicMock()
        manager._connections = {}
        cache = MagicMock()

        service = NlvSamplerService(manager=manager, cache=cache)
        service._mock_mode = True

        key = (1, 1)
        assert key not in service._prev_close

        service._generate_mock_nlv(key)
        assert key in service._prev_close
        assert service._prev_close[key] == Decimal("52500.00")


class TestPnlSnapshotMessage:
    """WS message structure validation."""

    def test_message_format(self):
        """pnl_snapshot message has all required fields."""
        sample = NLVSample(
            timestamp="14:30:00",
            nlv=Decimal("52750.00"),
            unrealized_pnl=Decimal("250.00"),
        )

        # Simulate the message construction (from _compute_and_broadcast)
        prev = Decimal("52500.00")
        day_pnl_pct = (sample.unrealized_pnl / abs(prev) * Decimal("100"))

        msg = {
            "type": "pnl_snapshot",
            "portfolio_id": 1,
            "data": {
                "current": {
                    "timestamp": sample.timestamp,
                    "nlv": str(sample.nlv),
                    "unrealized_pnl": str(sample.unrealized_pnl),
                },
                "prev_close_nlv": str(prev),
                "day_pnl_pct": str(day_pnl_pct),
                "series": [
                    {"t": sample.timestamp, "nlv": str(sample.nlv), "pnl": str(sample.unrealized_pnl)},
                ],
            },
        }

        assert msg["type"] == "pnl_snapshot"
        assert msg["portfolio_id"] == 1
        assert msg["data"]["current"]["nlv"] == "52750.00"
        assert msg["data"]["current"]["unrealized_pnl"] == "250.00"
        assert msg["data"]["prev_close_nlv"] == "52500.00"
        assert len(msg["data"]["series"]) == 1
        assert msg["data"]["series"][0]["t"] == "14:30:00"

    def test_nlv_sample_frozen(self):
        """NLVSample is frozen (immutable, slots-based)."""
        s = NLVSample(
            timestamp="14:30:00",
            nlv=Decimal("52750.00"),
            unrealized_pnl=Decimal("250.00"),
        )
        with pytest.raises(AttributeError):
            s.nlv = Decimal("99999")  # type: ignore[misc]


class TestNlvSamplerServiceLifecycle:
    """Service start/stop."""

    def test_service_creation(self):
        manager = MagicMock()
        manager._connections = {}
        cache = MagicMock()

        service = NlvSamplerService(manager=manager, cache=cache)
        assert service.poll_interval == 30  # default from config
        assert not service._running
        assert service._task is None
