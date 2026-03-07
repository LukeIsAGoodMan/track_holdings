"""
GET /api/portfolio/history?portfolio_id=N&days=30

Returns a daily NLV time series for the current portfolio holdings
over the past N days, using historical EOD prices from FMP.

Logic:
  1. Fetch current active positions from DB
  2. Stock positions: use historical EOD closes directly.
     Option positions: fetch the underlying symbol's historical EOD closes
     and compute simplified intrinsic value =
       CALL: max(0, spot - strike) × |contracts| × multiplier
       PUT:  max(0, strike - spot) × |contracts| × multiplier
     (multiplied by net_contracts sign so shorts are negative)
  3. Align on the UNION of all available trading dates, take last `days`.
     Missing prices are forward-filled (ffill) from the last known value.
  4. NLV[date] = cash_balance + Σ(historical_value per position)
  5. If no positions at all, return a flat cash-balance line.
  6. Return series sorted ascending, plus start/end NLV and return_pct.
"""
from __future__ import annotations

import asyncio
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user_flexible
from app.models import InstrumentType, OptionType
from app.models.cash_ledger import CashLedger
from app.models.user import User
from app.services import position_engine
from app.services.portfolio_resolver import resolve_portfolio_ids
from app.services.yfinance_client import get_price_history

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


def _flat_cash_response(cash_balance: Decimal, days: int) -> dict:
    """Return a flat cash-only line when no holdings exist."""
    today = date.today()
    nlv_str = str(cash_balance.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    series = [
        {"date": (today - timedelta(days=days - 1 - i)).isoformat(), "nlv": nlv_str}
        for i in range(days)
    ]
    return {
        "series": series,
        "start_nlv": nlv_str,
        "end_nlv": nlv_str,
        "return_pct": "0.00",
        "days": days,
    }


@router.get("/portfolio/history")
async def get_portfolio_history(
    portfolio_id: int | None = Query(None),
    days: int = Query(30, ge=5, le=365),
    user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_db),
):
    """
    Daily portfolio NLV history for the past N days using current holdings
    applied to historical EOD prices.

    Returns:
      series:     [{date, nlv}] ascending
      start_nlv:  first point NLV
      end_nlv:    last point NLV
      return_pct: percentage gain/loss over the period
      days:       actual days returned
    """
    # 1. Resolve portfolio hierarchy + get positions + cash
    pids = await resolve_portfolio_ids(db, user.id, portfolio_id)

    cash_result = await db.execute(
        select(func.coalesce(func.sum(CashLedger.amount), 0))
        .where(CashLedger.portfolio_id.in_(pids))
    )
    cash_balance = Decimal(str(cash_result.scalar_one()))

    positions = await position_engine.calculate_positions(db, portfolio_ids=pids)

    if not positions:
        return _flat_cash_response(cash_balance, days)

    # 2. Separate stock and option positions; gather all underlying symbols to fetch
    #    All symbol keys are normalised to UPPER CASE throughout.
    stock_sym_qty: dict[str, int] = {}   # sym -> net_contracts
    # (underlying_sym, strike, option_type, net_contracts, multiplier)
    option_legs: list[tuple[str, Decimal, OptionType, int, int]] = []
    all_syms: set[str] = set()

    for pos in positions:
        if pos.instrument is None:
            continue
        sym = pos.instrument.symbol.upper()
        itype = pos.instrument.instrument_type
        otype = pos.instrument.option_type

        if itype == InstrumentType.STOCK or otype is None:
            stock_sym_qty[sym] = stock_sym_qty.get(sym, 0) + pos.net_contracts
            all_syms.add(sym)
        else:
            # Option — fetch the underlying's price history for intrinsic value
            all_syms.add(sym)
            option_legs.append((
                sym,
                Decimal(str(pos.instrument.strike)),
                otype,
                pos.net_contracts,
                pos.instrument.multiplier,
            ))

    # 3. Fetch historical EOD closes (buffer +15 days for weekends/holidays)
    start_date = (date.today() - timedelta(days=days + 15)).isoformat()
    sym_list = sorted(all_syms)

    histories = await asyncio.gather(
        *[get_price_history(sym, start_date) for sym in sym_list],
        return_exceptions=True,
    )

    # Build price_histories with UPPER-CASE keys (fix symbol mismatch)
    price_histories: dict[str, dict[str, float]] = {}
    for sym, hist in zip(sym_list, histories):
        key = sym.upper()
        if isinstance(hist, Exception) or not hist:
            price_histories[key] = {}
        else:
            price_histories[key] = hist   # date keys already strings

    # 4. UNION of available trading dates (not intersection) → take last `days`
    date_sets = [set(h.keys()) for h in price_histories.values() if h]
    if date_sets:
        all_dates = sorted(set().union(*date_sets))[-days:]
    else:
        # No price data at all — fall back to cash flat line
        return _flat_cash_response(cash_balance, days)

    # 5. Forward-fill each symbol over the full union timeline
    filled: dict[str, dict[str, float]] = {
        sym: _ffill(all_dates, price_histories.get(sym, {}))
        for sym in all_syms
    }

    # 6. Compute daily NLV
    series = []
    for d_str in all_dates:
        nlv = cash_balance

        # Stock / ETF contributions
        for sym, qty in stock_sym_qty.items():
            price = filled.get(sym.upper(), {}).get(d_str)
            if price is not None:
                nlv += Decimal(str(price)) * qty

        # Option intrinsic-value contributions (simplified — no time value)
        for (underlying_sym, strike, opt_type, net_contracts, multiplier) in option_legs:
            price = filled.get(underlying_sym.upper(), {}).get(d_str)
            if price is None:
                continue
            spot = Decimal(str(price))
            if str(opt_type).upper() in ("CALL", "OPTIONTYPE.CALL"):
                intrinsic = max(Decimal("0"), spot - strike)
            else:  # PUT
                intrinsic = max(Decimal("0"), strike - spot)
            nlv += intrinsic * net_contracts * multiplier

        series.append({
            "date": d_str,
            "nlv": str(nlv.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        })

    if not series:
        return _flat_cash_response(cash_balance, days)

    start_nlv = Decimal(series[0]["nlv"])
    end_nlv = Decimal(series[-1]["nlv"])

    if start_nlv != 0:
        return_pct = ((end_nlv - start_nlv) / abs(start_nlv) * 100).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
    else:
        return_pct = Decimal("0.00")

    return {
        "series": series,
        "start_nlv": str(start_nlv),
        "end_nlv": str(end_nlv),
        "return_pct": str(return_pct),
        "days": len(series),
    }
