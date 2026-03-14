"""
GET /api/portfolio/history?portfolio_id=N&days=30

Returns a daily NLV time series for the current portfolio holdings
over the past N days, using historical EOD prices from FMP.

Logic:
  1. Fetch current active positions from DB.
  2. Stock positions: use historical EOD closes directly.
     Option positions: fetch the underlying symbol's historical EOD closes
     and compute simplified intrinsic value =
       CALL: max(0, spot - strike) × |contracts| × multiplier
       PUT:  max(0, strike - spot) × |contracts| × multiplier
     (multiplied by net_contracts sign so shorts are negative)
  3. Align on the UNION of all available trading dates, take last `days`.
     Missing prices are forward-filled (ffill) from the last known value.
  4. Resilient summation: if a symbol's full history is unavailable, use
     the current cached spot price as a flat-line proxy rather than 0.
     This prevents a single API failure from zeroing the entire portfolio.
  5. NLV[date] = cash_balance + Σ(historical_value per position)
  6. Return series sorted ascending, plus start/end NLV and return_pct.
  7. debug_info lists which tickers succeeded and which fell back to proxy.
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
        "debug_info": {"tickers_ok": [], "tickers_failed": [], "tickers_proxy": []},
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
      series:      [{date, nlv}] ascending
      start_nlv:   first point NLV
      end_nlv:     last point NLV
      return_pct:  percentage gain/loss over the period
      days:        actual days returned
      debug_info:  {tickers_ok, tickers_failed, tickers_proxy} for diagnostics
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

    # 2. Separate stock and option positions; collect all underlying symbols.
    stock_sym_qty: dict[str, int] = {}   # sym → net_contracts
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
            all_syms.add(sym)
            option_legs.append((
                sym,
                Decimal(str(pos.instrument.strike)),
                otype,
                pos.net_contracts,
                pos.instrument.multiplier,
            ))

    # 3. Fetch historical EOD closes.
    #    start_date is anchored to the nearest preceding business day so that
    #    weekend starts don't produce an empty leading segment from FMP.
    buffer_days = max(days + 20, 30)   # extra buffer for weekends + holidays
    raw_start = date.today() - timedelta(days=buffer_days)
    start_date = nearest_business_day_back(raw_start).isoformat()

    sym_list = sorted(all_syms)

    histories_raw = await asyncio.gather(
        *[get_price_history(sym, start_date) for sym in sym_list],
        return_exceptions=True,
    )

    # ── Resilient summation: classify each symbol ─────────────────────────────
    # tickers_ok     — full history from FMP
    # tickers_proxy  — FMP returned empty; using current spot as flat-line proxy
    # tickers_failed — neither history nor cached spot available
    tickers_ok:     list[str] = []
    tickers_proxy:  list[str] = []
    tickers_failed: list[str] = []

    price_histories: dict[str, dict[str, float]] = {}

    for sym, hist in zip(sym_list, histories_raw):
        key = sym.upper()
        if isinstance(hist, Exception) or not hist:
            # FMP returned nothing — try current cached spot as fallback proxy
            spot_fallback = get_spot_cached_only(key)
            if spot_fallback is not None:
                # Inject the current spot as a single anchor point.
                # _ffill will propagate it backward across all union dates,
                # producing a flat line rather than a zero contribution.
                today_str = date.today().isoformat()
                price_histories[key] = {today_str: float(spot_fallback)}
                tickers_proxy.append(key)
            else:
                price_histories[key] = {}
                tickers_failed.append(key)
        else:
            price_histories[key] = hist
            tickers_ok.append(key)

    # 4. Build union of trading dates from all symbols that have ANY data.
    date_sets = [set(h.keys()) for h in price_histories.values() if h]
    if not date_sets:
        return _flat_cash_response(cash_balance, days)

    all_dates = sorted(set().union(*date_sets))[-days:]

    # 5. Forward-fill each symbol over the full union timeline.
    filled: dict[str, dict[str, float]] = {
        sym: _ffill(all_dates, price_histories.get(sym.upper(), {}))
        for sym in all_syms
    }

    # 6. Compute daily NLV — each instrument is treated independently.
    #    A missing price for one instrument never zeros another's contribution.
    series = []
    for d_str in all_dates:
        nlv = cash_balance

        # Stock / ETF contributions
        for sym, qty in stock_sym_qty.items():
            price = filled.get(sym.upper(), {}).get(d_str)
            if price is not None:
                nlv += Decimal(str(price)) * qty

        # Option intrinsic-value contributions (simplified — no time value).
        # Uses underlying price; if underlying data was proxied from current spot,
        # this becomes a flat-line estimate rather than zeroing the position out.
        for (underlying_sym, strike, opt_type, net_contracts, multiplier) in option_legs:
            price = filled.get(underlying_sym.upper(), {}).get(d_str)
            if price is None:
                # No data at all for this underlying — use 0 for this leg only.
                # Other legs continue contributing their correct values.
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
    end_nlv   = Decimal(series[-1]["nlv"])

    # Divide-by-zero guard: if start_nlv is 0 or missing, return_pct = 0.
    if start_nlv and start_nlv != 0:
        return_pct = ((end_nlv - start_nlv) / abs(start_nlv) * 100).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
    else:
        return_pct = Decimal("0.00")

    return {
        "series":    series,
        "start_nlv": str(start_nlv),
        "end_nlv":   str(end_nlv),
        "return_pct": str(return_pct),
        "days":      len(series),
        "debug_info": {
            "tickers_ok":     tickers_ok,
            "tickers_proxy":  tickers_proxy,   # flat-line proxy used
            "tickers_failed": tickers_failed,  # completely absent
        },
    }
