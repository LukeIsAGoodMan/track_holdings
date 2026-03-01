"""
Scanner router — REST endpoint for market opportunities snapshot.

GET /api/scanner/opportunities → list of opportunity dicts
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.dependencies import get_current_user
from app.services.scanner_service import MarketScannerService

router = APIRouter(tags=["scanner"])

_scanner: MarketScannerService | None = None


def init_scanner_globals(scanner: MarketScannerService) -> None:
    """Called from main.py lifespan to inject the singleton."""
    global _scanner
    _scanner = scanner


@router.get("/scanner/opportunities")
async def get_opportunities(user=Depends(get_current_user)):
    """Return the latest scanner sweep results."""
    if _scanner is None:
        return []
    return _scanner.get_latest()
