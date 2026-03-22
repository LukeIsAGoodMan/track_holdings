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

    # Smart action: accepts "BUY" or "SELL" (resolved server-side)
    # Also accepts legacy "SELL_OPEN", "BUY_OPEN", "BUY_CLOSE", "SELL_CLOSE" for backward compat
    action:        Literal["BUY", "SELL", "SELL_OPEN", "BUY_OPEN", "BUY_CLOSE", "SELL_CLOSE"]

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
    strategy_tags: list[str] | None = Field(
        None,
        description="Strategy tags, e.g. ['Hedge', 'Income']. Validated against VALID_STRATEGY_TAGS.",
    )


# Predefined strategy tag vocabulary (Phase 10.5)
VALID_STRATEGY_TAGS = frozenset({
    "Hedge", "Speculative", "Earnings", "Income",
    "Momentum", "Mean Reversion", "Wheel", "Volatility",
})


class TradeUpdate(BaseModel):
    """Updatable coaching fields on an existing trade (trade_metadata only)."""
    confidence_score: int | None = Field(None, ge=1, le=5)
    trade_reason: str | None = Field(None, max_length=500)
    strategy_tags: list[str] | None = None


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
    confidence_score:     int | None = None
    strategy_tags:        list[str] | None = None
