"""
WebSocket Broadcast Service — decoupled broadcast layer.

Wraps ConnectionManager broadcast methods so that upstream services
(PriceFeedService, MacroService, NlvSampler, etc.) never import
or directly call the ConnectionManager.

This layer adds:
  - structured logging per broadcast
  - future hook point for metrics (ws_broadcast_total, etc.)
  - fault isolation (broadcast failures don't crash callers)
"""
from __future__ import annotations

import logging

from app.services.ws_manager import ConnectionManager

logger = logging.getLogger(__name__)


class WSBroadcastService:
    """Thin broadcast abstraction over ConnectionManager."""

    def __init__(self, manager: ConnectionManager) -> None:
        self._manager = manager

    # ── Symbol-scoped ────────────────────────────────────────────────────

    async def broadcast_spot(self, message: dict, symbols: set[str]) -> int:
        """Send spot_update to all connections subscribed to any of the given symbols."""
        conns = self._manager.connections_for_any_symbol(symbols)
        if not conns:
            return 0
        import asyncio
        results = await asyncio.gather(
            *[self._manager.send_json(c.ws, message) for c in conns],
            return_exceptions=True,
        )
        sent = sum(1 for r in results if r is True)
        return sent

    # ── User-scoped ──────────────────────────────────────────────────────

    async def broadcast_to_user(self, user_id: int, message: dict) -> int:
        """Send a message to all connections for a user."""
        return await self._manager.broadcast_to_user(user_id, message)

    # ── Portfolio-scoped ─────────────────────────────────────────────────

    async def broadcast_to_portfolio(
        self, user_id: int, portfolio_id: int, message: dict,
    ) -> int:
        """Send to connections subscribed to a specific portfolio."""
        conns = self._manager.connections_for_user_portfolio(user_id, portfolio_id)
        if not conns:
            return 0
        import asyncio
        results = await asyncio.gather(
            *[self._manager.send_json(c.ws, message) for c in conns],
            return_exceptions=True,
        )
        return sum(1 for r in results if r is True)

    # ── Global ───────────────────────────────────────────────────────────

    async def broadcast_all(self, message: dict) -> int:
        """Send to ALL connected clients."""
        return await self._manager.broadcast_all(message)

    # ── Direct send ──────────────────────────────────────────────────────

    async def send_json(self, ws, data: dict) -> bool:
        """Send to a single WebSocket."""
        return await self._manager.send_json(ws, data)

    # ── Queries (delegated) ──────────────────────────────────────────────

    def all_subscribed_symbols(self) -> set[str]:
        return self._manager.all_subscribed_symbols()

    def connections_for_any_symbol(self, symbols: set[str]):
        return self._manager.connections_for_any_symbol(symbols)

    def connections_for_user(self, user_id: int):
        return self._manager.connections_for_user(user_id)

    def connections_for_user_portfolio(self, user_id: int, portfolio_id: int):
        return self._manager.connections_for_user_portfolio(user_id, portfolio_id)

    def snapshot_connections(self):
        return self._manager.snapshot_connections()

    @property
    def active_count(self) -> int:
        return self._manager.active_count
