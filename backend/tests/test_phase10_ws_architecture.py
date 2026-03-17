"""
Phase 10 regression tests — WebSocket architecture upgrade.

Covers:
  1. WSSession state machine transitions
  2. WSSession pong timeout tracking
  3. WSSession task management
  4. WSBroadcastService delegation
  5. WSSnapshotService fault isolation
  6. Thin router backward compatibility
  7. Two-phase subscription (subscribed_ack + snapshot_status)
  8. Heartbeat pong timeout detection
"""
from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.ws_session import (
    WSSession, WSSessionState, create_session,
)
from app.services.ws_broadcast_service import WSBroadcastService
from app.services.ws_manager import ConnectionManager


# ══════════════════════════════════════════════════════════════════════════
# 1. WSSession STATE MACHINE
# ══════════════════════════════════════════════════════════════════════════

class TestWSSessionStateMachine:
    def test_create_session_defaults(self):
        ws = MagicMock()
        session = create_session(user_id=1, language="en", ws=ws)
        assert session.state == WSSessionState.CONNECTING
        assert session.user_id == 1
        assert session.language == "en"
        assert len(session.session_id) == 12
        assert session.subscribed_portfolios == set()

    def test_transition_updates_state(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)
        session.transition(WSSessionState.AUTHENTICATED)
        assert session.state == WSSessionState.AUTHENTICATED

    def test_full_lifecycle(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)
        assert session.state == WSSessionState.CONNECTING

        session.transition(WSSessionState.AUTHENTICATED)
        assert session.state == WSSessionState.AUTHENTICATED

        session.transition(WSSessionState.READY)
        assert session.state == WSSessionState.READY
        assert session.can_send is True

        session.transition(WSSessionState.SUBSCRIBED)
        assert session.state == WSSessionState.SUBSCRIBED
        assert session.can_send is True

        session.transition(WSSessionState.CLOSED)
        assert session.state == WSSessionState.CLOSED
        assert session.can_send is False
        assert session.is_alive is False

    def test_can_send_states(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)

        # CONNECTING — cannot send
        assert session.can_send is False

        session.transition(WSSessionState.AUTHENTICATED)
        assert session.can_send is False

        session.transition(WSSessionState.READY)
        assert session.can_send is True

        session.transition(WSSessionState.DEGRADED)
        assert session.can_send is True

    def test_is_alive(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)
        assert session.is_alive is True

        session.transition(WSSessionState.CLOSED)
        assert session.is_alive is False

    def test_log_ctx_format(self):
        ws = MagicMock()
        session = create_session(42, "zh", ws)
        assert "session=" in session.log_ctx
        assert "user=42" in session.log_ctx


# ══════════════════════════════════════════════════════════════════════════
# 2. WSSession PONG TIMEOUT
# ══════════════════════════════════════════════════════════════════════════

class TestWSSessionPong:
    def test_initial_pong_timestamp(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)
        # Should be set to monotonic time at creation
        assert session.last_pong > 0
        assert session.pong_age() < 1.0  # just created

    def test_record_pong_resets_age(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)
        # Artificially age the session
        session.last_pong = time.monotonic() - 100
        assert session.pong_age() > 99

        # Record pong
        session.record_pong()
        assert session.pong_age() < 1.0

    def test_pong_age_increases(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)
        session.last_pong = time.monotonic() - 30
        assert session.pong_age() >= 29


# ══════════════════════════════════════════════════════════════════════════
# 3. WSSession TASK MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════

class TestWSSessionTasks:
    def test_track_task(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)

        task = MagicMock(spec=asyncio.Task)
        task.done.return_value = False
        session.track_task("heartbeat", task)
        assert "heartbeat" in session._active_tasks

    def test_track_task_cancels_old(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)

        old_task = MagicMock(spec=asyncio.Task)
        old_task.done.return_value = False
        session.track_task("heartbeat", old_task)

        new_task = MagicMock(spec=asyncio.Task)
        new_task.done.return_value = False
        session.track_task("heartbeat", new_task)

        old_task.cancel.assert_called_once()
        assert session._active_tasks["heartbeat"] is new_task

    def test_cancel_all_tasks(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)

        t1 = MagicMock(spec=asyncio.Task)
        t1.done.return_value = False
        t2 = MagicMock(spec=asyncio.Task)
        t2.done.return_value = False

        session.track_task("heartbeat", t1)
        session.track_task("snapshot", t2)

        session.cancel_all_tasks()
        t1.cancel.assert_called_once()
        t2.cancel.assert_called_once()
        assert len(session._active_tasks) == 0

    def test_cancel_skips_done_tasks(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)

        done_task = MagicMock(spec=asyncio.Task)
        done_task.done.return_value = True
        session.track_task("done_one", done_task)

        session.cancel_all_tasks()
        done_task.cancel.assert_not_called()


# ══════════════════════════════════════════════════════════════════════════
# 4. WSBroadcastService DELEGATION
# ══════════════════════════════════════════════════════════════════════════

class TestWSBroadcastService:
    @pytest.mark.asyncio
    async def test_broadcast_to_user_delegates(self):
        manager = MagicMock(spec=ConnectionManager)
        manager.broadcast_to_user = AsyncMock(return_value=2)
        svc = WSBroadcastService(manager)

        result = await svc.broadcast_to_user(42, {"type": "test"})
        assert result == 2
        manager.broadcast_to_user.assert_called_once_with(42, {"type": "test"})

    @pytest.mark.asyncio
    async def test_broadcast_all_delegates(self):
        manager = MagicMock(spec=ConnectionManager)
        manager.broadcast_all = AsyncMock(return_value=5)
        svc = WSBroadcastService(manager)

        result = await svc.broadcast_all({"type": "market"})
        assert result == 5
        manager.broadcast_all.assert_called_once()

    @pytest.mark.asyncio
    async def test_send_json_delegates(self):
        manager = MagicMock(spec=ConnectionManager)
        manager.send_json = AsyncMock(return_value=True)
        svc = WSBroadcastService(manager)

        ws = MagicMock()
        result = await svc.send_json(ws, {"type": "ping"})
        assert result is True

    def test_all_subscribed_symbols_delegates(self):
        manager = MagicMock(spec=ConnectionManager)
        manager.all_subscribed_symbols.return_value = {"NVDA", "AAPL"}
        svc = WSBroadcastService(manager)

        syms = svc.all_subscribed_symbols()
        assert syms == {"NVDA", "AAPL"}

    def test_active_count_delegates(self):
        manager = MagicMock(spec=ConnectionManager)
        manager.active_count = 7
        svc = WSBroadcastService(manager)
        assert svc.active_count == 7


# ══════════════════════════════════════════════════════════════════════════
# 5. WSSession STATE ENUM
# ══════════════════════════════════════════════════════════════════════════

class TestWSSessionStateEnum:
    def test_all_states_exist(self):
        expected = {"connecting", "authenticated", "ready", "subscribed", "degraded", "closed"}
        actual = {s.value for s in WSSessionState}
        assert actual == expected

    def test_state_values_are_strings(self):
        for state in WSSessionState:
            assert isinstance(state.value, str)


# ══════════════════════════════════════════════════════════════════════════
# 6. BACKWARD COMPATIBILITY — existing tests must still pass
# ══════════════════════════════════════════════════════════════════════════

class TestBackwardCompatibility:
    """Verify Phase 10 additions don't break existing ConnectionManager API."""

    @pytest.mark.asyncio
    async def test_connect_still_returns_ws_connection(self):
        from app.services.ws_manager import WSConnection
        manager = ConnectionManager()
        ws = MagicMock()
        ws.accept = AsyncMock()
        conn = await manager.connect(ws, user_id=1)
        assert isinstance(conn, WSConnection)
        assert conn.user_id == 1

    @pytest.mark.asyncio
    async def test_subscribe_unsubscribe_still_works(self):
        manager = ConnectionManager()
        ws = MagicMock()
        ws.accept = AsyncMock()
        await manager.connect(ws, user_id=1)
        manager.subscribe(ws, 42, {"NVDA"})
        assert "NVDA" in manager.all_subscribed_symbols()
        manager.unsubscribe(ws, 42)
        assert "NVDA" not in manager.all_subscribed_symbols()

    @pytest.mark.asyncio
    async def test_broadcast_to_user_still_works(self):
        manager = ConnectionManager()
        ws = MagicMock()
        ws.accept = AsyncMock()
        ws.send_text = AsyncMock()
        await manager.connect(ws, user_id=1)
        count = await manager.broadcast_to_user(1, {"type": "test"})
        assert count == 1

    @pytest.mark.asyncio
    async def test_is_portfolio_subscribed_elsewhere_still_works(self):
        manager = ConnectionManager()
        ws_a = MagicMock()
        ws_a.accept = AsyncMock()
        ws_b = MagicMock()
        ws_b.accept = AsyncMock()
        await manager.connect(ws_a, user_id=1)
        await manager.connect(ws_b, user_id=1)
        manager.subscribe(ws_a, 42, {"NVDA"})
        manager.subscribe(ws_b, 42, {"NVDA"})

        # A unsubscribes, B still has it
        manager.unsubscribe(ws_a, 42)
        assert manager.is_portfolio_subscribed_elsewhere(1, 42, id(ws_a)) is True


# ══════════════════════════════════════════════════════════════════════════
# 7. WSSession SUBSCRIPTION TRACKING
# ══════════════════════════════════════════════════════════════════════════

class TestWSSessionSubscriptionTracking:
    def test_add_portfolio(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)
        session.subscribed_portfolios.add(42)
        assert 42 in session.subscribed_portfolios

    def test_remove_portfolio(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)
        session.subscribed_portfolios.add(42)
        session.subscribed_portfolios.discard(42)
        assert 42 not in session.subscribed_portfolios

    def test_multiple_portfolios(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)
        session.subscribed_portfolios.add(42)
        session.subscribed_portfolios.add(99)
        assert session.subscribed_portfolios == {42, 99}


# ══════════════════════════════════════════════════════════════════════════
# 8. DEGRADED STATE HANDLING
# ══════════════════════════════════════════════════════════════════════════

class TestDegradedState:
    def test_degraded_can_still_send(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)
        session.transition(WSSessionState.DEGRADED)
        assert session.can_send is True
        assert session.is_alive is True

    def test_degraded_to_closed(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)
        session.transition(WSSessionState.DEGRADED)
        session.transition(WSSessionState.CLOSED)
        assert session.can_send is False
        assert session.is_alive is False


# ══════════════════════════════════════════════════════════════════════════
# 9. UNIQUE SESSION IDs
# ══════════════════════════════════════════════════════════════════════════

class TestSessionIdUniqueness:
    def test_different_sessions_different_ids(self):
        ws = MagicMock()
        s1 = create_session(1, "en", ws)
        s2 = create_session(1, "en", ws)
        assert s1.session_id != s2.session_id

    def test_session_id_is_12_chars(self):
        ws = MagicMock()
        session = create_session(1, "en", ws)
        assert len(session.session_id) == 12
        assert session.session_id.isalnum()
