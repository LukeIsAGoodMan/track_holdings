"""
Integration tests for app/services/lifecycle.py

Tests the settlement sweep (process_expired_trades) with focus on:
  - OTM expiry → EXPIRED status, no stock trade created
  - ITM assignment → ASSIGNED status, auto-stock trade created
  - Premium-to-cost-basis transfer (the core accounting feature):
      Short PUT assigned: effective_price = strike - avg_premium
      Short CALL assigned: effective_price = strike + avg_premium
  - Cash ledger amount uses strike price (actual cash), not effective_price
  - trade_metadata fields: premium_per_share, effective_cost_per_share
  - Multiple opening trades → weighted average premium

All tests use in-memory SQLite (via conftest `db` fixture).
yfinance calls are monkey-patched with a fake spot price.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest

from app.models import (
    Instrument, InstrumentType, OptionType,
    Portfolio,
    TradeEvent, TradeAction, TradeStatus,
)
from app.models.cash_ledger import CashLedger
from app.services.lifecycle import process_expired_trades

pytestmark = pytest.mark.asyncio

PAST_EXPIRY = date(2024, 1, 15)   # always in the past → triggers lifecycle sweep
SPOT_OTM    = Decimal("650")      # above $600 PUT strike → OTM for PUT
SPOT_ITM    = Decimal("550")      # below $600 PUT strike → ITM for PUT


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _portfolio(db) -> Portfolio:
    p = Portfolio(name="Test")
    db.add(p)
    await db.flush()
    return p


async def _option(
    db,
    symbol: str = "SPX",
    option_type: OptionType = OptionType.PUT,
    strike: str = "600",
    expiry: date = PAST_EXPIRY,
) -> Instrument:
    inst = Instrument(
        symbol=symbol,
        instrument_type=InstrumentType.OPTION,
        option_type=option_type,
        strike=Decimal(strike),
        expiry=expiry,
        multiplier=100,
    )
    db.add(inst)
    await db.flush()
    return inst


async def _trade(
    db,
    portfolio: Portfolio,
    instrument: Instrument,
    action: TradeAction = TradeAction.SELL_OPEN,
    quantity: int = 5,
    price: str = "5.00",
) -> TradeEvent:
    t = TradeEvent(
        portfolio_id=portfolio.id,
        instrument_id=instrument.id,
        action=action,
        quantity=quantity,
        price=Decimal(price),
        status=TradeStatus.ACTIVE,
        trade_date=datetime(2024, 1, 1, tzinfo=timezone.utc),
    )
    db.add(t)
    await db.flush()
    return t


def _patch_spot(spot: Decimal):
    """Patch yfinance_client.get_spot_price to return a fixed spot price."""
    return patch(
        "app.services.lifecycle.yfinance_client.get_spot_price",
        new=AsyncMock(return_value=spot),
    )


# ── OTM expiry ─────────────────────────────────────────────────────────────────

async def test_otm_put_marks_expired(db):
    """Short PUT, spot > strike → OTM → status EXPIRED, no stock trade."""
    port  = await _portfolio(db)
    inst  = await _option(db)  # PUT $600, past expiry

    t = await _trade(db, port, inst, TradeAction.SELL_OPEN, quantity=2, price="5.00")

    with _patch_spot(SPOT_OTM):   # spot 650 > strike 600 → OTM for PUT
        result = await process_expired_trades(db)

    assert result.expired  == 1
    assert result.assigned == 0

    await db.refresh(t)
    assert t.status == TradeStatus.EXPIRED
    assert t.closed_date == date.today()

    # No stock trade should have been auto-created
    stock_trades = (await db.execute(
        __import__("sqlalchemy", fromlist=["select"]).select(TradeEvent)
        .join(Instrument)
        .where(Instrument.instrument_type == InstrumentType.STOCK)
    )).scalars().all()
    assert len(stock_trades) == 0


async def test_otm_call_marks_expired(db):
    """Short CALL, spot < strike → OTM → status EXPIRED."""
    port = await _portfolio(db)
    inst = await _option(db, option_type=OptionType.CALL, strike="700")

    t = await _trade(db, port, inst)

    with _patch_spot(Decimal("650")):   # spot 650 < strike 700 → OTM for CALL
        result = await process_expired_trades(db)

    assert result.expired == 1
    await db.refresh(t)
    assert t.status == TradeStatus.EXPIRED


# ── ITM assignment ─────────────────────────────────────────────────────────────

async def test_itm_short_put_creates_buy_open_stock(db):
    """Short PUT, spot < strike → ASSIGNED → BUY_OPEN stock trade."""
    port = await _portfolio(db)
    inst = await _option(db)  # PUT $600

    await _trade(db, port, inst, TradeAction.SELL_OPEN, quantity=2)

    with _patch_spot(SPOT_ITM):
        result = await process_expired_trades(db)

    assert result.assigned == 1

    from sqlalchemy import select
    stock_trades = (await db.execute(
        select(TradeEvent)
        .join(Instrument)
        .where(Instrument.instrument_type == InstrumentType.STOCK)
    )).scalars().all()

    assert len(stock_trades) == 1
    st = stock_trades[0]
    assert st.action == TradeAction.BUY_OPEN
    assert st.quantity == 200       # 2 contracts × 100 shares
    assert st.trade_metadata["auto_assigned_from_option"] is True


async def test_itm_short_call_creates_sell_open_stock(db):
    """Short CALL, spot > strike → ASSIGNED → SELL_OPEN stock trade."""
    port = await _portfolio(db)
    inst = await _option(db, option_type=OptionType.CALL, strike="600")

    await _trade(db, port, inst, TradeAction.SELL_OPEN, quantity=1)

    with _patch_spot(Decimal("650")):   # spot 650 > strike 600 → ITM for CALL
        result = await process_expired_trades(db)

    assert result.assigned == 1

    from sqlalchemy import select
    stock_trades = (await db.execute(
        select(TradeEvent)
        .join(Instrument)
        .where(Instrument.instrument_type == InstrumentType.STOCK)
    )).scalars().all()

    assert len(stock_trades) == 1
    assert stock_trades[0].action == TradeAction.SELL_OPEN


# ── Premium transfer ───────────────────────────────────────────────────────────

async def test_short_put_premium_reduces_cost_basis(db):
    """
    Core accounting test:
    Short 5× PUT $600 @ $5.00 premium → assigned at spot $550.
    Effective cost per share = $600 - $5 = $595.
    Cash ledger = -$300,000 (500 shares × $600 strike, not effective_price).
    """
    from sqlalchemy import select
    port = await _portfolio(db)
    inst = await _option(db, strike="600")

    await _trade(db, port, inst, TradeAction.SELL_OPEN, quantity=5, price="5.00")

    with _patch_spot(Decimal("550")):
        result = await process_expired_trades(db)

    assert result.assigned == 1

    # Auto-stock trade uses effective cost basis (600 - 5 = 595)
    stock_trades = (await db.execute(
        select(TradeEvent)
        .join(Instrument)
        .where(Instrument.instrument_type == InstrumentType.STOCK)
    )).scalars().all()
    assert len(stock_trades) == 1
    st = stock_trades[0]

    assert st.price == Decimal("595")      # strike - premium = 595
    assert st.quantity == 500              # 5 contracts × 100

    meta = st.trade_metadata
    assert abs(meta["premium_per_share"] - 5.0)       < 0.0001
    assert abs(meta["effective_cost_per_share"] - 595.0) < 0.0001

    # Cash must use STRIKE ($600), not effective price
    cash_entries = (await db.execute(
        select(CashLedger).where(CashLedger.trade_event_id == st.id)
    )).scalars().all()
    assert len(cash_entries) == 1
    # BUY_OPEN → cash outflow → negative
    assert cash_entries[0].amount == Decimal("-300000")   # 500 × 600


async def test_short_call_premium_increases_effective_proceeds(db):
    """
    Short 3× CALL $700 @ $8.00 → assigned at spot $750.
    Effective proceeds per share = $700 + $8 = $708.
    Cash ledger = +$210,000 (300 shares × $700 strike).
    """
    from sqlalchemy import select
    port = await _portfolio(db)
    inst = await _option(db, option_type=OptionType.CALL, strike="700")

    await _trade(db, port, inst, TradeAction.SELL_OPEN, quantity=3, price="8.00")

    with _patch_spot(Decimal("750")):   # above strike → ITM for CALL
        result = await process_expired_trades(db)

    assert result.assigned == 1

    stock_trades = (await db.execute(
        select(TradeEvent)
        .join(Instrument)
        .where(Instrument.instrument_type == InstrumentType.STOCK)
    )).scalars().all()
    assert len(stock_trades) == 1
    st = stock_trades[0]

    assert st.price    == Decimal("708")   # strike + premium = 708
    assert st.quantity == 300              # 3 × 100

    meta = st.trade_metadata
    assert abs(meta["premium_per_share"] - 8.0)       < 0.0001
    assert abs(meta["effective_cost_per_share"] - 708.0) < 0.0001

    cash_entries = (await db.execute(
        select(CashLedger).where(CashLedger.trade_event_id == st.id)
    )).scalars().all()
    # SELL_OPEN → cash inflow → positive; uses STRIKE ($700)
    assert cash_entries[0].amount == Decimal("210000")   # 300 × 700


async def test_weighted_average_premium_multiple_trades(db):
    """
    Two opening trades at different premiums → weighted average.
    SELL_OPEN 2 @ $4.00, SELL_OPEN 3 @ $6.00
    avg = (2×4 + 3×6) / 5 = (8+18)/5 = 5.20
    effective_price = 600 - 5.20 = 594.80
    """
    from sqlalchemy import select
    port = await _portfolio(db)
    inst = await _option(db, strike="600")

    # Two separate opening trades at different premiums
    await _trade(db, port, inst, TradeAction.SELL_OPEN, quantity=2, price="4.00")
    await _trade(db, port, inst, TradeAction.SELL_OPEN, quantity=3, price="6.00")

    with _patch_spot(Decimal("550")):
        result = await process_expired_trades(db)

    assert result.assigned == 1

    stock_trades = (await db.execute(
        select(TradeEvent)
        .join(Instrument)
        .where(Instrument.instrument_type == InstrumentType.STOCK)
    )).scalars().all()
    assert len(stock_trades) == 1
    st = stock_trades[0]

    assert st.quantity == 500  # (2+3) × 100

    # Effective price = 600 - 5.20 = 594.80
    expected_eff = Decimal("594.80")
    assert abs(st.price - expected_eff) < Decimal("0.01")

    meta = st.trade_metadata
    assert abs(meta["premium_per_share"] - 5.20)     < 0.001
    assert abs(meta["effective_cost_per_share"] - float(expected_eff)) < 0.01


async def test_idempotent_sweep_does_not_double_assign(db):
    """
    Running process_expired_trades twice must not create a second stock trade.
    Only ACTIVE option trades are swept; ASSIGNED ones are skipped.
    """
    from sqlalchemy import select
    port = await _portfolio(db)
    inst = await _option(db, strike="600")

    await _trade(db, port, inst, TradeAction.SELL_OPEN, quantity=1)

    with _patch_spot(Decimal("550")):
        r1 = await process_expired_trades(db)
        r2 = await process_expired_trades(db)

    assert r1.assigned == 1
    assert r2.assigned == 0   # second sweep is a no-op

    stock_count = len((await db.execute(
        select(TradeEvent)
        .join(Instrument)
        .where(Instrument.instrument_type == InstrumentType.STOCK)
    )).scalars().all())
    assert stock_count == 1


async def test_flat_position_closed_without_stock_trade(db):
    """
    SELL_OPEN + BUY_CLOSE → net == 0 → status CLOSED, no stock trade.
    """
    from sqlalchemy import select
    port = await _portfolio(db)
    inst = await _option(db, strike="600")

    await _trade(db, port, inst, TradeAction.SELL_OPEN,  quantity=2)
    await _trade(db, port, inst, TradeAction.BUY_CLOSE,  quantity=2, price="2.00")

    with _patch_spot(Decimal("550")):
        result = await process_expired_trades(db)

    # net == 0 → CLOSED, no assignment
    assert result.assigned == 0

    stock_count = len((await db.execute(
        select(TradeEvent)
        .join(Instrument)
        .where(Instrument.instrument_type == InstrumentType.STOCK)
    )).scalars().all())
    assert stock_count == 0
