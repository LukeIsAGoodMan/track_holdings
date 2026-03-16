"""
Valuation engine — forward PE band from analyst consensus EPS estimates.

PE discipline uses FY2 EPS as the valuation anchor year (analysis.py reference).
Growth is computed as 2-year CAGR (FY0→FY2) when FY0 is available,
falling back to (FY2-FY1)/FY1 otherwise.

Style layer: valuation_style_engine adjusts PE bands for non-growth sectors
(cyclical, financial, defensive) to prevent systematic misclassification.

Regime layer: detect_valuation_regime provides structured metadata including
pe_applicable flag — pre_profit names skip PE valuation entirely.
"""
from __future__ import annotations

import logging

from .valuation_style_engine import (
    detect_valuation_style,
    detect_valuation_regime,
    apply_style_adjustment,
    PeAuditTrail,
    StyleResult,
    RegimeResult,
)

logger = logging.getLogger(__name__)

# EPS sanity floor — below this, valuation confidence is too low to classify
MIN_VALID_EPS = 0.5

# PE multiple table — reference analysis.py discipline
# Keyed by avg forward growth rate → (pe_low, pe_high)
# These thresholds are NEVER modified by the style layer.
_PE_TABLE = [
    (0.50, 35, 45),
    (0.20, 25, 37.5),
    (0.10, 22.5, 32.5),
    (float("-inf"), 15, 25),
]


def _compute_avg_growth(fy0: float | None, fy1: float | None,
                        fy2: float | None) -> float | None:
    """Compute average forward growth.

    Preferred: 2-year CAGR from FY0→FY2 when both are available and FY0 > 0.
    Fallback:  (FY2-FY1)/FY1 when FY0 unavailable.
    """
    if fy0 is not None and fy2 is not None and fy0 > 0 and fy2 > 0:
        return (fy2 / fy0) ** 0.5 - 1
    if fy1 is not None and fy2 is not None and fy1 > 0 and fy2 > 0:
        return (fy2 - fy1) / fy1
    return None


def build_valuation(
    estimates: dict,
    price: float,
    haircut_pct: float,
    sector_hint: str | None = None,
    symbol: str | None = None,
) -> dict:
    fy0 = estimates.get("fy0_eps_avg")
    fy1 = estimates.get("fy1_eps_avg")
    fy2 = estimates.get("fy2_eps_avg")

    avg_growth = _compute_avg_growth(fy0, fy1, fy2)

    # Detect regime first — may short-circuit PE valuation
    regime = detect_valuation_regime(
        {"eps_growth_pct": avg_growth, **estimates},
        sector_hint=sector_hint,
        symbol=symbol,
    )

    # Pre-profit regime: PE is not applicable
    if not regime.pe_applicable:
        logger.info(
            "Valuation regime [%s]: %s — PE not applicable, skipping PE band",
            symbol or "?", regime.valuation_regime,
        )
        return _pre_profit_result(estimates, avg_growth, regime)

    if fy1 is None or fy1 <= 0:
        return _unavailable(estimates, regime)

    growth = avg_growth if avg_growth is not None else 0.0

    # Select base PE band from growth rate (analysis.py discipline)
    base_pe_low, base_pe_high = 15, 25
    for min_g, lo, hi in _PE_TABLE:
        if growth >= min_g:
            base_pe_low, base_pe_high = lo, hi
            break

    # Apply valuation style adjustment
    style = regime.style_result
    pe_low, pe_high = apply_style_adjustment(base_pe_low, base_pe_high, style)

    # Audit trail for debugging
    audit = PeAuditTrail(
        valuation_style=style.style,
        base_pe_low=base_pe_low,
        base_pe_high=base_pe_high,
        adjusted_pe_low=pe_low,
        adjusted_pe_high=pe_high,
    )
    logger.info(
        "Valuation PE audit [%s]: regime=%s, style=%s, base=%.1f-%.1f, adjusted=%.1f-%.1f",
        symbol or "?", regime.valuation_regime, audit.valuation_style,
        audit.base_pe_low, audit.base_pe_high,
        audit.adjusted_pe_low, audit.adjusted_pe_high,
    )

    # Use FY2 as valuation anchor when available, else FY1
    anchor_eps = fy2 if (fy2 is not None and fy2 > 0) else fy1

    # EPS sanity cap — below MIN_VALID_EPS, classification is unreliable
    valuation_confidence = "normal"
    classification_fallback = None
    if anchor_eps < MIN_VALID_EPS:
        valuation_confidence = "low"
        classification_fallback = "fair_value"
        logger.warning(
            "EPS sanity cap: anchor_eps=%.2f < %.2f for %s — forcing fair_value",
            anchor_eps, MIN_VALID_EPS, symbol or "?",
        )

    raw_low = anchor_eps * pe_low
    raw_high = anchor_eps * pe_high
    raw_mid = (raw_low + raw_high) / 2
    raw = {"low": raw_low, "mid": raw_mid, "high": raw_high}

    factor = 1 - haircut_pct / 100
    adjusted = {
        "low": raw["low"] * factor,
        "mid": raw["mid"] * factor,
        "high": raw["high"] * factor,
    }

    status = classification_fallback if classification_fallback else _classify(price, adjusted)

    return {
        "available": True,
        "fy0_eps_avg": fy0,
        "fy1_eps_avg": fy1,
        "fy2_eps_avg": fy2,
        "eps_growth_pct": avg_growth,
        "pe_band_low": pe_low,
        "pe_band_high": pe_high,
        "raw_fair_value": raw,
        "adjusted_fair_value": adjusted,
        "status": status,
        "valuation_style": regime.valuation_style,
        "valuation_confidence": valuation_confidence,
        "valuation_regime": regime.valuation_regime,
        "valuation_method": regime.valuation_method,
        "pe_applicable": regime.pe_applicable,
        "anchor_metric_label": regime.anchor_metric_label,
        "_pe_audit": audit._asdict(),
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


def _pre_profit_result(estimates: dict, growth: float | None, regime: RegimeResult) -> dict:
    """Result for pre-profit companies where PE valuation is not applicable."""
    return {
        "available": False,
        "fy0_eps_avg": estimates.get("fy0_eps_avg"),
        "fy1_eps_avg": estimates.get("fy1_eps_avg"),
        "fy2_eps_avg": estimates.get("fy2_eps_avg"),
        "eps_growth_pct": growth,
        "pe_band_low": None,
        "pe_band_high": None,
        "raw_fair_value": None,
        "adjusted_fair_value": None,
        "status": "unavailable",
        "valuation_style": regime.valuation_style,
        "valuation_confidence": "low",
        "valuation_regime": regime.valuation_regime,
        "valuation_method": regime.valuation_method,
        "pe_applicable": False,
        "anchor_metric_label": regime.anchor_metric_label,
        "_pe_audit": None,
    }


def _unavailable(estimates: dict, regime: RegimeResult | None = None) -> dict:
    return {
        "available": False,
        "fy0_eps_avg": estimates.get("fy0_eps_avg"),
        "fy1_eps_avg": estimates.get("fy1_eps_avg"),
        "fy2_eps_avg": estimates.get("fy2_eps_avg"),
        "eps_growth_pct": None,
        "pe_band_low": None,
        "pe_band_high": None,
        "raw_fair_value": None,
        "adjusted_fair_value": None,
        "status": "unavailable",
        "valuation_style": regime.valuation_style if regime else "unknown",
        "valuation_confidence": "low",
        "valuation_regime": regime.valuation_regime if regime else "unknown",
        "valuation_method": regime.valuation_method if regime else "forward_pe",
        "pe_applicable": regime.pe_applicable if regime else True,
        "anchor_metric_label": regime.anchor_metric_label if regime else "Forward EPS",
        "_pe_audit": None,
    }
