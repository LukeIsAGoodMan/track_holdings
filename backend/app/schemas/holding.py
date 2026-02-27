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
