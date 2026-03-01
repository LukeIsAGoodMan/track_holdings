"""
Portfolio — supports arbitrary hierarchy via self-referential parent_id.

Example:
    Portfolio("Main Account")              parent_id=NULL  (root)
      └── Portfolio("NVDA Wheel")          parent_id=1
      └── Portfolio("SPY Puts")            parent_id=1
"""
from __future__ import annotations

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func
from sqlalchemy.orm import relationship

from app.database import Base


class Portfolio(Base):
    __tablename__ = "portfolios"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String(100), nullable=False, unique=True)
    description = Column(String(500), nullable=True)
    parent_id   = Column(
        Integer, ForeignKey("portfolios.id"), nullable=True, index=True
    )
    user_id     = Column(
        Integer, ForeignKey("users.id"), nullable=True, index=True
    )
    created_at  = Column(DateTime(timezone=True), server_default=func.now())

    # Self-referential hierarchy
    parent   = relationship("Portfolio", remote_side=[id], back_populates="children")
    children = relationship(
        "Portfolio", back_populates="parent", cascade="all, delete-orphan"
    )

    trade_events = relationship("TradeEvent", back_populates="portfolio")
    cash_entries = relationship("CashLedger",  back_populates="portfolio")
