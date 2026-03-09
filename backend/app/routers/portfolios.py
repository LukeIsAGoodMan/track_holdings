"""
GET  /api/portfolios              — portfolio tree with aggregated stats
POST /api/portfolios              — create portfolio or sub-portfolio
GET  /api/portfolios/{id}/trades  — transaction history for a portfolio
"""
from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import Portfolio, CashLedger
from app.models.trade_event import TradeEvent
from app.models.user import User
from app.schemas.portfolio import PortfolioCreate, PortfolioNode
from app.services import position_engine, yfinance_client
from app.services.black_scholes import (
    DEFAULT_SIGMA,
    calculate_greeks,
    maintenance_margin,
    net_delta_exposure,
)


class TransactionResponse(BaseModel):
    id:             int
    symbol:         str
    instrument_type: str
    option_type:    str | None
    strike:         str | None
    expiry:         str | None
    action:         str
    quantity:       int
    price:          str
    trade_date:     str
    status:         str
    notes:          str | None
    trade_metadata: Any | None

router = APIRouter(tags=["portfolios"])


# ── Helper ────────────────────────────────────────────────────────────────────

async def _portfolio_stats(portfolio_id: int, db: AsyncSession) -> dict:
    """
    Compute aggregated stats for one portfolio (direct trades only, not sub-portfolios).
    Returns: {cash, delta, margin}
    """
    # Cash balance
    raw = await db.execute(
        select(func.sum(CashLedger.amount))
        .where(CashLedger.portfolio_id == portfolio_id)
    )
    cash = Decimal(str(raw.scalar() or 0))

    # Positions
    positions = await position_engine.calculate_positions(db, portfolio_id=portfolio_id)
    if not positions:
        return {"cash": cash, "delta": Decimal("0"), "margin": Decimal("0")}

    symbols    = list({pos.instrument.symbol for pos in positions})
    spot_tasks = [yfinance_client.get_spot_price(s) for s in symbols]
    spots      = await asyncio.gather(*spot_tasks)
    spot_map   = dict(zip(symbols, spots))

    today = date.today()
    r_f   = Decimal(str(settings.risk_free_rate))
    total_delta  = Decimal("0")
    total_margin = Decimal("0")

    for pos in positions:
        inst = pos.instrument
        if not (inst.option_type and inst.expiry):
            continue
        dte  = (inst.expiry - today).days
        T    = Decimal(str(max(dte, 0) / 365.0))
        spot = spot_map.get(inst.symbol)
        marg = maintenance_margin(pos.net_contracts, inst.strike)
        total_margin += marg
        if spot and T > 0:
            g = calculate_greeks(spot, inst.strike, T, inst.option_type.value,
                                 DEFAULT_SIGMA, r_f)
            total_delta += net_delta_exposure(pos.net_contracts, g)

    return {"cash": cash, "delta": total_delta, "margin": total_margin}


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/portfolios", response_model=list[PortfolioNode])
async def list_portfolios(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the full portfolio hierarchy as a nested tree."""
    result = await db.execute(
        select(Portfolio).where(Portfolio.user_id == user.id).order_by(Portfolio.id)
    )
    all_portfolios = result.scalars().all()

    # Build flat node map
    nodes: dict[int, PortfolioNode] = {}
    for p in all_portfolios:
        stats = await _portfolio_stats(p.id, db)
        nodes[p.id] = PortfolioNode(
            id=p.id,
            name=p.name,
            description=p.description,
            parent_id=p.parent_id,
            total_cash=stats["cash"],
            total_delta_exposure=stats["delta"],
            total_margin=stats["margin"],
        )

    # Assemble tree
    roots: list[PortfolioNode] = []
    for node in nodes.values():
        if node.parent_id is None:
            roots.append(node)
        else:
            parent = nodes.get(node.parent_id)
            if parent:
                parent.children.append(node)

    return roots


@router.post("/portfolios", response_model=PortfolioNode, status_code=201)
async def create_portfolio(
    body: PortfolioCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.parent_id is not None:
        parent = await db.get(Portfolio, body.parent_id)
        if parent is None or parent.user_id != user.id:
            raise HTTPException(
                status_code=404,
                detail=f"Parent portfolio {body.parent_id} not found",
            )

    portfolio = Portfolio(
        name=body.name,
        description=body.description,
        parent_id=body.parent_id,
        user_id=user.id,
    )
    db.add(portfolio)
    await db.commit()
    await db.refresh(portfolio)

    return PortfolioNode(
        id=portfolio.id,
        name=portfolio.name,
        description=portfolio.description,
        parent_id=portfolio.parent_id,
        total_cash=Decimal("0"),
        total_delta_exposure=Decimal("0"),
        total_margin=Decimal("0"),
    )


@router.get("/portfolios/{portfolio_id}/trades", response_model=list[TransactionResponse])
async def get_portfolio_trades(
    portfolio_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return full transaction log for a portfolio, newest first."""
    portfolio = await db.get(Portfolio, portfolio_id)
    if portfolio is None or portfolio.user_id != user.id:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    result = await db.execute(
        select(TradeEvent)
        .options(selectinload(TradeEvent.instrument))
        .where(TradeEvent.portfolio_id == portfolio_id)
        .order_by(TradeEvent.trade_date.desc())
    )
    trades = result.scalars().all()

    return [
        TransactionResponse(
            id=t.id,
            symbol=t.instrument.symbol,
            instrument_type=t.instrument.instrument_type.value,
            option_type=t.instrument.option_type.value if t.instrument.option_type else None,
            strike=str(t.instrument.strike) if t.instrument.strike is not None else None,
            expiry=t.instrument.expiry.isoformat() if t.instrument.expiry else None,
            action=t.action.value,
            quantity=t.quantity,
            price=str(t.price),
            trade_date=t.trade_date.isoformat() if t.trade_date else "",
            status=t.status.value,
            notes=t.notes,
            trade_metadata=t.trade_metadata,
        )
        for t in trades
    ]
