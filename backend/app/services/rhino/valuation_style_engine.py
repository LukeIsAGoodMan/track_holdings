"""
Valuation regime engine — classifies stocks into valuation regimes
to prevent PE distortion across different business types.

Regimes:
  - earnings_compounder: Stable earnings growth, full PE discipline
  - quality_mega_cap:    Large-cap quality with moderate growth
  - cyclical:            Earnings-cycle-dependent, PE compressed (mean reversion framing)
  - financial:           Banks/insurance, PE clamped
  - hyper_growth:        High-growth (>50%), growth-aware framing, avoid mature-stock compression
  - pre_profit:          Negative/near-zero EPS, PE not applicable

PE adjustment factors are applied AFTER the growth-bucket PE lookup,
never modifying the bucket thresholds themselves.

Priority order:
  1. TICKER_SECTOR_OVERRIDE (hardcoded per-ticker)
  2. sector_hint (Financial → financial, Commodity/Industrial → cyclical)
  3. Known ticker sets (financial / cyclical tickers)
  4. EPS quality gate (negative/near-zero → pre_profit)
  5. Growth/stability heuristics (hyper_growth, earnings_compounder, unknown)

Safety guard:
  - Unknown sector + EPS <= 0 → pre_profit (never falls through to PE-based regime)
"""
from __future__ import annotations

import logging
from typing import NamedTuple

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# SCHEMA
# ═══════════════════════════════════════════════════════════════════════════

class StyleResult(NamedTuple):
    style: str            # regime name (backward compat alias)
    pe_adj_low: float     # multiplier for pe_low  (1.0 = no change)
    pe_adj_high: float    # multiplier for pe_high (1.0 = no change)
    pe_clamp_low: float | None   # hard ceiling for pe_low (None = no clamp)
    pe_clamp_high: float | None  # hard ceiling for pe_high (None = no clamp)


class RegimeResult(NamedTuple):
    """Extended regime classification with structured metadata."""
    valuation_regime: str        # earnings_compounder | quality_mega_cap | cyclical | financial | hyper_growth | pre_profit
    valuation_style: str         # backward compat: growth | quality_mega_cap | cyclical | financial | defensive | unknown
    valuation_method: str        # forward_pe | pe_compressed | pe_clamped | growth_adjusted_pe | not_applicable
    pe_applicable: bool          # whether PE-based valuation is meaningful
    anchor_metric_label: str     # "Forward EPS" | "Revenue Growth" | "Book Value" etc.
    style_result: StyleResult    # PE adjustment factors


# ═══════════════════════════════════════════════════════════════════════════
# STYLE DEFINITIONS — PE adjustments per style
# ═══════════════════════════════════════════════════════════════════════════

_STYLE_MAP: dict[str, StyleResult] = {
    "growth":           StyleResult("growth",           1.0,  1.0,  None, None),
    "quality_mega_cap": StyleResult("quality_mega_cap", 1.0,  1.0,  None, None),
    "cyclical":         StyleResult("cyclical",         0.75, 0.75, None, None),
    "financial":        StyleResult("financial",        1.0,  1.0,  15,   18),
    "defensive":        StyleResult("defensive",        0.85, 0.85, None, None),
    "hyper_growth":     StyleResult("hyper_growth",     1.0,  1.0,  None, None),
    "pre_profit":       StyleResult("pre_profit",       1.0,  1.0,  None, None),
    "unknown":          StyleResult("unknown",          1.0,  1.0,  None, None),
}

# Style name → (regime_name, backward_compat_style, method, pe_applicable, anchor_label)
# Keys match _STYLE_MAP keys (style.style values)
_REGIME_MAP: dict[str, tuple[str, str, str, bool, str]] = {
    "growth":           ("earnings_compounder", "growth",           "forward_pe",          True,  "Forward EPS"),
    "quality_mega_cap": ("quality_mega_cap",    "quality_mega_cap", "forward_pe",          True,  "Forward EPS"),
    "cyclical":         ("cyclical",            "cyclical",         "pe_compressed",       True,  "Normalized EPS"),
    "financial":        ("financial",           "financial",        "pe_clamped",          True,  "Forward EPS"),
    "hyper_growth":     ("hyper_growth",        "growth",           "growth_adjusted_pe",  True,  "Forward EPS"),
    "pre_profit":       ("pre_profit",          "unknown",          "not_applicable",      False, "Revenue Growth"),
    "defensive":        ("defensive",           "defensive",        "pe_compressed",       True,  "Forward EPS"),
    "unknown":          ("unknown",             "unknown",          "forward_pe",          True,  "Forward EPS"),
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
# TICKER SECTOR OVERRIDE — highest priority, bypasses all heuristics
# ═══════════════════════════════════════════════════════════════════════════

TICKER_SECTOR_OVERRIDE: dict[str, str] = {
    "AMZN": "growth",
    "TSLA": "growth",
    "NVDA": "hyper_growth",
    "META": "growth",
    "GOOGL": "quality_mega_cap",
    "MSFT": "quality_mega_cap",
    "AAPL": "quality_mega_cap",
    "BRK.B": "defensive",
}


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
      1. TICKER_SECTOR_OVERRIDE → hardcoded per-ticker
      2. sector_hint → financial / cyclical / quality_mega_cap
      3. symbol in known ticker sets → financial / cyclical
      4. EPS quality gate → pre_profit if EPS <= 0
      5. Growth/stability heuristics → hyper_growth / growth / defensive / unknown
    """
    # ── Priority 1: Hardcoded ticker override ─────────────────────────
    if symbol:
        sym_upper = symbol.upper().strip()
        override = TICKER_SECTOR_OVERRIDE.get(sym_upper)
        if override and override in _STYLE_MAP:
            return _STYLE_MAP[override]

    # ── Priority 2: Sector-based classification ────────────────────────
    if sector_hint:
        hint_lower = sector_hint.lower().strip()
        if hint_lower in _FINANCIAL_HINTS:
            return _STYLE_MAP["financial"]
        if hint_lower in _CYCLICAL_HINTS:
            return _STYLE_MAP["cyclical"]
        if hint_lower in _QUALITY_MEGA_HINTS:
            return _STYLE_MAP["quality_mega_cap"]

    # ── Priority 3: Known ticker fallback ──────────────────────────────
    if symbol:
        sym_upper = symbol.upper().strip()
        if sym_upper in _FINANCIAL_TICKERS:
            return _STYLE_MAP["financial"]
        if sym_upper in _CYCLICAL_TICKERS:
            return _STYLE_MAP["cyclical"]

    # ── Priority 4: EPS quality gate — safety guard ────────────────────
    # Unknown sector + non-positive EPS → pre_profit (never PE-based)
    anchor_eps = _get_anchor_eps(estimates)
    if anchor_eps is not None and anchor_eps <= 0:
        return _STYLE_MAP["pre_profit"]

    # ── Priority 5: Growth/stability heuristics ────────────────────────
    growth = estimates.get("eps_growth_pct")

    if growth is None:
        # No EPS at all → pre_profit if anchor is None/missing
        if anchor_eps is None:
            return _STYLE_MAP["pre_profit"]
        return _STYLE_MAP["unknown"]

    if growth >= 0.50:
        return _STYLE_MAP["hyper_growth"]

    if growth >= 0.15:
        return _STYLE_MAP["growth"]

    if growth < 0.08:
        return _STYLE_MAP["defensive"]

    # Moderate growth (0.08–0.15), no sector signal
    return _STYLE_MAP["unknown"]


def detect_valuation_regime(
    estimates: dict,
    macro: dict | None = None,
    sector_hint: str | None = None,
    symbol: str | None = None,
) -> RegimeResult:
    """Full regime classification with structured metadata.

    Returns RegimeResult with valuation_regime, valuation_method,
    pe_applicable, anchor_metric_label, and the underlying StyleResult.
    """
    style = detect_valuation_style(estimates, macro, sector_hint, symbol)
    regime_key = style.style

    # Map style to regime metadata
    if regime_key in _REGIME_MAP:
        regime_name, compat_style, method, pe_ok, anchor = _REGIME_MAP[regime_key]
    else:
        regime_name, compat_style, method, pe_ok, anchor = _REGIME_MAP["unknown"]

    return RegimeResult(
        valuation_regime=regime_name,
        valuation_style=compat_style,
        valuation_method=method,
        pe_applicable=pe_ok,
        anchor_metric_label=anchor,
        style_result=style,
    )


def _get_anchor_eps(estimates: dict) -> float | None:
    """Extract anchor EPS from estimates (FY2 preferred, then FY1)."""
    fy2 = estimates.get("fy2_eps_avg")
    if fy2 is not None and fy2 > 0:
        return fy2
    fy1 = estimates.get("fy1_eps_avg")
    return fy1


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
