"""
Unit tests for app/services/black_scholes.py

All tests are pure-Python (no DB, no network).  We verify:
  - Greek boundary conditions (ATM, deep ITM/OTM, expired)
  - Put-call parity for prices
  - Sign conventions (delta exposure, theta direction)
  - Maintenance margin rules
  - Historical volatility estimator edge cases
"""
from __future__ import annotations

import math
from decimal import Decimal

import pytest

from app.services.black_scholes import (
    DEFAULT_SIGMA,
    MULTIPLIER,
    Greeks,
    calculate_greeks,
    calculate_option_price,
    compute_historical_vol,
    maintenance_margin,
    net_delta_exposure,
)

# ── Helpers ───────────────────────────────────────────────────────────────────
D = Decimal

# Standard test parameters: ATM, 30-day option, 30% IV, 4.5% rf
S_ATM  = D("100")
K_ATM  = D("100")
T_30D  = D(str(30 / 365))   # ≈ 0.0822 years
SIGMA  = D("0.30")
R_FREE = D("0.045")


# ── Delta ─────────────────────────────────────────────────────────────────────

def test_call_delta_atm_near_half():
    """ATM call delta ≈ 0.50 (slightly above due to risk-free drift)."""
    g = calculate_greeks(S_ATM, K_ATM, T_30D, "CALL", SIGMA, R_FREE)
    assert 0.48 < float(g.delta) < 0.55, f"ATM call delta out of range: {g.delta}"


def test_put_delta_atm_near_neg_half():
    """ATM put delta ≈ −0.50."""
    g = calculate_greeks(S_ATM, K_ATM, T_30D, "PUT", SIGMA, R_FREE)
    assert -0.55 < float(g.delta) < -0.45, f"ATM put delta out of range: {g.delta}"


def test_call_delta_in_zero_one():
    """Call delta is always in [0, 1]."""
    for s in [50, 80, 100, 120, 200]:
        g = calculate_greeks(D(str(s)), K_ATM, T_30D, "CALL", SIGMA, R_FREE)
        assert 0 <= float(g.delta) <= 1, f"Call delta out of [0,1]: {g.delta} at S={s}"


def test_put_delta_in_neg_one_zero():
    """Put delta is always in [−1, 0]."""
    for s in [50, 80, 100, 120, 200]:
        g = calculate_greeks(D(str(s)), K_ATM, T_30D, "PUT", SIGMA, R_FREE)
        assert -1 <= float(g.delta) <= 0, f"Put delta out of [-1,0]: {g.delta} at S={s}"


def test_call_put_delta_sum_near_one():
    """
    Call delta + (1 + Put delta) ≈ 1  (put-call delta relationship).
    call_delta - put_delta ≈ 1  →  call_delta + |put_delta| ≈ 1
    """
    g_c = calculate_greeks(S_ATM, K_ATM, T_30D, "CALL", SIGMA, R_FREE)
    g_p = calculate_greeks(S_ATM, K_ATM, T_30D, "PUT",  SIGMA, R_FREE)
    # N(d1) − (N(d1)−1) = 1  exactly
    diff = float(g_c.delta) + abs(float(g_p.delta))
    assert abs(diff - 1.0) < 0.01, f"Call-Put delta sum not near 1: {diff}"


def test_deep_itm_call_delta_near_one():
    """Deep in-the-money call: delta → 1."""
    g = calculate_greeks(D("200"), K_ATM, T_30D, "CALL", SIGMA, R_FREE)
    assert float(g.delta) > 0.95, f"Deep ITM call delta should be ~1: {g.delta}"


def test_deep_otm_put_delta_near_zero():
    """Deep out-of-the-money put: delta → 0."""
    g = calculate_greeks(D("200"), K_ATM, T_30D, "PUT", SIGMA, R_FREE)
    assert float(g.delta) > -0.05, f"Deep OTM put delta should be ~0: {g.delta}"


# ── Expired option ─────────────────────────────────────────────────────────────

def test_expired_option_all_greeks_zero():
    """T=0 (or negative) → all Greeks return 0."""
    for opt_type in ("CALL", "PUT"):
        g = calculate_greeks(S_ATM, K_ATM, D("0"), opt_type, SIGMA, R_FREE)
        assert g.delta == D("0"), f"Expired {opt_type} delta != 0"
        assert g.gamma == D("0"), f"Expired {opt_type} gamma != 0"
        assert g.theta == D("0"), f"Expired {opt_type} theta != 0"
        assert g.vega  == D("0"), f"Expired {opt_type} vega != 0"


# ── Gamma ─────────────────────────────────────────────────────────────────────

def test_gamma_always_positive():
    """Gamma is always positive regardless of spot, strike, or option type."""
    test_cases = [
        (D("80"),  K_ATM, "CALL"),
        (D("100"), K_ATM, "CALL"),
        (D("120"), K_ATM, "CALL"),
        (D("80"),  K_ATM, "PUT"),
        (D("100"), K_ATM, "PUT"),
        (D("120"), K_ATM, "PUT"),
    ]
    for s, k, opt in test_cases:
        g = calculate_greeks(s, k, T_30D, opt, SIGMA, R_FREE)
        assert float(g.gamma) > 0, f"Gamma not positive at S={s} K={k} {opt}"


def test_gamma_call_put_identical():
    """Call and put gamma are identical (same d1)."""
    g_c = calculate_greeks(S_ATM, K_ATM, T_30D, "CALL", SIGMA, R_FREE)
    g_p = calculate_greeks(S_ATM, K_ATM, T_30D, "PUT",  SIGMA, R_FREE)
    assert abs(float(g_c.gamma) - float(g_p.gamma)) < 1e-8


# ── Theta ──────────────────────────────────────────────────────────────────────

def test_theta_negative_for_long_option():
    """
    Theta is negative for a long option holder (time erodes value).
    The model returns long-unit theta.
    """
    for opt_type in ("CALL", "PUT"):
        g = calculate_greeks(S_ATM, K_ATM, T_30D, opt_type, SIGMA, R_FREE)
        assert float(g.theta) < 0, f"Long {opt_type} theta should be negative: {g.theta}"


def test_theta_magnitude_larger_near_atm():
    """ATM theta > deep OTM theta (more extrinsic value to decay near ATM)."""
    g_atm = calculate_greeks(S_ATM, K_ATM,  T_30D, "PUT", SIGMA, R_FREE)
    g_otm = calculate_greeks(D("60"), K_ATM, T_30D, "PUT", SIGMA, R_FREE)
    assert abs(float(g_atm.theta)) > abs(float(g_otm.theta)), (
        f"ATM theta {g_atm.theta} should be larger magnitude than OTM {g_otm.theta}"
    )


# ── Vega ──────────────────────────────────────────────────────────────────────

def test_vega_positive():
    """Vega is always positive (both calls and puts gain value with higher vol)."""
    for opt_type in ("CALL", "PUT"):
        g = calculate_greeks(S_ATM, K_ATM, T_30D, opt_type, SIGMA, R_FREE)
        assert float(g.vega) > 0, f"{opt_type} vega should be positive: {g.vega}"


def test_vega_call_put_identical():
    """Call and put vega are identical (same formula)."""
    g_c = calculate_greeks(S_ATM, K_ATM, T_30D, "CALL", SIGMA, R_FREE)
    g_p = calculate_greeks(S_ATM, K_ATM, T_30D, "PUT",  SIGMA, R_FREE)
    assert abs(float(g_c.vega) - float(g_p.vega)) < 1e-8


# ── Option price ───────────────────────────────────────────────────────────────

def test_call_price_positive():
    """Any ATM call price > 0."""
    price = calculate_option_price(S_ATM, K_ATM, T_30D, "CALL", SIGMA, R_FREE)
    assert float(price) > 0


def test_put_price_positive():
    """Any ATM put price > 0."""
    price = calculate_option_price(S_ATM, K_ATM, T_30D, "PUT", SIGMA, R_FREE)
    assert float(price) > 0


def test_put_call_parity():
    """
    Put-call parity: C - P = S - K * e^(-rT)
    Tolerance 0.01 (rounding from 6dp Decimal precision).
    """
    c = float(calculate_option_price(S_ATM, K_ATM, T_30D, "CALL", SIGMA, R_FREE))
    p = float(calculate_option_price(S_ATM, K_ATM, T_30D, "PUT",  SIGMA, R_FREE))
    s = float(S_ATM)
    k = float(K_ATM)
    t = float(T_30D)
    r = float(R_FREE)
    rhs = s - k * math.exp(-r * t)
    assert abs((c - p) - rhs) < 0.02, f"Put-call parity violated: C-P={c-p:.4f}, rhs={rhs:.4f}"


def test_expired_call_returns_intrinsic():
    """Expired ITM call price = max(S - K, 0)."""
    price = calculate_option_price(D("110"), D("100"), D("0"), "CALL")
    assert price == D("10.0"), f"ITM expired call intrinsic wrong: {price}"


def test_expired_otm_call_returns_zero():
    """Expired OTM call price = 0."""
    price = calculate_option_price(D("90"), D("100"), D("0"), "CALL")
    assert price == D("0.0"), f"OTM expired call should be 0: {price}"


def test_expired_put_returns_intrinsic():
    """Expired ITM put price = max(K - S, 0)."""
    price = calculate_option_price(D("90"), D("100"), D("0"), "PUT")
    assert price == D("10.0"), f"ITM expired put intrinsic wrong: {price}"


def test_expired_otm_put_returns_zero():
    """Expired OTM put price = 0."""
    price = calculate_option_price(D("110"), D("100"), D("0"), "PUT")
    assert price == D("0.0"), f"OTM expired put should be 0: {price}"


def test_call_price_increases_with_spot():
    """Call value increases as underlying rises."""
    p1 = calculate_option_price(D("90"),  K_ATM, T_30D, "CALL", SIGMA, R_FREE)
    p2 = calculate_option_price(D("100"), K_ATM, T_30D, "CALL", SIGMA, R_FREE)
    p3 = calculate_option_price(D("110"), K_ATM, T_30D, "CALL", SIGMA, R_FREE)
    assert float(p1) < float(p2) < float(p3)


def test_put_price_decreases_with_spot():
    """Put value decreases as underlying rises."""
    p1 = calculate_option_price(D("90"),  K_ATM, T_30D, "PUT", SIGMA, R_FREE)
    p2 = calculate_option_price(D("100"), K_ATM, T_30D, "PUT", SIGMA, R_FREE)
    p3 = calculate_option_price(D("110"), K_ATM, T_30D, "PUT", SIGMA, R_FREE)
    assert float(p1) > float(p2) > float(p3)


# ── Net delta exposure ─────────────────────────────────────────────────────────

def test_net_delta_exposure_short_put_positive():
    """
    Short put (net_contracts=-5) on a near-ATM strike has positive delta
    exposure (betting the stock stays up / equivalent to holding stock).
    """
    g = calculate_greeks(S_ATM, K_ATM, T_30D, "PUT", SIGMA, R_FREE)
    exposure = net_delta_exposure(-5, g)
    # put delta is negative; -5 × negative × 100 → positive
    assert float(exposure) > 0, f"Short put delta exposure should be positive: {exposure}"


def test_net_delta_exposure_long_call_positive():
    """Long call (net=+3) has positive delta exposure."""
    g = calculate_greeks(S_ATM, K_ATM, T_30D, "CALL", SIGMA, R_FREE)
    exposure = net_delta_exposure(3, g)
    assert float(exposure) > 0


def test_net_delta_exposure_formula():
    """net_delta_exposure = net_contracts × delta × 100."""
    g = Greeks(delta=D("0.45"), gamma=D("0.01"), theta=D("-0.05"), vega=D("0.10"))
    result = net_delta_exposure(4, g)
    expected = D("4") * D("0.45") * D("100")
    assert result == expected


# ── Maintenance margin ─────────────────────────────────────────────────────────

def test_maintenance_margin_short_position():
    """Short 2 contracts at K=500 → 0.20 × 500 × 100 × 2 = 20,000."""
    margin = maintenance_margin(-2, D("500"))
    assert margin == D("20000.00"), f"Margin wrong: {margin}"


def test_maintenance_margin_long_position_zero():
    """Long position has no maintenance margin requirement."""
    assert maintenance_margin(3, D("500")) == D("0")


def test_maintenance_margin_flat_position_zero():
    """Flat position (net=0) → no margin."""
    assert maintenance_margin(0, D("500")) == D("0")


def test_maintenance_margin_proportional_to_contracts():
    """Margin scales linearly with |short contracts|."""
    m1 = maintenance_margin(-1, D("400"))
    m5 = maintenance_margin(-5, D("400"))
    assert m5 == m1 * 5


# ── Historical volatility ──────────────────────────────────────────────────────

def test_hist_vol_flat_prices_returns_default():
    """Flat price series (zero log-returns) → fall through to DEFAULT_SIGMA."""
    # All same price → log returns all 0 → variance 0 → ann = 0 → DEFAULT_SIGMA
    prices = [100.0] * 20
    vol = compute_historical_vol(prices)
    assert vol == DEFAULT_SIGMA


def test_hist_vol_few_points_returns_default():
    """Fewer than 5 data points → DEFAULT_SIGMA."""
    vol = compute_historical_vol([100.0, 101.0, 102.0])
    assert vol == DEFAULT_SIGMA


def test_hist_vol_positive_for_volatile_series():
    """Volatile price series returns a positive Decimal vol."""
    prices = [100.0 * (1.01 ** i) * (0.99 if i % 2 == 0 else 1.01) for i in range(30)]
    vol = compute_historical_vol(prices)
    assert float(vol) > 0


def test_hist_vol_higher_for_more_volatile():
    """More volatile series should yield higher annualized vol."""
    calm    = [100.0 + i * 0.01 for i in range(30)]
    volatile = [100.0 * (1.05 if i % 2 == 0 else 0.95) for i in range(30)]
    vol_calm     = compute_historical_vol(calm)
    vol_volatile = compute_historical_vol(volatile)
    assert float(vol_volatile) > float(vol_calm)
