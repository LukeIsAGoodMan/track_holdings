"""
WebSocket Connection Manager.

Tracks active WebSocket connections per user, manages symbol subscriptions,
and provides broadcast helpers for the PriceFeedService.
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field

from fastapi import WebSocket

logger = logging.getLogger(__name__)


@dataclass
class WSConnection:
    """One authenticated WebSocket connection."""
    ws: WebSocket
    user_id: int
    subscribed_portfolio_ids: set[int] = field(default_factory=set)
    subscribed_symbols: set[str] = field(default_factory=set)
    language: str = "en"  # Phase 11: user's preferred language for AI diagnostics


class ConnectionManager:
    """Manages all active WebSocket connections and broadcasts."""

    def __init__(self) -> None:
        # conn_id (id(ws)) → WSConnection
        self._connections: dict[int, WSConnection] = {}

    # ── Connect / Disconnect ──────────────────────────────────────────────

    async def connect(self, ws: WebSocket, user_id: int, language: str = "en") -> WSConnection:
        await ws.accept()
        conn = WSConnection(ws=ws, user_id=user_id, language=language)
        self._connections[id(ws)] = conn
        logger.info("WS connected: user=%d  total=%d", user_id, len(self._connections))
        return conn

    def disconnect(self, ws: WebSocket) -> None:
        conn = self._connections.pop(id(ws), None)
        if conn:
            logger.info(
                "WS disconnected: user=%d  total=%d",
                conn.user_id, len(self._connections),
            )

    # ── Subscription ──────────────────────────────────────────────────────

    def subscribe(self, ws: WebSocket, portfolio_id: int, symbols: set[str]) -> None:
        conn = self._connections.get(id(ws))
        if conn:
            conn.subscribed_portfolio_ids.add(portfolio_id)
            conn.subscribed_symbols.update(symbols)
            logger.info(
                "WS subscribe: user=%d portfolio=%d symbols=%s",
                conn.user_id, portfolio_id, symbols,
            )

    def unsubscribe(self, ws: WebSocket, portfolio_id: int) -> None:
        conn = self._connections.get(id(ws))
        if conn:
            conn.subscribed_portfolio_ids.discard(portfolio_id)
            # Rebuild symbol set from remaining subscriptions
            # (symbols are refreshed on next poll cycle anyway)
            logger.info(
                "WS unsubscribe: user=%d portfolio=%d", conn.user_id, portfolio_id,
            )

    # ── Query ─────────────────────────────────────────────────────────────

    def all_subscribed_symbols(self) -> set[str]:
        """Return the union of all symbols across all connections."""
        symbols: set[str] = set()
        for conn in self._connections.values():
            symbols.update(conn.subscribed_symbols)
        return symbols

    def connections_for_symbol(self, symbol: str) -> list[WSConnection]:
        """Return all connections subscribed to a given symbol."""
        return [
            conn for conn in self._connections.values()
            if symbol in conn.subscribed_symbols
        ]

    def connections_for_user(self, user_id: int) -> list[WSConnection]:
        return [
            conn for conn in self._connections.values()
            if conn.user_id == user_id
        ]

    @property
    def active_count(self) -> int:
        return len(self._connections)

    # ── Broadcast ─────────────────────────────────────────────────────────

    async def send_json(self, ws: WebSocket, data: dict) -> bool:
        """Send JSON to a single WebSocket. Returns False on failure."""
        try:
            await ws.send_text(json.dumps(data, default=str))
            return True
        except Exception:
            self.disconnect(ws)
            return False

    async def broadcast_to_symbol_subscribers(
        self, symbol: str, message: dict
    ) -> int:
        """Send a message to all connections subscribed to a symbol. Returns send count."""
        conns = self.connections_for_symbol(symbol)
        if not conns:
            return 0
        results = await asyncio.gather(
            *[self.send_json(conn.ws, message) for conn in conns],
            return_exceptions=True,
        )
        return sum(1 for r in results if r is True)

    async def broadcast_to_user(self, user_id: int, message: dict) -> int:
        """Send a message to all connections for a specific user."""
        conns = self.connections_for_user(user_id)
        if not conns:
            return 0
        results = await asyncio.gather(
            *[self.send_json(conn.ws, message) for conn in conns],
            return_exceptions=True,
        )
        return sum(1 for r in results if r is True)

    async def broadcast_all(self, message: dict) -> int:
        """Send a message to ALL connected clients."""
        if not self._connections:
            return 0
        results = await asyncio.gather(
            *[self.send_json(conn.ws, message) for conn in self._connections.values()],
            return_exceptions=True,
        )
        return sum(1 for r in results if r is True)
