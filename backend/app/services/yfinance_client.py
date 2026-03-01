"""
yfinance async wrapper.
All yfinance calls are synchronous; wrapped in asyncio.to_thread.
Pattern mirrored from stocksage/backend/app/data/yfinance_client.py.
"""
from __future__ import annotations

import asyncio
from datetime import date
from decimal import Decimal

import requests
import yfinance as yf

from app.services.black_scholes import compute_historical_vol, DEFAULT_SIGMA

# ── Custom session with User-Agent to avoid Yahoo Finance 403 blocks ─────
_session = requests.Session()
_session.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
})


def _ticker(sym: str) -> yf.Ticker:
    """Create a yf.Ticker with our custom session attached."""
    t = yf.Ticker(sym.upper())
    t.session = _session
    return t


def _fetch_spot(ticker: str) -> Decimal | None:
    try:
        price = _ticker(ticker).fast_info.last_price
        if price and float(price) > 0:
            return Decimal(str(round(float(price), 4)))
    except Exception:
        pass
    return None


def _fetch_hist_vol(ticker: str) -> Decimal:
    try:
        df = _ticker(ticker).history(
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
        t       = _ticker(ticker)
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
        t    = _ticker(ticker)
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


# ── Batch fetch (for PriceFeedService) ────────────────────────────────────

def _fetch_spots_batch(tickers: list[str]) -> dict[str, Decimal]:
    """
    Fetch latest prices for multiple tickers in a single yf.download() call.
    Returns {symbol: Decimal_price} for successfully fetched symbols.
    Much more efficient than N individual Ticker().fast_info calls.
    """
    if not tickers:
        return {}
    try:
        upper = [t.upper() for t in tickers]
        df = yf.download(upper, period="1d", interval="1m", progress=False, session=_session)
        if df.empty:
            return {}

        result: dict[str, Decimal] = {}
        if len(upper) == 1:
            # yf.download returns flat columns for single ticker
            sym = upper[0]
            if "Close" in df.columns and len(df) > 0:
                last = float(df["Close"].iloc[-1])
                if last > 0:
                    result[sym] = Decimal(str(round(last, 4)))
        else:
            # Multi-ticker: MultiIndex columns (metric, ticker)
            if "Close" in df.columns:
                last_row = df["Close"].iloc[-1]
                for sym in upper:
                    try:
                        val = float(last_row[sym])
                        if val > 0:
                            result[sym] = Decimal(str(round(val, 4)))
                    except (KeyError, TypeError, ValueError):
                        pass
        return result
    except Exception:
        return {}


async def get_spot_prices_batch(tickers: list[str]) -> dict[str, Decimal]:
    """Async wrapper: fetch multiple spot prices in one yfinance call."""
    return await asyncio.to_thread(_fetch_spots_batch, tickers)


# ── 1-year daily closes (for MarketScannerService IV Rank) ────────────────

def _fetch_1y_closes(ticker: str) -> list[float]:
    """
    Fetch 1 year of daily closing prices for IV rank computation.
    Returns empty list on any failure.
    """
    try:
        df = _ticker(ticker).history(
            period="1y", interval="1d", auto_adjust=True
        )
        if df.empty:
            return []
        return [float(c) for c in df["Close"].dropna().tolist()]
    except Exception:
        return []


async def get_1y_closes(ticker: str) -> list[float]:
    """Async wrapper around _fetch_1y_closes."""
    return await asyncio.to_thread(_fetch_1y_closes, ticker)
