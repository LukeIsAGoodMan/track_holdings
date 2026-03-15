"""
WebSocket Connection Manager.

Tracks active WebSocket connections per user, manages hierarchical
portfolio -> symbol subscriptions, and provides broadcast helpers
for the PriceFeedService.

Subscription model:
    Connection
        └── Portfolio
                └── Symbols

Symbols remain active as long as at least one portfolio references them.

Routing index:
    _symbol_connections: symbol -> set[conn_id]
    Derived from the hierarchical portfolio maps.  Kept in sync
    incrementally by subscribe / unsubscribe / disconnect.
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field

from fastapi import WebSocket

from app.services.yfinance_client import normalize_ticker

logger = logging.getLogger(__name__)


@dataclass
class WSConnection:
    """One authenticated WebSocket connection with hierarchical subscriptions."""
    ws: WebSocket
    user_id: int
    language: str = "en"  # Phase 11: user's preferred language for AI diagnostics

    # Hierarchical subscription map: portfolio_id -> set of symbols
    _portfolio_map: dict[int, set[str]] = field(default_factory=dict)

    # ── Derived authority properties ───────────────────────────────────────

    @property
    def all_symbols(self) -> set[str]:
        """
        Union of all symbol sets across all subscribed portfolios.

        Always returns a NEW set instance — never exposes internal
        references.  Safe for concurrent iteration by the Spot Loop.
        """
        result: set[str] = set()
        for syms in self._portfolio_map.values():
            result |= syms
        return result

    # ── Read-only portfolio-level view ───────────────────────────────────────

    @property
    def portfolio_subscriptions(self) -> list[tuple[int, set[str]]]:
        """
        Read-only snapshot of portfolio-level subscriptions.

        Returns a list of (portfolio_id, frozenset_of_symbols) tuples.
        Each symbol set is a copy — callers cannot mutate internal state.
        """
        return [(pid, set(syms)) for pid, syms in self._portfolio_map.items()]

    # ── Backward-compatibility aliases ─────────────────────────────────────

    @property
    def subscribed_symbols(self) -> set[str]:
        """Compatibility alias — delegates to all_symbols."""
        return self.all_symbols

    @property
    def subscribed_portfolio_ids(self) -> set[int]:
        """Compatibility alias — derived from _portfolio_map keys."""
        return set(self._portfolio_map.keys())


class ConnectionManager:
    """Manages all active WebSocket connections and broadcasts."""

    def __init__(self) -> None:
        # conn_id (id(ws)) -> WSConnection
        self._connections: dict[int, WSConnection] = {}
        # Routing index: symbol -> set of conn_ids subscribed to that symbol
        self._symbol_connections: dict[str, set[int]] = {}

    # ── Connect / Disconnect ──────────────────────────────────────────────

    async def connect(self, ws: WebSocket, user_id: int, language: str = "en") -> WSConnection:
        await ws.accept()
        conn = WSConnection(ws=ws, user_id=user_id, language=language)
        self._connections[id(ws)] = conn
        logger.info("WS connected: user=%d  total=%d", user_id, len(self._connections))
        return conn

    def disconnect(self, ws: WebSocket) -> None:
        conn_id = id(ws)
        conn = self._connections.pop(conn_id, None)
        if conn:
            # Remove conn_id from every symbol bucket it participates in
            for sym in conn.all_symbols:
                bucket = self._symbol_connections.get(sym)
                if bucket is not None:
                    bucket.discard(conn_id)
                    if not bucket:
                        del self._symbol_connections[sym]
            logger.info(
                "WS disconnected: user=%d  total=%d",
                conn.user_id, len(self._connections),
            )

    # ── Subscription ──────────────────────────────────────────────────────

    def subscribe(self, ws: WebSocket, portfolio_id: int, symbols: set[str]) -> None:
        """
        Subscribe a connection to a portfolio's symbol set.

        Idempotent replacement: if portfolio_id already exists, the entire
        symbol set is replaced.  Symbols are normalized via normalize_ticker().
        The routing index is updated incrementally via before/after diff.
        """
        conn_id = id(ws)
        conn = self._connections.get(conn_id)
        if not conn:
            return

        normalized = {normalize_ticker(s) for s in symbols}

        # Snapshot effective symbols BEFORE the change
        old_effective = conn.all_symbols

        # Update the portfolio map (source of truth)
        conn._portfolio_map[portfolio_id] = normalized

        # Snapshot effective symbols AFTER the change
        new_effective = conn.all_symbols

        # Incremental index update
        removed = old_effective - new_effective
        added = new_effective - old_effective

        for sym in removed:
            bucket = self._symbol_connections.get(sym)
            if bucket is not None:
                bucket.discard(conn_id)
                if not bucket:
                    del self._symbol_connections[sym]

        for sym in added:
            self._symbol_connections.setdefault(sym, set()).add(conn_id)

        logger.info(
            "WS subscribe: user=%d portfolio=%d symbols=%s",
            conn.user_id, portfolio_id, normalized,
        )

    def unsubscribe(self, ws: WebSocket, portfolio_id: int) -> None:
        """
        Unsubscribe a connection from a portfolio.

        The routing index is updated via before/after diff so symbols
        still referenced by other portfolios are retained.
        """
        conn_id = id(ws)
        conn = self._connections.get(conn_id)
        if not conn:
            return

        if portfolio_id not in conn._portfolio_map:
            return

        # Snapshot effective symbols BEFORE the change
        old_effective = conn.all_symbols

        # Remove portfolio entry (source of truth)
        del conn._portfolio_map[portfolio_id]

        # Snapshot effective symbols AFTER the change
        new_effective = conn.all_symbols

        # Symbols that this connection no longer references at all
        removed = old_effective - new_effective
        for sym in removed:
            bucket = self._symbol_connections.get(sym)
            if bucket is not None:
                bucket.discard(conn_id)
                if not bucket:
                    del self._symbol_connections[sym]

        logger.info(
            "WS unsubscribe: user=%d portfolio=%d", conn.user_id, portfolio_id,
        )

    # ── Query ─────────────────────────────────────────────────────────────

    def all_subscribed_symbols(self) -> set[str]:
        """Return the union of all symbols across all connections."""
        return set(self._symbol_connections.keys())

    def connections_for_symbol(self, symbol: str) -> list[WSConnection]:
        """Return all connections subscribed to a given symbol."""
        bucket = self._symbol_connections.get(symbol)
        if not bucket:
            return []
        return [
            self._connections[cid]
            for cid in bucket
            if cid in self._connections
        ]

    def connections_for_any_symbol(self, symbols: set[str]) -> list[WSConnection]:
        """
        Return unique WSConnection objects subscribed to at least one
        symbol in the input set.  O(changed symbols) instead of O(all connections).
        """
        conn_ids: set[int] = set()
        for sym in symbols:
            bucket = self._symbol_connections.get(sym)
            if bucket:
                conn_ids.update(bucket)
        # Resolve to WSConnection objects, skip stale ids defensively
        return [
            self._connections[cid]
            for cid in conn_ids
            if cid in self._connections
        ]

    def connections_for_user(self, user_id: int) -> list[WSConnection]:
        return [
            conn for conn in self._connections.values()
            if conn.user_id == user_id
        ]

    def connections_for_user_portfolio(
        self, user_id: int, portfolio_id: int
    ) -> list[WSConnection]:
        """
        Return connections for a user that are subscribed to a specific portfolio.

        Used for portfolio-scoped broadcasting to avoid cross-tab pollution.
        """
        return [
            conn for conn in self._connections.values()
            if conn.user_id == user_id and portfolio_id in conn._portfolio_map
        ]

    def is_portfolio_subscribed_elsewhere(
        self, user_id: int, portfolio_id: int, exclude_conn_id: int
    ) -> bool:
        """
        Check if any OTHER connection for this user still subscribes to the portfolio.

        Used for reference-aware FSM cleanup: only clear FSM index when the
        last connection referencing a portfolio disconnects or unsubscribes.
        """
        for cid, conn in self._connections.items():
            if (
                cid != exclude_conn_id
                and conn.user_id == user_id
                and portfolio_id in conn._portfolio_map
            ):
                return True
        return False

    def snapshot_connections(self) -> list[WSConnection]:
        """Return a read-only snapshot of all connections (safe to iterate)."""
        return list(self._connections.values())

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
