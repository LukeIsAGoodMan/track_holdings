"""
Instrument — deduped contract registry.

One row per unique financial instrument:
  - Stock:  symbol="NVDA", instrument_type=STOCK  (strike/expiry/option_type = NULL)
  - Option: symbol="NVDA", instrument_type=OPTION,
            strike=600, expiry=2026-12-18, option_type=PUT

Greeks and PnL calculations are stateless plugins that TAKE an Instrument as
input; they are never stored here. Swap the pricing model without touching data.
"""
from __future__ import annotations

import enum

from sqlalchemy import (
    Column,
    Integer,
    String,
    Date,
    Numeric,
    JSON,
    UniqueConstraint,
    Enum as SAEnum,
)
from sqlalchemy.orm import relationship

from app.database import Base


class InstrumentType(str, enum.Enum):
    STOCK  = "STOCK"
    OPTION = "OPTION"
    ETF    = "ETF"
    INDEX  = "INDEX"
    CRYPTO = "CRYPTO"


class OptionType(str, enum.Enum):
    CALL = "CALL"
    PUT  = "PUT"


class Instrument(Base):
    __tablename__ = "instruments"
    __table_args__ = (
        UniqueConstraint(
            "symbol", "strike", "expiry", "option_type",
            name="uq_instrument_contract",
        ),
    )

    id              = Column(Integer, primary_key=True, index=True)
    symbol          = Column(String(20), nullable=False, index=True)
    instrument_type = Column(SAEnum(InstrumentType, native_enum=False), nullable=False)

    # Option-specific fields (NULL for stocks).
    # Numeric(18, 6, asdecimal=True) → Python always yields Decimal, never float.
    strike      = Column(Numeric(18, 6, asdecimal=True), nullable=True)
    expiry      = Column(Date,                           nullable=True)
    option_type = Column(SAEnum(OptionType, native_enum=False), nullable=True)
    multiplier  = Column(Integer, default=100, nullable=False)

    # Future-proofing: arbitrary metadata per contract.
    # Intended for: support/resistance levels, PEG analysis anchors, analyst targets.
    # Example: {"support": 580, "resistance": 640, "peg_ratio": 1.8, "notes": "..."}
    tags        = Column(JSON, nullable=True, default=None)

    trade_events = relationship("TradeEvent", back_populates="instrument")
