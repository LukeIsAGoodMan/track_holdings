"""
Pydantic schemas for price alert CRUD.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import DecStr


class AlertCreate(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20)
    alert_type: Literal[
        "PRICE_ABOVE", "PRICE_BELOW", "PCT_CHANGE_UP", "PCT_CHANGE_DOWN"
    ]
    threshold: Decimal = Field(..., gt=Decimal("0"))
    reference_price: Decimal | None = None
    repeat: bool = False
    cooldown_seconds: int = Field(300, ge=0)
    note: str | None = Field(None, max_length=500)
    expires_at: datetime | None = None


class AlertUpdate(BaseModel):
    status: Literal["ACTIVE", "DISABLED"] | None = None
    threshold: Decimal | None = None
    repeat: bool | None = None
    cooldown_seconds: int | None = None
    note: str | None = None
    expires_at: datetime | None = None


class AlertResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    symbol: str
    alert_type: str
    status: str
    threshold: DecStr
    reference_price: DecStr | None
    repeat: bool
    cooldown_seconds: int
    note: str | None
    created_at: datetime
    triggered_at: datetime | None
    trigger_count: int
    expires_at: datetime | None
