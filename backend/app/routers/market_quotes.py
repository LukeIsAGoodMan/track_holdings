"""
GET /api/market/quotes?symbols=SPY,QQQ,DIA,VIX

Lightweight endpoint that returns spot prices + day-change% for a set of
symbols from the yfinance/FMP cache. Used by the frontend market bar to
poll SPY / QQQ / DIA / VIX without WebSocket dependency.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.dependencies import get_current_user
from app.models.user import User
from app.services import yfinance_client

router = APIRouter(tags=["market"])

MAX_SYMBOLS = 10


class MarketQuote(BaseModel):
    symbol:     str
    price:      str | None        # decimal string or null
    change_pct: float | None      # day % change, e.g. -0.42


@router.get("/market/quotes", response_model=list[MarketQuote])
async def get_market_quotes(
    symbols: str = Query(..., description="Comma-separated, e.g. SPY,QQQ,DIA,VIX"),
    _user: User = Depends(get_current_user),
):
    """Return cached spot price + change% for requested symbols (max 10)."""
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()][:MAX_SYMBOLS]

    # Fetch spots concurrently (uses cache + schedules bg refresh on stale)
    prices: list[Decimal | None] = list(
        await asyncio.gather(*[yfinance_client.get_spot_price(s) for s in syms])
    )

    results: list[MarketQuote] = []
    for sym, price in zip(syms, prices):
        chg_pct_d = yfinance_client.get_changepct_cached(sym)
        chg_pct   = float(chg_pct_d) if chg_pct_d is not None else None
        results.append(MarketQuote(
            symbol=sym,
            price=str(price) if price is not None else None,
            change_pct=chg_pct,
        ))
    return results
