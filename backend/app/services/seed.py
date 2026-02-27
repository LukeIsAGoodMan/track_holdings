"""
Seed data injector — idempotent.

Inserts the canonical validation trade on first run:
  Sell 5x NVDA 2026-12-18 $600 Put @ $500.00  (trade date 2024-01-01)

Expected outcomes:
  CashLedger SUM  = +$250,000.00   (5 × 500 × 100)
  Net contracts   = -5             (SELL_OPEN → negative)
  Delta exposure  > 0              (short put → positive delta)
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Portfolio,
    Instrument,
    InstrumentType,
    OptionType,
    TradeEvent,
    TradeAction,
    TradeStatus,
    CashLedger,
)


async def run_seed(db: AsyncSession) -> bool:
    """
    Insert seed data if the portfolios table is empty.
    Returns True if data was inserted, False if already present (idempotent).
    """
    count_result = await db.execute(
        select(func.count()).select_from(Portfolio)
    )
    if (count_result.scalar() or 0) > 0:
        return False  # already seeded

    # ── 1. Root portfolio ─────────────────────────────────────────────────
    main = Portfolio(
        name="Main Account",
        description="Root portfolio — all strategies",
    )
    db.add(main)
    await db.flush()   # populate main.id

    # ── 2. Sub-portfolio (Wheel strategy on NVDA) ─────────────────────────
    wheel = Portfolio(
        name="NVDA Wheel",
        description="NVDA Wheel strategy — Sell Puts + Covered Calls",
        parent_id=main.id,
    )
    db.add(wheel)
    await db.flush()   # populate wheel.id

    # ── 3. Option contract (deduplicated instrument) ──────────────────────
    # Expiry: 2026-12-18 (third Friday Dec 2026 — standard monthly expiry)
    # Strike: $600 | Type: PUT
    instrument = Instrument(
        symbol="NVDA",
        instrument_type=InstrumentType.OPTION,
        option_type=OptionType.PUT,
        strike=Decimal("600.00"),
        expiry=date(2026, 12, 18),
        multiplier=100,
    )
    db.add(instrument)
    await db.flush()   # populate instrument.id

    # ── 4. Trade event (SELL_OPEN) ────────────────────────────────────────
    # price = $500.00 per share (premium collected per share)
    # NVDA was ~$495 on 2024-01-01 — $600 Put was slightly OTM at that time.
    trade = TradeEvent(
        portfolio_id=wheel.id,
        instrument_id=instrument.id,
        action=TradeAction.SELL_OPEN,
        quantity=5,
        price=Decimal("500.00"),
        underlying_price_at_trade=Decimal("495.00"),
        status=TradeStatus.ACTIVE,
        trade_date=datetime(2024, 1, 1, 9, 30, 0),
        notes="Seed: initial NVDA Wheel position",
    )
    db.add(trade)
    await db.flush()   # populate trade.id

    # ── 5. Cash ledger entry ──────────────────────────────────────────────
    # SELL_OPEN → cash inflow = price × quantity × multiplier
    cash_amount = trade.price * Decimal(str(trade.quantity)) * Decimal(str(instrument.multiplier))
    # = Decimal("500.00") × 5 × 100 = Decimal("250000.00")

    cash_entry = CashLedger(
        portfolio_id=wheel.id,
        trade_event_id=trade.id,
        amount=cash_amount,
        description=(
            f"SELL_OPEN 5x NVDA {instrument.expiry} ${instrument.strike} PUT "
            f"@ ${trade.price} | +${cash_amount:,.2f}"
        ),
    )
    db.add(cash_entry)

    return True
