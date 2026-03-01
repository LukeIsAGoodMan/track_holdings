"""
POST /api/trades

TradeEvent + CashLedger are written inside a single explicit transaction.
Either both succeed (commit) or both are rolled back (exception propagated as HTTP 500).
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models import (
    CashLedger,
    Instrument,
    InstrumentType,
    OptionType,
    Portfolio,
    TradeEvent,
    TradeAction,
    TradeStatus,
)
from app.schemas.trade import TradeCreate, TradeResponse, TradeUpdate, VALID_STRATEGY_TAGS
from app.services.position_engine import calculate_positions

router = APIRouter(tags=["trades"])


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _get_or_create_instrument(
    db: AsyncSession, body: TradeCreate
) -> Instrument:
    """
    Upsert the Instrument record (deduplication by unique contract key).
    Called inside an open transaction — caller must commit/rollback.
    """
    sym = body.symbol.upper()

    if body.instrument_type == "OPTION":
        stmt = select(Instrument).where(
            Instrument.symbol == sym,
            Instrument.instrument_type == InstrumentType.OPTION,
            Instrument.strike == body.strike,
            Instrument.expiry == body.expiry,
            Instrument.option_type == OptionType(body.option_type),
        )
    else:
        stmt = select(Instrument).where(
            Instrument.symbol == sym,
            Instrument.instrument_type == InstrumentType.STOCK,
        )

    result = await db.execute(stmt)
    instrument = result.scalar_one_or_none()

    if instrument is None:
        # Options: multiplier=100 (1 contract = 100 shares)
        # Stocks: multiplier=1 (1 unit = 1 share)
        multiplier = 100 if body.instrument_type == "OPTION" else 1
        instrument = Instrument(
            symbol=sym,
            instrument_type=InstrumentType(body.instrument_type),
            option_type=OptionType(body.option_type) if body.option_type else None,
            strike=body.strike,
            expiry=body.expiry,
            multiplier=multiplier,
        )
        db.add(instrument)
        await db.flush()   # populate instrument.id

    return instrument


def _compute_cash_impact(
    action: str, price: Decimal, quantity: int, multiplier: int
) -> Decimal:
    """
    Signed cash flow from one trade.
    SELL_OPEN / SELL_CLOSE → +inflow
    BUY_OPEN  / BUY_CLOSE  → -outflow
    """
    raw = price * Decimal(str(quantity)) * Decimal(str(multiplier))
    return raw if action in ("SELL_OPEN", "SELL_CLOSE") else -raw


# ── Route ────────────────────────────────────────────────────────────────────

@router.post("/trades", response_model=TradeResponse, status_code=201)
async def create_trade(
    body: TradeCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Record a trade.

    Guarantees:
    - TradeEvent and CashLedger are written in ONE database transaction.
    - If either insert fails the whole operation is rolled back.
    - cash_impact and net_contracts_after are returned in the response.
    """
    # ── 0. Validate portfolio exists and belongs to user ─────────────────
    portfolio = await db.get(Portfolio, body.portfolio_id)
    if portfolio is None or portfolio.user_id != user.id:
        raise HTTPException(
            status_code=404,
            detail=f"Portfolio {body.portfolio_id} not found",
        )

    # ── 1-5. Atomic write ─────────────────────────────────────────────────
    trade: TradeEvent
    cash_impact: Decimal

    try:
        # 1. Get or create Instrument (deduped contract registry)
        instrument = await _get_or_create_instrument(db, body)

        # 2. Create TradeEvent (immutable ledger entry)
        # Pack Trading Coach fields into JSON metadata if provided
        coaching: dict | None = None
        if body.confidence_score is not None or body.trade_reason is not None or body.strategy_tags is not None:
            coaching = {}
            if body.confidence_score is not None:
                coaching["confidence_score"] = body.confidence_score
            if body.trade_reason is not None:
                coaching["trade_reason"] = body.trade_reason
            if body.strategy_tags is not None:
                invalid = set(body.strategy_tags) - VALID_STRATEGY_TAGS
                if invalid:
                    raise HTTPException(400, f"Invalid strategy tags: {invalid}")
                coaching["strategy_tags"] = body.strategy_tags

        trade = TradeEvent(
            portfolio_id=body.portfolio_id,
            user_id=user.id,
            instrument_id=instrument.id,
            action=TradeAction(body.action),
            quantity=body.quantity,
            price=body.price,
            underlying_price_at_trade=body.underlying_price_at_trade,
            status=TradeStatus.ACTIVE,
            trade_date=datetime.now(timezone.utc),
            notes=body.notes,
            trade_metadata=coaching,
        )
        db.add(trade)
        await db.flush()   # populate trade.id before creating CashLedger FK

        # 3. Signed cash impact
        cash_impact = _compute_cash_impact(
            body.action, body.price, body.quantity, instrument.multiplier
        )

        # 4. Append to cash ledger (append-only, never updated/deleted)
        sym_desc = body.symbol.upper()
        detail_desc = (
            f" ${body.strike} {body.option_type} exp {body.expiry}"
            if body.option_type
            else ""
        )
        sign_str = "+" if cash_impact >= 0 else ""
        cash_entry = CashLedger(
            portfolio_id=body.portfolio_id,
            user_id=user.id,
            trade_event_id=trade.id,
            amount=cash_impact,
            description=(
                f"{body.action} {body.quantity}x {sym_desc}{detail_desc}"
                f" @ ${body.price} | {sign_str}${cash_impact:,.2f}"
            ),
        )
        db.add(cash_entry)

        # 5. Commit — both inserts committed atomically
        await db.commit()

    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # ── 6. Compute net_contracts_after for the response ───────────────────
    #    (runs a fresh SELECT after commit — session is clean)
    positions = await calculate_positions(db, portfolio_id=body.portfolio_id)
    net_after = next(
        (p.net_contracts for p in positions if p.instrument.id == instrument.id),
        0,
    )

    meta = trade.trade_metadata or {}
    return TradeResponse(
        id=trade.id,
        portfolio_id=trade.portfolio_id,
        instrument_id=instrument.id,
        symbol=instrument.symbol,
        option_type=instrument.option_type.value if instrument.option_type else None,
        strike=instrument.strike,
        expiry=instrument.expiry,
        action=trade.action.value,
        quantity=trade.quantity,
        price=trade.price,
        cash_impact=cash_impact,
        net_contracts_after=net_after,
        trade_date=trade.trade_date,
        confidence_score=meta.get("confidence_score"),
        strategy_tags=meta.get("strategy_tags"),
    )


# ── PATCH — update coaching metadata on existing trade ────────────────────────

@router.patch("/trades/{trade_id}", response_model=TradeResponse)
async def update_trade_metadata(
    trade_id: int,
    body: TradeUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Update coaching/annotation metadata on an existing trade.

    Only trade_metadata fields (confidence, reason, tags) are mutable.
    The financial record (price, quantity, action) is immutable.
    """
    result = await db.execute(
        select(TradeEvent).where(TradeEvent.id == trade_id),
    )
    trade = result.scalar_one_or_none()
    if not trade or trade.user_id != user.id:
        raise HTTPException(404, "Trade not found")

    meta = dict(trade.trade_metadata or {})
    updates = body.model_dump(exclude_unset=True)

    if "strategy_tags" in updates and updates["strategy_tags"] is not None:
        invalid = set(updates["strategy_tags"]) - VALID_STRATEGY_TAGS
        if invalid:
            raise HTTPException(400, f"Invalid strategy tags: {invalid}")

    for field in ("confidence_score", "trade_reason", "strategy_tags"):
        if field in updates:
            if updates[field] is not None:
                meta[field] = updates[field]
            else:
                meta.pop(field, None)

    trade.trade_metadata = meta if meta else None
    await db.commit()
    await db.refresh(trade)

    # Load instrument for response
    inst_result = await db.execute(
        select(Instrument).where(Instrument.id == trade.instrument_id),
    )
    inst = inst_result.scalar_one()

    positions = await calculate_positions(db, portfolio_id=trade.portfolio_id)
    net_after = next(
        (p.net_contracts for p in positions if p.instrument.id == inst.id), 0,
    )

    return TradeResponse(
        id=trade.id,
        portfolio_id=trade.portfolio_id,
        instrument_id=inst.id,
        symbol=inst.symbol,
        option_type=inst.option_type.value if inst.option_type else None,
        strike=inst.strike,
        expiry=inst.expiry,
        action=trade.action.value,
        quantity=trade.quantity,
        price=trade.price,
        cash_impact=Decimal("0"),
        net_contracts_after=net_after,
        trade_date=trade.trade_date,
        confidence_score=meta.get("confidence_score"),
        strategy_tags=meta.get("strategy_tags"),
    )
