"""
GET /api/portfolio/history?portfolio_id=N&days=30

Returns a daily NLV time series for the current portfolio holdings
over the past N days, using historical EOD prices from FMP.

Logic:
  1. Fetch current active positions from DB
  2. For each symbol, fetch historical EOD closes via get_price_history()
  3. Align all symbols on a common set of dates (last `days` market days)
  4. NLV[date] = cash_balance + Σ(close[sym][date] × qty[sym])
     (options not included — their historical price model is unreliable;
      only stocks/ETF legs are included)
  5. Return series sorted ascending, plus start/end NLV and return_pct
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user_flexible
from app.models.cash_ledger import CashLedger
from app.models.user import User
from app.services import position_engine
from app.services.portfolio_resolver import resolve_portfolio_ids
from app.services.yfinance_client import get_price_history

router = APIRouter(tags=["portfolio"])


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
        return {"series": [], "start_nlv": None, "end_nlv": None, "return_pct": None, "days": 0}

    # 2. Collect stock positions only (options excluded — BS pricing unreliable historically)
    from app.models import InstrumentType
    stock_positions = [
        pos for pos in positions
        if pos.instrument is not None
        and (pos.instrument.instrument_type == InstrumentType.STOCK
             or pos.instrument.option_type is None)
    ]

    if not stock_positions:
        return {"series": [], "start_nlv": None, "end_nlv": None, "return_pct": None, "days": 0}

    # Build {symbol -> net_qty} map
    sym_qty: dict[str, int] = {}
    for pos in stock_positions:
        sym = pos.instrument.symbol
        sym_qty[sym] = sym_qty.get(sym, 0) + pos.net_contracts

    # 3. Fetch historical EOD closes — start from `days + 10` days ago (buffer for weekends)
    start_date = (date.today() - timedelta(days=days + 15)).isoformat()

    import asyncio
    histories = await asyncio.gather(
        *[get_price_history(sym, start_date) for sym in sym_qty],
        return_exceptions=True,
    )

    # Build {sym -> {date_str: float}}
    price_histories: dict[str, dict[str, float]] = {}
    for sym, hist in zip(sym_qty.keys(), histories):
        if isinstance(hist, Exception) or not hist:
            price_histories[sym] = {}
        else:
            price_histories[sym] = hist

    # 4. Find intersection of available dates across all symbols, take last `days`
    date_sets = [set(h.keys()) for h in price_histories.values() if h]
    if not date_sets:
        return {"series": [], "start_nlv": None, "end_nlv": None, "return_pct": None, "days": 0}

    common_dates = sorted(date_sets[0].intersection(*date_sets[1:]))[-days:]

    if not common_dates:
        return {"series": [], "start_nlv": None, "end_nlv": None, "return_pct": None, "days": 0}

    # 5. Compute daily NLV
    series = []
    for d_str in common_dates:
        nlv = cash_balance
        for sym, qty in sym_qty.items():
            hist = price_histories.get(sym, {})
            price = hist.get(d_str)
            if price is not None:
                nlv += Decimal(str(price)) * qty
        series.append({
            "date": d_str,
            "nlv": str(nlv.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        })

    if not series:
        return {"series": [], "start_nlv": None, "end_nlv": None, "return_pct": None, "days": 0}

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
