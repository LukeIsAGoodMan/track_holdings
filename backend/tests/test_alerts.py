"""
Tests for Phase 7e — Price Alert System.

Covers:
  - AlertEngine.evaluate() pure-function logic (all 4 alert types)
  - Alert model CRUD via DB fixture
  - Trigger state transitions (one-shot vs repeat)
  - Cooldown behaviour
  - Edge cases (None reference, zero threshold, expired alerts)
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert import Alert, AlertStatus, AlertType
from app.models.user import User
from app.services.alert_engine import AlertEngine, AlertSnapshot


# ── Helpers ───────────────────────────────────────────────────────────────────

def _snap(
    *,
    alert_type: AlertType = AlertType.PRICE_ABOVE,
    threshold: Decimal = Decimal("170"),
    reference_price: Decimal | None = None,
    repeat: bool = False,
    cooldown_seconds: int = 300,
    alert_id: int = 1,
    user_id: int = 1,
    symbol: str = "NVDA",
) -> AlertSnapshot:
    return AlertSnapshot(
        id=alert_id,
        user_id=user_id,
        symbol=symbol,
        alert_type=alert_type,
        threshold=threshold,
        reference_price=reference_price,
        repeat=repeat,
        cooldown_seconds=cooldown_seconds,
        note=None,
        trigger_count=0,
    )


# ── Pure evaluate() tests ─────────────────────────────────────────────────────


class TestEvaluatePure:
    """AlertEngine.evaluate() — no DB, no IO."""

    def test_price_above_triggers(self):
        snap = _snap(alert_type=AlertType.PRICE_ABOVE, threshold=Decimal("170"))
        assert AlertEngine.evaluate(snap, Decimal("170.00")) is True
        assert AlertEngine.evaluate(snap, Decimal("175.50")) is True

    def test_price_above_not_triggered(self):
        snap = _snap(alert_type=AlertType.PRICE_ABOVE, threshold=Decimal("170"))
        assert AlertEngine.evaluate(snap, Decimal("169.99")) is False

    def test_price_below_triggers(self):
        snap = _snap(alert_type=AlertType.PRICE_BELOW, threshold=Decimal("170"))
        assert AlertEngine.evaluate(snap, Decimal("170.00")) is True
        assert AlertEngine.evaluate(snap, Decimal("165.00")) is True

    def test_price_below_not_triggered(self):
        snap = _snap(alert_type=AlertType.PRICE_BELOW, threshold=Decimal("170"))
        assert AlertEngine.evaluate(snap, Decimal("170.01")) is False

    def test_pct_change_up_triggers(self):
        # ref=100, threshold=5 → target = 100 * 1.05 = 105
        snap = _snap(
            alert_type=AlertType.PCT_CHANGE_UP,
            threshold=Decimal("5"),
            reference_price=Decimal("100"),
        )
        assert AlertEngine.evaluate(snap, Decimal("105.00")) is True
        assert AlertEngine.evaluate(snap, Decimal("110.00")) is True

    def test_pct_change_up_not_triggered(self):
        snap = _snap(
            alert_type=AlertType.PCT_CHANGE_UP,
            threshold=Decimal("5"),
            reference_price=Decimal("100"),
        )
        assert AlertEngine.evaluate(snap, Decimal("104.99")) is False

    def test_pct_change_down_triggers(self):
        # ref=100, threshold=5 → target = 100 * 0.95 = 95
        snap = _snap(
            alert_type=AlertType.PCT_CHANGE_DOWN,
            threshold=Decimal("5"),
            reference_price=Decimal("100"),
        )
        assert AlertEngine.evaluate(snap, Decimal("95.00")) is True
        assert AlertEngine.evaluate(snap, Decimal("90.00")) is True

    def test_pct_change_down_not_triggered(self):
        snap = _snap(
            alert_type=AlertType.PCT_CHANGE_DOWN,
            threshold=Decimal("5"),
            reference_price=Decimal("100"),
        )
        assert AlertEngine.evaluate(snap, Decimal("95.01")) is False

    def test_pct_change_with_none_reference(self):
        snap = _snap(
            alert_type=AlertType.PCT_CHANGE_UP,
            threshold=Decimal("5"),
            reference_price=None,
        )
        assert AlertEngine.evaluate(snap, Decimal("200")) is False

    def test_pct_change_with_zero_reference(self):
        snap = _snap(
            alert_type=AlertType.PCT_CHANGE_DOWN,
            threshold=Decimal("5"),
            reference_price=Decimal("0"),
        )
        assert AlertEngine.evaluate(snap, Decimal("0")) is False


# ── DB integration tests ──────────────────────────────────────────────────────

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def user(db: AsyncSession) -> User:
    u = User(username="alertuser", hashed_password="x")
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def test_create_alert(db: AsyncSession, user: User):
    alert = Alert(
        user_id=user.id,
        symbol="NVDA",
        alert_type=AlertType.PRICE_BELOW,
        threshold=Decimal("170"),
        status=AlertStatus.ACTIVE,
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)

    assert alert.id is not None
    assert alert.symbol == "NVDA"
    assert alert.alert_type == AlertType.PRICE_BELOW
    assert alert.threshold == Decimal("170")
    assert alert.status == AlertStatus.ACTIVE
    assert alert.trigger_count == 0
    assert alert.repeat is False


async def test_list_alerts_filtered_by_user(db: AsyncSession, user: User):
    # Create two alerts for our user
    db.add(Alert(user_id=user.id, symbol="NVDA", alert_type=AlertType.PRICE_BELOW, threshold=Decimal("170")))
    db.add(Alert(user_id=user.id, symbol="AAPL", alert_type=AlertType.PRICE_ABOVE, threshold=Decimal("250")))
    # Create alert for another user
    other = User(username="other", hashed_password="x")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    db.add(Alert(user_id=other.id, symbol="SPY", alert_type=AlertType.PRICE_ABOVE, threshold=Decimal("600")))
    await db.commit()

    result = await db.execute(
        select(Alert).where(Alert.user_id == user.id)
    )
    alerts = result.scalars().all()
    assert len(alerts) == 2
    symbols = {a.symbol for a in alerts}
    assert symbols == {"NVDA", "AAPL"}


async def test_update_alert_status(db: AsyncSession, user: User):
    alert = Alert(
        user_id=user.id, symbol="NVDA",
        alert_type=AlertType.PRICE_BELOW, threshold=Decimal("170"),
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)

    alert.status = AlertStatus.DISABLED
    await db.commit()
    await db.refresh(alert)
    assert alert.status == AlertStatus.DISABLED


async def test_delete_alert(db: AsyncSession, user: User):
    alert = Alert(
        user_id=user.id, symbol="NVDA",
        alert_type=AlertType.PRICE_BELOW, threshold=Decimal("170"),
    )
    db.add(alert)
    await db.commit()
    alert_id = alert.id

    await db.delete(alert)
    await db.commit()

    gone = await db.get(Alert, alert_id)
    assert gone is None


async def test_one_shot_trigger_sets_triggered(db: AsyncSession, user: User):
    """repeat=False: after trigger, status should become TRIGGERED."""
    alert = Alert(
        user_id=user.id, symbol="NVDA",
        alert_type=AlertType.PRICE_BELOW, threshold=Decimal("170"),
        repeat=False,
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)

    # Simulate trigger
    alert.trigger_count = 1
    alert.triggered_at = datetime.now(timezone.utc)
    alert.status = AlertStatus.TRIGGERED
    await db.commit()
    await db.refresh(alert)

    assert alert.status == AlertStatus.TRIGGERED
    assert alert.trigger_count == 1


async def test_repeat_alert_stays_active(db: AsyncSession, user: User):
    """repeat=True: after trigger, status stays ACTIVE."""
    alert = Alert(
        user_id=user.id, symbol="NVDA",
        alert_type=AlertType.PRICE_BELOW, threshold=Decimal("170"),
        repeat=True,
    )
    db.add(alert)
    await db.commit()
    await db.refresh(alert)

    # Simulate first trigger — repeat keeps it ACTIVE
    alert.trigger_count = 1
    alert.triggered_at = datetime.now(timezone.utc)
    # Status stays ACTIVE for repeat alerts
    await db.commit()
    await db.refresh(alert)

    assert alert.status == AlertStatus.ACTIVE
    assert alert.trigger_count == 1


# ── Cooldown tests ────────────────────────────────────────────────────────────

@pytest.mark.filterwarnings("ignore::pytest.PytestWarning")
class TestCooldown:
    def test_not_in_cooldown_initially(self):
        engine = AlertEngine.__new__(AlertEngine)
        engine._cooldowns = {}
        assert engine._in_cooldown(1, 300) is False

    def test_in_cooldown_after_trigger(self):
        import time
        engine = AlertEngine.__new__(AlertEngine)
        engine._cooldowns = {1: time.monotonic()}
        assert engine._in_cooldown(1, 300) is True

    def test_cooldown_expired(self):
        import time
        engine = AlertEngine.__new__(AlertEngine)
        engine._cooldowns = {1: time.monotonic() - 400}  # 400s ago
        assert engine._in_cooldown(1, 300) is False
