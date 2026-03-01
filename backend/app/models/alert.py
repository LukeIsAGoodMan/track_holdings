"""
Alert model — user-defined price/percentage alerts.

Each alert monitors a symbol and fires when the spot price crosses the
configured threshold.  Alerts are per-user (not per-portfolio) so users
can set alerts on symbols they don't yet hold.

Phase 7e.
"""
from __future__ import annotations

import enum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    Numeric,
    String,
)
from sqlalchemy.sql import func

from app.database import Base


class AlertType(str, enum.Enum):
    PRICE_ABOVE = "PRICE_ABOVE"
    PRICE_BELOW = "PRICE_BELOW"
    PCT_CHANGE_UP = "PCT_CHANGE_UP"
    PCT_CHANGE_DOWN = "PCT_CHANGE_DOWN"


class AlertStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    TRIGGERED = "TRIGGERED"
    DISABLED = "DISABLED"


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    symbol = Column(String(20), nullable=False, index=True)

    alert_type = Column(SAEnum(AlertType, native_enum=False), nullable=False)
    status = Column(
        SAEnum(AlertStatus, native_enum=False),
        default=AlertStatus.ACTIVE,
        nullable=False,
    )

    threshold = Column(Numeric(18, 6, asdecimal=True), nullable=False)
    reference_price = Column(Numeric(18, 6, asdecimal=True), nullable=True)

    repeat = Column(Boolean, default=False, nullable=False)
    cooldown_seconds = Column(Integer, default=300, nullable=False)

    note = Column(String(500), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    triggered_at = Column(DateTime(timezone=True), nullable=True)
    trigger_count = Column(Integer, default=0, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
