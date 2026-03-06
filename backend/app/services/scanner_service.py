"""
Market Scanner Service — IV Rank / IV Percentile engine.

Polls yfinance for 1-year daily closes on a configurable symbol pool,
computes rolling 20-day historical volatility windows to derive:
  - IV Rank:       (current_HV - 52w_min) / (52w_max - 52w_min) -> 0-1
  - IV Percentile: count(rolling_HV < current_HV) / total_windows -> 0-1

Broadcasts `market_opportunity` messages via WebSocket to all connected users.
Also serves a REST snapshot via get_latest().

NOTE: Uses historical volatility as a free proxy for implied volatility.
"""
from __future__ import annotations

import asyncio
import logging
import math
from datetime import datetime, timezone
from decimal import Decimal

from app.config import settings
from app.services.ws_manager import ConnectionManager
from app.services.yfinance_client import (
    get_1y_closes,
    get_spot_prices_batch,
    is_screener_excluded,
    sync_screener_to_cache,
)

logger = logging.getLogger(__name__)

# Rolling window size for HV computation (trading days)
_HV_WINDOW = 20


def _compute_iv_metrics(closes: list[float]) -> dict | None:
    """
    Compute IV Rank and IV Percentile from 1-year daily closes.

    Returns dict with current_hv, iv_rank, iv_percentile, hv_52w_high, hv_52w_low
    or None if insufficient data.
    """
    if len(closes) < _HV_WINDOW + 5:
        return None

    # Compute log returns
    log_rets = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]

    # Compute rolling 20-day annualized HV for each window
    rolling_hvs: list[float] = []
    for i in range(_HV_WINDOW, len(log_rets) + 1):
        window = log_rets[i - _HV_WINDOW : i]
        n = len(window)
        mean = sum(window) / n
        var = sum((r - mean) ** 2 for r in window) / (n - 1)
        ann_vol = math.sqrt(var) * math.sqrt(252)
        rolling_hvs.append(ann_vol)

    if len(rolling_hvs) < 2:
        return None

    current_hv = rolling_hvs[-1]
    hv_min = min(rolling_hvs)
    hv_max = max(rolling_hvs)

    # IV Rank: where current HV sits in the 52-week range
    if hv_max - hv_min > 1e-8:
        iv_rank = (current_hv - hv_min) / (hv_max - hv_min)
    else:
        iv_rank = 0.5  # flat vol → neutral

    # IV Percentile: fraction of windows with HV below current
    below_count = sum(1 for hv in rolling_hvs if hv < current_hv)
    iv_percentile = below_count / len(rolling_hvs)

    return {
        "current_hv": round(current_hv, 4),
        "iv_rank": round(iv_rank, 4),
        "iv_percentile": round(iv_percentile, 4),
        "hv_52w_high": round(hv_max, 4),
        "hv_52w_low": round(hv_min, 4),
    }


def _generate_suggestion(iv_rank: float, iv_percentile: float) -> tuple[str, str]:
    """
    Rule-based suggestion from IV rank/percentile.
    Returns (suggestion_text, signal_enum).
    """
    if iv_rank > 0.80:
        return "IV elevated -- sell premium strategies favored", "HIGH_IV"
    if iv_rank > 0.60:
        return "IV above average -- consider selling spreads", "ELEVATED_IV"
    if iv_rank < 0.20:
        return "IV compressed -- buying options is cheap", "LOW_IV"
    return "Neutral -- no clear edge", "NEUTRAL"


class MarketScannerService:
    """
    Background scanner that computes IV metrics for a symbol pool
    and broadcasts opportunities via WebSocket.
    """

    def __init__(
        self,
        manager: ConnectionManager,
        poll_interval: float | None = None,
    ) -> None:
        self.manager = manager
        self.poll_interval = poll_interval or settings.scanner_poll_interval
        self.symbols = [
            s.strip().upper()
            for s in settings.scanner_symbols.split(",")
            if s.strip()
        ]
        self._latest: list[dict] = []
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._scan_loop())
            logger.info(
                "MarketScanner started: %d symbols, poll every %ds",
                len(self.symbols), self.poll_interval,
            )

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
            logger.info("MarketScanner stopped")

    def get_latest(self) -> list[dict]:
        """Return the most recent scan results (for REST snapshot)."""
        return list(self._latest)

    async def _scan_loop(self) -> None:
        """Main loop: pre-fill spot cache via screener, scan once, sleep 900s, repeat."""
        while True:
            try:
                await sync_screener_to_cache()
                await self._scan_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Scanner sweep failed")
            await asyncio.sleep(self.poll_interval)

    async def _scan_once(self) -> None:
        """Fetch 1y data for all symbols, compute metrics, broadcast."""
        # Fetch closes + batch spot prices concurrently (one FMP call for spots)
        close_tasks = [get_1y_closes(sym) for sym in self.symbols]
        all_closes, spot_map = await asyncio.gather(
            asyncio.gather(*close_tasks),
            get_spot_prices_batch(self.symbols),
        )

        opportunities: list[dict] = []
        for sym, closes in zip(self.symbols, all_closes):
            if is_screener_excluded(sym):
                logger.debug("Scanner: skipping %s (fund or low-volume)", sym)
                continue
            spot = spot_map.get(sym.upper())
            metrics = _compute_iv_metrics(closes)
            if metrics is None:
                continue

            suggestion, signal = _generate_suggestion(
                metrics["iv_rank"], metrics["iv_percentile"]
            )

            spot_str = str(spot) if spot else None

            opportunities.append({
                "symbol": sym,
                "spot_price": spot_str,
                "current_hv": str(metrics["current_hv"]),
                "iv_rank": str(metrics["iv_rank"]),
                "iv_percentile": str(metrics["iv_percentile"]),
                "hv_52w_high": str(metrics["hv_52w_high"]),
                "hv_52w_low": str(metrics["hv_52w_low"]),
                "suggestion": suggestion,
                "signal": signal,
            })

        # Store atomically
        self._latest = opportunities

        # Broadcast to all connected clients
        if opportunities:
            msg = {
                "type": "market_opportunity",
                "data": opportunities,
                "scanned_at": datetime.now(timezone.utc).isoformat(),
            }
            sent = await self.manager.broadcast_all(msg)
            logger.info(
                "Scanner broadcast: %d opportunities to %d clients",
                len(opportunities), sent,
            )
