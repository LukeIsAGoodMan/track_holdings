"""
GET /api/holdings/chart/{symbol}

Returns intraday 5-min OHLCV + EOD light history in a single response.
Frontend uses intraday for 1D candles, EOD for 5D/1M line charts.
No refetch needed when switching views — all data returned in one call.

Caching: 300s TTL on both datasets (compatible with 5-min frontend polling).
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from app.dependencies import get_current_user_flexible
from app.models.user import User
from app.services.yfinance_client import get_intraday_5min, get_eod_light

router = APIRouter(tags=["holdings"])


def _serialize_intraday(bars: list[dict] | None) -> list[dict]:
    """Convert Decimal prices to float for JSON serialization."""
    if not bars:
        return []
    out = []
    for b in bars:
        try:
            out.append({
                "date":   str(b.get("date", "")),
                "open":   float(b["open"]) if b.get("open") is not None else None,
                "high":   float(b["high"]) if b.get("high") is not None else None,
                "low":    float(b["low"])  if b.get("low")  is not None else None,
                "close":  float(b["close"]) if b.get("close") is not None else None,
                "volume": int(b.get("volume") or 0),
            })
        except (TypeError, ValueError):
            continue  # skip malformed rows
    return out


@router.get("/holdings/chart/{symbol}")
async def get_holding_chart(
    symbol: str,
    user: User = Depends(get_current_user_flexible),
):
    """
    Combined intraday + EOD chart data for a single holding.

    Returns partial data if one source fails (empty list for the failed source).
    Frontend should handle empty arrays gracefully.
    """
    symbol = symbol.upper().strip()

    intraday_raw, eod_raw = await asyncio.gather(
        get_intraday_5min(symbol),
        get_eod_light(symbol),
        return_exceptions=True,
    )

    intraday = _serialize_intraday(intraday_raw) if isinstance(intraday_raw, list) else []
    eod = eod_raw if isinstance(eod_raw, list) else []

    return {
        "symbol": symbol,
        "intraday_5min": intraday,
        "eod_light": eod,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
