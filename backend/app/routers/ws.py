"""
WebSocket endpoint: /api/ws?token=<JWT>
修正版：增加初始连接时的完整涨跌幅推送，防止前端数据真空。
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

# 这些由 main.py 初始化
_manager = None
_cache = None

@router.websocket("")
async def websocket_endpoint(
    ws: WebSocket,
    token: str = Query(...),
    lang: str = Query("en")
):
    """
    处理实时行情和持仓推送。
    """
    user_id = decode_access_token(token)
    if not user_id:
        await ws.close(code=1008)
        return

    await _manager.connect(ws)
    subscribed_pids: set[int] = set()

    try:
        while True:
            msg_text = await ws.receive_text()
            msg = json.loads(msg_text)
            msg_type = msg.get("type")

            if msg_type == "subscribe":
                pid = msg.get("portfolio_id")
                if pid:
                    subscribed_pids.add(pid)
                    # 订阅成功后，立即发送一个包含价格、涨跌、涨跌幅的完整快照
                    await _send_initial_snapshot(ws, user_id, pid)

            elif msg_type == "unsubscribe":
                pid = msg.get("portfolio_id")
                if pid in subscribed_pids:
                    subscribed_pids.remove(pid)

            elif msg_type == "pong":
                pass

    except WebSocketDisconnect:
        _manager.disconnect(ws)
    except Exception as e:
        logger.error(f"WS Error: {e}")
        _manager.disconnect(ws)

async def _send_initial_snapshot(ws: WebSocket, user_id: int, portfolio_id: int):
    """
    发送初始快照，确保 Unrealized PnL 所需的价格变动数据不为空。
    """
    try:
        async with AsyncSessionLocal() as db:
            positions = await position_engine.get_portfolio_positions(db, portfolio_id)
            symbols = list(set(p.instrument.symbol for p in positions))
            
            # 1. 发送实时价格与涨跌幅快照
            cached_data = _cache.get_many(symbols) if _cache else {}
            spot_data = {}
            change_data = {}
            pct_data = {}
            
            for s in symbols:
                val = cached_data.get(s, {})
                if isinstance(val, dict):
                    spot_data[s] = str(val.get("price", "0"))
                    change_data[s] = str(val.get("change", "0"))
                    pct_data[s] = str(val.get("changepct", "0"))
                else:
                    spot_data[s] = str(val or "0")
                    change_data[s] = "0"
                    pct_data[s] = "0"

            await ws.send_json({
                "type": "spot_update",
                "data": spot_data,
                "change": change_data,
                "changepct": pct_data
            })

            # 2. 发送持仓分组快照
            holdings = await compute_holding_groups(db, portfolio_id, spot_data)
            await ws.send_json({
                "type": "holdings_update",
                "portfolio_id": portfolio_id,
                "data": [h.dict() for h in holdings]
            })

            # 3. 发送风险快照
            risk_summary = compute_risk_summary(positions, spot_data, {})
            await ws.send_json({
                "type": "risk_update",
                "portfolio_id": portfolio_id,
                "data": {
                    "total_net_delta": str(risk_summary["total_net_delta"]),
                    "total_gamma": str(risk_summary["total_gamma"]),
                    "maintenance_margin_total": str(risk_summary["maintenance_margin_total"]),
                }
            })
    except Exception:
        logger.exception("Initial snapshot failed")