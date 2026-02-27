"""
yfinance async wrapper.
All yfinance calls are synchronous; wrapped in asyncio.to_thread.
Pattern mirrored from stocksage/backend/app/data/yfinance_client.py.
"""
from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal

import yfinance as yf

from app.services.black_scholes import compute_historical_vol, DEFAULT_SIGMA


def _fetch_spot(ticker: str) -> Decimal | None:
    try:
        price = yf.Ticker(ticker.upper()).fast_info.last_price
        if price and float(price) > 0:
            return Decimal(str(round(float(price), 4)))
    except Exception:
        pass
    return None


def _fetch_hist_vol(ticker: str) -> Decimal:
    try:
        df = yf.Ticker(ticker.upper()).history(
            period="1mo", interval="1d", auto_adjust=True
        )
        if df.empty or len(df) < 5:
            return DEFAULT_SIGMA
        return compute_historical_vol([float(c) for c in df["Close"].dropna()])
    except Exception:
        return DEFAULT_SIGMA


def _fetch_ytd_return(ticker: str) -> Decimal | None:
    """
    Return year-to-date price return as a fraction.
    e.g. +0.052 = +5.2% YTD.  Returns None on failure.
    """
    try:
        today   = date.today()
        jan1    = date(today.year, 1, 1)
        t       = yf.Ticker(ticker.upper())
        hist    = t.history(
            start=jan1.strftime("%Y-%m-%d"),
            interval="1d",
            auto_adjust=True,
        )
        closes = hist["Close"].dropna()
        if len(closes) < 2:
            return None
        start_price   = float(closes.iloc[0])
        current_price = float(closes.iloc[-1])
        if start_price <= 0:
            return None
        return Decimal(str(round((current_price - start_price) / start_price, 6)))
    except Exception:
        return None


async def get_spot_price(ticker: str) -> Decimal | None:
    return await asyncio.to_thread(_fetch_spot, ticker)


async def get_hist_vol(ticker: str) -> Decimal:
    return await asyncio.to_thread(_fetch_hist_vol, ticker)


async def get_ytd_return(ticker: str) -> Decimal | None:
    """Async wrapper around _fetch_ytd_return."""
    return await asyncio.to_thread(_fetch_ytd_return, ticker)


def _fetch_price_history(ticker: str, start_date: str) -> dict[str, float]:
    """
    Return {date_str: closing_price} for ticker from start_date to today.
    Used by the /api/risk/history endpoint for benchmark normalization.
    Returns empty dict on any failure.
    """
    try:
        t    = yf.Ticker(ticker.upper())
        hist = t.history(start=start_date, interval="1d", auto_adjust=True)
        if hist.empty:
            return {}
        result: dict[str, float] = {}
        for idx, row in hist.iterrows():
            result[idx.strftime("%Y-%m-%d")] = float(row["Close"])
        return result
    except Exception:
        return {}


async def get_price_history(ticker: str, start_date: str) -> dict[str, float]:
    """Async wrapper around _fetch_price_history."""
    return await asyncio.to_thread(_fetch_price_history, ticker, start_date)
