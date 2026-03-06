"""
NlvSamplerService — 30-second background loop that computes Net Liquidation
Value for each subscribed (user, portfolio) pair and broadcasts intraday
P&L snapshots via WebSocket.

NLV = cash_balance + stock_mtm + option_mtm
  stock_mtm  = spot * net_shares                                     (multiplier=1)
  option_mtm = calculate_option_price(S,K,T,type,sigma) * net * 100  (signed)

For short positions (net_contracts < 0) the mark-to-market is NEGATIVE
(a liability the portfolio owes to close the position).

Lifecycle:
  start() — called in FastAPI lifespan (startup)
  stop()  — called in FastAPI lifespan (shutdown)
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
import random
import time
from collections import deque
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import InstrumentType
from app.models.cash_ledger import CashLedger
from app.services import position_engine
from app.services.black_scholes import (
    DEFAULT_SIGMA,
    calculate_option_price,
)
from app.services.portfolio_resolver import resolve_portfolio_ids
from app.services.price_cache import PriceCache
from app.services.ws_manager import ConnectionManager

from sqlalchemy import func, select

logger = logging.getLogger(__name__)

# ── Data structures ──────────────────────────────────────────────────────────

@dataclass(frozen=True, slots=True)
class NLVSample:
    """Single NLV observation — immutable, no ORM binding."""
    timestamp: str      # "HH:MM:SS"
    nlv: Decimal
    unrealized_pnl: Decimal   # nlv - prev_close_nlv


# ── Pure NLV computation (testable, no side effects) ─────────────────────────

def compute_nlv(
    cash_balance: Decimal,
    positions: list,          # list[PositionRow]
    spot_map: dict[str, Decimal | None],
    vol_map: dict[str, Decimal],
) -> Decimal:
    """
    Compute true Net Liquidation Value.

    NLV = cash + SUM(stock mark-to-market) + SUM(option mark-to-market)

    Short option MtM is negative (liability): BS_price * negative_net * 100.
    Long  option MtM is positive (asset):     BS_price * positive_net * 100.
    """
    nlv = cash_balance
    today = date.today()
    r_f = Decimal(str(settings.risk_free_rate))

    for pos in positions:
        inst = pos.instrument
        spot = spot_map.get(inst.symbol)
        if spot is None or spot <= 0:
            continue

        # Stock / ETF: MtM = spot * net_shares (multiplier=1)
        if inst.instrument_type == InstrumentType.STOCK or inst.option_type is None:
            nlv += spot * Decimal(str(pos.net_contracts))
            continue

        # Option: MtM = BS_price * net_contracts * 100
        if inst.expiry is None:
            continue

        dte = (inst.expiry - today).days
        T = Decimal(str(max(dte, 0) / 365.0))
        sigma = vol_map.get(inst.symbol, DEFAULT_SIGMA)

        bs_price = calculate_option_price(
            S=spot, K=inst.strike, T=T,
            option_type=inst.option_type.value,
            sigma=sigma, r=r_f,
        )
        # signed: negative net_contracts → negative MtM (liability)
        nlv += bs_price * Decimal(str(pos.net_contracts)) * Decimal("100")

    return nlv.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ── Service class ────────────────────────────────────────────────────────────

# Reference to the shared vol cache in price_feed (avoid duplicate fetches)
_VOL_CACHE_REF: dict[str, Decimal] | None = None


def set_vol_cache_ref(cache: dict[str, Decimal]) -> None:
    """Called from main.py to share the price_feed vol cache."""
    global _VOL_CACHE_REF
    _VOL_CACHE_REF = cache


class NlvSamplerService:
    """Background NLV sampler — broadcasts pnl_snapshot every N seconds."""

    def __init__(
        self,
        manager: ConnectionManager,
        cache: PriceCache,
        poll_interval: float | None = None,
    ) -> None:
        self.manager = manager
        self.cache = cache
        self.poll_interval = poll_interval or settings.nlv_sample_interval
        self._task: asyncio.Task | None = None
        self._running = False
        self._mock_mode = os.environ.get("USE_MOCK_DATA", "").strip() in (
            "1", "true", "yes",
        )

        # In-memory rolling buffers: (user_id, portfolio_id) → deque[NLVSample]
        self._buffers: dict[tuple[int, int], deque[NLVSample]] = {}

        # Previous close NLV per (user, portfolio) — baseline for unrealized_pnl
        self._prev_close: dict[tuple[int, int], Decimal] = {}

        # Track current date for midnight rollover
        self._current_date: str = date.today().isoformat()

        # Mock state
        self._mock_nlv: dict[tuple[int, int], Decimal] = {}
        self._mock_tick: int = 0

    # ── Lifecycle ────────────────────────────────────────────────────────────

    def start(self) -> None:
        if self._task is not None:
            return
        self._running = True
        self._task = asyncio.create_task(self._poll_loop(), name="nlv_sampler")
        logger.info(
            "NlvSamplerService started (interval=%ss, mock=%s)",
            self.poll_interval, self._mock_mode,
        )

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("NlvSamplerService stopped")

    # ── Main loop ────────────────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        while self._running:
            try:
                await self._sample_once()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("NLV sampler error")
            await asyncio.sleep(self.poll_interval)

    async def _sample_once(self) -> None:
        # Midnight rollover check
        today_str = date.today().isoformat()
        if today_str != self._current_date:
            self._handle_date_rollover(today_str)

        # Collect unique (user_id, portfolio_id) pairs from active connections
        seen: set[tuple[int, int]] = set()
        for conn in list(self.manager._connections.values()):
            for pid in conn.subscribed_portfolio_ids:
                seen.add((conn.user_id, pid))

        if not seen:
            return

        now_ts = datetime.now().strftime("%H:%M:%S")

        for user_id, portfolio_id in seen:
            try:
                await self._compute_and_broadcast(
                    user_id, portfolio_id, now_ts,
                )
            except Exception:
                logger.exception(
                    "NLV sample failed: user=%d pid=%d", user_id, portfolio_id,
                )

    async def _compute_prev_close_nlv(
        self, user_id: int, portfolio_id: int,
    ) -> Decimal | None:
        """
        Compute NLV baseline using FMP previousClose prices.

        Fetches yesterday's official closing price for every holding,
        then reuses compute_nlv() with that prev_close price map.
        Returns None if no positions or prev_close data unavailable.
        """
        from app.services.yfinance_client import get_prev_close

        async with AsyncSessionLocal() as db:
            pids = await resolve_portfolio_ids(db, user_id, portfolio_id)
            cash_result = await db.execute(
                select(func.coalesce(func.sum(CashLedger.amount), 0))
                .where(CashLedger.portfolio_id.in_(pids))
            )
            cash_balance = Decimal(str(cash_result.scalar_one()))
            positions = await position_engine.calculate_positions(
                db, portfolio_ids=pids,
            )

        if not positions:
            return None

        unique_syms = list({
            pos.instrument.symbol
            for pos in positions
            if pos.instrument is not None
        })
        prev_prices = await asyncio.gather(*[get_prev_close(s) for s in unique_syms])
        prev_map: dict[str, Decimal | None] = dict(zip(unique_syms, prev_prices))

        vol_map: dict[str, Decimal] = {}
        if _VOL_CACHE_REF is not None:
            vol_map = dict(_VOL_CACHE_REF)

        result = compute_nlv(cash_balance, positions, prev_map, vol_map)
        return result if result != Decimal("0.00") else None

    async def _compute_and_broadcast(
        self,
        user_id: int,
        portfolio_id: int,
        now_ts: str,
    ) -> None:
        key = (user_id, portfolio_id)

        if self._mock_mode:
            nlv = self._generate_mock_nlv(key)
        else:
            nlv = await self._compute_real_nlv(user_id, portfolio_id)

        # Set daily P&L baseline from FMP previousClose (not from first live sample)
        if key not in self._prev_close:
            if not self._mock_mode:
                prev_nlv = await self._compute_prev_close_nlv(user_id, portfolio_id)
                self._prev_close[key] = prev_nlv if prev_nlv is not None else nlv
            # mock mode: _generate_mock_nlv() already initialises _prev_close[key]

        prev = self._prev_close[key]
        unrealized = nlv - prev

        sample = NLVSample(
            timestamp=now_ts,
            nlv=nlv,
            unrealized_pnl=unrealized,
        )

        # Append to rolling buffer
        if key not in self._buffers:
            self._buffers[key] = deque(maxlen=480)
        self._buffers[key].append(sample)

        # Day P&L percentage
        if prev != Decimal("0"):
            day_pnl_pct = (unrealized / abs(prev) * Decimal("100")).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP,
            )
        else:
            day_pnl_pct = Decimal("0")

        # Build WS message
        series = [
            {"t": s.timestamp, "nlv": str(s.nlv), "pnl": str(s.unrealized_pnl)}
            for s in self._buffers[key]
        ]

        msg = {
            "type": "pnl_snapshot",
            "portfolio_id": portfolio_id,
            "data": {
                "current": {
                    "timestamp": now_ts,
                    "nlv": str(nlv),
                    "unrealized_pnl": str(unrealized),
                },
                "prev_close_nlv": str(prev),
                "day_pnl_pct": str(day_pnl_pct),
                "series": series,
            },
        }
        await self.manager.broadcast_to_user(user_id, msg)

    # ── Real NLV computation ─────────────────────────────────────────────────

    async def _compute_real_nlv(
        self, user_id: int, portfolio_id: int,
    ) -> Decimal:
        async with AsyncSessionLocal() as db:
            # Resolve portfolio hierarchy
            pids = await resolve_portfolio_ids(db, user_id, portfolio_id)

            # Cash balance: SUM(amount) from cash_ledger
            cash_result = await db.execute(
                select(func.coalesce(func.sum(CashLedger.amount), 0))
                .where(CashLedger.portfolio_id.in_(pids))
            )
            cash_balance = Decimal(str(cash_result.scalar_one()))

            # Positions
            positions = await position_engine.calculate_positions(
                db, portfolio_ids=pids,
            )

        # Spot prices from shared cache
        spot_map = self.cache.all_prices()

        # Vol map from shared price_feed cache
        vol_map: dict[str, Decimal] = {}
        if _VOL_CACHE_REF is not None:
            vol_map = dict(_VOL_CACHE_REF)

        return compute_nlv(cash_balance, positions, spot_map, vol_map)

    # ── Date rollover ────────────────────────────────────────────────────────

    def _handle_date_rollover(self, new_date: str) -> None:
        """Archive current NLV as prev_close, clear buffers for new day."""
        logger.info("NLV date rollover: %s -> %s", self._current_date, new_date)

        # Last sample's NLV becomes the new prev_close
        for key, buf in self._buffers.items():
            if buf:
                self._prev_close[key] = buf[-1].nlv

        # Clear all buffers for the new day
        self._buffers.clear()
        self._current_date = new_date
        self._mock_tick = 0

    # ── Mock-mode NLV generation ─────────────────────────────────────────────

    def _generate_mock_nlv(self, key: tuple[int, int]) -> Decimal:
        """
        Generate synthetic NLV using random walk (+-0.03%) with sine drift.

        Produces a smooth intraday curve that mimics:
        - Morning volatility (wider swings)
        - Midday calm (tighter range)
        - Afternoon trend (slight directional move)
        """
        self._mock_tick += 1

        if key not in self._mock_nlv:
            # Seed base NLV — typical small options portfolio
            self._mock_nlv[key] = Decimal("52750.00")
            # Set prev_close slightly different for visible P&L
            if key not in self._prev_close:
                self._prev_close[key] = Decimal("52500.00")

        base = self._mock_nlv[key]

        # Random walk: +-0.03% normally distributed
        jitter = Decimal(str(random.gauss(0, 0.0003)))

        # Sine drift: smooth intraday pattern (period ~4h = 480 ticks at 30s)
        # Amplitude: ~0.15% of NLV
        t = self._mock_tick
        sine_component = Decimal(str(
            0.0015 * math.sin(2 * math.pi * t / 480)
        ))

        # Slight upward bias (0.001% per tick)
        drift = Decimal("0.00001")

        factor = Decimal("1") + jitter + sine_component + drift
        new_nlv = (base * factor).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP,
        )
        self._mock_nlv[key] = new_nlv
        return new_nlv
