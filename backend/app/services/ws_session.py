"""
WebSocket Session — state machine for individual WS connections.

Each authenticated WebSocket gets a WSSession that tracks:
  - lifecycle state (connecting → authenticated → ready → subscribed → closed)
  - subscribed portfolios
  - background tasks (heartbeat, snapshots)
  - pong timeout tracking
  - structured session_id for logging

State transitions:
  CONNECTING → AUTHENTICATED → READY → SUBSCRIBED ↔ DEGRADED
                                          ↓
                                        CLOSED
"""
from __future__ import annotations

import asyncio
import enum
import logging
import time
import uuid
from dataclasses import dataclass, field

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WSSessionState(enum.Enum):
    """Lifecycle states for a WebSocket session."""
    CONNECTING = "connecting"
    AUTHENTICATED = "authenticated"
    READY = "ready"
    SUBSCRIBED = "subscribed"
    DEGRADED = "degraded"
    CLOSED = "closed"


# States that allow sending messages
_SENDABLE = {
    WSSessionState.READY,
    WSSessionState.SUBSCRIBED,
    WSSessionState.DEGRADED,
}


@dataclass
class WSSession:
    """Tracks per-connection lifecycle, subscriptions, and health."""
    session_id: str
    user_id: int
    language: str
    ws: WebSocket
    state: WSSessionState = WSSessionState.CONNECTING
    subscribed_portfolios: set[int] = field(default_factory=set)
    _active_tasks: dict[str, asyncio.Task] = field(default_factory=dict)
    last_pong: float = field(default_factory=time.monotonic)
    created_at: float = field(default_factory=time.monotonic)

    # ── State transitions ────────────────────────────────────────────────

    def transition(self, new_state: WSSessionState) -> None:
        """Transition to a new state with logging."""
        old = self.state
        self.state = new_state
        logger.info(
            "session=%s user=%d state %s -> %s",
            self.session_id, self.user_id, old.value, new_state.value,
        )

    @property
    def can_send(self) -> bool:
        return self.state in _SENDABLE

    @property
    def is_alive(self) -> bool:
        return self.state not in (WSSessionState.CLOSED,)

    # ── Task management ──────────────────────────────────────────────────

    def track_task(self, name: str, task: asyncio.Task) -> None:
        """Register a background task (snapshot, heartbeat, etc.)."""
        old = self._active_tasks.get(name)
        if old and not old.done():
            old.cancel()
        self._active_tasks[name] = task

    def cancel_all_tasks(self) -> None:
        """Cancel all tracked background tasks."""
        for name, task in self._active_tasks.items():
            if not task.done():
                task.cancel()
        self._active_tasks.clear()

    # ── Pong tracking ────────────────────────────────────────────────────

    def record_pong(self) -> None:
        self.last_pong = time.monotonic()

    def pong_age(self) -> float:
        """Seconds since last pong."""
        return time.monotonic() - self.last_pong

    # ── Logging context ──────────────────────────────────────────────────

    @property
    def log_ctx(self) -> str:
        return f"session={self.session_id} user={self.user_id}"


def create_session(user_id: int, language: str, ws: WebSocket) -> WSSession:
    """Factory: create a new session with a unique ID."""
    return WSSession(
        session_id=uuid.uuid4().hex[:12],
        user_id=user_id,
        language=language,
        ws=ws,
    )
