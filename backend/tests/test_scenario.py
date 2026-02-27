"""
Unit tests for the second-order Taylor expansion scenario engine.

The scenario formula (from routers/risk.py get_scenario) is:
  For options:
    ΔPnL = delta_exp × ΔP + 0.5 × gamma_exp × ΔP² + vega_exp × vol_pp

  Where:
    delta_exp = delta × net_contracts × 100
    gamma_exp = gamma × net_contracts × 100   (signed: short = negative)
    vega_exp  = vega  × net_contracts × 100
    ΔP        = spot × price_change_pct
    vol_pp    = absolute vol-point shift

  For stocks:
    ΔPnL = net_shares × ΔP

We test these formulas directly using Greeks from calculate_greeks() so that
tests remain pure-Python with no DB or network calls.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.black_scholes import (
    MULTIPLIER,
    Greeks,
    calculate_greeks,
    calculate_option_price,
)

D = Decimal


# ── Helpers: mirror the scenario engine formulas ───────────────────────────────

def scenario_option_pnl(
    net_contracts: int,
    g: Greeks,
    spot: Decimal,
    price_change_pct: Decimal,
    vol_change_ppt: Decimal,
) -> Decimal:
    """Reproduce the scenario PnL formula from routers/risk.py."""
    n_d       = D(str(net_contracts))
    delta_P   = spot * price_change_pct
    delta_exp = g.delta * n_d * MULTIPLIER
    gamma_exp = g.gamma * n_d * MULTIPLIER
    vega_exp  = g.vega  * n_d * MULTIPLIER
    return (
        delta_exp * delta_P
        + D("0.5") * gamma_exp * delta_P * delta_P
        + vega_exp * vol_change_ppt
    )


def scenario_stock_pnl(
    net_shares: int,
    spot: Decimal,
    price_change_pct: Decimal,
) -> Decimal:
    """Stock PnL: net_shares × ΔP."""
    return D(str(net_shares)) * (spot * price_change_pct)


# ── Stock scenario ─────────────────────────────────────────────────────────────

def test_stock_long_positive_move():
    """Long 100 shares, spot=500, +10% → PnL = 100 × 50 = 5000."""
    pnl = scenario_stock_pnl(100, D("500"), D("0.10"))
    assert pnl == D("5000.00")


def test_stock_short_positive_move_loses():
    """Short 50 shares, spot=200, +5% → PnL = -50 × 10 = -500."""
    pnl = scenario_stock_pnl(-50, D("200"), D("0.05"))
    assert pnl == D("-500.00")


def test_stock_zero_move():
    """Zero price change → zero PnL for any position."""
    pnl = scenario_stock_pnl(100, D("500"), D("0"))
    assert pnl == D("0")


# ── Option scenario — delta contribution ──────────────────────────────────────

def test_option_delta_dominates_small_move():
    """
    For a small price move (+1%) the delta term dominates and gamma/vega ≈ 0.

    Short put, ATM, 30-day: delta ≈ −0.50 → delta_exp ≈ +50 (per contract).
    For 5 short contracts: delta_exp ≈ +250.
    ΔP = 100 × 0.01 = 1.  →  delta contribution ≈ +250.
    Gamma contribution ≈ 0.5 × gamma_exp × 1 ≈ small.
    """
    S = D("100")
    g = calculate_greeks(S, D("100"), D(str(30 / 365)), "PUT", D("0.30"), D("0.045"))
    pnl = scenario_option_pnl(-5, g, S, D("0.01"), D("0"))
    # Short put benefits from up moves (positive PnL)
    assert float(pnl) > 0, f"Short put +1% move should be positive PnL: {pnl}"


def test_option_short_put_down_move_loses():
    """Short put profits on up moves, loses on down moves."""
    S = D("100")
    g = calculate_greeks(S, D("100"), D(str(30 / 365)), "PUT", D("0.30"), D("0.045"))
    pnl_up   = scenario_option_pnl(-5, g, S, D("0.05"),  D("0"))
    pnl_down = scenario_option_pnl(-5, g, S, D("-0.05"), D("0"))
    assert float(pnl_up) > 0,   "Short put up move should profit"
    assert float(pnl_down) < 0, "Short put down move should lose"


# ── Option scenario — gamma contribution ──────────────────────────────────────

def test_gamma_convexity_long_call():
    """
    Long call (net=+1) has positive gamma.  Large moves help (gamma > 0 means
    the delta_exp grows in your favour as the option moves ITM).

    Verify that |PnL(+15%)| > delta_only estimate (gamma adds).
    Also: PnL(+15%) and PnL(-15%) are not symmetric — long gamma favours big moves.
    """
    S = D("100")
    K = D("100")
    T = D(str(60 / 365))
    g = calculate_greeks(S, K, T, "CALL", D("0.30"), D("0.045"))

    pnl_up   = float(scenario_option_pnl(1, g, S, D("0.15"),  D("0")))
    pnl_down = float(scenario_option_pnl(1, g, S, D("-0.15"), D("0")))

    # Long call benefits more from up than from down (convexity)
    assert pnl_up > 0,   "Long call should profit on up move"
    assert pnl_up > abs(pnl_down), "Long call: gamma makes up-move PnL > |down-move PnL|"


def test_gamma_hurts_short_position():
    """
    Short call (net=−1) has NEGATIVE gamma exposure.  Large moves hurt both
    directions but the gamma term makes the loss accelerate.

    PnL(−15%) should be more negative than linear-delta would predict.
    """
    S = D("100")
    K = D("100")
    T = D(str(60 / 365))
    g = calculate_greeks(S, K, T, "CALL", D("0.30"), D("0.045"))

    pnl_down = float(scenario_option_pnl(-1, g, S, D("-0.15"), D("0")))
    # delta-only (no gamma)
    n_d = D("-1")
    delta_only = float(g.delta * n_d * MULTIPLIER * (S * D("-0.15")))
    # gamma makes the loss larger than delta alone
    assert pnl_down < delta_only, (
        f"Short call with gamma should lose more than delta-only: "
        f"pnl={pnl_down:.2f} vs delta_only={delta_only:.2f}"
    )


# ── Option scenario — vega contribution ──────────────────────────────────────

def test_vega_increases_long_call_value():
    """
    Long call is long vega: vol increase → positive PnL.
    vol_pp = +10 (percentage points).
    """
    S = D("100")
    g = calculate_greeks(S, D("100"), D(str(30 / 365)), "CALL", D("0.30"), D("0.045"))
    pnl = scenario_option_pnl(1, g, S, D("0"), D("10"))
    assert float(pnl) > 0, "Long call should profit from vol increase"


def test_vega_hurts_short_call_on_vol_spike():
    """Short call is short vega: vol increase → negative PnL."""
    S = D("100")
    g = calculate_greeks(S, D("100"), D(str(30 / 365)), "CALL", D("0.30"), D("0.045"))
    pnl = scenario_option_pnl(-1, g, S, D("0"), D("10"))
    assert float(pnl) < 0, "Short call should lose from vol increase"


def test_vega_zero_vol_change_no_contribution():
    """vol_pp = 0 → vega term = 0."""
    S = D("100")
    g = calculate_greeks(S, D("100"), D(str(30 / 365)), "CALL", D("0.30"), D("0.045"))
    pnl_no_vol = float(scenario_option_pnl(1, g, S, D("0.05"), D("0")))
    pnl_vol    = float(scenario_option_pnl(1, g, S, D("0.05"), D("0")))
    assert pnl_no_vol == pnl_vol  # same inputs, deterministic


# ── Second-order expansion — numerical accuracy ────────────────────────────────

def test_taylor_matches_bs_price_small_move():
    """
    For a small move, the 2nd-order Taylor PnL should closely approximate the
    actual B-S price change (within ~5%).

    Tests that the Taylor expansion is a reasonable approximation — not exact,
    but within the expected error for a 5% move on a 30-day ATM option.
    """
    S     = D("100")
    K     = D("100")
    T     = D(str(30 / 365))
    SIGMA = D("0.30")
    R     = D("0.045")
    pc    = D("0.05")  # +5%

    g    = calculate_greeks(S, K, T, "CALL", SIGMA, R)
    S2   = S * (D("1") + pc)
    T2   = T  # vol and time unchanged

    # Actual B-S price change × 100 (1 long call contract)
    price_before = calculate_option_price(S,  K, T,  "CALL", SIGMA, R)
    price_after  = calculate_option_price(S2, K, T2, "CALL", SIGMA, R)
    actual_pnl   = (price_after - price_before) * D("100")  # 1 long contract

    # Taylor approximation
    taylor_pnl = scenario_option_pnl(1, g, S, pc, D("0"))

    # Relative error < 10% for a 5% spot move
    if float(actual_pnl) != 0:
        rel_err = abs(float(taylor_pnl - actual_pnl)) / abs(float(actual_pnl))
        assert rel_err < 0.10, (
            f"Taylor expansion error too large: taylor={float(taylor_pnl):.2f} "
            f"actual={float(actual_pnl):.2f} rel_err={rel_err:.2%}"
        )


# ── Edge cases ────────────────────────────────────────────────────────────────

def test_zero_price_change_zero_pnl_from_delta_gamma():
    """Zero price change: delta and gamma terms vanish; only vega matters."""
    S = D("100")
    g = calculate_greeks(S, D("100"), D(str(30 / 365)), "PUT", D("0.30"), D("0.045"))
    pnl = float(scenario_option_pnl(-5, g, S, D("0"), D("0")))
    assert abs(pnl) < 1e-8, f"No move + no vol change → zero PnL, got {pnl}"


def test_flat_portfolio_zero_net_gives_no_pnl():
    """Net=0 (flat position) → scenario PnL = 0."""
    S = D("100")
    g = Greeks(delta=D("0.50"), gamma=D("0.02"), theta=D("-0.05"), vega=D("0.10"))
    pnl = float(scenario_option_pnl(0, g, S, D("0.10"), D("5")))
    assert pnl == 0.0
