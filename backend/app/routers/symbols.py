"""
Symbol search & validation router.

Loads master_symbols.json at module import time (once per process).
Uses bisect for O(log n) prefix search on ~37k symbols.

Public helpers (importable by other modules):
  resolve_instrument_type(symbol, fallback) → InstrumentType
  get_asset_class(symbol)                   → 'stock' | 'etf' | 'index' | 'crypto'

Endpoints:
  GET /api/symbols/search?q=NVD  → list[SymbolSuggestion] (up to 5)
  GET /api/symbols/validate/NVDA → {valid: bool, symbol: str, type: str, name: str}
"""
from __future__ import annotations

import bisect
import json
import logging
from pathlib import Path

from fastapi import APIRouter, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ── Load symbol list at import time ──────────────────────────────────────────
_DATA_PATH = Path(__file__).parent.parent.parent / "data" / "symbols" / "master_symbols.json"

# {symbol: {s, n, t}} — O(1) lookup for validation + type resolution
_symbol_map: dict[str, dict] = {}
# Sorted uppercase symbol strings — for bisect prefix search
_sorted_keys: list[str] = []

try:
    with open(_DATA_PATH, encoding="utf-8") as f:
        raw: list[dict] = json.load(f)
    for entry in raw:
        s = entry.get("s", "").upper().strip()
        if s:
            _symbol_map[s] = entry
    _sorted_keys = sorted(_symbol_map.keys())
    logger.info(
        "Symbol master list loaded: %d symbols (%d etf, %d index, %d crypto, %d stock)",
        len(_sorted_keys),
        sum(1 for e in _symbol_map.values() if e.get("t") == "etf"),
        sum(1 for e in _symbol_map.values() if e.get("t") == "index"),
        sum(1 for e in _symbol_map.values() if e.get("t") == "crypto"),
        sum(1 for e in _symbol_map.values() if e.get("t") == "stock"),
    )
except FileNotFoundError:
    logger.warning("master_symbols.json not found at %s — symbol search disabled", _DATA_PATH)
except Exception:
    logger.exception("Failed to load master_symbols.json")


# ── Asset-class helpers (imported by trades.py, migration script, etc.) ───────

# Map JSON `t` value → InstrumentType enum string
_TYPE_MAP: dict[str, str] = {
    "stock":  "STOCK",
    "etf":    "ETF",
    "index":  "INDEX",
    "crypto": "CRYPTO",
    "option": "OPTION",
}

# Well-known index symbols absent from master_symbols.json (exchanges don't list
# tradeable instruments for these).  Stored without the leading '^' so that both
# "VIX" and "^VIX" match after normalisation.
_KNOWN_INDEX_SYMBOLS: frozenset[str] = frozenset({
    "VIX", "SPX", "NDX", "RUT", "DJI", "GSPC", "TNX", "TYX",
    "VXN", "OVX", "GVZ", "VVIX", "MOVE",
})


def get_asset_class(symbol: str) -> str:
    """Return the asset class string for a symbol: 'stock' | 'etf' | 'index' | 'crypto'.
    Falls back to 'stock' if symbol is not in the master list.

    Leading '^' is stripped before lookup so that both 'VIX' and '^VIX'
    resolve to 'index' rather than the 'stock' fallback.
    """
    bare = symbol.upper().strip().lstrip("^")
    if bare in _KNOWN_INDEX_SYMBOLS:
        return "index"
    entry = _symbol_map.get(bare)
    if entry is None:
        return "stock"
    return entry.get("t") or "stock"


def resolve_instrument_type(symbol: str, requested: str) -> str:
    """
    Return the authoritative InstrumentType string for a non-option trade.

    Rules:
      - OPTION is always honoured as-is (user explicitly chose option).
      - For all other types: look up master_symbols.json and use its `t` field.
      - Fallback: use `requested` if symbol is not in the map.

    Returns one of: "STOCK" | "ETF" | "INDEX" | "CRYPTO" | "OPTION"
    """
    if requested.upper() == "OPTION":
        return "OPTION"
    asset_class = get_asset_class(symbol)
    return _TYPE_MAP.get(asset_class, requested.upper())


# ── Schema ────────────────────────────────────────────────────────────────────
class SymbolSuggestion(BaseModel):
    symbol: str
    name:   str
    type:   str   # 'stock' | 'etf' | 'index' | 'crypto'


# ── Router ────────────────────────────────────────────────────────────────────
router = APIRouter(prefix="/symbols", tags=["symbols"])


@router.get("/search", response_model=list[SymbolSuggestion])
def search_symbols(
    q: str = Query("", min_length=0, max_length=20),
) -> list[SymbolSuggestion]:
    """
    Return up to 5 symbol suggestions matching the prefix `q` (case-insensitive).
    Uses bisect for sub-millisecond search.
    """
    q_upper = q.upper().strip()
    if not q_upper or not _sorted_keys:
        return []

    lo = bisect.bisect_left(_sorted_keys, q_upper)
    results: list[SymbolSuggestion] = []
    for i in range(lo, min(lo + 50, len(_sorted_keys))):
        sym = _sorted_keys[i]
        if not sym.startswith(q_upper):
            break
        entry = _symbol_map[sym]
        results.append(SymbolSuggestion(
            symbol=sym,
            name=entry.get("n") or "",
            type=entry.get("t") or "stock",
        ))
        if len(results) == 5:
            break

    return results


@router.get("/validate/{symbol}")
def validate_symbol(symbol: str) -> dict:
    """
    Return {valid, symbol, type, name} for a given ticker.
    O(1) lookup against in-memory map.
    """
    sym = symbol.upper().strip()
    entry = _symbol_map.get(sym)
    return {
        "valid":  entry is not None,
        "symbol": sym,
        "type":   entry.get("t", "stock") if entry else "stock",
        "name":   entry.get("n", "") if entry else "",
    }
