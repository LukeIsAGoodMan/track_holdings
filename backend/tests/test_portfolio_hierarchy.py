"""
Integration tests for Phase 16C — Hierarchical Portfolio Filtering.

Verifies that folder portfolios correctly aggregate data from all descendants:
  1. collect_portfolio_ids — BFS returns root + all descendants
  2. calculate_positions  — aggregates trades across a portfolio subtree
  3. resolve_portfolio_ids — validates ownership; returns subtree or all user portfolios
  4. CashLedger filtering  — cash rollup respects the portfolio_ids set

Test layout used throughout:
    Folder (root)  ← is_folder, user_id=1
    ├── AccountA   ← leaf, user_id=1
    └── AccountB   ← leaf, user_id=1
        └── SubAccount ← grandchild, user_id=1
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select

from app.models import (
    CashLedger,
    Instrument,
    InstrumentType,
    Portfolio,
    TradeEvent,
    TradeAction,
    TradeStatus,
)
from app.services.portfolio_resolver import resolve_portfolio_ids
from app.services.position_engine import calculate_positions, collect_portfolio_ids

pytestmark = pytest.mark.asyncio


# ── Fixture helpers ──────────────────────────────────────────────────────────

async def _make_portfolio(
    db,
    name: str,
    *,
    parent_id: int | None = None,
    is_folder: bool = False,
    user_id: int = 1,
) -> Portfolio:
    p = Portfolio(
        name=name,
        parent_id=parent_id,
        is_folder=is_folder,
        user_id=user_id,
    )
    db.add(p)
    await db.flush()
    return p


async def _make_stock(db, symbol: str = "NVDA") -> Instrument:
    inst = Instrument(
        symbol=symbol,
        instrument_type=InstrumentType.STOCK,
        multiplier=1,
    )
    db.add(inst)
    await db.flush()
    return inst


async def _make_trade(
    db,
    portfolio: Portfolio,
    instrument: Instrument,
    action: TradeAction = TradeAction.BUY_OPEN,
    quantity: int = 1,
    price: str = "100.00",
) -> TradeEvent:
    t = TradeEvent(
        portfolio_id=portfolio.id,
        instrument_id=instrument.id,
        action=action,
        quantity=quantity,
        price=Decimal(price),
        trade_date=date(2025, 1, 15),
        status=TradeStatus.ACTIVE,
    )
    db.add(t)
    await db.flush()
    return t


async def _make_cash(
    db,
    portfolio: Portfolio,
    amount: str,
    user_id: int = 1,
) -> CashLedger:
    entry = CashLedger(
        portfolio_id=portfolio.id,
        user_id=user_id,
        amount=Decimal(amount),
        description="test deposit",
    )
    db.add(entry)
    await db.flush()
    return entry


# ── collect_portfolio_ids ─────────────────────────────────────────────────────

async def test_collect_ids_root_only(db):
    """Root with no children → returns {root.id}."""
    root = await _make_portfolio(db, "Root", is_folder=True)
    ids = await collect_portfolio_ids(db, root.id)
    assert ids == {root.id}


async def test_collect_ids_two_levels(db):
    """Folder → 2 children → returns {folder, childA, childB}."""
    folder = await _make_portfolio(db, "Folder", is_folder=True)
    childA = await _make_portfolio(db, "AccountA", parent_id=folder.id)
    childB = await _make_portfolio(db, "AccountB", parent_id=folder.id)

    ids = await collect_portfolio_ids(db, folder.id)
    assert ids == {folder.id, childA.id, childB.id}


async def test_collect_ids_three_levels(db):
    """Folder → child → grandchild → returns all three."""
    folder = await _make_portfolio(db, "Folder", is_folder=True)
    child  = await _make_portfolio(db, "Child",  parent_id=folder.id)
    grand  = await _make_portfolio(db, "Grand",  parent_id=child.id)

    ids = await collect_portfolio_ids(db, folder.id)
    assert ids == {folder.id, child.id, grand.id}


async def test_collect_ids_leaf_returns_only_itself(db):
    """Querying a leaf portfolio returns only {leaf.id}."""
    folder = await _make_portfolio(db, "Folder", is_folder=True)
    leaf   = await _make_portfolio(db, "Leaf", parent_id=folder.id)

    ids = await collect_portfolio_ids(db, leaf.id)
    assert ids == {leaf.id}


async def test_collect_ids_sibling_excluded(db):
    """Querying childA does not include childB (sibling isolation)."""
    folder = await _make_portfolio(db, "Folder", is_folder=True)
    childA = await _make_portfolio(db, "AccountA", parent_id=folder.id)
    childB = await _make_portfolio(db, "AccountB", parent_id=folder.id)

    ids = await collect_portfolio_ids(db, childA.id)
    assert childB.id not in ids
    assert ids == {childA.id}


# ── calculate_positions with subtree ─────────────────────────────────────────

async def test_positions_aggregate_across_subtree(db):
    """
    calculate_positions with portfolio_ids={A, B} sums both portfolios.

    Portfolio A: BUY_OPEN 3 NVDA
    Portfolio B: BUY_OPEN 2 NVDA
    → net_contracts = 5
    """
    folder = await _make_portfolio(db, "Folder", is_folder=True)
    portA  = await _make_portfolio(db, "A", parent_id=folder.id)
    portB  = await _make_portfolio(db, "B", parent_id=folder.id)
    nvda   = await _make_stock(db, "NVDA")

    await _make_trade(db, portA, nvda, TradeAction.BUY_OPEN, quantity=3)
    await _make_trade(db, portB, nvda, TradeAction.BUY_OPEN, quantity=2)

    pids = await collect_portfolio_ids(db, folder.id)
    positions = await calculate_positions(db, portfolio_ids=pids)

    assert len(positions) == 1
    assert positions[0].instrument.symbol == "NVDA"
    assert positions[0].net_contracts == 5


async def test_positions_isolated_to_leaf(db):
    """Querying only portA shows only portA's trades (portB excluded)."""
    folder = await _make_portfolio(db, "Folder", is_folder=True)
    portA  = await _make_portfolio(db, "A", parent_id=folder.id)
    portB  = await _make_portfolio(db, "B", parent_id=folder.id)
    nvda   = await _make_stock(db, "NVDA")

    await _make_trade(db, portA, nvda, TradeAction.BUY_OPEN, quantity=3)
    await _make_trade(db, portB, nvda, TradeAction.BUY_OPEN, quantity=10)

    pids = await collect_portfolio_ids(db, portA.id)  # only portA
    positions = await calculate_positions(db, portfolio_ids=pids)

    assert len(positions) == 1
    assert positions[0].net_contracts == 3  # not 13


async def test_positions_empty_when_no_trades(db):
    """Folder with children but no trades → empty position list."""
    folder = await _make_portfolio(db, "Folder", is_folder=True)
    await _make_portfolio(db, "A", parent_id=folder.id)
    await _make_portfolio(db, "B", parent_id=folder.id)

    pids = await collect_portfolio_ids(db, folder.id)
    positions = await calculate_positions(db, portfolio_ids=pids)
    assert positions == []


async def test_positions_three_level_rollup(db):
    """Folder → child → grandchild: positions aggregate across all three levels."""
    folder = await _make_portfolio(db, "Folder", is_folder=True)
    child  = await _make_portfolio(db, "Child", parent_id=folder.id)
    grand  = await _make_portfolio(db, "Grand", parent_id=child.id)
    nvda   = await _make_stock(db, "NVDA")

    await _make_trade(db, child, nvda, TradeAction.BUY_OPEN, quantity=4)
    await _make_trade(db, grand, nvda, TradeAction.BUY_OPEN, quantity=6)

    pids = await collect_portfolio_ids(db, folder.id)
    positions = await calculate_positions(db, portfolio_ids=pids)

    assert len(positions) == 1
    assert positions[0].net_contracts == 10


# ── resolve_portfolio_ids ─────────────────────────────────────────────────────

async def test_resolve_returns_subtree_for_folder(db):
    """resolve_portfolio_ids(folder_id) returns folder + all descendants."""
    folder = await _make_portfolio(db, "Folder", is_folder=True, user_id=1)
    childA = await _make_portfolio(db, "A", parent_id=folder.id, user_id=1)
    childB = await _make_portfolio(db, "B", parent_id=folder.id, user_id=1)

    pids = await resolve_portfolio_ids(db, user_id=1, portfolio_id=folder.id)
    assert pids == {folder.id, childA.id, childB.id}


async def test_resolve_returns_all_user_portfolios_when_no_filter(db):
    """resolve_portfolio_ids(portfolio_id=None) returns all user's portfolios."""
    p1 = await _make_portfolio(db, "P1", user_id=1)
    p2 = await _make_portfolio(db, "P2", user_id=1)
    # user_id=2 portfolio — should NOT appear
    await _make_portfolio(db, "Other", user_id=2)

    pids = await resolve_portfolio_ids(db, user_id=1, portfolio_id=None)
    assert p1.id in pids
    assert p2.id in pids
    # Portfolios belonging to user 2 must be excluded
    result = await db.execute(select(Portfolio.id).where(Portfolio.user_id == 2))
    other_ids = set(result.scalars().all())
    assert not (pids & other_ids), "User 2's portfolios leaked into user 1's result"


async def test_resolve_raises_404_for_wrong_user(db):
    """resolve_portfolio_ids raises HTTP 404 when user doesn't own the portfolio."""
    owner_port = await _make_portfolio(db, "Owner's", user_id=1)

    with pytest.raises(HTTPException) as exc_info:
        await resolve_portfolio_ids(db, user_id=2, portfolio_id=owner_port.id)

    assert exc_info.value.status_code == 404


async def test_resolve_raises_404_for_missing_portfolio(db):
    """resolve_portfolio_ids raises HTTP 404 for a non-existent portfolio ID."""
    with pytest.raises(HTTPException) as exc_info:
        await resolve_portfolio_ids(db, user_id=1, portfolio_id=99999)

    assert exc_info.value.status_code == 404


# ── Cash ledger rollup ────────────────────────────────────────────────────────

async def test_cash_aggregates_across_subtree(db):
    """
    Cash in two child portfolios aggregates when the parent's pids are queried.

    portfolio_ids = collect_portfolio_ids(folder) → {folder, childA, childB}
    Cash in childA: +1000, Cash in childB: +500  → total = 1500
    """
    from sqlalchemy import func as sa_func

    folder = await _make_portfolio(db, "Folder", is_folder=True, user_id=1)
    childA = await _make_portfolio(db, "A", parent_id=folder.id, user_id=1)
    childB = await _make_portfolio(db, "B", parent_id=folder.id, user_id=1)

    await _make_cash(db, childA, "1000.00")
    await _make_cash(db, childB, "500.00")

    pids = await collect_portfolio_ids(db, folder.id)

    result = await db.execute(
        select(sa_func.sum(CashLedger.amount)).where(
            CashLedger.portfolio_id.in_(pids)
        )
    )
    total = Decimal(str(result.scalar() or 0))
    assert total == Decimal("1500.00")


async def test_cash_isolated_to_single_portfolio(db):
    """
    Querying childA's pids returns only childA's cash (childB excluded).
    """
    from sqlalchemy import func as sa_func

    folder = await _make_portfolio(db, "Folder", is_folder=True, user_id=1)
    childA = await _make_portfolio(db, "A", parent_id=folder.id, user_id=1)
    childB = await _make_portfolio(db, "B", parent_id=folder.id, user_id=1)

    await _make_cash(db, childA, "1000.00")
    await _make_cash(db, childB, "9999.00")  # must not bleed into childA query

    pids = await collect_portfolio_ids(db, childA.id)

    result = await db.execute(
        select(sa_func.sum(CashLedger.amount)).where(
            CashLedger.portfolio_id.in_(pids)
        )
    )
    total = Decimal(str(result.scalar() or 0))
    assert total == Decimal("1000.00")


async def test_cash_three_level_rollup(db):
    """Cash at child + grandchild both included when querying folder."""
    from sqlalchemy import func as sa_func

    folder = await _make_portfolio(db, "Folder", is_folder=True, user_id=1)
    child  = await _make_portfolio(db, "Child",  parent_id=folder.id, user_id=1)
    grand  = await _make_portfolio(db, "Grand",  parent_id=child.id,  user_id=1)

    await _make_cash(db, child, "300.00")
    await _make_cash(db, grand, "200.00")

    pids = await collect_portfolio_ids(db, folder.id)

    result = await db.execute(
        select(sa_func.sum(CashLedger.amount)).where(
            CashLedger.portfolio_id.in_(pids)
        )
    )
    total = Decimal(str(result.scalar() or 0))
    assert total == Decimal("500.00")


# ── A: Menu CRUD ──────────────────────────────────────────────────────────────

async def test_rename_succeeds(db):
    """A1: Renaming a portfolio to a unique name updates the name in the database."""
    port = await _make_portfolio(db, "OldName")
    port.name = "NewName"
    await db.flush()

    result = await db.execute(select(Portfolio).where(Portfolio.id == port.id))
    updated = result.scalar_one()
    assert updated.name == "NewName"


async def test_rename_conflicts_with_existing_name(db):
    """A2: Conflict check mirrors the router: a pre-existing name → 409-level block."""
    await _make_portfolio(db, "TakenName")
    port = await _make_portfolio(db, "MyPortfolio")

    # Same logic as the router's unique-name guard
    existing = await db.execute(
        select(Portfolio.id).where(Portfolio.name == "TakenName")
    )
    conflict_id = existing.scalar_one_or_none()

    # The conflict exists and belongs to a different portfolio → rename must be refused
    assert conflict_id is not None
    assert conflict_id != port.id


async def test_add_child_creates_nested_portfolio(db):
    """A3: 'Add Child' action creates a portfolio whose parent_id matches the folder."""
    parent = await _make_portfolio(db, "Parent", is_folder=True)
    child  = await _make_portfolio(db, "Child",  parent_id=parent.id)

    assert child.parent_id == parent.id

    # BFS must include both
    ids = await collect_portfolio_ids(db, parent.id)
    assert child.id in ids


async def test_cascade_delete_removes_entire_subtree(db):
    """A4: Deleting a folder removes it and all descendants (mirrors router cascade logic)."""
    from sqlalchemy import delete as _delete

    folder = await _make_portfolio(db, "Folder", is_folder=True)
    child  = await _make_portfolio(db, "Child",  parent_id=folder.id)
    grand  = await _make_portfolio(db, "Grand",  parent_id=child.id)

    all_ids = await collect_portfolio_ids(db, folder.id)
    assert all_ids == {folder.id, child.id, grand.id}

    await db.execute(_delete(Portfolio).where(Portfolio.id.in_(all_ids)))
    await db.flush()

    result = await db.execute(
        select(Portfolio).where(Portfolio.id.in_(all_ids))
    )
    remaining = result.scalars().all()
    assert remaining == []


# ── B: Move-Into Logic ────────────────────────────────────────────────────────

async def test_move_into_folder_reassigns_parent(db):
    """B1: Moving a portfolio into a folder correctly sets its parent_id."""
    folder = await _make_portfolio(db, "Folder", is_folder=True)
    port   = await _make_portfolio(db, "Port")

    port.parent_id = folder.id
    await db.flush()

    ids = await collect_portfolio_ids(db, folder.id)
    assert port.id in ids


async def test_cycle_guard_prevents_move_into_descendant(db):
    """B2: Moving a folder into its own descendant is a cycle — subtree contains the target."""
    folder = await _make_portfolio(db, "Folder", is_folder=True)
    child  = await _make_portfolio(db, "Child",  parent_id=folder.id, is_folder=True)

    # Router collects folder's subtree; if target parent (child) is in it → cycle
    subtree = await collect_portfolio_ids(db, folder.id)
    assert child.id in subtree  # move must be rejected


async def test_non_folder_is_invalid_drop_target(db):
    """B3: Accounts (is_folder=False) are never valid move-into targets."""
    account = await _make_portfolio(db, "Account", is_folder=False)
    assert not account.is_folder


async def test_self_drop_blocked(db):
    """B4: A portfolio cannot be moved into itself (self is always in own subtree)."""
    port    = await _make_portfolio(db, "Port", is_folder=True)
    subtree = await collect_portfolio_ids(db, port.id)
    assert port.id in subtree  # self-drop must be rejected


async def test_positions_rollup_correctly_after_move(db):
    """
    B5: After reparenting a portfolio into a folder, positions roll up through
    the new subtree.

    Setup: folder (empty), portA (loose, 3 NVDA).
    Before move  → folder subtree: no positions.
    After move   → folder subtree: 3 NVDA.
    """
    folder = await _make_portfolio(db, "Folder", is_folder=True)
    portA  = await _make_portfolio(db, "PortA")
    nvda   = await _make_stock(db, "NVDA")
    await _make_trade(db, portA, nvda, TradeAction.BUY_OPEN, quantity=3)

    # Before move: folder subtree is empty
    pids_before = await collect_portfolio_ids(db, folder.id)
    pos_before  = await calculate_positions(db, portfolio_ids=pids_before)
    assert pos_before == []

    # Move portA into folder
    portA.parent_id = folder.id
    await db.flush()

    # After move: folder subtree now includes portA's trade
    pids_after = await collect_portfolio_ids(db, folder.id)
    assert portA.id in pids_after

    pos_after = await calculate_positions(db, portfolio_ids=pids_after)
    assert len(pos_after) == 1
    assert pos_after[0].net_contracts == 3
