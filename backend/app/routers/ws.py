"""
WebSocket endpoint: /api/ws?token=<JWT>

Protocol:
  Client → Server:
    {"type": "subscribe",   "portfolio_id": 1}
    {"type": "unsubscribe", "portfolio_id": 1}
    {"type": "pong"}

  Server → Client:
    {"type": "spot_update",      "data": {"NVDA": "135.42", ...}}
    {"type": "holdings_update",  "portfolio_id": 1, "data": [...]}
    {"type": "ping"}
    {"type": "error",            "message": "..."}

Authentication: JWT via ?token= query parameter (WebSocket cannot set headers).
"""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import Instrument, TradeEvent
from app.services import position_engine, yfinance_client
from app.services.auth import decode_access_token
from app.services.holdings_engine import compute_holding_groups
from app.services.portfolio_resolver import resolve_portfolio_ids
from app.services.risk_engine import compute_risk_summary

logger = logging.getLogger(__name__)

router = APIRouter()

# These are set by main.py at startup
_manager = None  # type: ignore
_cache = None    # type: ignore


def init_ws_globals(manager, cache):
    """Called from main.py to inject shared singletons."""
    global _manager, _cache
    _manager = manager
    _cache = cache


async def _authenticate_ws(token: str | None) -> int | None:
    """Validate JWT and return user_id, or None on failure."""
    if not token:
        return None
    try:
        payload = decode_access_token(token)
        return int(payload["sub"])
    except Exception:
        return None


async def _get_portfolio_symbols(
    user_id: int, portfolio_id: int
) -> set[str]:
    """Resolve a portfolio's active symbols for subscription."""
    async with AsyncSessionLocal() as db:
        pids = await resolve_portfolio_ids(db, user_id, portfolio_id)

        # Get all symbols from active trades in these portfolios
        result = await db.execute(
            select(Instrument.symbol)
            .join(TradeEvent, TradeEvent.instrument_id == Instrument.id)
            .where(TradeEvent.portfolio_id.in_(pids))
            .distinct()
        )
        return {row[0] for row in result.all()}


@router.websocket("/ws")
async def websocket_endpoint(
    ws: WebSocket,
    token: str | None = Query(None),
    lang: str | None = Query(None),
):
    # ── Authenticate ──────────────────────────────────────────────────────
    user_id = await _authenticate_ws(token)
    if user_id is None:
        await ws.close(code=4001, reason="Authentication required")
        return

    # ── Connect (Phase 11: pass language preference) ──────────────────────
    language = lang if lang in ("en", "zh") else "en"
    conn = await _manager.connect(ws, user_id, language=language)
    heartbeat_task = asyncio.create_task(_heartbeat(ws))

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
                symbols = await _get_portfolio_symbols(user_id, pid)
                _manager.subscribe(ws, pid, symbols)

                # Send initial spot snapshot from cache
                cached = _cache.get_many(sorted(symbols))
                if cached:
                    await _manager.send_json(ws, {
                        "type": "spot_update",
                        "data": {s: str(p) for s, p in cached.items()},
                    })

                await _manager.send_json(ws, {
                    "type": "subscribed",
                    "portfolio_id": pid,
                    "symbols": sorted(symbols),
                })

                # Send initial holdings snapshot
                asyncio.create_task(
                    _send_initial_holdings(ws, user_id, pid)
                )

            elif msg_type == "unsubscribe":
                pid = msg.get("portfolio_id")
                if pid is not None:
                    _manager.unsubscribe(ws, pid)

            elif msg_type == "pong":
                pass  # heartbeat ack — just ignore

            else:
                await _manager.send_json(ws, {
                    "type": "error",
                    "message": f"Unknown message type: {msg_type}",
                })

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WS error for user=%d", user_id)
    finally:
        heartbeat_task.cancel()
        _manager.disconnect(ws)


async def _send_initial_holdings(
    ws: WebSocket, user_id: int, portfolio_id: int
) -> None:
    """Compute and send a full holdings snapshot on subscribe."""
    try:
        async with AsyncSessionLocal() as db:
            pids = await resolve_portfolio_ids(db, user_id, portfolio_id)
            positions = await position_engine.calculate_positions(
                db, portfolio_ids=pids
            )

        if not positions:
            return

        symbols = list({pos.instrument.symbol for pos in positions})

        # Use cache for spots; fetch vols
        spot_map = {}
        for s in symbols:
            cached_price = _cache.get(s)
            if cached_price is not None:
                spot_map[s] = cached_price
            else:
                spot_map[s] = await yfinance_client.get_spot_price(s)

        vol_results = await asyncio.gather(
            *[yfinance_client.get_hist_vol(s) for s in symbols]
        )
        vol_map = dict(zip(symbols, vol_results))

        groups = compute_holding_groups(positions, spot_map, vol_map)
        holdings_msg = {
            "type": "holdings_update",
            "portfolio_id": portfolio_id,
            "data": [g.model_dump(mode="json") for g in groups],
        }
        await _manager.send_json(ws, holdings_msg)

        # Also send initial risk snapshot
        risk_summary = compute_risk_summary(positions, spot_map, vol_map)
        risk_msg = {
            "type": "risk_update",
            "portfolio_id": portfolio_id,
            "data": {
                "total_net_delta": str(risk_summary["total_net_delta"]),
                "total_gamma": str(risk_summary["total_gamma"]),
                "total_theta_daily": str(risk_summary["total_theta_daily"]),
                "total_vega": str(risk_summary["total_vega"]),
                "maintenance_margin_total": str(risk_summary["maintenance_margin_total"]),
                "var_1d_95": str(risk_summary["var_1d_95"]) if risk_summary["var_1d_95"] else None,
                "positions_count": risk_summary["positions_count"],
                "risk_alerts": risk_summary["risk_alerts"],
            },
        }
        await _manager.send_json(ws, risk_msg)
    except Exception:
        logger.exception("Initial snapshot failed: user=%d pid=%d", user_id, portfolio_id)


async def _heartbeat(ws: WebSocket, interval: float = 30.0) -> None:
    """Send periodic ping to keep the connection alive."""
    try:
        while True:
            await asyncio.sleep(interval)
            try:
                await ws.send_text(json.dumps({"type": "ping"}))
            except Exception:
                break
    except asyncio.CancelledError:
        pass
