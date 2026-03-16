"""
Fundamental narrative engine — classifies price vs raw fair-value band
and produces a structured FundamentalNarrative for downstream consumers.

One-way consumption: reads valuation_engine output, never recomputes PE bands.
Uses raw_fair_value (pre-haircut) for classification — the narrative should
reflect intrinsic value independent of macro adjustments.
"""
from __future__ import annotations

from typing import NamedTuple


class FundamentalNarrative(NamedTuple):
    """Structured output consumed by rhino_report_engine and frontend."""
    classification: str          # deep_value | discount | fair | premium
    label: str                   # human-readable tag
    upside_pct: float | None     # % to raw_mid (positive = upside)
    raw_low: float | None
    raw_mid: float | None
    raw_high: float | None
    anchor_eps: float | None     # FY2 (preferred) or FY1
    pe_band_low: float | None
    pe_band_high: float | None
    growth_pct: float | None
    valuation_style: str         # growth | quality_mega_cap | cyclical | financial | defensive | unknown


_LABELS = {
    "deep_value": "Deep Value",
    "discount":   "Discount",
    "fair":       "Fair Value",
    "premium":    "Premium",
}


def build_fundamental_narrative(
    valuation: dict,
    price: float,
) -> FundamentalNarrative:
    """Build classification from valuation engine output and current price.

    Classification thresholds (using raw_fair_value, pre-haircut):
      - price < raw_low * 0.92  → deep_value
      - price < raw_low         → discount
      - raw_low ≤ price ≤ raw_high → fair
      - price > raw_high        → premium
    """
    raw = valuation.get("raw_fair_value")
    if not raw or not valuation.get("available"):
        return FundamentalNarrative(
            classification="fair",
            label="Fair Value",
            upside_pct=None,
            raw_low=None,
            raw_mid=None,
            raw_high=None,
            anchor_eps=None,
            pe_band_low=None,
            pe_band_high=None,
            growth_pct=None,
            valuation_style=valuation.get("valuation_style", "unknown"),
        )

    raw_low = raw["low"]
    raw_mid = raw["mid"]
    raw_high = raw["high"]

    classification = _classify(price, raw_low, raw_high)

    upside_pct = None
    if raw_mid and price > 0:
        upside_pct = (raw_mid - price) / price * 100

    # Determine anchor EPS: FY2 preferred, else FY1
    fy2 = valuation.get("fy2_eps_avg")
    fy1 = valuation.get("fy1_eps_avg")
    anchor_eps = fy2 if (fy2 is not None and fy2 > 0) else fy1

    return FundamentalNarrative(
        classification=classification,
        label=_LABELS.get(classification, classification),
        upside_pct=round(upside_pct, 1) if upside_pct is not None else None,
        raw_low=raw_low,
        raw_mid=raw_mid,
        raw_high=raw_high,
        anchor_eps=anchor_eps,
        pe_band_low=valuation.get("pe_band_low"),
        pe_band_high=valuation.get("pe_band_high"),
        growth_pct=valuation.get("eps_growth_pct"),
        valuation_style=valuation.get("valuation_style", "unknown"),
    )


def _classify(price: float, raw_low: float, raw_high: float) -> str:
    # Guard: invalid or degenerate fair-value band → safe fallback
    if raw_low <= 0 or raw_high <= 0 or raw_low >= raw_high:
        return "fair"
    if price < raw_low * 0.92:
        return "deep_value"
    if price < raw_low:
        return "discount"
    if price <= raw_high:
        return "fair"
    return "premium"
