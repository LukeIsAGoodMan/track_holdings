"""
WebSocket endpoint: /api/ws?token=<JWT>

Phase 10 — thin router layer.

This module ONLY:
  - authenticates the JWT
  - opens a session
  - delegates message handling to session service
  - runs heartbeat with pong timeout

Heavy computation (holdings, risk, snapshots) is delegated
to ws_snapshot_service.py via background tasks.

Protocol:
  Client → Server:
    {"type": "subscribe",   "portfolio_id": 1}
    {"type": "unsubscribe", "portfolio_id": 1}
    {"type": "pong"}

  Server → Client:
    {"type": "subscribed_ack",   "portfolio_id": 1}
    {"type": "snapshot_status",  "portfolio_id": 1, "status": "starting"|"complete"}
    {"type": "spot_update",      "data": {"NVDA": "135.42", ...}}
    {"type": "holdings_update",  "portfolio_id": 1, "data": [...]}
    {"type": "risk_update",      "portfolio_id": 1, "data": {...}}
    {"type": "macro_ticker",     "data": {...}}
    {"type": "subscribed",       "portfolio_id": 1, "symbols": [...]}
    {"type": "ping"}
    {"type": "error",            "message": "..."}
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import Instrument, TradeEvent
from app.services.auth import decode_access_token
from app.services.portfolio_resolver import resolve_portfolio_ids
from app.services.ws_session import (
    WSSession, WSSessionState, create_session,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Injected by main.py at startup
_manager = None          # type: ignore
_cache = None            # type: ignore
_macro_service = None    # type: ignore
_price_feed = None       # type: ignore
_snapshot_service = None  # type: ignore


def init_ws_globals(
    manager, cache, macro_service=None, price_feed=None, snapshot_service=None,
):
    """Called from main.py to inject shared singletons."""
    global _manager, _cache, _macro_service, _price_feed, _snapshot_service
    _manager = manager
    _cache = cache
    _macro_service = macro_service
    _price_feed = price_feed
    _snapshot_service = snapshot_service


# ── Authentication ────────────────────────────────────────────────────────

async def _authenticate_ws(token: str | None) -> int | None:
    """Validate JWT and return user_id, or None on failure."""
    if not token:
        return None
    try:
        payload = decode_access_token(token)
        return int(payload["sub"])
    except Exception:
        return None


# ── Symbol resolution (lightweight DB query) ──────────────────────────────

async def _get_portfolio_symbols(user_id: int, portfolio_id: int) -> set[str]:
    """Resolve a portfolio's active symbols for subscription."""
    async with AsyncSessionLocal() as db:
        pids = await resolve_portfolio_ids(db, user_id, portfolio_id)
        result = await db.execute(
            select(Instrument.symbol)
            .join(TradeEvent, TradeEvent.instrument_id == Instrument.id)
            .where(TradeEvent.portfolio_id.in_(pids))
            .distinct()
        )
        return {row[0] for row in result.all()}


# ── Heartbeat with pong timeout ──────────────────────────────────────────

PING_INTERVAL = 20.0    # seconds between pings (<Render 30s proxy timeout)
PONG_TIMEOUT = 45.0     # seconds before declaring session degraded


async def _heartbeat(session: WSSession) -> None:
    """Send periodic ping; enforce pong timeout."""
    try:
        while session.is_alive:
            await asyncio.sleep(PING_INTERVAL)
            if not session.is_alive:
                break

            # Check pong timeout
            age = session.pong_age()
            if age > PONG_TIMEOUT:
                logger.warning(
                    "Pong timeout (%.0fs): %s — closing", age, session.log_ctx,
                )
                session.transition(WSSessionState.DEGRADED)
                try:
                    await session.ws.close(code=4008, reason="Pong timeout")
                except Exception:
                    pass
                break

            # Send ping
            try:
                await session.ws.send_text(json.dumps({"type": "ping"}))
            except Exception:
                break
    except asyncio.CancelledError:
        pass


# ── Subscribe handler ────────────────────────────────────────────────────

async def _handle_subscribe(
    session: WSSession, conn, pid: int,
) -> None:
    """Two-phase subscription: immediate ACK + async snapshot pipeline."""
    ws = session.ws

    # Phase 0: resolve symbols (lightweight DB query)
    symbols = await _get_portfolio_symbols(session.user_id, pid)

    # Update ConnectionManager subscription index
    _manager.subscribe(ws, pid, symbols)
    session.subscribed_portfolios.add(pid)

    # Proactive FSM sync
    if _price_feed is not None:
        normalized_syms = conn._portfolio_map.get(pid, set())
        if normalized_syms:
            await _price_feed.sync_portfolio_index(
                pid, session.user_id, set(normalized_syms),
            )

    # Phase 1: Immediate ACK (non-blocking)
    await _manager.send_json(ws, {
        "type": "subscribed_ack",
        "portfolio_id": pid,
    })

    # Backward compat: also send the old "subscribed" message
    await _manager.send_json(ws, {
        "type": "subscribed",
        "portfolio_id": pid,
        "symbols": sorted(symbols),
    })

    # Update session state
    if session.state in (WSSessionState.READY, WSSessionState.AUTHENTICATED):
        session.transition(WSSessionState.SUBSCRIBED)

    logger.info("Subscribe: %s pid=%d symbols=%d", session.log_ctx, pid, len(symbols))

    # Phase 2: Async snapshot pipeline (background task, non-blocking)
    if _snapshot_service is not None:
        task = asyncio.create_task(
            _snapshot_service.send_snapshot(session, pid),
            name=f"snapshot_{session.session_id}_{pid}",
        )
        session.track_task(f"snapshot_{pid}", task)


# ── Unsubscribe handler ─────────────────────────────────────────────────

async def _handle_unsubscribe(
    session: WSSession, conn, pid: int,
) -> None:
    """Unsubscribe from a portfolio with reference-aware FSM cleanup."""
    conn_id = id(session.ws)
    _manager.unsubscribe(session.ws, pid)
    session.subscribed_portfolios.discard(pid)

    # Reference-aware FSM cleanup
    if _price_feed is not None:
        if not _manager.is_portfolio_subscribed_elsewhere(
            session.user_id, pid, conn_id,
        ):
            await _price_feed.remove_portfolio_index(pid)

    logger.info("Unsubscribe: %s pid=%d", session.log_ctx, pid)


# ── Main endpoint ────────────────────────────────────────────────────────

@router.websocket("/ws")
async def websocket_endpoint(
    ws: WebSocket,
    token: str | None = Query(None),
    lang: str | None = Query(None),
):
    # ── Step 1: Authenticate ─────────────────────────────────────────────
    user_id = await _authenticate_ws(token)
    if user_id is None:
        await ws.close(code=4001, reason="Authentication required")
        return

    # ── Step 2: Create session + connect ─────────────────────────────────
    language = lang if lang in ("en", "zh") else "en"
    session = create_session(user_id, language, ws)
    session.transition(WSSessionState.AUTHENTICATED)

    conn = await _manager.connect(ws, user_id, language=language)
    session.transition(WSSessionState.READY)

    logger.info("WS open: %s lang=%s", session.log_ctx, language)

    # ── Step 3: Start heartbeat ──────────────────────────────────────────
    hb_task = asyncio.create_task(
        _heartbeat(session), name=f"heartbeat_{session.session_id}",
    )
    session.track_task("heartbeat", hb_task)

    # ── Step 4: Message loop (thin — no heavy work here) ─────────────────
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _manager.send_json(ws, {
                    "type": "error", "message": "Invalid JSON",
                })
                continue

            msg_type = msg.get("type")

            if msg_type == "subscribe":
                pid = msg.get("portfolio_id")
                if pid is None:
                    await _manager.send_json(ws, {
                        "type": "error", "message": "portfolio_id required",
                    })
                    continue
                await _handle_subscribe(session, conn, pid)

            elif msg_type == "unsubscribe":
                pid = msg.get("portfolio_id")
                if pid is not None:
                    await _handle_unsubscribe(session, conn, pid)

            elif msg_type == "pong":
                session.record_pong()

            else:
                await _manager.send_json(ws, {
                    "type": "error",
                    "message": f"Unknown message type: {msg_type}",
                })

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WS error: %s", session.log_ctx)
    finally:
        # ── Cleanup ──────────────────────────────────────────────────────
        session.cancel_all_tasks()
        session.transition(WSSessionState.CLOSED)

        # Snapshot orphan pids BEFORE disconnect removes the connection
        conn_id = id(ws)
        orphan_pids = list(conn._portfolio_map.keys())
        _manager.disconnect(ws)

        # Reference-aware FSM cleanup
        if _price_feed is not None:
            for pid in orphan_pids:
                if not _manager.is_portfolio_subscribed_elsewhere(
                    session.user_id, pid, conn_id,
                ):
                    await _price_feed.remove_portfolio_index(pid)

        logger.info("WS closed: %s", session.log_ctx)
