from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import DecStr


class TradeCreate(BaseModel):
    portfolio_id:  int
    symbol:        str   = Field(..., min_length=1, max_length=20)
    instrument_type: Literal["STOCK", "OPTION"] = "OPTION"
    option_type:   Literal["CALL", "PUT"] | None = None
    strike:        Decimal | None = None
    expiry:        date    | None = None
    action:        Literal["SELL_OPEN", "BUY_OPEN", "BUY_CLOSE", "SELL_CLOSE"]
    quantity:      int     = Field(..., gt=0)
    price:         Decimal = Field(..., ge=Decimal("0"))
    underlying_price_at_trade: Decimal | None = None
    notes:         str | None = None

    # Trading Coach — optional decision log attached to each trade
    confidence_score: int | None = Field(
        None, ge=1, le=5,
        description="Self-assessed conviction level: 1 (low) – 5 (high)",
    )
    trade_reason: str | None = Field(
        None, max_length=500,
        description="Free-text rationale, e.g. 'IV rank > 50, support at 580'",
    )


class TradeResponse(BaseModel):
    """Response returned after a successful trade POST."""
    model_config = ConfigDict(from_attributes=False)

    id:                   int
    portfolio_id:         int
    instrument_id:        int
    symbol:               str
    option_type:          str | None
    strike:               DecStr | None
    expiry:               date   | None
    action:               str
    quantity:             int
    price:                DecStr
    cash_impact:          DecStr   # signed: + for inflow, - for outflow
    net_contracts_after:  int      # net position post-trade (signed)
    trade_date:           datetime
