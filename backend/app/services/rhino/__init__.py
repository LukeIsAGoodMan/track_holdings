"""
Rhino Analysis Engine — async orchestrator.

Price basis: latest historical EOD close (not intraday quote).
All indicators, zones, valuation, and playbook use the same EOD snapshot.

Usage:
    from app.services.rhino import analyze
    result = await analyze("MSFT", lang="en")
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from .providers import get_quote, get_history, get_estimates, get_macro
from .technical_engine import build_technical
from .valuation_engine import build_valuation
from .macro_engine import build_macro
from .confidence_engine import build_confidence
from .playbook_engine import build_playbook
from .report import build_report

logger = logging.getLogger(__name__)


async def analyze(symbol: str, lang: str = "en") -> dict:
    """Run full Rhino analysis pipeline for a single symbol."""
    symbol = symbol.strip().upper()

    # Fetch all data in parallel
    quote, bars, estimates, raw_macro = await asyncio.gather(
        get_quote(symbol),
        get_history(symbol),
        get_estimates(symbol),
        get_macro(),
    )

    # ── Price basis: latest EOD close (not intraday quote) ────────────
    # All indicators, zones, valuation are computed from the same historical
    # snapshot. The quote is only used for supplementary display fields
    # (change, change_pct) — never as the primary analysis price.
    price = 0.0
    if bars:
        price = bars[-1]["close"]
    elif quote and quote.get("price"):
        # Fallback if history is empty but quote exists (rare)
        price = quote["price"]

    # Degraded result if no pricing data at all
    if price == 0:
        return _degraded(symbol, lang, raw_macro, estimates)

    # Run engines
    macro = build_macro(raw_macro)
    technical = build_technical(bars, price)
    valuation = build_valuation(estimates, price, macro["recommended_haircut_pct"])
    playbook = build_playbook(technical, valuation, macro["vix_regime"])

    # Data quality + confidence
    dq = {
        "has_quote": quote is not None,
        "has_history": len(bars) > 0,
        "history_days": len(bars),
        "has_estimates": estimates.get("fy1_eps_avg") is not None,
        "has_vix": raw_macro.get("vix") is not None,
        "has_treasury": raw_macro.get("us10y") is not None,
    }
    confidence = build_confidence(dq, technical, valuation)

    # Chart data
    sma200_series = _compute_sma200_series(bars)
    chart = {
        "candles": [
            {"date": b["date"], "open": b["open"], "high": b["high"],
             "low": b["low"], "close": b["close"], "volume": b["volume"]}
            for b in bars[-120:]
        ],
        "sma200": sma200_series,
        "support_zones": technical["support_zones"],
        "resistance_zones": technical["resistance_zones"],
    }

    # Build quote response with EOD price as basis, supplemented by
    # intraday change data from the quote (if available)
    analysis_quote = {
        "symbol": symbol,
        "price": price,  # EOD close — primary analysis price
        "previous_close": quote.get("previous_close") if quote else None,
        "change": quote.get("change") if quote else None,
        "change_pct": quote.get("change_pct") if quote else None,
        "volume": bars[-1]["volume"] if bars else None,
        "market_cap": quote.get("market_cap") if quote else None,
        "name": quote.get("name") if quote else None,
    }

    # Text report
    text = build_report(lang, {
        "symbol": symbol, "price": price, "quote": analysis_quote,
        "technical": technical, "valuation": valuation,
        "macro": macro, "playbook": playbook, "confidence": confidence,
    })

    return {
        "symbol": symbol,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "data_quality": dq,
        "confidence": confidence,
        "quote": analysis_quote,
        "technical": technical,
        "valuation": valuation,
        "macro": macro,
        "playbook": playbook,
        "text": text,
        "chart": chart,
    }


def _degraded(symbol: str, lang: str, raw_macro: dict, estimates: dict) -> dict:
    macro = build_macro(raw_macro)
    empty_tech = {
        "sma200": None, "avg_volume_50": None, "atr20": None,
        "today_volume": None, "volume_ratio": None,
        "support_zones": [], "resistance_zones": [], "pattern_tags": [],
    }
    empty_val = {
        "available": False, "fy1_eps_avg": estimates.get("fy1_eps_avg"),
        "fy2_eps_avg": estimates.get("fy2_eps_avg"),
        "eps_growth_pct": None, "raw_fair_value": None,
        "adjusted_fair_value": None, "status": "unavailable",
    }
    playbook = {"bias_tag": "neutral", "action_tag": "hold_watch",
                "rationale": ["No pricing data available"]}
    dq = {
        "has_quote": False, "has_history": False, "history_days": 0,
        "has_estimates": estimates.get("fy1_eps_avg") is not None,
        "has_vix": raw_macro.get("vix") is not None,
        "has_treasury": raw_macro.get("us10y") is not None,
    }
    confidence = {"score": 0, "grade": "D",
                  "reasons": ["No pricing data — quote and history both unavailable"]}
    text = build_report(lang, {
        "symbol": symbol, "price": 0, "quote": None,
        "technical": empty_tech, "valuation": empty_val,
        "macro": macro, "playbook": playbook, "confidence": confidence,
    })
    return {
        "symbol": symbol,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "data_quality": dq, "confidence": confidence, "quote": None,
        "technical": empty_tech, "valuation": empty_val,
        "macro": macro, "playbook": playbook, "text": text,
        "chart": {"candles": [], "sma200": [], "support_zones": [], "resistance_zones": []},
    }


def _compute_sma200_series(bars: list[dict]) -> list[dict]:
    if len(bars) < 200:
        return []
    result = []
    for i in range(199, len(bars)):
        avg = sum(b["close"] for b in bars[i - 199:i + 1]) / 200
        result.append({"date": bars[i]["date"], "value": round(avg, 2)})
    return result[-120:]  # match candle window
