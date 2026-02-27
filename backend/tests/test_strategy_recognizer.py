"""
Unit tests for app/services/strategy_recognizer.py

Verifies that identify_strategy() correctly classifies standard multi-leg
option structures from a list of LegSnapshot objects.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.strategy_recognizer import LegSnapshot, identify_strategy


def leg(option_type: str, strike: str, expiry: str, net: int) -> LegSnapshot:
    return LegSnapshot(
        option_type=option_type,
        strike=Decimal(strike),
        expiry=expiry,
        net_contracts=net,
    )


JAN = "2027-01-16"
MAR = "2027-03-21"


# ── No legs / single leg ──────────────────────────────────────────────────────

def test_no_legs_is_single():
    tag = identify_strategy([])
    assert tag.strategy_type == "SINGLE"
    assert "Stock" in tag.label or "ETF" in tag.label


def test_single_short_put():
    tag = identify_strategy([leg("PUT", "600", JAN, -5)])
    assert tag.strategy_type == "SINGLE"
    assert "Short" in tag.label and "Put" in tag.label


def test_single_long_call():
    tag = identify_strategy([leg("CALL", "620", JAN, 2)])
    assert tag.strategy_type == "SINGLE"
    assert "Long" in tag.label and "Call" in tag.label


# ── Vertical spreads ──────────────────────────────────────────────────────────

def test_bull_put_spread():
    """Short 600P + long 580P = Bull Put Spread."""
    legs = [
        leg("PUT", "600", JAN, -5),  # short higher strike
        leg("PUT", "580", JAN,  5),  # long lower strike
    ]
    tag = identify_strategy(legs)
    assert tag.strategy_type == "VERTICAL"
    assert "Bull Put" in tag.label


def test_bear_call_spread():
    """Short 620C + long 640C = Bear Call Spread."""
    legs = [
        leg("CALL", "620", JAN, -3),  # short lower strike
        leg("CALL", "640", JAN,  3),  # long higher strike
    ]
    tag = identify_strategy(legs)
    assert tag.strategy_type == "VERTICAL"
    assert "Bear Call" in tag.label


def test_vertical_same_type_same_expiry():
    """Two puts same expiry → VERTICAL regardless of which is short."""
    legs = [
        leg("PUT", "550", JAN, 2),
        leg("PUT", "530", JAN, -2),
    ]
    tag = identify_strategy(legs)
    assert tag.strategy_type == "VERTICAL"


# ── Straddle ──────────────────────────────────────────────────────────────────

def test_straddle_same_strike():
    """Short call + short put same strike & expiry = Straddle."""
    legs = [
        leg("CALL", "600", JAN, -1),
        leg("PUT",  "600", JAN, -1),
    ]
    tag = identify_strategy(legs)
    assert tag.strategy_type == "STRADDLE"
    assert "Straddle" in tag.label


# ── Strangle ──────────────────────────────────────────────────────────────────

def test_strangle_different_strikes():
    """Short 620C + short 580P same expiry = Strangle."""
    legs = [
        leg("CALL", "620", JAN, -1),
        leg("PUT",  "580", JAN, -1),
    ]
    tag = identify_strategy(legs)
    assert tag.strategy_type == "STRANGLE"


# ── Iron Condor ───────────────────────────────────────────────────────────────

def test_iron_condor():
    """Classic short iron condor: 2 short + 2 long, 2 PUTs + 2 CALLs."""
    legs = [
        leg("PUT",  "560", JAN,  2),  # long put wing
        leg("PUT",  "580", JAN, -2),  # short put
        leg("CALL", "620", JAN, -2),  # short call
        leg("CALL", "640", JAN,  2),  # long call wing
    ]
    tag = identify_strategy(legs)
    assert tag.strategy_type == "IRON_CONDOR"
    assert "Iron Condor" in tag.label


# ── Calendar spread ───────────────────────────────────────────────────────────

def test_calendar_spread():
    """Short near + long far, same type & strike, different expiries."""
    legs = [
        leg("PUT", "600", JAN, -1),
        leg("PUT", "600", MAR,  1),
    ]
    tag = identify_strategy(legs)
    assert tag.strategy_type == "CALENDAR"
    assert "Calendar" in tag.label


# ── Custom / unknown ──────────────────────────────────────────────────────────

def test_three_legs_is_custom():
    """Three legs don't match any known pattern."""
    legs = [
        leg("PUT", "600", JAN, -2),
        leg("PUT", "580", JAN,  1),
        leg("CALL", "620", JAN, -1),
    ]
    tag = identify_strategy(legs)
    assert tag.strategy_type == "CUSTOM"


def test_five_legs_is_custom():
    """Five legs = custom."""
    legs = [leg("PUT", str(600 - i * 10), JAN, -1) for i in range(5)]
    tag = identify_strategy(legs)
    assert tag.strategy_type == "CUSTOM"
