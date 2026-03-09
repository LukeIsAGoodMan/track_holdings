"""
POST /api/lifecycle/process  — trigger expired-option settlement sweep
GET  /api/lifecycle/settled  — query recently settled option trades

The sweep is idempotent: re-running it on already-settled trades is safe
because only ACTIVE trades are ever mutated.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models import TradeAction, TradeEvent, TradeStatus
from app.models.user import User
from app.models.instrument import Instrument
from app.schemas.lifecycle import LifecycleResult, SettledTrade, SettledTradesResponse
from app.services.lifecycle import process_expired_trades

router = APIRouter(tags=["lifecycle"])

# ── Per-user cooldown: prevent hammering process_expired_trades on every
#    portfolio switch.  The sweep is idempotent but still scans the DB.
#    5-minute window per user is safe — options expire at EOD, not intraday.
_lifecycle_last_run: dict[int, float] = {}   # user_id → monotonic timestamp
_LIFECYCLE_COOLDOWN_SECS: float = 300.0      # 5 minutes


@router.post("/lifecycle/process", response_model=LifecycleResult)
async def trigger_lifecycle(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger the expired-option settlement sweep for the current user's portfolios.
    Idempotent — safe to call repeatedly; only ACTIVE trades are touched.
    Returns a summary of what was processed.

    Backend debounce: if this user already ran the sweep within the last 5 minutes
    we return an empty result immediately without touching the database.
    """
    now = time.monotonic()
    if now - _lifecycle_last_run.get(user.id, 0.0) < _LIFECYCLE_COOLDOWN_SECS:
        return LifecycleResult(expired=0, assigned=0, skipped=0, details=[])
    _lifecycle_last_run[user.id] = now

    result = await process_expired_trades(db, user_id=user.id)
    return LifecycleResult(
        expired=result.expired,
        assigned=result.assigned,
        skipped=result.skipped,
        details=result.details,
    )


@router.get("/lifecycle/settled", response_model=SettledTradesResponse)
async def get_settled_trades(
    portfolio_id: int | None = Query(None),
    since_hours: int | None = Query(
        None,
        description="If set, return only trades settled within this many hours. "
                    "Omit for full history.",
    ),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns all settled (EXPIRED / ASSIGNED / CLOSED) opening trades,
    newest first, up to 100 records.  Includes both option and stock trades.

    Only SELL_OPEN / BUY_OPEN actions are returned (the original opening leg),
    so each closed position appears exactly once.  For ASSIGNED option trades,
    auto_stock_* fields carry the assignment details from trade_metadata.
    """
    stmt = (
        select(TradeEvent)
        .join(Instrument, TradeEvent.instrument_id == Instrument.id)
        .where(
            TradeEvent.user_id == user.id,
            TradeEvent.status.in_([
                TradeStatus.EXPIRED,
                TradeStatus.ASSIGNED,
                TradeStatus.CLOSED,
            ]),
            TradeEvent.action.in_([TradeAction.SELL_OPEN, TradeAction.BUY_OPEN]),
        )
        .options(selectinload(TradeEvent.instrument))
        .order_by(TradeEvent.closed_date.desc().nullslast(), TradeEvent.id.desc())
        .limit(100)
    )
    if portfolio_id is not None:
        stmt = stmt.where(TradeEvent.portfolio_id == portfolio_id)
    if since_hours is not None:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).date()
        stmt = stmt.where(TradeEvent.closed_date >= cutoff)

    settled_rows = (await db.execute(stmt)).scalars().all()

    # For ASSIGNED option trades: look up auto-stock trade via trade_metadata
    auto_by_opt_id: dict[int, TradeEvent] = {}
    assigned_inst_ids = {
        row.instrument_id for row in settled_rows if row.status == TradeStatus.ASSIGNED
    }
    if assigned_inst_ids:
        auto_stmt = (
            select(TradeEvent)
            .where(
                TradeEvent.user_id == user.id,
                TradeEvent.notes.like("Auto-assign%"),
            )
            .options(selectinload(TradeEvent.instrument))
        )
        if portfolio_id is not None:
            auto_stmt = auto_stmt.where(TradeEvent.portfolio_id == portfolio_id)
        for at in (await db.execute(auto_stmt)).scalars().all():
            if at.trade_metadata and at.trade_metadata.get("auto_assigned_from_option"):
                opt_id = at.trade_metadata.get("option_instrument_id")
                if opt_id is not None:
                    auto_by_opt_id[int(opt_id)] = at

    trades: list[SettledTrade] = []
    for row in settled_rows:
        inst = row.instrument
        auto = auto_by_opt_id.get(inst.id)
        meta: dict = (auto.trade_metadata or {}) if auto else {}
        trades.append(SettledTrade(
            trade_event_id=row.id,
            portfolio_id=row.portfolio_id,
            symbol=inst.symbol,
            option_type=inst.option_type.value if inst.option_type else None,
            strike=inst.strike,
            expiry=inst.expiry.isoformat() if inst.expiry else None,
            action=row.action.value,
            quantity=row.quantity,
            status=row.status.value,
            settled_date=row.closed_date.isoformat() if row.closed_date else None,
            auto_stock_action=auto.action.value if auto else None,
            auto_stock_quantity=auto.quantity if auto else None,
            auto_stock_price=auto.price if auto else None,
            premium_per_share=meta.get("premium_per_share"),
            effective_cost_per_share=meta.get("effective_cost_per_share"),
        ))

    return SettledTradesResponse(trades=trades, total=len(trades))
