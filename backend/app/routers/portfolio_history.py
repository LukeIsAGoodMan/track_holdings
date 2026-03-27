"""
GET /api/portfolio/history?portfolio_id=N&days=30

Returns a daily Portfolio PnL time series (NOT NLV / market value).

PnL = Σ unrealized_pnl_i[t] + cumulative_realized_pnl[t]

Where:
  unrealized_pnl_i[t] = (price[t] - entry_price_i) × qty_i × multiplier_i
  - Gated by first_trade_date: contribution = 0 before entry
  - entry_price = actual execution price (avg_open_price from position engine)
  - At entry: PnL ≈ 0 (no step jump from capital deployment)

  realized_pnl = frozen contribution from closed positions
  - Computed by replaying trade events with FIFO cost basis
  - Persists as constant offset after close date

Key properties:
  - No principal injection (position notional never enters the series)
  - No step jumps when new positions are added
  - PnL starts at ~0 for newly opened positions
  - Closed positions' PnL persists in the historical series
  - Continuous line, no synthetic gaps
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import get_current_user_flexible
from app.models import InstrumentType, OptionType, TradeEvent, TradeAction, Instrument
from app.models.user import User
from app.services import position_engine
from app.services.portfolio_resolver import resolve_portfolio_ids
from app.services.yfinance_client import (
    get_price_history,
    get_spot_cached_only,
    nearest_business_day_back,
)

router = APIRouter(tags=["portfolio"])


def _ffill(sorted_dates: list[str], raw: dict[str, float]) -> dict[str, float]:
    """Forward-fill missing dates using the last known price."""
    result: dict[str, float] = {}
    last: float | None = None
    for d in sorted_dates:
        if d in raw:
            last = raw[d]
        if last is not None:
            result[d] = last
    return result


def _empty_pnl_response(days: int) -> dict:
    """Return an empty series when no positions exist."""
    return {
        "series": [],
        "start_nlv": "0.00",
        "end_nlv": "0.00",
        "return_pct": "0.00",
        "days": 0,
        "debug_info": {"tickers_ok": [], "tickers_failed": [], "tickers_proxy": []},
    }


async def _compute_realized_pnl_events(
    db: AsyncSession, pids: set[int],
) -> list[tuple[str, Decimal]]:
    """
    Replay ALL trade events to compute realized PnL from closing trades.

    Uses the same cost basis logic as position_engine (weighted average of
    opening trades), then computes realized PnL = (close_price - avg_cost)
    × close_qty × multiplier for each closing trade.

    Returns list of (date_str, realized_pnl_amount) sorted by date.
    """
    result = await db.execute(
        select(TradeEvent)
        .options(selectinload(TradeEvent.instrument))
        .where(TradeEvent.portfolio_id.in_(pids))
        .order_by(TradeEvent.trade_date.asc())
    )
    trades = result.scalars().all()

    # Per-instrument running state: avg_cost, net_qty
    # Mirrors position_engine's cost basis computation
    state: dict[int, dict] = {}
    events: list[tuple[str, Decimal]] = []

    for trade in trades:
        iid = trade.instrument_id
        if iid not in state:
            state[iid] = {
                "net_qty": 0,
                "open_qty": Decimal("0"),
                "open_price_sum": Decimal("0"),
                "multiplier": trade.instrument.multiplier if trade.instrument else 1,
            }

        s = state[iid]
        multiplier = Decimal(str(s["multiplier"]))
        trade_price = trade.price
        trade_qty = trade.quantity

        is_open = trade.action in (TradeAction.BUY_OPEN, TradeAction.SELL_OPEN)
        is_close = trade.action in (TradeAction.BUY_CLOSE, TradeAction.SELL_CLOSE)

        if is_open:
            # Update cost basis (same logic as position_engine)
            s["open_qty"] += Decimal(str(trade_qty))
            s["open_price_sum"] += trade_price * Decimal(str(trade_qty))

            # Update net qty
            if trade.action == TradeAction.BUY_OPEN:
                s["net_qty"] += trade_qty
            else:  # SELL_OPEN
                s["net_qty"] -= trade_qty

        elif is_close:
            # Compute avg cost at this point
            avg_cost = (
                s["open_price_sum"] / s["open_qty"]
                if s["open_qty"] > Decimal("0")
                else Decimal("0")
            )

            # Realized PnL for this close
            close_qty_d = Decimal(str(trade_qty))
            if trade.action == TradeAction.SELL_CLOSE:
                # Closing a long: profit = (sell_price - avg_cost) × qty × mult
                realized = (trade_price - avg_cost) * close_qty_d * multiplier
                s["net_qty"] -= trade_qty
            else:  # BUY_CLOSE
                # Closing a short: profit = (avg_cost - buy_price) × qty × mult
                realized = (avg_cost - trade_price) * close_qty_d * multiplier
                s["net_qty"] += trade_qty

            # Record the event with its date
            td = trade.trade_date
            if td.tzinfo:
                td = td.replace(tzinfo=None)
            d_str = td.date().isoformat() if hasattr(td, "date") else str(td)[:10]
            events.append((d_str, realized))

    events.sort(key=lambda x: x[0])
    return events


@router.get("/portfolio/history")
async def get_portfolio_history(
    portfolio_id: int | None = Query(None),
    days: int = Query(30, ge=5, le=365),
    user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_db),
):
    """
    Daily portfolio PnL history for the past N days.

    PnL = unrealized (from active positions) + realized (from closed positions).
    No capital injection — adding a position does NOT create a step jump.

    Returns:
      series:      [{date, nlv}] ascending  (field kept as "nlv" for frontend compat)
      start_nlv:   first point PnL
      end_nlv:     last point PnL
      return_pct:  "0.00" (not meaningful for PnL series)
      days:        actual days returned
      debug_info:  {tickers_ok, tickers_failed, tickers_proxy}
    """
    # 1. Resolve portfolio hierarchy + get active positions
    pids = await resolve_portfolio_ids(db, user.id, portfolio_id)
    positions = await position_engine.calculate_positions(db, portfolio_ids=pids)

    # 2. Compute realized PnL events (from ALL historical close trades)
    realized_events = await _compute_realized_pnl_events(db, pids)

    if not positions and not realized_events:
        return _empty_pnl_response(days)

    # 3. Separate stock and option positions with lifecycle data.
    #    Each carries entry_date and entry_price (avg_open_price).
    # stock_positions: (sym, net_contracts, entry_date_str, avg_open_price, multiplier)
    stock_positions: list[tuple[str, int, str, Decimal, int]] = []
    # option_legs: (sym, strike, opt_type, net_contracts, multiplier, entry_date_str, avg_open_price)
    option_legs: list[tuple[str, Decimal, OptionType, int, int, str, Decimal]] = []
    all_syms: set[str] = set()

    for pos in positions:
        if pos.instrument is None:
            continue
        sym = pos.instrument.symbol.upper()
        itype = pos.instrument.instrument_type
        otype = pos.instrument.option_type

        # Entry date from first_trade_date (timezone-aware datetime → date string)
        ftd = pos.first_trade_date
        if ftd.tzinfo:
            ftd = ftd.replace(tzinfo=None)
        entry_date_str = ftd.date().isoformat() if hasattr(ftd, "date") else str(ftd)[:10]

        if itype == InstrumentType.STOCK or otype is None:
            stock_positions.append((
                sym, pos.net_contracts, entry_date_str,
                pos.avg_open_price, pos.instrument.multiplier,
            ))
            all_syms.add(sym)
        else:
            all_syms.add(sym)
            option_legs.append((
                sym,
                Decimal(str(pos.instrument.strike)),
                otype,
                pos.net_contracts,
                pos.instrument.multiplier,
                entry_date_str,
                pos.avg_open_price,
            ))

    # 4. Fetch historical EOD closes for all underlying symbols.
    buffer_days = max(days + 20, 30)
    raw_start = date.today() - timedelta(days=buffer_days)
    start_date = nearest_business_day_back(raw_start).isoformat()

    sym_list = sorted(all_syms)

    if sym_list:
        histories_raw = await asyncio.gather(
            *[get_price_history(sym, start_date) for sym in sym_list],
            return_exceptions=True,
        )
    else:
        histories_raw = []

    # Classify each symbol: ok / proxy / failed
    tickers_ok:     list[str] = []
    tickers_proxy:  list[str] = []
    tickers_failed: list[str] = []
    price_histories: dict[str, dict[str, float]] = {}

    for sym, hist in zip(sym_list, histories_raw):
        key = sym.upper()
        if isinstance(hist, Exception) or not hist:
            spot_fallback = get_spot_cached_only(key)
            if spot_fallback is not None:
                today_str = date.today().isoformat()
                price_histories[key] = {today_str: float(spot_fallback)}
                tickers_proxy.append(key)
            else:
                price_histories[key] = {}
                tickers_failed.append(key)
        else:
            price_histories[key] = hist
            tickers_ok.append(key)

    # 5. Build union timeline.
    #    Include dates from price histories AND realized PnL events.
    date_sets: list[set[str]] = [set(h.keys()) for h in price_histories.values() if h]
    if realized_events:
        date_sets.append({e[0] for e in realized_events})

    if not date_sets:
        return _empty_pnl_response(days)

    all_dates = sorted(set().union(*date_sets))[-days:]

    # 6. Forward-fill each symbol over the full timeline.
    filled: dict[str, dict[str, float]] = {
        sym: _ffill(all_dates, price_histories.get(sym.upper(), {}))
        for sym in all_syms
    }

    # 7. Build cumulative realized PnL per date (forward-filled).
    cumulative_realized: dict[str, Decimal] = {}
    cum = Decimal("0")
    realized_by_date: dict[str, Decimal] = {}
    for d_str, amount in realized_events:
        realized_by_date[d_str] = realized_by_date.get(d_str, Decimal("0")) + amount
    for d_str in all_dates:
        if d_str in realized_by_date:
            cum += realized_by_date[d_str]
        cumulative_realized[d_str] = cum

    # 8. Compute daily PnL — lifecycle-aware.
    #    PnL = Σ unrealized(active positions) + cumulative realized(closed positions)
    series = []
    for d_str in all_dates:
        pnl = cumulative_realized.get(d_str, Decimal("0"))

        # Stock / ETF unrealized PnL — gated by entry date
        for sym, qty, entry_date, avg_cost, mult in stock_positions:
            if d_str < entry_date:
                continue  # not yet opened
            price = filled.get(sym.upper(), {}).get(d_str)
            if price is not None:
                # PnL = (current_price - entry_price) × qty × multiplier
                pnl += (Decimal(str(price)) - avg_cost) * qty * mult

        # Option unrealized PnL — gated by entry date
        for (underlying_sym, strike, opt_type, net_contracts,
             multiplier, entry_date, avg_cost) in option_legs:
            if d_str < entry_date:
                continue  # not yet opened
            price = filled.get(underlying_sym.upper(), {}).get(d_str)
            if price is None:
                continue
            spot = Decimal(str(price))
            if str(opt_type).upper() in ("CALL", "OPTIONTYPE.CALL"):
                intrinsic = max(Decimal("0"), spot - strike)
            else:  # PUT
                intrinsic = max(Decimal("0"), strike - spot)
            # PnL = (current_value_per_share - entry_premium) × qty × multiplier
            pnl += (intrinsic - avg_cost) * net_contracts * multiplier

        series.append({
            "date": d_str,
            "nlv": str(pnl.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        })

    if not series:
        return _empty_pnl_response(days)

    start_pnl = Decimal(series[0]["nlv"])
    end_pnl   = Decimal(series[-1]["nlv"])

    return {
        "series":    series,
        "start_nlv": str(start_pnl),
        "end_nlv":   str(end_pnl),
        "return_pct": "0.00",
        "days":      len(series),
        "debug_info": {
            "tickers_ok":     tickers_ok,
            "tickers_proxy":  tickers_proxy,
            "tickers_failed": tickers_failed,
        },
    }
