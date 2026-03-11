"""
GET /api/cash[?portfolio_id=N]

Returns the current cash balance (sum of all CashLedger.amount rows)
and the 50 most-recent ledger entries.

Uses recursive roll-up: querying a folder portfolio automatically includes
all child sub-portfolios (same pattern as /holdings and /risk/dashboard).
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
from app.models import CashLedger, TradeEvent, TradeStatus
from app.models.user import User
from app.schemas.base import DecStr
from app.services.portfolio_resolver import resolve_portfolio_ids

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
    portfolio_id: int | None = Query(None, description="Filter by portfolio ID (recursive rollup for folders)"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return current cash balance and recent ledger (last 50 entries).

    Uses recursive roll-up: querying a folder portfolio automatically includes
    all child sub-portfolios, matching the behaviour of /holdings and /risk/dashboard.
    """
    pids = await resolve_portfolio_ids(db, user.id, portfolio_id)
    if not pids:
        return CashSummary(balance=Decimal("0"), realized_pnl=Decimal("0"), entries=[])

    # Balance — sum across all resolved portfolio IDs
    stmt_sum = select(func.sum(CashLedger.amount)).where(
        CashLedger.portfolio_id.in_(pids)
    )
    raw = await db.execute(stmt_sum)
    balance = Decimal(str(raw.scalar() or 0))

    # Realized PnL — only cash flows from fully-settled trades (CLOSED / EXPIRED / ASSIGNED).
    # Open positions (ACTIVE status) are excluded to avoid counting unrealized stock purchases
    # as losses or gains before they are sold.
    stmt_rpnl = (
        select(func.sum(CashLedger.amount))
        .join(TradeEvent, CashLedger.trade_event_id == TradeEvent.id)
        .where(
            CashLedger.portfolio_id.in_(pids),
            TradeEvent.status.in_([
                TradeStatus.CLOSED,
                TradeStatus.EXPIRED,
                TradeStatus.ASSIGNED,
            ]),
        )
    )
    raw_rpnl = await db.execute(stmt_rpnl)
    realized_pnl = Decimal(str(raw_rpnl.scalar() or 0))

    # Ledger — entries from all resolved portfolios
    stmt_entries = (
        select(CashLedger)
        .where(CashLedger.portfolio_id.in_(pids))
        .order_by(CashLedger.created_at.desc())
        .limit(50)
    )

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
