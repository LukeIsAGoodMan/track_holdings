"""
Alerts router — CRUD for user price alerts.

POST   /api/alerts         → create alert
GET    /api/alerts         → list user's alerts
PATCH  /api/alerts/{id}    → update alert
DELETE /api/alerts/{id}    → delete alert

Phase 7e.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.alert import Alert, AlertStatus, AlertType
from app.models.user import User
from app.schemas.alert import AlertCreate, AlertResponse, AlertUpdate
from app.services import yfinance_client
from app.services.price_cache import PriceCache
from app.services.price_feed import PriceFeedService

router = APIRouter(tags=["alerts"])

# ── Globals (injected from main.py lifespan) ──────────────────────────────

_price_cache: PriceCache | None = None
_price_feed: PriceFeedService | None = None


def init_alert_globals(
    price_cache: PriceCache, price_feed: PriceFeedService
) -> None:
    """Called from main.py lifespan to inject singletons."""
    global _price_cache, _price_feed
    _price_cache = price_cache
    _price_feed = price_feed


def _invalidate() -> None:
    if _price_feed:
        _price_feed.invalidate_alert_cache()


# ── CRUD ──────────────────────────────────────────────────────────────────


@router.post("/alerts", response_model=AlertResponse, status_code=201)
async def create_alert(
    body: AlertCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    sym = body.symbol.upper()

    # Auto-capture reference_price for percentage alerts
    ref = body.reference_price
    if body.alert_type in ("PCT_CHANGE_UP", "PCT_CHANGE_DOWN") and ref is None:
        if _price_cache:
            ref = _price_cache.get(sym)
        if ref is None:
            ref = await yfinance_client.get_spot_price(sym)
        if ref is None:
            raise HTTPException(400, f"Cannot determine reference price for {sym}")

    alert = Alert(
        user_id=user.id,
        symbol=sym,
        alert_type=AlertType(body.alert_type),
        threshold=body.threshold,
        reference_price=ref,
        repeat=body.repeat,
        cooldown_seconds=body.cooldown_seconds,
        note=body.note,
        expires_at=body.expires_at,
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)

    _invalidate()
    return AlertResponse.model_validate(alert)


@router.get("/alerts", response_model=list[AlertResponse])
async def list_alerts(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Alert)
        .where(Alert.user_id == user.id)
        .order_by(Alert.created_at.desc())
    )
    return [AlertResponse.model_validate(a) for a in result.scalars().all()]


@router.patch("/alerts/{alert_id}", response_model=AlertResponse)
async def update_alert(
    alert_id: int,
    body: AlertUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    alert = await db.get(Alert, alert_id)
    if not alert or alert.user_id != user.id:
        raise HTTPException(404, "Alert not found")

    for field, val in body.model_dump(exclude_unset=True).items():
        if field == "status":
            setattr(alert, field, AlertStatus(val))
        else:
            setattr(alert, field, val)

    await db.commit()
    await db.refresh(alert)

    _invalidate()
    return AlertResponse.model_validate(alert)


@router.delete("/alerts/{alert_id}", status_code=204)
async def delete_alert(
    alert_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    alert = await db.get(Alert, alert_id)
    if not alert or alert.user_id != user.id:
        raise HTTPException(404, "Alert not found")
    await db.delete(alert)
    await db.commit()

    _invalidate()
