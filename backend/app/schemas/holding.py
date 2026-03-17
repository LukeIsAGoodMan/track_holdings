from __future__ import annotations

from pydantic import BaseModel

from app.schemas.base import DecStr


class OptionLeg(BaseModel):
    """One option position leg under a single underlying symbol."""
    instrument_id:       int
    option_type:         str          # "CALL" | "PUT"
    strike:              DecStr
    expiry:              str          # ISO date "2026-12-18"
    days_to_expiry:      int
    net_contracts:       int          # signed: negative = short
    avg_open_price:      DecStr       # premium per share at open

    # Greeks — None when market data is unavailable
    delta:               DecStr | None = None   # long-unit delta
    gamma:               DecStr | None = None
    theta:               DecStr | None = None   # per calendar day, per contract
    vega:                DecStr | None = None   # per 1% vol

    # Exposure (signed, accounts for net_contracts direction)
    delta_exposure:      DecStr | None = None   # net_contracts × delta × 100
    maintenance_margin:  DecStr                 # 20% × strike × 100 × |short_contracts|

    # ── Unrealized P&L ────────────────────────────────────────────────────
    # daily_pnl:  (BS(spot_now) − BS(prev_close)) × net_contracts × 100
    # total_pnl:  (BS(spot_now) − avg_open_price) × net_contracts × 100
    # total_pnl_pct: total_pnl / |cost_basis|  (cost_basis = |net| × avg_open × 100)
    daily_pnl:     DecStr | None = None
    total_pnl:     DecStr | None = None
    total_pnl_pct: DecStr | None = None


class StockLeg(BaseModel):
    """One stock/ETF position under a single underlying symbol.

    Delta convention: 1 share = 1Δ (long) or -1Δ (short).
    Gamma / Theta / Vega are all zero — stocks have no optionality.
    """
    instrument_id:   int
    net_shares:      int        # signed: positive = long, negative = short
    avg_open_price:  DecStr     # cost basis per share
    delta_exposure:  DecStr     # = net_shares  (1:1 ratio)
    market_value:    DecStr | None = None   # spot × net_shares, None if no quote

    # ── Unrealized P&L ────────────────────────────────────────────────────
    # daily_pnl:  net_shares × (spot − prev_close)
    # total_pnl:  net_shares × (spot − avg_open_price)
    # total_pnl_pct: total_pnl / |cost_basis|  (cost_basis = |shares| × avg_open)
    daily_pnl:     DecStr | None = None
    total_pnl:     DecStr | None = None
    total_pnl_pct: DecStr | None = None


class HoldingGroup(BaseModel):
    """All option and stock legs for one underlying symbol."""
    symbol:                   str
    spot_price:               DecStr | None = None
    option_legs:              list[OptionLeg] = []
    stock_legs:               list[StockLeg]  = []

    # Portfolio-level aggregates for this underlying (options + stocks combined)
    total_delta_exposure:     DecStr
    total_maintenance_margin: DecStr          # options only (stocks have no formal margin req)

    # Theta P&L: signed — positive = net short (theta earns money each day)
    # Stocks contribute 0. Computed as: Σ (leg.theta × net_contracts × 100)
    total_theta_daily:        DecStr

    # Capital efficiency: total_theta_daily / total_maintenance_margin
    # Expressed as a fraction (multiply × 100 to get %).
    # None when maintenance_margin == 0 (no options open).
    capital_efficiency:       DecStr | None = None

    # Auto-detected multi-leg strategy from strategy_recognizer.
    # strategy_type is one of: SINGLE | VERTICAL | STRADDLE | STRANGLE | IRON_CONDOR | CALENDAR | CUSTOM
    # strategy_label is a human-readable sub-label, e.g. "Bull Put Spread".
    strategy_type:            str = "SINGLE"
    strategy_label:           str = "Single"

    # ── Phase 14 enrichment (derived from cached data — zero extra API calls) ──
    # Dollar-notional exposure magnitude: stock = |shares| × spot;
    # option = spot × |contracts × 100 × |delta||
    delta_adjusted_exposure:  DecStr | None = None

    # Multi-period % performance (raw underlying price change), from cached 1y closes.
    # None when 1y history hasn't been fetched for this symbol yet.
    perf_1d:  str | None = None   # 1 trading day
    perf_5d:  str | None = None   # 5 trading days (~1 week)
    perf_1m:  str | None = None   # ~22 trading days
    perf_3m:  str | None = None   # ~66 trading days

    # ── Phase 14b — directional risk analytics ────────────────────────────────
    # is_short: True when total net delta < 0 (short stock, long put, short call…)
    # Treemap label shows "(S)" for these positions.
    is_short:             bool = False

    # Signed dollar-notional: total_delta_exposure × spot_price.
    # Sum across all groups gives portfolio-level net delta exposure (Hero Banner).
    signed_delta_notional: DecStr | None = None

    # Effective perf = raw_underlying_perf × sign(net_delta).
    # This is what the position actually GAINS when the underlying moves.
    # Example: long put (delta<0) gains when underlying falls → effective_perf is positive.
    effective_perf_1d:  str | None = None
    effective_perf_5d:  str | None = None
    effective_perf_1m:  str | None = None
    effective_perf_3m:  str | None = None

    # ── Unrealized P&L (group-level aggregates) ────────────────────────────────
    # daily_pnl: Σ leg.daily_pnl  (ignoring None legs)
    # total_pnl: Σ leg.total_pnl  (ignoring None legs)
    # total_pnl_pct: total_pnl / Σ |leg cost_basis|
    daily_pnl:     DecStr | None = None
    total_pnl:     DecStr | None = None
    total_pnl_pct: DecStr | None = None

    # ── Legacy: BS mark-to-market P&L (1-day) ────────────────────────────────
    # Preserved for backward compatibility. Equal to daily_pnl when computed.
    bs_pnl_1d: DecStr | None = None

    # ── Phase 15.3 — asset class classification ──────────────────────────────
    # 'stock' | 'etf' | 'index' | 'crypto' | 'option'
    asset_class: str = "stock"
