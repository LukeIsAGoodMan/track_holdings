"""
Valuation style engine — classifies stocks into valuation regimes
to prevent PE distortion in non-growth sectors.

Styles:
  - growth:           High-growth companies, use full PE discipline
  - quality_mega_cap: Large-cap quality with moderate growth
  - cyclical:         Earnings-cycle-dependent, PE compressed
  - financial:        Banks/insurance, PE clamped
  - defensive:        Low-growth stable earners, PE moderately compressed
  - unknown:          Fallback, use base PE unchanged

PE adjustment factors are applied AFTER the growth-bucket PE lookup,
never modifying the bucket thresholds themselves.

Priority order:
  1. sector_hint (Financial → financial, Commodity/Industrial → cyclical)
  2. Growth/stability heuristics (growth, defensive, unknown)
"""
from __future__ import annotations

import logging
from typing import NamedTuple

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# SCHEMA
# ═══════════════════════════════════════════════════════════════════════════

class StyleResult(NamedTuple):
    style: str            # growth | quality_mega_cap | cyclical | financial | defensive | unknown
    pe_adj_low: float     # multiplier for pe_low  (1.0 = no change)
    pe_adj_high: float    # multiplier for pe_high (1.0 = no change)
    pe_clamp_low: float | None   # hard ceiling for pe_low (None = no clamp)
    pe_clamp_high: float | None  # hard ceiling for pe_high (None = no clamp)


# ═══════════════════════════════════════════════════════════════════════════
# STYLE DEFINITIONS — PE adjustments per style
# ═══════════════════════════════════════════════════════════════════════════

_STYLE_MAP: dict[str, StyleResult] = {
    "growth":           StyleResult("growth",           1.0,  1.0,  None, None),
    "quality_mega_cap": StyleResult("quality_mega_cap", 1.0,  1.0,  None, None),
    "cyclical":         StyleResult("cyclical",         0.75, 0.75, None, None),
    "financial":        StyleResult("financial",        1.0,  1.0,  15,   18),
    "defensive":        StyleResult("defensive",        0.85, 0.85, None, None),
    "unknown":          StyleResult("unknown",          1.0,  1.0,  None, None),
}


# ═══════════════════════════════════════════════════════════════════════════
# SECTOR HINT CLASSIFICATION SETS
# ═══════════════════════════════════════════════════════════════════════════

_FINANCIAL_HINTS = frozenset({
    "financial", "financials", "banking", "banks", "bank",
    "insurance", "asset management", "capital markets",
    "financial services", "diversified financials",
})

_CYCLICAL_HINTS = frozenset({
    "energy", "oil", "gas", "materials", "mining",
    "industrials", "industrial", "commodities", "commodity",
    "metals", "steel", "chemicals", "construction",
    "basic materials", "utilities",
})

_QUALITY_MEGA_HINTS = frozenset({
    "technology", "tech", "software", "platform",
    "mega cap", "mega-cap", "faang",
})


# ═══════════════════════════════════════════════════════════════════════════
# WELL-KNOWN FINANCIAL TICKERS (fallback when no sector_hint)
# ═══════════════════════════════════════════════════════════════════════════

_FINANCIAL_TICKERS = frozenset({
    "JPM", "BAC", "WFC", "C", "GS", "MS", "USB", "PNC",
    "TFC", "SCHW", "BK", "AXP", "COF", "SPGI", "ICE",
    "CME", "MCO", "BRK.A", "BRK.B", "BRK-B", "ALL",
    "MET", "PRU", "AIG", "TRV", "PGR", "CB", "AFL",
    "HSBC", "TD", "BMO", "RY", "BNS", "CM",
})

_CYCLICAL_TICKERS = frozenset({
    "XOM", "CVX", "COP", "SLB", "HAL", "BKR",
    "FCX", "NEM", "AA", "CLF", "X", "NUE",
    "DOW", "LYB", "EMN", "CE",
    "CAT", "DE", "CMI", "PCAR", "URI",
})


# ═══════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════

def detect_valuation_style(
    estimates: dict,
    macro: dict | None = None,
    sector_hint: str | None = None,
    symbol: str | None = None,
) -> StyleResult:
    """Classify valuation style from available data.

    Priority:
      1. sector_hint → financial / cyclical / quality_mega_cap
      2. symbol in known ticker sets → financial / cyclical
      3. Growth/stability heuristics → growth / defensive / unknown
    """
    # ── Priority 1: Sector-based classification ────────────────────────
    if sector_hint:
        hint_lower = sector_hint.lower().strip()
        if hint_lower in _FINANCIAL_HINTS:
            return _STYLE_MAP["financial"]
        if hint_lower in _CYCLICAL_HINTS:
            return _STYLE_MAP["cyclical"]
        if hint_lower in _QUALITY_MEGA_HINTS:
            return _STYLE_MAP["quality_mega_cap"]

    # ── Priority 2: Known ticker fallback ──────────────────────────────
    if symbol:
        sym_upper = symbol.upper().strip()
        if sym_upper in _FINANCIAL_TICKERS:
            return _STYLE_MAP["financial"]
        if sym_upper in _CYCLICAL_TICKERS:
            return _STYLE_MAP["cyclical"]

    # ── Priority 3: Growth/stability heuristics ────────────────────────
    growth = estimates.get("eps_growth_pct")

    if growth is None:
        return _STYLE_MAP["unknown"]

    if growth >= 0.15:
        return _STYLE_MAP["growth"]

    if growth < 0.08:
        return _STYLE_MAP["defensive"]

    # Moderate growth (0.08–0.15), no sector signal
    return _STYLE_MAP["unknown"]


def apply_style_adjustment(
    pe_low: float,
    pe_high: float,
    style: StyleResult,
) -> tuple[float, float]:
    """Apply style-based PE adjustment to base PE band.

    Returns (adjusted_pe_low, adjusted_pe_high).
    Never modifies the growth-bucket thresholds — only the PE output.
    """
    adj_low = pe_low * style.pe_adj_low
    adj_high = pe_high * style.pe_adj_high

    # Apply clamps if defined
    if style.pe_clamp_low is not None:
        adj_low = min(adj_low, style.pe_clamp_low)
    if style.pe_clamp_high is not None:
        adj_high = min(adj_high, style.pe_clamp_high)

    return round(adj_low, 2), round(adj_high, 2)


class PeAuditTrail(NamedTuple):
    """Debug-only audit trail for PE adjustment decisions."""
    valuation_style: str
    base_pe_low: float
    base_pe_high: float
    adjusted_pe_low: float
    adjusted_pe_high: float
