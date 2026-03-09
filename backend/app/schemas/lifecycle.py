from __future__ import annotations

from pydantic import BaseModel

from app.schemas.base import DecStr


class LifecycleResult(BaseModel):
    """Summary returned by POST /api/lifecycle/process."""
    expired:  int
    assigned: int
    skipped:  int
    details:  list[str] = []


class SettledTrade(BaseModel):
    """
    One settled (EXPIRED or ASSIGNED) option TradeEvent.

    For ASSIGNED positions, auto_stock_* fields carry details of the
    auto-generated stock trade created by the lifecycle sweep.
    """
    trade_event_id:    int
    portfolio_id:      int
    symbol:            str
    option_type:       str | None     # "CALL" | "PUT" | None for stock trades
    strike:            DecStr | None
    expiry:            str | None    # ISO date
    action:            str           # original opening action: SELL_OPEN | BUY_OPEN
    quantity:          int
    status:            str           # "EXPIRED" | "ASSIGNED" | "CLOSED"
    settled_date:      str | None    # ISO date

    # Populated only for ASSIGNED positions
    auto_stock_action:        str | None = None
    auto_stock_quantity:      int | None = None
    auto_stock_price:         DecStr | None = None  # effective cost basis (premium-adjusted)
    premium_per_share:        DecStr | None = None
    effective_cost_per_share: DecStr | None = None


class SettledTradesResponse(BaseModel):
    trades: list[SettledTrade]
    total:  int
