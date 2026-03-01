"""
CashLedger — append-only signed cash log.

Cash flow rules:
  SELL_OPEN   → amount = +price * quantity * multiplier   (e.g. +250,000)
  BUY_OPEN    → amount = -price * quantity * multiplier
  BUY_CLOSE   → amount = -price * quantity * multiplier
  SELL_CLOSE  → amount = +price * quantity * multiplier

Current balance = SELECT SUM(amount) FROM cash_ledger WHERE portfolio_id = ?

Rows are NEVER updated or deleted — only appended.
This preserves a complete audit trail of every cash movement.
"""
from __future__ import annotations

from sqlalchemy import Column, Integer, String, DateTime, Numeric, ForeignKey, func
from sqlalchemy.orm import relationship

from app.database import Base


class CashLedger(Base):
    __tablename__ = "cash_ledger"

    id             = Column(Integer, primary_key=True, index=True)
    portfolio_id   = Column(
        Integer, ForeignKey("portfolios.id"),   nullable=False, index=True
    )
    trade_event_id = Column(
        Integer, ForeignKey("trade_events.id"), nullable=True
    )
    user_id        = Column(
        Integer, ForeignKey("users.id"), nullable=True, index=True
    )

    # Signed amount: positive = inflow, negative = outflow.
    # Decimal(18, 6) — sub-cent precision, eliminates float rounding risk.
    amount      = Column(Numeric(18, 6, asdecimal=True), nullable=False)
    description = Column(String(200), nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

    portfolio   = relationship("Portfolio",  back_populates="cash_entries")
    trade_event = relationship("TradeEvent", back_populates="cash_entries")
