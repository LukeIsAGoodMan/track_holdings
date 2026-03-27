"""
GET /api/portfolio/history?portfolio_id=N&days=30

Returns a daily Portfolio PnL time series.

Accounting Methodology: Weighted-Average Cost Basis.

PnL = Σ unrealized_pnl_i[t] + cumulative_realized_pnl[t]

Where:
  unrealized_pnl_i[t] = (price[t] - entry_price_i) × qty_i × multiplier_i
  - Gated by first_trade_date: contribution = 0 before entry
  - entry_price = actual execution price (avg_open_price, weighted-average)
  - At entry: PnL ≈ 0 (no step jump from capital deployment)

  realized_pnl = frozen contribution from closed positions
  - Computed by replaying trade events with weighted-average cost basis
  - Persists as constant offset after close date

Option Valuation Note:
  Historical option PnL uses Intrinsic Value as a mark-to-market proxy:
    CALL intrinsic = max(0, spot - strike)
    PUT  intrinsic = max(0, strike - spot)
  This excludes extrinsic value components (Time Value, Implied Volatility)
  and is treated as a financial approximation for historical series generation.
  If a mark_price history is available in the future, it should be prioritized
  over intrinsic value.

Economic Start Date:
  The series begins at the EARLIEST of:
    - first opening trade date across all active positions
    - first realized PnL event date
  No synthetic zero-fill before the portfolio's first economic activity.
  series_start_date = max(economic_start_date, lookback_start_date)

Key properties:
  - No principal injection (position notional never enters the series)
  - No step jumps when new positions are added
  - PnL starts at ~0 for newly opened positions
  - Closed positions' PnL persists in the historical series
  - No flat zero line before first activity
  - Continuous across option expiry → realized PnL transitions
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


def _empty_pnl_response() -> dict:
    """Return an empty series when no economic activity exists."""
    return {
        "series": [],
        "start_pnl": "0.00",
        "end_pnl": "0.00",
        "return_pct": "0.00",
        "days": 0,
        "debug_info": {"tickers_ok": [], "tickers_failed": [], "tickers_proxy": []},
    }


async def _compute_realized_pnl_events(
    db: AsyncSession, pids: set[int],
) -> list[tuple[str, Decimal]]:
    """
    Replay ALL trade events to compute realized PnL from closing trades.

    Accounting Methodology: Weighted-Average Cost Basis.
    Uses the same cost basis logic as position_engine (weighted average of
    opening trades), then computes realized PnL = (close_price - avg_cost)
    × close_qty × multiplier for each closing trade.

    This correctly handles option expiry / assignment transitions: when an
    option position is closed (expired/assigned), its realized PnL is frozen
    as a constant contribution from that date forward, ensuring no series
    discontinuity at the transition point.

    Returns list of (date_str, realized_pnl_amount) sorted by date.
    """
    result = await db.execute(
        select(TradeEvent)
        .options(selectinload(TradeEvent.instrument))
        .where(TradeEvent.portfolio_id.in_(pids))
        .order_by(TradeEvent.trade_date.asc())
    )
    trades = result.scalars().all()

    # Per-instrument running state: weighted-average cost, net_qty
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
            # Update weighted-average cost basis
            s["open_qty"] += Decimal(str(trade_qty))
            s["open_price_sum"] += trade_price * Decimal(str(trade_qty))

            if trade.action == TradeAction.BUY_OPEN:
                s["net_qty"] += trade_qty
            else:  # SELL_OPEN
                s["net_qty"] -= trade_qty

        elif is_close:
            # Weighted-average cost at this point
            avg_cost = (
                s["open_price_sum"] / s["open_qty"]
                if s["open_qty"] > Decimal("0")
                else Decimal("0")
            )

            close_qty_d = Decimal(str(trade_qty))
            if trade.action == TradeAction.SELL_CLOSE:
                realized = (trade_price - avg_cost) * close_qty_d * multiplier
                s["net_qty"] -= trade_qty
            else:  # BUY_CLOSE
                realized = (avg_cost - trade_price) * close_qty_d * multiplier
                s["net_qty"] += trade_qty

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
    Daily portfolio PnL history with Economic Start Date trimming.

    The series begins at the portfolio's first economic activity (earliest
    trade or realized PnL event), not at a fixed lookback anchor. This
    prevents flat zero lines before the portfolio existed.

    Returns:
      series:      [{date, pnl}] ascending
      start_pnl:   first point PnL
      end_pnl:     last point PnL
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
        return _empty_pnl_response()

    # 3. Separate stock and option positions with lifecycle data.
    #    Each carries entry_date and entry_price (weighted-average cost).
    stock_positions: list[tuple[str, int, str, Decimal, int]] = []
    option_legs: list[tuple[str, Decimal, OptionType, int, int, str, Decimal]] = []
    all_syms: set[str] = set()
    entry_dates: list[str] = []  # collect all entry dates for economic start

    for pos in positions:
        if pos.instrument is None:
            continue
        sym = pos.instrument.symbol.upper()
        itype = pos.instrument.instrument_type
        otype = pos.instrument.option_type

        # Entry date from first_trade_date (timezone-aware → date string)
        ftd = pos.first_trade_date
        if ftd.tzinfo:
            ftd = ftd.replace(tzinfo=None)
        entry_date_str = ftd.date().isoformat() if hasattr(ftd, "date") else str(ftd)[:10]
        entry_dates.append(entry_date_str)

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

    # 4. Determine Economic Start Date — earliest of:
    #    - first opening trade (entry_date) across all active positions
    #    - first realized PnL event date
    economic_start: str | None = None
    candidates: list[str] = list(entry_dates)
    if realized_events:
        candidates.append(realized_events[0][0])  # already sorted
    if candidates:
        economic_start = min(candidates)

    # 5. Fetch historical EOD closes for all underlying symbols.
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

    # 6. Build union timeline, then apply Economic Start Date trimming.
    date_sets: list[set[str]] = [set(h.keys()) for h in price_histories.values() if h]
    if realized_events:
        date_sets.append({e[0] for e in realized_events})

    if not date_sets:
        return _empty_pnl_response()

    all_dates_full = sorted(set().union(*date_sets))[-days:]

    # Apply economic start: series_start = max(economic_start, lookback_start)
    # This trims pre-activity dates without post-generation filtering.
    if economic_start:
        all_dates = [d for d in all_dates_full if d >= economic_start]
    else:
        all_dates = all_dates_full

    if not all_dates:
        return _empty_pnl_response()

    # 7. Forward-fill each symbol over the trimmed timeline.
    filled: dict[str, dict[str, float]] = {
        sym: _ffill(all_dates, price_histories.get(sym.upper(), {}))
        for sym in all_syms
    }

    # 8. Build cumulative realized PnL per date (forward-filled).
    #    Includes events before the visible window for correct cumulative base.
    cumulative_realized: dict[str, Decimal] = {}
    cum = Decimal("0")
    realized_by_date: dict[str, Decimal] = {}
    for d_str, amount in realized_events:
        realized_by_date[d_str] = realized_by_date.get(d_str, Decimal("0")) + amount

    # Pre-seed cumulative with events before window start
    window_start = all_dates[0]
    for d_str, amount in realized_events:
        if d_str < window_start:
            cum += amount
    # Then walk the visible window
    for d_str in all_dates:
        if d_str in realized_by_date:
            cum += realized_by_date[d_str]
        cumulative_realized[d_str] = cum

    # 9. Compute daily PnL — lifecycle-aware.
    #    PnL = Σ unrealized(active positions) + cumulative realized(closed positions)
    #
    #    Option Valuation: uses Intrinsic Value as mark-to-market proxy.
    #    See module docstring for approximation details.
    series = []
    for d_str in all_dates:
        pnl = cumulative_realized.get(d_str, Decimal("0"))

        # Stock / ETF unrealized PnL — gated by entry date
        for sym, qty, entry_date, avg_cost, mult in stock_positions:
            if d_str < entry_date:
                continue
            price = filled.get(sym.upper(), {}).get(d_str)
            if price is not None:
                pnl += (Decimal(str(price)) - avg_cost) * qty * mult

        # Option unrealized PnL — intrinsic value approximation, gated by entry date
        for (underlying_sym, strike, opt_type, net_contracts,
             multiplier, entry_date, avg_cost) in option_legs:
            if d_str < entry_date:
                continue
            price = filled.get(underlying_sym.upper(), {}).get(d_str)
            if price is None:
                continue
            spot = Decimal(str(price))
            if str(opt_type).upper() in ("CALL", "OPTIONTYPE.CALL"):
                intrinsic = max(Decimal("0"), spot - strike)
            else:  # PUT
                intrinsic = max(Decimal("0"), strike - spot)
            pnl += (intrinsic - avg_cost) * net_contracts * multiplier

        series.append({
            "date": d_str,
            "pnl": str(pnl.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        })

    if not series:
        return _empty_pnl_response()

    start_pnl = Decimal(series[0]["pnl"])
    end_pnl   = Decimal(series[-1]["pnl"])

    return {
        "series":    series,
        "start_pnl": str(start_pnl),
        "end_pnl":   str(end_pnl),
        "return_pct": "0.00",
        "days":      len(series),
        "debug_info": {
            "tickers_ok":     tickers_ok,
            "tickers_proxy":  tickers_proxy,
            "tickers_failed": tickers_failed,
        },
    }
