"""
AlertEngine — in-memory alert cache + evaluation engine.

Loaded from DB every 30s.  Called by PriceFeedService after spot diffs
are detected.  Zero-overhead on the hot path when no alerts trigger.

Phase 7e.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.alert import Alert, AlertStatus, AlertType
from app.services.ws_manager import ConnectionManager

logger = logging.getLogger(__name__)

_CACHE_TTL = 30.0  # seconds between DB refreshes


@dataclass(frozen=True, slots=True)
class AlertSnapshot:
    """Lightweight read-only copy of an Alert row (avoids session binding)."""

    id: int
    user_id: int
    symbol: str
    alert_type: AlertType
    threshold: Decimal
    reference_price: Decimal | None
    repeat: bool
    cooldown_seconds: int
    note: str | None
    trigger_count: int


class AlertEngine:
    """In-memory alert evaluator.  Injected into PriceFeedService."""

    def __init__(self, manager: ConnectionManager) -> None:
        self.manager = manager
        self._by_symbol: dict[str, list[AlertSnapshot]] = defaultdict(list)
        self._cache_ts: float = 0.0
        self._cooldowns: dict[int, float] = {}  # alert_id -> monotonic time

    # ── Cache management ──────────────────────────────────────────────────

    async def maybe_refresh(self) -> None:
        now = time.monotonic()
        if now - self._cache_ts > _CACHE_TTL:
            await self._load_cache()

    async def _load_cache(self) -> None:
        by_sym: dict[str, list[AlertSnapshot]] = defaultdict(list)
        now_utc = datetime.now(timezone.utc)

        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(
                    select(Alert).where(Alert.status == AlertStatus.ACTIVE)
                )
            ).scalars().all()

        for r in rows:
            # Skip expired alerts
            if r.expires_at is not None and r.expires_at <= now_utc:
                continue
            snap = AlertSnapshot(
                id=r.id,
                user_id=r.user_id,
                symbol=r.symbol.upper(),
                alert_type=r.alert_type,
                threshold=r.threshold,
                reference_price=r.reference_price,
                repeat=r.repeat,
                cooldown_seconds=r.cooldown_seconds,
                note=r.note,
                trigger_count=r.trigger_count,
            )
            by_sym[snap.symbol].append(snap)

        self._by_symbol = by_sym
        self._cache_ts = time.monotonic()
        logger.debug(
            "Alert cache refreshed: %d alerts across %d symbols",
            sum(len(v) for v in by_sym.values()),
            len(by_sym),
        )

    def invalidate_cache(self) -> None:
        """Force next check_alerts() to reload from DB."""
        self._cache_ts = 0.0

    def all_alert_symbols(self) -> set[str]:
        """Symbols with at least one ACTIVE alert (for poll-set union)."""
        return set(self._by_symbol.keys())

    # ── Evaluation ────────────────────────────────────────────────────────

    @staticmethod
    def evaluate(alert: AlertSnapshot, spot: Decimal) -> bool:
        """Pure function: does *spot* satisfy the alert condition?"""
        t = alert.alert_type
        if t == AlertType.PRICE_ABOVE:
            return spot >= alert.threshold
        if t == AlertType.PRICE_BELOW:
            return spot <= alert.threshold
        if t == AlertType.PCT_CHANGE_UP:
            ref = alert.reference_price
            if ref is None or ref == 0:
                return False
            target = ref * (1 + alert.threshold / 100)
            return spot >= target
        if t == AlertType.PCT_CHANGE_DOWN:
            ref = alert.reference_price
            if ref is None or ref == 0:
                return False
            target = ref * (1 - alert.threshold / 100)
            return spot <= target
        return False

    def _in_cooldown(self, alert_id: int, cooldown_secs: int) -> bool:
        last = self._cooldowns.get(alert_id)
        if last is None:
            return False
        return (time.monotonic() - last) < cooldown_secs

    # ── Check + trigger ───────────────────────────────────────────────────

    async def check_alerts(self, changed: dict[str, Decimal]) -> None:
        """Evaluate cached alerts against changed prices and trigger hits."""
        await self.maybe_refresh()

        triggered: list[tuple[AlertSnapshot, Decimal]] = []

        for symbol, spot in changed.items():
            alerts = self._by_symbol.get(symbol.upper(), [])
            for alert in alerts:
                if not self.evaluate(alert, spot):
                    continue
                if self._in_cooldown(alert.id, alert.cooldown_seconds):
                    continue
                triggered.append((alert, spot))

        if not triggered:
            return

        await self._process_triggered(triggered)

    async def _process_triggered(
        self, triggered: list[tuple[AlertSnapshot, Decimal]]
    ) -> None:
        now_utc = datetime.now(timezone.utc)
        now_mono = time.monotonic()

        # Batch DB updates
        async with AsyncSessionLocal() as db:
            for snap, _spot in triggered:
                alert = await db.get(Alert, snap.id)
                if alert is None:
                    continue
                alert.triggered_at = now_utc
                alert.trigger_count = (alert.trigger_count or 0) + 1
                if not alert.repeat:
                    alert.status = AlertStatus.TRIGGERED
                db.add(alert)
            await db.commit()

        # Record cooldowns + remove one-shot from cache
        for snap, _spot in triggered:
            self._cooldowns[snap.id] = now_mono
            if not snap.repeat:
                syms = self._by_symbol.get(snap.symbol, [])
                self._by_symbol[snap.symbol] = [
                    a for a in syms if a.id != snap.id
                ]

        # WS broadcast
        for snap, spot in triggered:
            msg = {
                "type": "alert_triggered",
                "data": {
                    "alert_id": snap.id,
                    "symbol": snap.symbol,
                    "alert_type": snap.alert_type.value,
                    "threshold": str(snap.threshold),
                    "spot_price": str(spot),
                    "note": snap.note,
                    "triggered_at": now_utc.isoformat(),
                },
            }
            await self.manager.broadcast_to_user(snap.user_id, msg)
            logger.info(
                "Alert triggered: id=%d %s %s threshold=%s spot=%s",
                snap.id, snap.symbol, snap.alert_type.value,
                snap.threshold, spot,
            )
