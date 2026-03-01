"""
POST /api/lifecycle/process  — trigger expired-option settlement sweep
GET  /api/lifecycle/settled  — query recently settled option trades

The sweep is idempotent: re-running it on already-settled trades is safe
because only ACTIVE trades are ever mutated.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user
from app.models import InstrumentType, TradeEvent, TradeStatus
from app.models.user import User
from app.models.instrument import Instrument
from app.schemas.lifecycle import LifecycleResult, SettledTrade, SettledTradesResponse
from app.services.lifecycle import process_expired_trades

router = APIRouter(tags=["lifecycle"])


@router.post("/lifecycle/process", response_model=LifecycleResult)
async def trigger_lifecycle(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger the expired-option settlement sweep for the current user's portfolios.
    Idempotent — safe to call repeatedly; only ACTIVE trades are touched.
    Returns a summary of what was processed.
    """
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
    Returns recently settled (EXPIRED / ASSIGNED / CLOSED) option trades,
    newest first, up to 100 records.

    For ASSIGNED trades, auto-generated stock trades are linked via
    trade_metadata['option_instrument_id'].
    """
    # ── 1. Settled option opening trades ──────────────────────────────────────
    stmt = (
        select(TradeEvent)
        .join(Instrument, TradeEvent.instrument_id == Instrument.id)
        .where(
            TradeEvent.status.in_([
                TradeStatus.EXPIRED,
                TradeStatus.ASSIGNED,
                TradeStatus.CLOSED,
            ]),
            Instrument.instrument_type == InstrumentType.OPTION,
        )
        .options(selectinload(TradeEvent.instrument))
        .order_by(TradeEvent.closed_date.desc(), TradeEvent.id.desc())
        .limit(100)
    )
    stmt = stmt.where(TradeEvent.user_id == user.id)
    if portfolio_id is not None:
        stmt = stmt.where(TradeEvent.portfolio_id == portfolio_id)
    if since_hours is not None:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).date()
        stmt = stmt.where(TradeEvent.closed_date >= cutoff)

    settled_rows = (await db.execute(stmt)).scalars().all()

    # ── 2. Auto-assigned stock trades (linked by trade_metadata) ──────────────
    auto_stmt = (
        select(TradeEvent)
        .join(Instrument, TradeEvent.instrument_id == Instrument.id)
        .where(
            Instrument.instrument_type == InstrumentType.STOCK,
            TradeEvent.notes.like("Auto-assign%"),
        )
        .options(selectinload(TradeEvent.instrument))
    )
    auto_stmt = auto_stmt.where(TradeEvent.user_id == user.id)
    if portfolio_id is not None:
        auto_stmt = auto_stmt.where(TradeEvent.portfolio_id == portfolio_id)

    auto_rows = (await db.execute(auto_stmt)).scalars().all()

    # Build lookup: option_instrument_id → most-recent auto stock trade
    auto_by_opt_id: dict[int, TradeEvent] = {}
    for at in auto_rows:
        if at.trade_metadata and at.trade_metadata.get("auto_assigned_from_option"):
            opt_id = at.trade_metadata.get("option_instrument_id")
            if opt_id is not None:
                auto_by_opt_id[int(opt_id)] = at

    # ── 3. Build response ─────────────────────────────────────────────────────
    trades: list[SettledTrade] = []
    for row in settled_rows:
        inst = row.instrument
        auto = auto_by_opt_id.get(inst.id)
        meta: dict = (auto.trade_metadata or {}) if auto else {}
        trades.append(SettledTrade(
            trade_event_id=row.id,
            portfolio_id=row.portfolio_id,
            symbol=inst.symbol,
            option_type=inst.option_type.value if inst.option_type else "?",
            strike=inst.strike,
            expiry=inst.expiry.isoformat() if inst.expiry else None,
            action=row.action.value,
            quantity=row.quantity,
            status=row.status.value,
            settled_date=row.closed_date.isoformat() if row.closed_date else None,
            auto_stock_action=auto.action.value if auto else None,
            auto_stock_quantity=auto.quantity if auto else None,
            auto_stock_price=auto.price if auto else None,  # effective cost basis
            premium_per_share=meta.get("premium_per_share"),
            effective_cost_per_share=meta.get("effective_cost_per_share"),
        ))

    return SettledTradesResponse(trades=trades, total=len(trades))
