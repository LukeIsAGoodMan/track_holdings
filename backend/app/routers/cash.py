"""
GET /api/cash[?portfolio_id=N]

Returns the current cash balance (sum of all CashLedger.amount rows)
and the 50 most-recent ledger entries.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import CashLedger
from app.models.user import User
from app.schemas.base import DecStr

router = APIRouter(tags=["cash"])


class CashEntry(BaseModel):
    id:             int
    portfolio_id:   int
    trade_event_id: int | None
    amount:         DecStr
    description:    str | None
    created_at:     datetime


class CashSummary(BaseModel):
    balance:      DecStr
    realized_pnl: DecStr
    entries:      list[CashEntry]


@router.get("/cash", response_model=CashSummary)
async def get_cash(
    portfolio_id: int | None = Query(None, description="Filter by portfolio ID"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return current cash balance and recent ledger (last 50 entries)."""
    # Balance — always scoped to user
    stmt_sum = select(func.sum(CashLedger.amount)).where(CashLedger.user_id == user.id)
    if portfolio_id is not None:
        stmt_sum = stmt_sum.where(CashLedger.portfolio_id == portfolio_id)
    raw = await db.execute(stmt_sum)
    balance = Decimal(str(raw.scalar() or 0))

    # Realized PnL — sum of trade-linked ledger entries (premiums, stock proceeds)
    stmt_rpnl = select(func.sum(CashLedger.amount)).where(
        CashLedger.user_id == user.id,
        CashLedger.trade_event_id.isnot(None),
    )
    if portfolio_id is not None:
        stmt_rpnl = stmt_rpnl.where(CashLedger.portfolio_id == portfolio_id)
    raw_rpnl = await db.execute(stmt_rpnl)
    realized_pnl = Decimal(str(raw_rpnl.scalar() or 0))

    # Ledger — always scoped to user
    stmt_entries = (
        select(CashLedger)
        .where(CashLedger.user_id == user.id)
        .order_by(CashLedger.created_at.desc())
        .limit(50)
    )
    if portfolio_id is not None:
        stmt_entries = stmt_entries.where(CashLedger.portfolio_id == portfolio_id)

    result  = await db.execute(stmt_entries)
    entries = result.scalars().all()

    return CashSummary(
        balance=balance,
        realized_pnl=realized_pnl,
        entries=[
            CashEntry(
                id=e.id,
                portfolio_id=e.portfolio_id,
                trade_event_id=e.trade_event_id,
                amount=e.amount,
                description=e.description,
                created_at=e.created_at,
            )
            for e in entries
        ],
    )
