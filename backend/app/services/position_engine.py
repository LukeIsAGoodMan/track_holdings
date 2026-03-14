"""
Position Engine — replays the TradeEvent sequence to compute net positions.

calculate_positions(db, portfolio_id=None, portfolio_ids=None) → list[PositionRow]

collect_portfolio_ids(db, root_id) → set[int]
    BFS walk: returns root_id + all descendant portfolio IDs, enabling
    recursive roll-up so that querying "Main Account" also includes
    all child sub-strategy portfolios.

Grouping key: instrument_id (across or within a single portfolio).
Net-contracts sign convention:
  SELL_OPEN   → -quantity   (opening short)
  BUY_OPEN    → +quantity   (opening long)
  BUY_CLOSE   → +quantity   (reducing short)
  SELL_CLOSE  → -quantity   (reducing long)

Positions where net_contracts == 0 (fully closed / flat) are filtered out.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import TradeEvent, TradeAction, Instrument


@dataclass
class PositionRow:
    instrument:        Instrument
    net_contracts:     int        # signed: negative = short
    avg_open_price:    Decimal    # weighted avg cost basis per share
    total_open_premium: Decimal   # abs(net_contracts) × avg_open_price × multiplier
    first_trade_date:  datetime
    days_elapsed:      int        # calendar days from first trade to today


async def collect_portfolio_ids(db: AsyncSession, root_id: int) -> set[int]:
    """
    BFS walk of the portfolio hierarchy.

    Loads all (id, parent_id) pairs in a single query, then walks the
    tree in Python to return root_id plus every descendant ID.

    Example:
        Main Account (id=1) → NVDA Wheel (id=2), SPY Puts (id=3)
        collect_portfolio_ids(db, 1)  →  {1, 2, 3}
        collect_portfolio_ids(db, 2)  →  {2}
    """
    from app.models.portfolio import Portfolio  # local to avoid circular

    result = await db.execute(select(Portfolio.id, Portfolio.parent_id))
    rows = result.all()

    # Build parent_id → [child_ids] map
    children_map: dict[int, list[int]] = {}
    for pid, ppid in rows:
        if ppid is not None:
            children_map.setdefault(ppid, []).append(pid)

    # BFS from root — visited-set guards against DB cycles (e.g. A→B→A)
    ids: set[int] = set()
    queue: list[int] = [root_id]
    while queue:
        current = queue.pop()
        if current in ids:   # already visited: skip to prevent infinite loop
            continue
        ids.add(current)
        queue.extend(children_map.get(current, []))

    return ids


async def calculate_positions(
    db: AsyncSession,
    portfolio_id: int | None = None,
    portfolio_ids: set[int] | None = None,
) -> list[PositionRow]:
    """
    Replay all TradeEvents → net positions per instrument.

    Args:
        portfolio_id:  if provided (and portfolio_ids is None), restrict to
                       trades in exactly that one portfolio.
        portfolio_ids: if provided, restrict to trades in this set of IDs
                       (use with collect_portfolio_ids for recursive roll-up).
        Neither set → aggregate across all portfolios.
    """
    query = (
        select(TradeEvent)
        .options(selectinload(TradeEvent.instrument))
        .order_by(TradeEvent.trade_date.asc())   # chronological for correct FIFO avg
    )
    if portfolio_ids is not None:
        query = query.where(TradeEvent.portfolio_id.in_(portfolio_ids))
    elif portfolio_id is not None:
        query = query.where(TradeEvent.portfolio_id == portfolio_id)

    result = await db.execute(query)
    trades = result.scalars().all()

    # Accumulator: instrument_id → running state dict
    groups: dict[int, dict] = {}

    today = datetime.utcnow()

    for trade in trades:
        iid = trade.instrument_id
        if iid not in groups:
            groups[iid] = {
                "instrument":       trade.instrument,
                "net_contracts":    0,
                "open_qty":         Decimal("0"),        # denominator for avg
                "open_price_sum":   Decimal("0"),        # numerator for avg
                "first_trade_date": trade.trade_date,
            }

        g = groups[iid]

        # ── Signed net-contracts contribution ────────────────────────────
        if trade.action == TradeAction.SELL_OPEN:
            g["net_contracts"] -= trade.quantity
        elif trade.action == TradeAction.BUY_OPEN:
            g["net_contracts"] += trade.quantity
        elif trade.action == TradeAction.BUY_CLOSE:
            g["net_contracts"] += trade.quantity    # reduces the short
        else:  # SELL_CLOSE
            g["net_contracts"] -= trade.quantity    # reduces the long

        # ── Cost basis: only opening trades contribute ────────────────────
        if trade.action in (TradeAction.SELL_OPEN, TradeAction.BUY_OPEN):
            qty_d = Decimal(str(trade.quantity))
            g["open_qty"]       += qty_d
            g["open_price_sum"] += trade.price * qty_d

        # ── Track earliest trade date ─────────────────────────────────────
        # trade_date may be timezone-aware; normalize to naive UTC for compare
        td = trade.trade_date.replace(tzinfo=None) if trade.trade_date.tzinfo else trade.trade_date
        fd = g["first_trade_date"]
        fd = fd.replace(tzinfo=None) if fd.tzinfo else fd
        if td < fd:
            g["first_trade_date"] = trade.trade_date

    # ── Build output rows (skip flat positions) ───────────────────────────
    rows: list[PositionRow] = []
    for g in groups.values():
        if g["net_contracts"] == 0:
            continue

        avg_price = (
            g["open_price_sum"] / g["open_qty"]
            if g["open_qty"] > Decimal("0")
            else Decimal("0")
        )

        instrument: Instrument = g["instrument"]
        total_open = avg_price * abs(g["net_contracts"]) * Decimal(str(instrument.multiplier))

        fd = g["first_trade_date"]
        fd_naive = fd.replace(tzinfo=None) if fd.tzinfo else fd
        elapsed_days = max(int((today - fd_naive).total_seconds() // 86400), 0)

        rows.append(
            PositionRow(
                instrument=instrument,
                net_contracts=g["net_contracts"],
                avg_open_price=avg_price,
                total_open_premium=total_open,
                first_trade_date=g["first_trade_date"],
                days_elapsed=elapsed_days,
            )
        )

    return rows
