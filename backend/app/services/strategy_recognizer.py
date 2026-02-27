"""
Strategy Auto-Recognition Engine
──────────────────────────────────
Identifies multi-leg option strategies from a list of option legs belonging to
a single underlying symbol.

Supported strategies:
  SINGLE        – One option leg only.
  VERTICAL      – Two legs, same option type (both CALLs or both PUTs), same
                  expiry, different strikes (credit or debit spread).
                  • Bull Put Spread: short PUT at higher K + long PUT at lower K
                  • Bear Call Spread: short CALL at lower K + long CALL at higher K
  STRADDLE      – Two legs, one CALL + one PUT, same strike, same expiry.
  STRANGLE      – Two legs, one CALL + one PUT, different strikes, same expiry.
  IRON_CONDOR   – Four legs, two PUTs (different strikes) + two CALLs (different
                  strikes), all same expiry.  Classic short iron condor has one
                  short and one long in each pair.
  CALENDAR      – Two legs, same option type, same strike, different expiries.
  CUSTOM        – Recognized as a multi-leg structure but doesn't match the above.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

# ── Types ─────────────────────────────────────────────────────────────────────

StrategyType = Literal[
    "SINGLE",
    "VERTICAL",
    "STRADDLE",
    "STRANGLE",
    "IRON_CONDOR",
    "CALENDAR",
    "CUSTOM",
]


@dataclass(frozen=True)
class LegSnapshot:
    """Minimal leg data needed for pattern matching."""
    option_type:   str      # "CALL" | "PUT"
    strike:        Decimal
    expiry:        str      # ISO date string
    net_contracts: int      # signed


@dataclass(frozen=True)
class StrategyTag:
    strategy_type: StrategyType
    # Human-readable sub-label (e.g. "Bull Put Spread", "Bear Call Spread")
    label:         str


# ── Internal helpers ──────────────────────────────────────────────────────────

def _vertical_label(legs: list[LegSnapshot]) -> str:
    """Determine Bull Put / Bear Call / Debit spread sub-label."""
    puts  = [l for l in legs if l.option_type == "PUT"]
    calls = [l for l in legs if l.option_type == "CALL"]

    if len(puts) == 2:
        # Identify short leg (net_contracts < 0)
        short = next((l for l in puts if l.net_contracts < 0), None)
        long_  = next((l for l in puts if l.net_contracts > 0), None)
        if short and long_:
            if float(short.strike) > float(long_.strike):
                return "Bull Put Spread"   # short higher strike = bullish
            return "Bear Put Spread"       # short lower strike = bearish

    if len(calls) == 2:
        short = next((l for l in calls if l.net_contracts < 0), None)
        long_  = next((l for l in calls if l.net_contracts > 0), None)
        if short and long_:
            if float(short.strike) < float(long_.strike):
                return "Bear Call Spread"  # short lower strike = bearish
            return "Bull Call Spread"

    # Fallback: just "Vertical Spread"
    return "Vertical Spread"


def _iron_condor_label(legs: list[LegSnapshot]) -> str:
    """Classic vs. reverse iron condor."""
    short_count = sum(1 for l in legs if l.net_contracts < 0)
    return "Iron Condor" if short_count == 2 else "Reverse Iron Condor"


# ── Public API ─────────────────────────────────────────────────────────────────

def identify_strategy(legs: list[LegSnapshot]) -> StrategyTag:
    """
    Classify the option legs into a recognized strategy.

    Args:
        legs: list of LegSnapshot for a single underlying symbol.
              May be empty (stock-only holding) or contain 1–N legs.

    Returns:
        StrategyTag with strategy_type and a human-readable label.
    """
    n = len(legs)

    # ── No option legs (stock only) ───────────────────────────────────────
    if n == 0:
        return StrategyTag(strategy_type="SINGLE", label="Stock / ETF")

    # ── Single leg ────────────────────────────────────────────────────────
    if n == 1:
        leg = legs[0]
        direction = "Short" if leg.net_contracts < 0 else "Long"
        return StrategyTag(
            strategy_type="SINGLE",
            label=f"{direction} {leg.option_type.capitalize()}",
        )

    # ── Two legs ──────────────────────────────────────────────────────────
    if n == 2:
        expiries = {l.expiry for l in legs}
        types    = sorted(l.option_type for l in legs)   # sorted for consistent comparison
        strikes  = [float(l.strike) for l in legs]

        # Both legs same option type
        if types[0] == types[1]:
            if len(expiries) == 1:
                # Same expiry: vertical spread
                return StrategyTag(
                    strategy_type="VERTICAL",
                    label=_vertical_label(legs),
                )
            else:
                # Different expiries: calendar spread
                return StrategyTag(strategy_type="CALENDAR", label="Calendar Spread")

        # One CALL + one PUT
        if types == ["CALL", "PUT"]:
            if len(expiries) == 1:
                put_strike  = float(next(l.strike for l in legs if l.option_type == "PUT"))
                call_strike = float(next(l.strike for l in legs if l.option_type == "CALL"))
                if abs(put_strike - call_strike) < 0.01:
                    return StrategyTag(strategy_type="STRADDLE", label="Straddle")
                return StrategyTag(strategy_type="STRANGLE", label="Strangle")

    # ── Four legs ─────────────────────────────────────────────────────────
    if n == 4:
        puts  = [l for l in legs if l.option_type == "PUT"]
        calls = [l for l in legs if l.option_type == "CALL"]
        expiries = {l.expiry for l in legs}

        if len(puts) == 2 and len(calls) == 2 and len(expiries) == 1:
            # Verify put strikes are different and call strikes are different
            put_strikes  = {float(l.strike) for l in puts}
            call_strikes = {float(l.strike) for l in calls}
            if len(put_strikes) == 2 and len(call_strikes) == 2:
                return StrategyTag(
                    strategy_type="IRON_CONDOR",
                    label=_iron_condor_label(legs),
                )

    # ── Fallback ──────────────────────────────────────────────────────────
    return StrategyTag(strategy_type="CUSTOM", label=f"{n}-Leg Custom")
