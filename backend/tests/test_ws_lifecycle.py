"""
Tests for WebSocket subscription lifecycle correctness.

Covers:
  - Multi-connection unsubscribe (reference safety)
  - Last-subscription unsubscribe (FSM cleanup)
  - Cross-tab broadcast isolation (portfolio-scoped delivery)
  - Disconnect reference safety (multi-tab FSM preservation)
  - Proactive FSM sync on subscribe
  - Symbol routing index consistency
"""
from __future__ import annotations

import asyncio
import json
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio

from app.services.ws_manager import ConnectionManager, WSConnection
from app.services.price_feed import FeedStateManager


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_mock_ws(conn_id: int) -> MagicMock:
    """Create a mock WebSocket with a deterministic id()."""
    ws = MagicMock()
    ws.__hash__ = lambda self: conn_id
    # Override id() by storing conn_id, but we need to patch the manager
    # to use a known key.  We'll use the real id() and track it.
    ws.accept = AsyncMock()
    ws.send_text = AsyncMock()
    return ws


async def _connect(manager: ConnectionManager, user_id: int, ws: MagicMock) -> WSConnection:
    """Connect and return the WSConnection."""
    return await manager.connect(ws, user_id)


# ═══════════════════════════════════════════════════════════════════════════════
# Test 1 — Multi-connection unsubscribe: FSM index preserved
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_multi_conn_unsubscribe_preserves_fsm():
    """
    Conn A and Conn B both subscribe to PID 42.
    A unsubscribes → FSM index for 42 must still exist.
    """
    manager = ConnectionManager()
    fsm = FeedStateManager()

    ws_a = _make_mock_ws(100)
    ws_b = _make_mock_ws(200)

    conn_a = await _connect(manager, user_id=1, ws=ws_a)
    conn_b = await _connect(manager, user_id=1, ws=ws_b)

    # Both subscribe to PID 42 with same symbols
    manager.subscribe(ws_a, 42, {"NVDA", "AVGO"})
    manager.subscribe(ws_b, 42, {"NVDA", "AVGO"})

    # Proactive FSM sync (mirrors what ws.py does on subscribe)
    await fsm.sync_portfolio_index(42, 1, {"NVDA", "AVGO"})

    # A unsubscribes — reference check should find B still subscribes
    conn_a_id = id(ws_a)
    manager.unsubscribe(ws_a, 42)

    still_subscribed = manager.is_portfolio_subscribed_elsewhere(1, 42, conn_a_id)
    assert still_subscribed is True

    # FSM should NOT be cleared (another connection still references PID 42)
    owner = await fsm.get_owner(42)
    assert owner == 1

    # Symbol routing index should still route to conn B
    conns = manager.connections_for_any_symbol({"NVDA"})
    assert len(conns) == 1
    assert conns[0] is conn_b


# ═══════════════════════════════════════════════════════════════════════════════
# Test 2 — Last subscription unsubscribe: FSM index removed
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_last_unsubscribe_clears_fsm():
    """
    Only Conn A subscribes to PID 42.
    A unsubscribes → FSM index for 42 must be removed.
    """
    manager = ConnectionManager()
    fsm = FeedStateManager()

    ws_a = _make_mock_ws(100)
    conn_a = await _connect(manager, user_id=1, ws=ws_a)

    manager.subscribe(ws_a, 42, {"NVDA"})
    await fsm.sync_portfolio_index(42, 1, {"NVDA"})

    # Unsubscribe
    conn_a_id = id(ws_a)
    manager.unsubscribe(ws_a, 42)

    still_subscribed = manager.is_portfolio_subscribed_elsewhere(1, 42, conn_a_id)
    assert still_subscribed is False

    # Simulate the cleanup ws.py would do
    await fsm.remove_portfolio(42)

    # FSM must be fully cleared
    owner = await fsm.get_owner(42)
    assert owner is None
    syms = await fsm.all_indexed_symbols()
    assert "NVDA" not in syms


# ═══════════════════════════════════════════════════════════════════════════════
# Test 3 — Cross-tab broadcast isolation
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_portfolio_scoped_broadcast():
    """
    User has Tab A (subscribed to PID 42) and Tab B (not subscribed).
    Only Tab A should receive portfolio-scoped messages.
    """
    manager = ConnectionManager()

    ws_a = _make_mock_ws(100)
    ws_b = _make_mock_ws(200)

    conn_a = await _connect(manager, user_id=1, ws=ws_a)
    conn_b = await _connect(manager, user_id=1, ws=ws_b)

    # Only Tab A subscribes to PID 42
    manager.subscribe(ws_a, 42, {"NVDA"})
    # Tab B subscribes to PID 99 (different portfolio)
    manager.subscribe(ws_b, 99, {"AAPL"})

    # Portfolio-scoped query should return only Tab A
    target = manager.connections_for_user_portfolio(1, 42)
    assert len(target) == 1
    assert target[0] is conn_a

    # Tab B should NOT be in the target
    target_99 = manager.connections_for_user_portfolio(1, 99)
    assert len(target_99) == 1
    assert target_99[0] is conn_b

    # broadcast_to_user would hit both — connections_for_user_portfolio is precise
    all_user = manager.connections_for_user(1)
    assert len(all_user) == 2


# ═══════════════════════════════════════════════════════════════════════════════
# Test 4 — Disconnect reference safety
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_disconnect_preserves_fsm_when_other_conn_exists():
    """
    Conn A and Conn B both subscribe to PID 42.
    Conn A disconnects → FSM index for 42 must remain intact.
    Conn B continues receiving updates.
    """
    manager = ConnectionManager()
    fsm = FeedStateManager()

    ws_a = _make_mock_ws(100)
    ws_b = _make_mock_ws(200)

    conn_a = await _connect(manager, user_id=1, ws=ws_a)
    conn_b = await _connect(manager, user_id=1, ws=ws_b)

    manager.subscribe(ws_a, 42, {"NVDA", "AMD"})
    manager.subscribe(ws_b, 42, {"NVDA", "AMD"})
    await fsm.sync_portfolio_index(42, 1, {"NVDA", "AMD"})

    # Snapshot orphan pids before disconnect (mirrors ws.py finally block)
    orphan_pids = list(conn_a._portfolio_map.keys())
    conn_a_id = id(ws_a)

    # Disconnect A
    manager.disconnect(ws_a)

    # Reference check for each orphan pid
    for pid in orphan_pids:
        still_elsewhere = manager.is_portfolio_subscribed_elsewhere(1, pid, conn_a_id)
        assert still_elsewhere is True  # Conn B still has it

    # FSM should be untouched
    owner = await fsm.get_owner(42)
    assert owner == 1

    # Symbol routing should only return Conn B now
    conns = manager.connections_for_any_symbol({"NVDA"})
    assert len(conns) == 1
    assert conns[0] is conn_b

    # Portfolio-scoped broadcast should target only Conn B
    target = manager.connections_for_user_portfolio(1, 42)
    assert len(target) == 1
    assert target[0] is conn_b


# ═══════════════════════════════════════════════════════════════════════════════
# Test 5 — Last-man disconnect clears FSM
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_last_disconnect_clears_fsm():
    """
    Only Conn A subscribes to PID 42.
    A disconnects → FSM should be fully cleared.
    """
    manager = ConnectionManager()
    fsm = FeedStateManager()

    ws_a = _make_mock_ws(100)
    conn_a = await _connect(manager, user_id=1, ws=ws_a)

    manager.subscribe(ws_a, 42, {"NVDA"})
    await fsm.sync_portfolio_index(42, 1, {"NVDA"})

    # Snapshot and disconnect
    orphan_pids = list(conn_a._portfolio_map.keys())
    conn_a_id = id(ws_a)
    manager.disconnect(ws_a)

    # Last-man check
    for pid in orphan_pids:
        still_elsewhere = manager.is_portfolio_subscribed_elsewhere(1, pid, conn_a_id)
        assert still_elsewhere is False

    # Simulate cleanup
    await fsm.remove_portfolio(42)

    owner = await fsm.get_owner(42)
    assert owner is None
    syms = await fsm.all_indexed_symbols()
    assert len(syms) == 0


# ═══════════════════════════════════════════════════════════════════════════════
# Test 6 — Proactive FSM sync on subscribe
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_proactive_fsm_sync():
    """
    After subscribe + FSM sync, the portfolio should be immediately
    discoverable via portfolios_for_symbols (primary path, not fallback).
    """
    manager = ConnectionManager()
    fsm = FeedStateManager()

    ws = _make_mock_ws(100)
    conn = await _connect(manager, user_id=1, ws=ws)

    manager.subscribe(ws, 42, {"NVDA", "^VIX"})

    # Simulate proactive sync (what ws.py now does)
    normalized = conn._portfolio_map.get(42, set())
    await fsm.sync_portfolio_index(42, 1, set(normalized))

    # Primary path should find the portfolio immediately
    pids = await fsm.portfolios_for_symbols({"NVDA"})
    assert 42 in pids

    owner = await fsm.get_owner(42)
    assert owner == 1


# ═══════════════════════════════════════════════════════════════════════════════
# Test 7 — Symbol routing isolation across connections
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_symbol_routing_isolation():
    """
    Verify _symbol_connections correctly tracks per-connection ownership.
    """
    manager = ConnectionManager()

    ws_a = _make_mock_ws(100)
    ws_b = _make_mock_ws(200)

    await _connect(manager, user_id=1, ws=ws_a)
    await _connect(manager, user_id=2, ws=ws_b)

    # A subscribes to {NVDA, AVGO}, B subscribes to {NVDA}
    manager.subscribe(ws_a, 10, {"NVDA", "AVGO"})
    manager.subscribe(ws_b, 20, {"NVDA"})

    # Both should appear for NVDA
    nvda_conns = manager.connections_for_any_symbol({"NVDA"})
    assert len(nvda_conns) == 2

    # Only A for AVGO
    avgo_conns = manager.connections_for_any_symbol({"AVGO"})
    assert len(avgo_conns) == 1

    # Disconnect A — NVDA should only route to B, AVGO gone
    manager.disconnect(ws_a)

    nvda_conns = manager.connections_for_any_symbol({"NVDA"})
    assert len(nvda_conns) == 1

    avgo_conns = manager.connections_for_any_symbol({"AVGO"})
    assert len(avgo_conns) == 0

    # AVGO should be fully removed from symbol_connections
    assert "AVGO" not in manager._symbol_connections


# ═══════════════════════════════════════════════════════════════════════════════
# Test 8 — remove_portfolio_index is idempotent
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_remove_portfolio_index_idempotent():
    """
    Calling remove_portfolio multiple times must not raise.
    """
    fsm = FeedStateManager()
    await fsm.sync_portfolio_index(42, 1, {"NVDA"})

    # First removal
    await fsm.remove_portfolio(42)
    owner = await fsm.get_owner(42)
    assert owner is None

    # Second removal — must be safe
    await fsm.remove_portfolio(42)
    owner = await fsm.get_owner(42)
    assert owner is None
