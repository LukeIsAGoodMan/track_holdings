"""
Valuation engine — forward PE band from analyst consensus EPS estimates.
"""
from __future__ import annotations

# PE multiple table keyed by annual EPS growth rate
_PE_TABLE = [
    (0.30, 25, 32, 40),
    (0.20, 20, 26, 33),
    (0.10, 16, 21, 27),
    (0.00, 13, 17, 22),
    (float("-inf"), 8, 12, 16),
]


def build_valuation(estimates: dict, price: float, haircut_pct: float) -> dict:
    fy1 = estimates.get("fy1_eps_avg")
    fy2 = estimates.get("fy2_eps_avg")

    if fy1 is None or fy1 <= 0:
        return _unavailable(estimates)

    eps_growth = (fy2 - fy1) / fy1 if fy2 is not None and fy2 > 0 else None
    growth = eps_growth if eps_growth is not None else 0.0

    pe_low, pe_mid, pe_high = 8, 12, 16
    for min_g, lo, mi, hi in _PE_TABLE:
        if growth >= min_g:
            pe_low, pe_mid, pe_high = lo, mi, hi
            break

    raw = {"low": fy1 * pe_low, "mid": fy1 * pe_mid, "high": fy1 * pe_high}

    factor = 1 - haircut_pct / 100
    adjusted = {"low": raw["low"] * factor, "mid": raw["mid"] * factor, "high": raw["high"] * factor}

    status = _classify(price, adjusted)

    return {
        "available": True,
        "fy1_eps_avg": fy1,
        "fy2_eps_avg": fy2,
        "eps_growth_pct": eps_growth,
        "raw_fair_value": raw,
        "adjusted_fair_value": adjusted,
        "status": status,
    }


def _classify(price: float, band: dict) -> str:
    if price < band["low"] * 0.85:
        return "deeply_undervalued"
    if price < band["low"]:
        return "undervalued"
    if price <= band["high"]:
        return "fair_value"
    if price <= band["high"] * 1.15:
        return "overvalued"
    return "deeply_overvalued"


def _unavailable(estimates: dict) -> dict:
    return {
        "available": False,
        "fy1_eps_avg": estimates.get("fy1_eps_avg"),
        "fy2_eps_avg": estimates.get("fy2_eps_avg"),
        "eps_growth_pct": None,
        "raw_fair_value": None,
        "adjusted_fair_value": None,
        "status": "unavailable",
    }
