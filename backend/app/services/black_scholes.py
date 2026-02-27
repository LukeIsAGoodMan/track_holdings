"""
Black-Scholes Greeks (Δ Γ Θ V) + transparent PnL attribution engine.

All public interfaces accept and return Python Decimal for consistency with
the accounting layer.

Pure-Python implementation — uses only the standard library (math module).
No scipy/numpy dependency: N(x) is computed via math.erfc which is exact.

Standard normal functions:
  N(x)  = 0.5 * erfc(-x / sqrt(2))   # CDF
  n(x)  = exp(-0.5 * x²) / sqrt(2π)  # PDF

Sign convention (long-unit basis):
  Long  Call: delta = N(d1)        ∈ [0,  +1]
  Long  Put:  delta = N(d1) - 1   ∈ [-1,  0]
  Short Put (net_contracts=-5): delta_exposure = -5 × (negative) × 100 > 0  ✓
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal

# ── Constants ────────────────────────────────────────────────────────────────
MULTIPLIER    = Decimal("100")
DEFAULT_SIGMA = Decimal("0.30")
RISK_FREE     = Decimal("0.045")

_SQRT2    = math.sqrt(2.0)
_SQRT2PI  = math.sqrt(2.0 * math.pi)


# ── Standard normal helpers (pure Python) ────────────────────────────────────
def _norm_cdf(x: float) -> float:
    """Standard normal CDF via math.erfc — exact to float precision."""
    return 0.5 * math.erfc(-x / _SQRT2)


def _norm_pdf(x: float) -> float:
    """Standard normal PDF."""
    return math.exp(-0.5 * x * x) / _SQRT2PI


# ── Output types ─────────────────────────────────────────────────────────────
@dataclass
class Greeks:
    """Per-contract Greeks for a LONG unit of the option."""
    delta: Decimal   # ∂V/∂S
    gamma: Decimal   # ∂²V/∂S²
    theta: Decimal   # ∂V/∂t per calendar day (negative for long holder)
    vega:  Decimal   # ∂V/∂σ per 1% change in vol


@dataclass
class PnLAttribution:
    """Transparent P&L breakdown for one option position leg."""
    cost_basis:       Decimal   # Premium received/paid at open (total cash)
    time_decay_pnl:   Decimal   # |theta_at_open| × days_elapsed × |contracts| × 100
    directional_pnl:  Decimal   # Residual = total_unrealized - time_decay_pnl
    total_unrealized: Decimal   # (open_premium - current_premium) × |contracts| × 100


# ── Core helpers ─────────────────────────────────────────────────────────────
def _d1_d2(
    S: float, K: float, T: float, r: float, sigma: float
) -> tuple[float, float]:
    if T <= 0 or S <= 0 or K <= 0 or sigma <= 0:
        return 0.0, 0.0
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    return d1, d2


# ── Public API ────────────────────────────────────────────────────────────────
def calculate_greeks(
    S:           Decimal,
    K:           Decimal,
    T:           Decimal,        # years to expiry (calendar days / 365)
    option_type: str,            # "CALL" | "PUT"
    sigma:       Decimal = DEFAULT_SIGMA,
    r:           Decimal = RISK_FREE,
) -> Greeks:
    """
    Compute Δ Γ Θ V for a LONG unit of the option.

    For short positions, flip sign of delta/theta/vega externally.
    Gamma is always positive regardless of long/short.

    Returns Greeks(0,0,0,0) if the option has expired (T ≤ 0).
    """
    S_f   = float(S)
    K_f   = float(K)
    T_f   = float(T)
    r_f   = float(r)
    sig_f = float(sigma)

    if T_f <= 0:
        return Greeks(Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0"))

    d1, d2 = _d1_d2(S_f, K_f, T_f, r_f, sig_f)
    n_d1   = _norm_pdf(d1)

    # Delta
    if option_type.upper() == "CALL":
        delta = _norm_cdf(d1)
    else:
        delta = _norm_cdf(d1) - 1.0   # negative for long put

    # Gamma (identical for calls and puts)
    gamma = n_d1 / (S_f * sig_f * math.sqrt(T_f))

    # Theta (per calendar day — divide annual by 365)
    if option_type.upper() == "CALL":
        theta = (
            -S_f * n_d1 * sig_f / (2.0 * math.sqrt(T_f))
            - r_f * K_f * math.exp(-r_f * T_f) * _norm_cdf(d2)
        ) / 365.0
    else:
        theta = (
            -S_f * n_d1 * sig_f / (2.0 * math.sqrt(T_f))
            + r_f * K_f * math.exp(-r_f * T_f) * _norm_cdf(-d2)
        ) / 365.0

    # Vega — per 1% change in vol (divide by 100)
    vega = S_f * n_d1 * math.sqrt(T_f) / 100.0

    def _d(x: float) -> Decimal:
        return Decimal(str(round(x, 8)))

    return Greeks(
        delta=_d(delta),
        gamma=_d(gamma),
        theta=_d(theta),
        vega =_d(vega),
    )


def net_delta_exposure(net_contracts: int, greeks: Greeks) -> Decimal:
    """
    Dollar-delta for one position leg.

    net_contracts is SIGNED: -5 = short 5, +3 = long 3.

    Example — short put, net_contracts=-5, greeks.delta≈-0.97 (deep ITM):
        exposure = Decimal(-5) × Decimal(-0.97) × 100 = +485  ✓ positive
    """
    return Decimal(str(net_contracts)) * greeks.delta * MULTIPLIER


def maintenance_margin(net_contracts: int, strike: Decimal) -> Decimal:
    """
    Reg-T simplified maintenance margin for net-short option positions:
    20% of notional = 0.20 × strike × 100 × |net_contracts|

    Returns Decimal("0") for long (or flat) positions.
    """
    if net_contracts >= 0:
        return Decimal("0")
    return Decimal("0.20") * strike * MULTIPLIER * Decimal(str(abs(net_contracts)))


def attribution(
    net_contracts:   int,
    open_premium:    Decimal,
    current_premium: Decimal,
    days_elapsed:    int,
    greeks_at_open:  Greeks,
) -> PnLAttribution:
    """
    Transparent P&L attribution for one option leg.

    For a SELL_OPEN (short) position:
      cost_basis       = +open_premium × |net| × 100  (premium received)
      total_unrealized = (open_premium - current_premium) × |net| × 100
      time_decay_pnl   = |theta_at_open| × days_elapsed × |net| × 100
      directional_pnl  = total_unrealized - time_decay_pnl  (delta-driven residual)
    """
    abs_n = abs(net_contracts)
    sign  = Decimal("-1") if net_contracts < 0 else Decimal("1")

    cost_basis       = open_premium * Decimal(str(abs_n)) * MULTIPLIER * sign
    total_unrealized = (open_premium - current_premium) * Decimal(str(abs_n)) * MULTIPLIER * sign
    theta_per_day    = abs(greeks_at_open.theta)
    time_decay_pnl   = theta_per_day * Decimal(str(days_elapsed)) * Decimal(str(abs_n)) * MULTIPLIER
    directional_pnl  = total_unrealized - time_decay_pnl

    return PnLAttribution(
        cost_basis=cost_basis,
        time_decay_pnl=time_decay_pnl,
        directional_pnl=directional_pnl,
        total_unrealized=total_unrealized,
    )


def calculate_option_price(
    S:           Decimal,
    K:           Decimal,
    T:           Decimal,
    option_type: str,
    sigma:       Decimal = DEFAULT_SIGMA,
    r:           Decimal = RISK_FREE,
) -> Decimal:
    """
    Black-Scholes theoretical option price per share (not per contract).

    Returns intrinsic value (floored at 0) when T <= 0.
    """
    S_f   = float(S)
    K_f   = float(K)
    T_f   = float(T)
    r_f   = float(r)
    sig_f = float(sigma)

    if T_f <= 0:
        if option_type.upper() == "CALL":
            return Decimal(str(max(S_f - K_f, 0.0)))
        return Decimal(str(max(K_f - S_f, 0.0)))

    d1, d2 = _d1_d2(S_f, K_f, T_f, r_f, sig_f)

    if option_type.upper() == "CALL":
        price = S_f * _norm_cdf(d1) - K_f * math.exp(-r_f * T_f) * _norm_cdf(d2)
    else:
        price = K_f * math.exp(-r_f * T_f) * _norm_cdf(-d2) - S_f * _norm_cdf(-d1)

    return Decimal(str(max(round(price, 6), 0.0)))


def compute_historical_vol(closes: list[float]) -> Decimal:
    """
    Annualized historical volatility from a list of daily close prices.
    Returns DEFAULT_SIGMA if fewer than 5 data points.
    """
    if len(closes) < 5:
        return DEFAULT_SIGMA
    log_ret = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
    n    = len(log_ret)
    mean = sum(log_ret) / n
    var  = sum((r - mean) ** 2 for r in log_ret) / (n - 1)
    ann  = math.sqrt(var) * math.sqrt(252)
    return Decimal(str(round(ann, 8))) if ann > 0 else DEFAULT_SIGMA
