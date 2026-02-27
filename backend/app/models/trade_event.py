"""
TradeEvent — immutable event log (source of truth for all position calculations).

TradeAction semantics:
  SELL_OPEN   → open short position  → cash INCREASES (+price * qty * multiplier)
  BUY_OPEN    → open long  position  → cash DECREASES (-price * qty * multiplier)
  BUY_CLOSE   → close short (buy-back) → cash DECREASES
  SELL_CLOSE  → close long  (sell)     → cash INCREASES

Net contracts sign convention (computed by position_engine, NOT stored here):
  SELL_OPEN   contribution: -quantity
  BUY_OPEN    contribution: +quantity
  BUY_CLOSE   contribution: +quantity  (reduces the short)
  SELL_CLOSE  contribution: -quantity  (reduces the long)

TradeStatus lifecycle:
  ACTIVE → CLOSED    (manually closed before expiry)
  ACTIVE → EXPIRED   (option expired worthless)
  ACTIVE → ASSIGNED  (put exercised against seller)
"""
from __future__ import annotations

import enum

from sqlalchemy import (
    Column,
    Integer,
    String,
    Date,
    DateTime,
    Numeric,
    JSON,
    ForeignKey,
    Enum as SAEnum,
    func,
)
from sqlalchemy.orm import relationship

from app.database import Base


class TradeAction(str, enum.Enum):
    SELL_OPEN   = "SELL_OPEN"
    BUY_OPEN    = "BUY_OPEN"
    BUY_CLOSE   = "BUY_CLOSE"
    SELL_CLOSE  = "SELL_CLOSE"


class TradeStatus(str, enum.Enum):
    ACTIVE   = "ACTIVE"
    EXPIRED  = "EXPIRED"
    ASSIGNED = "ASSIGNED"
    CLOSED   = "CLOSED"


class TradeEvent(Base):
    __tablename__ = "trade_events"

    id            = Column(Integer, primary_key=True, index=True)
    portfolio_id  = Column(
        Integer, ForeignKey("portfolios.id"),  nullable=False, index=True
    )
    instrument_id = Column(
        Integer, ForeignKey("instruments.id"), nullable=False, index=True
    )

    action   = Column(SAEnum(TradeAction,  native_enum=False), nullable=False)
    quantity = Column(Integer, nullable=False)  # always positive; direction = action

    # All monetary values: Decimal — NO float in trade accounting.
    # price = premium per share (options) or price per share (stocks).
    price                     = Column(Numeric(18, 6, asdecimal=True), nullable=False)
    underlying_price_at_trade = Column(Numeric(18, 6, asdecimal=True), nullable=True)

    status      = Column(
        SAEnum(TradeStatus, native_enum=False),
        default=TradeStatus.ACTIVE,
        nullable=False,
    )
    trade_date  = Column(DateTime(timezone=True), server_default=func.now())
    closed_date = Column(Date, nullable=True)
    notes       = Column(String(500), nullable=True)

    # Trading Coach / Decision Log metadata.
    # Stores confidence_score (1-5) and trade_reason as structured JSON,
    # plus any future coaching fields without schema migrations.
    # Example: {"confidence_score": 4, "trade_reason": "IV rank high, wheel strategy"}
    trade_metadata = Column(JSON, nullable=True, default=None)

    portfolio    = relationship("Portfolio",  back_populates="trade_events")
    instrument   = relationship("Instrument", back_populates="trade_events")
    cash_entries = relationship("CashLedger", back_populates="trade_event")
