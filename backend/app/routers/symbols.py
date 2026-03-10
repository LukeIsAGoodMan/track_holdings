"""
Symbol search & validation router.

Loads master_symbols.json at module import time (once per process).
Uses bisect for O(log n) prefix search on ~37k symbols.

Endpoints:
  GET /api/symbols/search?q=NVD  → list[SymbolSuggestion] (up to 5)
  GET /api/symbols/validate/NVDA → {valid: bool, symbol: str}
"""
from __future__ import annotations

import bisect
import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query

logger = logging.getLogger(__name__)

# ── Load symbol list at import time ──────────────────────────────────────────
_DATA_PATH = Path(__file__).parent.parent.parent / "data" / "symbols" / "master_symbols.json"

# {symbol: {s, n, t}} — O(1) lookup for validation
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
    logger.info("Symbol master list loaded: %d symbols", len(_sorted_keys))
except FileNotFoundError:
    logger.warning("master_symbols.json not found at %s — symbol search disabled", _DATA_PATH)
except Exception:
    logger.exception("Failed to load master_symbols.json")


# ── Schema ────────────────────────────────────────────────────────────────────
from pydantic import BaseModel


class SymbolSuggestion(BaseModel):
    symbol: str
    name:   str
    type:   str


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
    if not q_upper or len(q_upper) < 1 or not _sorted_keys:
        return []

    # Find left insertion point for q_upper
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
    Return {valid: bool, symbol: str} for a given ticker.
    O(1) lookup against in-memory set.
    """
    sym = symbol.upper().strip()
    valid = sym in _symbol_map
    return {"valid": valid, "symbol": sym}
