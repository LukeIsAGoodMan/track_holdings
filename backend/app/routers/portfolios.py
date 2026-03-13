"""
GET   /api/portfolios              — portfolio tree with aggregated stats
POST  /api/portfolios              — create portfolio or sub-portfolio
PATCH /api/portfolios/{id}/move   — move portfolio (parent reassignment + sibling sort)
GET   /api/portfolios/{id}/trades — transaction history for a portfolio
"""
from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import Portfolio, CashLedger
from app.models.trade_event import TradeEvent
from app.models.user import User
from app.schemas.portfolio import PortfolioCreate, PortfolioMoveBody, PortfolioNode
from app.services import position_engine, yfinance_client
from app.services.position_engine import collect_portfolio_ids
from app.services.portfolio_resolver import resolve_portfolio_ids
from app.services.black_scholes import (
    DEFAULT_SIGMA,
    calculate_greeks,
    maintenance_margin,
    net_delta_exposure,
)


class ReorderItem(BaseModel):
    id:         int
    sort_order: int


class PortfolioUpdateBody(BaseModel):
    name: str


class TransactionResponse(BaseModel):
    id:              int
    portfolio_id:    int       # source portfolio (useful in aggregated/folder views)
    portfolio_name:  str       # display name of the source portfolio
    symbol:          str
    instrument_type: str
    option_type:     str | None
    strike:          str | None
    expiry:          str | None
    action:          str
    quantity:        int
    price:           str
    trade_date:      str
    status:          str
    notes:           str | None
    trade_metadata:  Any | None

router = APIRouter(tags=["portfolios"])


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/portfolios", response_model=list[PortfolioNode])
async def list_portfolios(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Return the full portfolio hierarchy as a nested tree.

    Query plan (avoids N+1):
      1. One SELECT portfolios WHERE user_id = ?
      2. One SELECT cash_ledger GROUP BY portfolio_id  (cash for all portfolios)
      3. N sequential calculate_positions calls         (session is not concurrent-safe)
      4. One asyncio.gather for all unique spot prices  (HTTP, safe to parallelise)
      5. Pure-Python stat computation — no further DB calls
      6. Tree assembly + post-order rollup (cash / delta / margin)
    """
    port_result = await db.execute(
        select(Portfolio).where(Portfolio.user_id == user.id)
        .order_by(Portfolio.sort_order.asc(), Portfolio.id.asc())
    )
    all_portfolios = port_result.scalars().all()
    if not all_portfolios:
        return []

    pid_list = [p.id for p in all_portfolios]

    # ── 1. Batch cash: one GROUP BY query for all portfolios ──────────────────
    cash_result = await db.execute(
        select(CashLedger.portfolio_id, func.sum(CashLedger.amount))
        .where(CashLedger.portfolio_id.in_(pid_list))
        .group_by(CashLedger.portfolio_id)
    )
    cash_by_pid: dict[int, Decimal] = {
        row[0]: Decimal(str(row[1] or 0))
        for row in cash_result.fetchall()
    }

    # ── 2. Positions per portfolio (sequential — same async session) ──────────
    pos_by_pid: dict[int, list] = {}
    all_symbols: set[str] = set()
    for pid in pid_list:
        positions = await position_engine.calculate_positions(db, portfolio_id=pid)
        pos_by_pid[pid] = positions
        for pos in positions:
            all_symbols.add(pos.instrument.symbol)

    # ── 3. Batch spot prices: one gather for all unique symbols ───────────────
    symbols_list = list(all_symbols)
    spot_values  = await asyncio.gather(
        *[yfinance_client.get_spot_price(s) for s in symbols_list]
    )
    spot_map = dict(zip(symbols_list, spot_values))

    # ── 4. Per-portfolio stat computation (pure Python, no I/O) ──────────────
    today = date.today()
    r_f   = Decimal(str(settings.risk_free_rate))
    nodes: dict[int, PortfolioNode] = {}

    for p in all_portfolios:
        cash         = cash_by_pid.get(p.id, Decimal("0"))
        total_delta  = Decimal("0")
        total_margin = Decimal("0")

        for pos in pos_by_pid[p.id]:
            inst = pos.instrument
            if not (inst.option_type and inst.expiry):
                # Stock / ETF: delta = net shares (1 share = 1Δ), no margin
                total_delta += Decimal(str(pos.net_contracts))
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

        nodes[p.id] = PortfolioNode(
            id=p.id,
            name=p.name,
            description=p.description,
            parent_id=p.parent_id,
            is_folder=p.is_folder,
            sort_order=p.sort_order,
            total_cash=cash,
            total_delta_exposure=total_delta,
            total_margin=total_margin,
        )

    # ── 5. Assemble tree ──────────────────────────────────────────────────────
    roots: list[PortfolioNode] = []
    for node in nodes.values():
        if node.parent_id is None:
            roots.append(node)
        else:
            parent = nodes.get(node.parent_id)
            if parent:
                parent.children.append(node)

    # ── 6. Post-order rollup: aggregate cash, delta, margin across subtree ────
    def _rollup_stats(node: PortfolioNode) -> tuple[Decimal, Decimal, Decimal]:
        cash   = Decimal(str(node.total_cash))
        delta  = Decimal(str(node.total_delta_exposure))
        margin = Decimal(str(node.total_margin))
        for child in node.children:
            c, d, m = _rollup_stats(child)
            cash   += c
            delta  += d
            margin += m
        node.aggregated_cash   = cash
        node.aggregated_delta  = delta
        node.aggregated_margin = margin
        return cash, delta, margin

    for root in roots:
        _rollup_stats(root)

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
        is_folder=body.is_folder,
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
        is_folder=portfolio.is_folder,
        sort_order=portfolio.sort_order,
        total_cash=Decimal("0"),
        total_delta_exposure=Decimal("0"),
        total_margin=Decimal("0"),
    )


@router.patch("/portfolios/reorder", status_code=200)
async def reorder_portfolios(
    body: list[ReorderItem],
    user: User = Depends(get_current_user),
    db:   AsyncSession = Depends(get_db),
):
    """Batch-update sort_order for sibling portfolios (drag-and-drop reorder)."""
    for item in body:
        port = await db.get(Portfolio, item.id)
        if port and port.user_id == user.id:
            port.sort_order = item.sort_order
    await db.commit()
    return {"reordered": len(body)}


@router.patch("/portfolios/{portfolio_id}", response_model=PortfolioNode)
async def rename_portfolio(
    portfolio_id: int,
    body: PortfolioUpdateBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Rename a portfolio. Returns 409 if the name is already taken."""
    port = await db.get(Portfolio, portfolio_id)
    if port is None or port.user_id != user.id:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    new_name = body.name.strip()
    if not new_name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")

    # Unique-name guard (portfolio names are globally unique per the model)
    existing = await db.execute(
        select(Portfolio.id).where(Portfolio.name == new_name)
    )
    conflict_id = existing.scalar_one_or_none()
    if conflict_id is not None and conflict_id != portfolio_id:
        raise HTTPException(status_code=409, detail="A portfolio with that name already exists")

    port.name = new_name
    await db.commit()
    await db.refresh(port)

    return PortfolioNode(
        id=port.id,
        name=port.name,
        description=port.description,
        parent_id=port.parent_id,
        is_folder=port.is_folder,
        sort_order=port.sort_order,
        total_cash=Decimal("0"),
        total_delta_exposure=Decimal("0"),
        total_margin=Decimal("0"),
    )


@router.delete("/portfolios/{portfolio_id}", status_code=204)
async def delete_portfolio(
    portfolio_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Cascade-delete a portfolio and its entire subtree.
    Deletes CashLedger and TradeEvent rows for all descendant portfolios,
    then deletes the portfolio rows (deepest first to satisfy FK constraints).
    """
    port = await db.get(Portfolio, portfolio_id)
    if port is None or port.user_id != user.id:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    # BFS subtree (includes portfolio_id itself)
    all_ids = await collect_portfolio_ids(db, portfolio_id)

    # Delete dependent rows first
    await db.execute(delete(CashLedger).where(CashLedger.portfolio_id.in_(all_ids)))
    await db.execute(delete(TradeEvent).where(TradeEvent.portfolio_id.in_(all_ids)))

    # Delete portfolios leaf-first (reverse BFS order) to respect self-referential FK
    result = await db.execute(
        select(Portfolio).where(Portfolio.id.in_(all_ids))
    )
    subtree_ports = result.scalars().all()
    # Sort children before parents (deepest id first is fine for SQLite; for safety sort by depth)
    subtree_ports_sorted = sorted(subtree_ports, key=lambda p: (p.parent_id is None, p.id))
    for p in reversed(subtree_ports_sorted):
        await db.delete(p)

    await db.commit()


@router.patch("/portfolios/{portfolio_id}/move", response_model=PortfolioNode)
async def move_portfolio(
    portfolio_id: int,
    body: PortfolioMoveBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Move a portfolio to a new parent (or to root if parent_id=None) and/or
    update its sort_order for sibling reordering.

    Cycle guard: raises 400 if the destination parent is a descendant of the
    portfolio being moved (which would create a circular reference).
    """
    port = await db.get(Portfolio, portfolio_id)
    if port is None or port.user_id != user.id:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    new_parent_id = body.parent_id

    if new_parent_id is not None:
        parent = await db.get(Portfolio, new_parent_id)
        if parent is None or parent.user_id != user.id:
            raise HTTPException(status_code=404, detail="Parent portfolio not found")

        # Cycle check: new parent must NOT be the portfolio itself or any of its descendants
        subtree = await collect_portfolio_ids(db, portfolio_id)
        if new_parent_id in subtree:
            raise HTTPException(
                status_code=400,
                detail="Cannot move a portfolio into its own subtree (cycle detected)",
            )

    port.parent_id  = new_parent_id
    port.sort_order = body.sort_order
    await db.commit()
    await db.refresh(port)

    return PortfolioNode(
        id=port.id,
        name=port.name,
        description=port.description,
        parent_id=port.parent_id,
        is_folder=port.is_folder,
        sort_order=port.sort_order,
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
    """
    Return full transaction log for a portfolio, newest first.

    Uses recursive roll-up: if portfolio_id points to a folder, trades from
    all descendant portfolios are included (same pattern as /holdings and /cash).
    Each row carries portfolio_id + portfolio_name so the UI can label the
    source sub-portfolio in aggregated (folder) views.
    """
    # resolve_portfolio_ids validates ownership and returns BFS subtree
    pids = await resolve_portfolio_ids(db, user.id, portfolio_id)
    if not pids:
        return []

    # Batch-load portfolio names for the resolved IDs
    port_result = await db.execute(
        select(Portfolio.id, Portfolio.name).where(Portfolio.id.in_(pids))
    )
    port_name_map: dict[int, str] = {row[0]: row[1] for row in port_result.fetchall()}

    result = await db.execute(
        select(TradeEvent)
        .options(selectinload(TradeEvent.instrument))
        .where(TradeEvent.portfolio_id.in_(pids))
        .order_by(TradeEvent.trade_date.desc())
    )
    trades = result.scalars().all()

    return [
        TransactionResponse(
            id=t.id,
            portfolio_id=t.portfolio_id,
            portfolio_name=port_name_map.get(t.portfolio_id, ""),
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
