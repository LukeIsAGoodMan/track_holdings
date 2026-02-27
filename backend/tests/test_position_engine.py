"""
Async integration tests for app/services/position_engine.py

Each test gets a fresh in-memory SQLite database (via the `db` fixture in
conftest.py).  We insert minimal Instrument + TradeEvent rows and then verify
that calculate_positions() produces the correct net positions, weighted
average prices, and portfolio-ID filtering.
"""
from __future__ import annotations

from datetime import datetime, date
from decimal import Decimal

import pytest
import pytest_asyncio

from app.models import (
    Instrument, InstrumentType, OptionType,
    Portfolio,
    TradeEvent, TradeAction, TradeStatus,
)
from app.services.position_engine import calculate_positions, collect_portfolio_ids

pytestmark = pytest.mark.asyncio


# ── Fixture helpers ────────────────────────────────────────────────────────────

async def _make_portfolio(db, name: str = "Test Portfolio") -> Portfolio:
    p = Portfolio(name=name)
    db.add(p)
    await db.flush()
    return p


async def _make_stock_instrument(db, symbol: str = "NVDA") -> Instrument:
    inst = Instrument(
        symbol=symbol,
        instrument_type=InstrumentType.STOCK,
        multiplier=1,
    )
    db.add(inst)
    await db.flush()
    return inst


async def _make_option_instrument(
    db,
    symbol: str = "NVDA",
    option_type: OptionType = OptionType.PUT,
    strike: str = "600",
    expiry: date | None = None,
) -> Instrument:
    inst = Instrument(
        symbol=symbol,
        instrument_type=InstrumentType.OPTION,
        option_type=option_type,
        strike=Decimal(strike),
        expiry=expiry or date(2027, 1, 16),
        multiplier=100,
    )
    db.add(inst)
    await db.flush()
    return inst


async def _make_trade(
    db,
    portfolio: Portfolio,
    instrument: Instrument,
    action: TradeAction,
    quantity: int,
    price: str = "5.00",
) -> TradeEvent:
    t = TradeEvent(
        portfolio_id=portfolio.id,
        instrument_id=instrument.id,
        action=action,
        quantity=quantity,
        price=Decimal(price),
        status=TradeStatus.ACTIVE,
        trade_date=datetime.utcnow(),
    )
    db.add(t)
    await db.flush()
    return t


# ── Net-contracts sign convention ─────────────────────────────────────────────

async def test_sell_open_gives_negative_net(db):
    """SELL_OPEN 5 → net_contracts = -5 (short)."""
    port = await _make_portfolio(db)
    inst = await _make_option_instrument(db)
    await _make_trade(db, port, inst, TradeAction.SELL_OPEN, 5, price="3.00")

    rows = await calculate_positions(db)
    assert len(rows) == 1
    assert rows[0].net_contracts == -5


async def test_buy_open_gives_positive_net(db):
    """BUY_OPEN 3 → net_contracts = +3 (long)."""
    port = await _make_portfolio(db)
    inst = await _make_option_instrument(db, option_type=OptionType.CALL)
    await _make_trade(db, port, inst, TradeAction.BUY_OPEN, 3, price="2.00")

    rows = await calculate_positions(db)
    assert len(rows) == 1
    assert rows[0].net_contracts == 3


async def test_buy_close_reduces_short(db):
    """SELL_OPEN 5 then BUY_CLOSE 2 → net = -3."""
    port = await _make_portfolio(db)
    inst = await _make_option_instrument(db)
    await _make_trade(db, port, inst, TradeAction.SELL_OPEN, 5, price="3.00")
    await _make_trade(db, port, inst, TradeAction.BUY_CLOSE, 2, price="1.50")

    rows = await calculate_positions(db)
    assert len(rows) == 1
    assert rows[0].net_contracts == -3


async def test_sell_close_reduces_long(db):
    """BUY_OPEN 4 then SELL_CLOSE 1 → net = +3."""
    port = await _make_portfolio(db)
    inst = await _make_option_instrument(db, option_type=OptionType.CALL)
    await _make_trade(db, port, inst, TradeAction.BUY_OPEN,  4, price="4.00")
    await _make_trade(db, port, inst, TradeAction.SELL_CLOSE, 1, price="5.00")

    rows = await calculate_positions(db)
    assert len(rows) == 1
    assert rows[0].net_contracts == 3


async def test_fully_closed_position_excluded(db):
    """Flat net position (open then fully close) is filtered out."""
    port = await _make_portfolio(db)
    inst = await _make_option_instrument(db)
    await _make_trade(db, port, inst, TradeAction.SELL_OPEN, 5, price="3.00")
    await _make_trade(db, port, inst, TradeAction.BUY_CLOSE, 5, price="1.00")

    rows = await calculate_positions(db)
    assert rows == [], "Flat position should be excluded"


# ── Average open price ─────────────────────────────────────────────────────────

async def test_avg_open_price_single_trade(db):
    """Single BUY_OPEN: avg = trade price."""
    port = await _make_portfolio(db)
    inst = await _make_option_instrument(db, option_type=OptionType.CALL)
    await _make_trade(db, port, inst, TradeAction.BUY_OPEN, 3, price="4.50")

    rows = await calculate_positions(db)
    assert rows[0].avg_open_price == Decimal("4.50")


async def test_avg_open_price_weighted_average(db):
    """
    Two BUY_OPEN trades: 2 @ 4.00 and 3 @ 6.00.
    Weighted avg = (2×4 + 3×6) / 5 = 26/5 = 5.20.
    """
    port = await _make_portfolio(db)
    inst = await _make_option_instrument(db, option_type=OptionType.CALL)
    await _make_trade(db, port, inst, TradeAction.BUY_OPEN, 2, price="4.00")
    await _make_trade(db, port, inst, TradeAction.BUY_OPEN, 3, price="6.00")

    rows = await calculate_positions(db)
    assert rows[0].net_contracts == 5
    assert rows[0].avg_open_price == Decimal("5.20")


async def test_buy_close_does_not_affect_avg_price(db):
    """Closing trades do NOT affect the cost-basis average."""
    port = await _make_portfolio(db)
    inst = await _make_option_instrument(db)
    await _make_trade(db, port, inst, TradeAction.SELL_OPEN, 4, price="3.00")
    await _make_trade(db, port, inst, TradeAction.BUY_CLOSE, 1, price="1.00")  # close at profit

    rows = await calculate_positions(db)
    assert rows[0].net_contracts == -3
    # avg_open_price still reflects only the SELL_OPEN price
    assert rows[0].avg_open_price == Decimal("3.00")


# ── Portfolio ID filtering ─────────────────────────────────────────────────────

async def test_portfolio_filter_isolates_positions(db):
    """calculate_positions(portfolio_id=N) returns only that portfolio's positions."""
    port_a = await _make_portfolio(db, "Portfolio A")
    port_b = await _make_portfolio(db, "Portfolio B")
    inst   = await _make_option_instrument(db)

    await _make_trade(db, port_a, inst, TradeAction.SELL_OPEN, 3, price="2.00")
    await _make_trade(db, port_b, inst, TradeAction.SELL_OPEN, 7, price="2.00")

    rows_a = await calculate_positions(db, portfolio_id=port_a.id)
    rows_b = await calculate_positions(db, portfolio_id=port_b.id)

    assert len(rows_a) == 1 and rows_a[0].net_contracts == -3
    assert len(rows_b) == 1 and rows_b[0].net_contracts == -7


async def test_no_filter_aggregates_all_portfolios(db):
    """Without a portfolio filter, positions aggregate across portfolios."""
    port_a = await _make_portfolio(db, "Portfolio A")
    port_b = await _make_portfolio(db, "Portfolio B")
    inst_a = await _make_option_instrument(db, symbol="NVDA")
    inst_b = await _make_option_instrument(db, symbol="AAPL")

    await _make_trade(db, port_a, inst_a, TradeAction.SELL_OPEN, 3)
    await _make_trade(db, port_b, inst_b, TradeAction.BUY_OPEN,  5)

    rows = await calculate_positions(db)
    symbols = {r.instrument.symbol for r in rows}
    assert symbols == {"NVDA", "AAPL"}


# ── collect_portfolio_ids BFS ─────────────────────────────────────────────────

async def test_collect_portfolio_ids_single(db):
    """Root with no children returns just its own id."""
    port = await _make_portfolio(db)
    ids = await collect_portfolio_ids(db, port.id)
    assert ids == {port.id}


async def test_collect_portfolio_ids_with_children(db):
    """Parent + two children: all three IDs returned."""
    parent = await _make_portfolio(db, "Parent")
    child1 = Portfolio(name="Child 1", parent_id=parent.id)
    child2 = Portfolio(name="Child 2", parent_id=parent.id)
    db.add_all([child1, child2])
    await db.flush()

    ids = await collect_portfolio_ids(db, parent.id)
    assert ids == {parent.id, child1.id, child2.id}


async def test_collect_portfolio_ids_leaf_node(db):
    """Querying a leaf (child) node returns only that leaf's id."""
    parent = await _make_portfolio(db, "Parent")
    child  = Portfolio(name="Child", parent_id=parent.id)
    db.add(child)
    await db.flush()

    ids = await collect_portfolio_ids(db, child.id)
    assert ids == {child.id}


# ── Stock multiplier ──────────────────────────────────────────────────────────

async def test_stock_position_total_open_uses_multiplier_1(db):
    """
    Stock positions use multiplier=1.
    total_open_premium = avg_price × |net_shares| × 1
    """
    port = await _make_portfolio(db)
    inst = await _make_stock_instrument(db, "NVDA")
    await _make_trade(db, port, inst, TradeAction.BUY_OPEN, 10, price="800.00")

    rows = await calculate_positions(db)
    assert len(rows) == 1
    row = rows[0]
    assert row.net_contracts == 10
    assert row.avg_open_price == Decimal("800.00")
    # multiplier=1 for stocks
    assert row.total_open_premium == Decimal("800.00") * 10 * 1


async def test_option_position_total_open_uses_multiplier_100(db):
    """
    Option positions use multiplier=100.
    total_open_premium = avg_price × |net_contracts| × 100
    """
    port = await _make_portfolio(db)
    inst = await _make_option_instrument(db)
    await _make_trade(db, port, inst, TradeAction.SELL_OPEN, 2, price="5.00")

    rows = await calculate_positions(db)
    row = rows[0]
    assert row.net_contracts == -2
    assert row.avg_open_price == Decimal("5.00")
    assert row.total_open_premium == Decimal("5.00") * 2 * 100
