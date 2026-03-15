"""
Analysis router — Rhino Analysis Engine endpoint.

GET /api/analysis/stock?symbol=MSFT&lang=en
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, HTTPException

from app.dependencies import get_current_user
from app.services.rhino import analyze
from app.services.rhino.fmp_client import normalize_ticker

router = APIRouter(tags=["analysis"])


@router.get("/analysis/stock")
async def analyze_stock(
    symbol: str = Query(..., description="Ticker symbol (e.g. MSFT, NVDA)"),
    lang: str = Query("en", description="Language: en or zh"),
    user=Depends(get_current_user),
):
    """Run Rhino Analysis Engine for a single stock."""
    sym = normalize_ticker(symbol)
    if not sym:
        raise HTTPException(status_code=400, detail="Missing symbol")

    lang = "zh" if lang == "zh" else "en"

    try:
        result = await analyze(sym, lang)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Analysis failed for {sym}")
