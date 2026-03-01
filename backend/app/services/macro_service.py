"""
Phase 12a -- Macro Market Factor Integration.

Pure functions:
  classify_vix(level) -> str
  classify_regime(spx_change_pct, vix) -> str
  next_macro_event(today) -> (days | None, name | None)
  build_market_context(spx, spx_prev, vix, today) -> MarketContext

Background service:
  MacroService -- polls PriceCache for ^GSPC/^VIX, broadcasts macro_ticker.

Economic calendar:
  ECONOMIC_CALENDAR -- static list of upcoming high-impact events.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timezone

from app.schemas.ai import MarketContext

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Economic Calendar (static, updated quarterly)
# ---------------------------------------------------------------------------

ECONOMIC_CALENDAR: list[dict] = [
    {"date": "2026-03-07", "name": "NFP",  "impact": "high"},
    {"date": "2026-03-12", "name": "CPI",  "impact": "high"},
    {"date": "2026-03-18", "name": "FOMC", "impact": "high"},
    {"date": "2026-03-28", "name": "PCE",  "impact": "high"},
    {"date": "2026-04-04", "name": "NFP",  "impact": "high"},
    {"date": "2026-04-10", "name": "CPI",  "impact": "high"},
    {"date": "2026-04-29", "name": "FOMC", "impact": "high"},
    {"date": "2026-05-02", "name": "NFP",  "impact": "high"},
    {"date": "2026-05-13", "name": "CPI",  "impact": "high"},
    {"date": "2026-06-10", "name": "FOMC", "impact": "high"},
]


# ---------------------------------------------------------------------------
# Pure functions (testable, no I/O)
# ---------------------------------------------------------------------------

def classify_vix(level: float) -> str:
    """
    Classify VIX into term buckets.

    Returns: "low" | "normal" | "elevated" | "crisis"
    """
    if level < 15:
        return "low"
    if level < 20:
        return "normal"
    if level < 30:
        return "elevated"
    return "crisis"


def classify_regime(spx_change_pct: float, vix: float) -> str:
    """
    Determine market regime from SPX daily % change + VIX level.

    Returns: "low_vol_bullish" | "low_vol_range" | "rising_vol"
             | "high_vol_selloff" | "crisis"
    """
    if vix >= 30:
        return "crisis"
    if vix >= 25 and spx_change_pct < -0.5:
        return "high_vol_selloff"
    if vix >= 20:
        return "rising_vol"
    if spx_change_pct > 0.3:
        return "low_vol_bullish"
    return "low_vol_range"


def next_macro_event(today: date) -> tuple[int | None, str | None]:
    """
    Find the next upcoming macro event within 30 calendar days.

    Returns: (days_until_event, event_name) or (None, None) if nothing within 30d.
    """
    for entry in ECONOMIC_CALENDAR:
        event_date = date.fromisoformat(entry["date"])
        delta = (event_date - today).days
        if 0 <= delta <= 30:
            return delta, entry["name"]
    return None, None


def build_market_context(
    spx: float,
    spx_prev: float,
    vix: float,
    today: date,
) -> MarketContext:
    """
    Pure function: build MarketContext from raw market data.

    Args:
        spx:       current S&P 500 level
        spx_prev:  previous close (for % change calculation)
        vix:       current VIX level
        today:     current date (for calendar lookup)

    Returns:
        MarketContext with all derived fields computed.
    """
    change_pct = ((spx - spx_prev) / spx_prev * 100) if spx_prev > 0 else 0.0
    vix_term = classify_vix(vix)
    regime = classify_regime(change_pct, vix)
    days_to_event, event_name = next_macro_event(today)

    return MarketContext(
        spx_price=round(spx, 2),
        spx_change_pct=round(change_pct, 2),
        vix_level=round(vix, 2),
        vix_term=vix_term,
        days_to_next_event=days_to_event,
        next_event_name=event_name,
        market_regime=regime,
    )


# ---------------------------------------------------------------------------
# MacroService -- background poller
# ---------------------------------------------------------------------------

class MacroService:
    """
    Polls PriceCache for SPX/VIX every N seconds, builds MarketContext,
    and broadcasts macro_ticker via WS to all connected clients.
    """

    def __init__(
        self,
        manager,          # ConnectionManager
        cache,            # PriceCache
        poll_interval: float | None = None,
    ) -> None:
        from app.config import settings
        self._manager = manager
        self._cache = cache
        self._poll_interval = poll_interval or settings.macro_poll_interval
        self._latest: MarketContext | None = None
        self._spx_prev_close: float | None = None
        self._task: asyncio.Task | None = None

    # -- Lifecycle -----------------------------------------------------------

    def start(self) -> None:
        if self._task is not None:
            return
        self._task = asyncio.create_task(self._poll_loop(), name="macro_ticker")
        logger.info(
            "MacroService started (interval=%ds)", self._poll_interval,
        )

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("MacroService stopped")

    def get_latest(self) -> MarketContext | None:
        """Return the most recent MarketContext (for AiInsightService)."""
        return self._latest

    # -- Main loop -----------------------------------------------------------

    async def _poll_loop(self) -> None:
        while True:
            try:
                await self._poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("MacroService poll failed")
            await asyncio.sleep(self._poll_interval)

    async def _poll_once(self) -> None:
        """Read SPX/VIX from PriceCache, build context, broadcast."""
        from app.services.yfinance_client import get_spot_prices_batch

        # Try PriceCache first (populated by PriceFeedService)
        spx_price = self._cache.get("^GSPC")
        vix_price = self._cache.get("^VIX")

        # Fallback: direct fetch if not in cache
        if spx_price is None or vix_price is None:
            fetched = await get_spot_prices_batch(["^GSPC", "^VIX"])
            if spx_price is None:
                spx_price = fetched.get("^GSPC")
            if vix_price is None:
                vix_price = fetched.get("^VIX")

        if spx_price is None or vix_price is None:
            logger.debug("MacroService: SPX or VIX unavailable, skipping")
            return

        spx = float(spx_price)
        vix = float(vix_price)

        # Track prev close (first reading of the day)
        if self._spx_prev_close is None:
            self._spx_prev_close = spx

        today = date.today()
        ctx = build_market_context(spx, self._spx_prev_close, vix, today)
        self._latest = ctx

        # Broadcast to all connected clients
        msg = {
            "type": "macro_ticker",
            "data": {
                "spx_price": ctx.spx_price,
                "spx_change_pct": ctx.spx_change_pct,
                "vix_level": ctx.vix_level,
                "vix_term": ctx.vix_term,
                "days_to_next_event": ctx.days_to_next_event,
                "next_event_name": ctx.next_event_name,
                "market_regime": ctx.market_regime,
                "as_of": datetime.now(timezone.utc).isoformat(),
            },
        }
        sent = await self._manager.broadcast_all(msg)
        logger.debug(
            "Macro ticker broadcast: SPX=%.2f VIX=%.2f regime=%s -> %d clients",
            spx, vix, ctx.market_regime, sent,
        )
