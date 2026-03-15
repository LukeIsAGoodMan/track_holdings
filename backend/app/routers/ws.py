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
_manager = None        # type: ignore
_cache = None          # type: ignore
_macro_service = None  # type: ignore
_price_feed = None     # type: ignore


def init_ws_globals(manager, cache, macro_service=None, price_feed=None):
    """Called from main.py to inject shared singletons."""
    global _manager, _cache, _macro_service, _price_feed
    _manager = manager
    _cache = cache
    _macro_service = macro_service
    _price_feed = price_feed


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

                # Proactive FSM sync: populate inverse index immediately
                # so the next _spot_tick uses the primary path, not fallback.
                # Read normalized symbols back from the connection (CM normalizes).
                if _price_feed is not None:
                    normalized_syms = conn._portfolio_map.get(pid, set())
                    if normalized_syms:
                        await _price_feed.sync_portfolio_index(
                            pid, user_id, set(normalized_syms)
                        )

                # Send initial spot snapshot from cache (with changepct so
                # the frontend Hero Banner and Treemap are warm on first connect)
                cached = _cache.get_many(sorted(symbols))
                if cached:
                    changepct_map: dict[str, str] = {}
                    for sym in cached:
                        cp = yfinance_client.get_changepct_cached(sym)
                        if cp is not None:
                            changepct_map[sym] = str(cp)
                    await _manager.send_json(ws, {
                        "type": "spot_update",
                        "data": {s: str(p) for s, p in cached.items()},
                        "changepct": changepct_map,
                    })

                await _manager.send_json(ws, {
                    "type": "subscribed",
                    "portfolio_id": pid,
                    "symbols": sorted(symbols),
                })

                # Push current macro state so MarketTicker shows on first connect (<1s)
                if _macro_service is not None:
                    macro_ctx = _macro_service.get_latest()
                    if macro_ctx is not None:
                        from datetime import datetime, timezone
                        await _manager.send_json(ws, {
                            "type": "macro_ticker",
                            "data": {
                                "spx_price":          macro_ctx.spx_price,
                                "spx_change_pct":     macro_ctx.spx_change_pct,
                                "vix_level":          macro_ctx.vix_level,
                                "vix_term":           macro_ctx.vix_term,
                                "days_to_next_event": macro_ctx.days_to_next_event,
                                "next_event_name":    macro_ctx.next_event_name,
                                "market_regime":      macro_ctx.market_regime,
                                "as_of":              datetime.now(timezone.utc).isoformat(),
                            },
                        })

                # Send initial holdings snapshot
                asyncio.create_task(
                    _send_initial_holdings(ws, user_id, pid)
                )

            elif msg_type == "unsubscribe":
                pid = msg.get("portfolio_id")
                if pid is not None:
                    conn_id = id(ws)
                    _manager.unsubscribe(ws, pid)
                    # Reference-aware FSM cleanup: only clear if no other
                    # connection for this user still subscribes to this portfolio.
                    if _price_feed is not None:
                        if not _manager.is_portfolio_subscribed_elsewhere(
                            user_id, pid, conn_id
                        ):
                            await _price_feed.remove_portfolio_index(pid)

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
        # Snapshot portfolios BEFORE disconnect removes the connection
        conn_id = id(ws)
        orphan_pids = list(conn._portfolio_map.keys())
        _manager.disconnect(ws)
        # Reference-aware FSM cleanup: only clear portfolios that no
        # remaining connection for this user still subscribes to.
        if _price_feed is not None:
            for pid in orphan_pids:
                if not _manager.is_portfolio_subscribed_elsewhere(
                    user_id, pid, conn_id
                ):
                    await _price_feed.remove_portfolio_index(pid)


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

        # Force get_spot_price for all symbols — ensures FMP /quote is called,
        # which populates changepct cache required for live perf_1d
        spot_results = await asyncio.gather(
            *[yfinance_client.get_spot_price(s) for s in symbols]
        )
        spot_map = {s: p for s, p in zip(symbols, spot_results) if p is not None}

        vol_results = await asyncio.gather(
            *[yfinance_client.get_hist_vol(s) for s in symbols]
        )
        vol_map = dict(zip(symbols, vol_results))

        perf_results = await asyncio.gather(
            *[yfinance_client.get_perf_cached(s) for s in symbols]
        )
        perf_map = dict(zip(symbols, perf_results))

        # Daily P&L: BS mark-to-market (snapshot/recompute parity with price_feed)
        from app.services.price_feed import PriceFeedService
        prev_close_map = PriceFeedService._build_prev_close_map(symbols)
        bs_pnl_map = PriceFeedService._build_daily_pnl_map(
            positions, spot_map, vol_map, prev_close_map,
        )

        groups = compute_holding_groups(
            positions, spot_map, vol_map, perf_map=perf_map,
            bs_pnl_map=bs_pnl_map,
        )
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


async def _heartbeat(ws: WebSocket, interval: float = 20.0) -> None:
    """Send periodic ping to keep the connection alive.
    Interval is 20s (< Render's 30s proxy idle timeout) to prevent WS drops."""
    try:
        while True:
            await asyncio.sleep(interval)
            try:
                await ws.send_text(json.dumps({"type": "ping"}))
            except Exception:
                break
    except asyncio.CancelledError:
        pass
