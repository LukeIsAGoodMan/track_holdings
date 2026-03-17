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

from .providers import get_history, get_estimates, get_macro
from .technical_engine import build_technical
from .indicators import compute_sma_series_multi
from .valuation_engine import build_valuation
from .macro_engine import build_macro
from .confidence_engine import build_confidence
from .playbook_engine import build_playbook
from .semantic_engine import build_semantic_state
from .scenario_engine import build_scenario_state, NEUTRAL_SCENARIO
from .narrative_engine import build_rhino_narrative
from .briefing_engine import build_rhino_briefing
from .fundamental_narrative_engine import build_fundamental_narrative
from .rhino_report_engine import build_battle_report
from .report import build_report

logger = logging.getLogger(__name__)


async def analyze(symbol: str, lang: str = "en") -> dict:
    """Run full Rhino analysis pipeline for a single symbol."""
    symbol = symbol.strip().upper()

    # Fetch all data in parallel — no intraday quote needed.
    # Price basis is 100% EOD historical.
    bars, estimates, raw_macro = await asyncio.gather(
        get_history(symbol),
        get_estimates(symbol),
        get_macro(),
    )

    # ── Price basis: latest EOD close ─────────────────────────────────
    # All indicators, zones, valuation, and the chart use the same
    # historical snapshot.  change/change_pct are derived from the last
    # two daily closes — never from an intraday quote.
    price = 0.0
    if bars:
        price = bars[-1]["close"]

    # Degraded result if no pricing data at all
    if price == 0:
        return _degraded(symbol, lang, raw_macro, estimates)

    # Run engines
    macro = build_macro(raw_macro)
    technical = build_technical(bars, price)
    valuation = build_valuation(estimates, price, macro["recommended_haircut_pct"],
                                symbol=symbol)

    # Pipeline verification — proves estimates reach the valuation engine
    logger.info(
        "Rhino valuation pipeline [%s]: estimates=%s, price=%.2f, "
        "valuation.available=%s, status=%s",
        symbol, estimates, price, valuation.get("available"), valuation.get("status"),
    )

    playbook = build_playbook(technical, valuation, macro["vix_regime"])
    semantic = build_semantic_state(price, technical, valuation, macro)
    scenario = build_scenario_state(semantic, technical, valuation, macro, playbook)
    narrative = build_rhino_narrative(
        symbol, price, technical, valuation, macro, semantic, playbook, lang,
        scenario=scenario,
    )
    briefing = build_rhino_briefing(
        symbol, price, technical, valuation, macro,
        scenario=scenario, playbook=playbook,
    )
    fundamental_narrative = build_fundamental_narrative(valuation, price)
    battle_report = build_battle_report(
        price, technical, valuation, macro, playbook, fundamental_narrative, lang,
    )

    # Data quality + confidence
    dq = {
        "has_quote": len(bars) > 0,   # EOD bars serve as quote source
        "has_history": len(bars) > 0,
        "history_days": len(bars),
        "has_estimates": estimates.get("fy1_eps_avg") is not None,
        "has_vix": raw_macro.get("vix") is not None,
        "has_treasury": raw_macro.get("us10y") is not None,
    }
    confidence = build_confidence(dq, technical, valuation)

    # Chart data — self-contained: includes current_price so the frontend
    # does not need to cross-reference the outer quote section.
    # All SMAs computed locally from the same bars — zero additional API calls.
    candle_window = bars[-200:]
    candle_dates = {b["date"] for b in candle_window}

    # Compute SMA30/100/200 series from full bar history in a single pass
    sma_all = compute_sma_series_multi(bars, [30, 100, 200])

    # Align each SMA series to candle dates
    sma30_aligned = [s for s in sma_all[30] if s["date"] in candle_dates]
    sma100_aligned = [s for s in sma_all[100] if s["date"] in candle_dates]
    sma200_aligned = [s for s in sma_all[200] if s["date"] in candle_dates]

    logger.info(
        "Rhino chart [%s]: %d candles, SMA aligned 30=%d 100=%d 200=%d",
        symbol, len(candle_window),
        len(sma30_aligned), len(sma100_aligned), len(sma200_aligned),
    )

    chart = {
        "candles": [
            {"date": b["date"], "open": b["open"], "high": b["high"],
             "low": b["low"], "close": b["close"], "volume": b["volume"]}
            for b in candle_window
        ],
        "sma30": sma30_aligned,
        "sma100": sma100_aligned,
        "sma200": sma200_aligned,
        "support_zones": technical["support_zones"],
        "resistance_zones": technical["resistance_zones"],
        "current_price": float(price),
        "analysis_close": float(price),
    }

    # Build quote from EOD bars — fully self-contained, no intraday quote.
    prev_close = bars[-2]["close"] if len(bars) >= 2 else None
    change = (price - prev_close) if prev_close is not None else None
    change_pct = (change / prev_close * 100) if prev_close and prev_close != 0 else None

    analysis_quote = {
        "symbol": symbol,
        "price": price,
        "previous_close": prev_close,
        "change": round(change, 4) if change is not None else None,
        "change_pct": round(change_pct, 4) if change_pct is not None else None,
        "volume": bars[-1]["volume"] if bars else None,
        "market_cap": None,
        "name": None,
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
        "semantic": semantic,
        "scenario": scenario._asdict(),
        "narrative": narrative,
        "briefing": briefing,
        "battle_report": battle_report,
        "text": text,
        "chart": chart,
    }


def _degraded(symbol: str, lang: str, raw_macro: dict, estimates: dict) -> dict:
    macro = build_macro(raw_macro)
    empty_tech = {
        "sma30": None, "sma100": None, "sma200": None,
        "avg_volume_50": None, "atr20": None,
        "today_volume": None, "volume_ratio": None,
        "support_zones": [], "resistance_zones": [], "pattern_tags": [],
    }
    empty_val = {
        "available": False,
        "fy0_eps_avg": estimates.get("fy0_eps_avg"),
        "fy1_eps_avg": estimates.get("fy1_eps_avg"),
        "fy2_eps_avg": estimates.get("fy2_eps_avg"),
        "eps_growth_pct": None, "pe_band_low": None, "pe_band_high": None,
        "raw_fair_value": None,
        "adjusted_fair_value": None, "status": "unavailable",
        "valuation_style": "unknown", "_pe_audit": None,
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
    empty_semantic = {
        "trend_state": "unavailable", "ma_alignment": "unavailable",
        "price_location": "unavailable", "valuation_zone": "unavailable",
        "macro_regime": "unavailable", "risk_state": "moderate",
        "stance": "neutral", "flags": [],
    }
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
        "macro": macro, "playbook": playbook,
        "semantic": empty_semantic,
        "scenario": NEUTRAL_SCENARIO._asdict(),
        "narrative": {"summary": "", "sections": {
            "valuation": "", "structure": "", "macro": "",
            "patterns": "", "playbook": ""}},
        "briefing": build_rhino_briefing(
            symbol, 0, empty_tech, empty_val, macro,
        ),
        "battle_report": build_battle_report(
            0, empty_tech, empty_val, macro,
            playbook, build_fundamental_narrative(empty_val, 0),
        ),
        "text": text,
        "chart": {"candles": [], "sma30": [], "sma100": [], "sma200": [],
                  "support_zones": [], "resistance_zones": [],
                  "current_price": 0.0, "analysis_close": 0.0},
    }
