"""
PriceFeedService — background asyncio task that polls yfinance and
broadcasts price updates + holdings changes via WebSocket.

Lifecycle:
  start() — called in FastAPI lifespan (startup)
  stop()  — called in FastAPI lifespan (shutdown)

Poll cycle:
  1. Collect all symbols subscribed by active WS connections
  2. Batch-fetch spot prices via yf.download() (or generate mock jitter)
  3. Diff against PriceCache → identify changed symbols
  4. Broadcast spot_update to subscribers
  4.5 Check price alerts against changed prices
  5. For each affected user/portfolio, recompute HoldingGroups and push holdings_update
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from app.config import settings
from app.database import AsyncSessionLocal
from app.services import position_engine, yfinance_client
from app.services.black_scholes import calculate_option_price
from app.services.holdings_engine import compute_holding_groups
from app.services.portfolio_resolver import resolve_portfolio_ids
from app.services.price_cache import PriceCache
from app.services.risk_engine import compute_risk_summary
from app.services.ws_manager import ConnectionManager

logger = logging.getLogger(__name__)

# Mock-mode seed prices (used when USE_MOCK_DATA=1)
_MOCK_SEED_PRICES: dict[str, Decimal] = {
    "SPY": Decimal("590.50"), "QQQ": Decimal("510.30"),
    "NVDA": Decimal("172.40"), "TSLA": Decimal("340.10"),
    "AAPL": Decimal("242.80"), "MSFT": Decimal("415.20"),
    "AMD": Decimal("120.60"), "AMZN": Decimal("210.90"),
    "META": Decimal("630.50"), "GOOGL": Decimal("180.70"),
}


# ── Shared vol cache (refreshes less often than spots) ────────────────────
_vol_cache: dict[str, Decimal] = {}
_vol_cache_ts: float = 0.0
_VOL_CACHE_TTL = 300.0  # 5 minutes


class PriceFeedService:
    """Background price poller + WebSocket broadcaster."""

    def __init__(
        self,
        manager: ConnectionManager,
        cache: PriceCache,
        poll_interval: float | None = None,
        alert_engine: "AlertEngine | None" = None,
    ) -> None:
        from app.services.alert_engine import AlertEngine  # noqa: F811

        self.manager = manager
        self.cache = cache
        self.poll_interval = poll_interval or settings.ws_price_poll_interval
        self.alert_engine: AlertEngine | None = alert_engine
        self._task: asyncio.Task | None = None
        self._running = False
        self._mock_mode = os.environ.get("USE_MOCK_DATA", "").strip() in ("1", "true", "yes")

    # ── Lifecycle ─────────────────────────────────────────────────────────

    def start(self) -> None:
        if self._task is not None:
            return
        self._running = True
        self._task = asyncio.create_task(self._poll_loop(), name="price_feed")
        logger.info("PriceFeedService started (interval=%ss)", self.poll_interval)

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("PriceFeedService stopped")

    def invalidate_alert_cache(self) -> None:
        """Force alert engine to reload from DB on next poll."""
        if self.alert_engine:
            self.alert_engine.invalidate_cache()

    # ── Main poll loop ────────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        while self._running:
            try:
                await self._poll_once()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("PriceFeed poll error")
            await asyncio.sleep(self.poll_interval)

    async def _poll_once(self) -> None:
        # 1. Collect symbols (WS subscribers + alert symbols + macro)
        symbols = self.manager.all_subscribed_symbols()
        if self.alert_engine:
            symbols = symbols | self.alert_engine.all_alert_symbols()
        # Phase 12a: always include macro index symbols for MacroService
        symbols = symbols | {"^GSPC", "^VIX"}
        if not symbols:
            return

        symbol_list = sorted(symbols)
        t0 = time.monotonic()

        # 2. Batch fetch (or mock jitter)
        if self._mock_mode:
            new_prices = self._generate_mock_prices(symbol_list)
        else:
            new_prices = await yfinance_client.get_spot_prices_batch(symbol_list)
        if not new_prices:
            return

        fetch_ms = (time.monotonic() - t0) * 1000
        logger.debug(
            "Price fetch: %d symbols in %.0fms  (got %d prices)%s",
            len(symbol_list), fetch_ms, len(new_prices),
            " [MOCK]" if self._mock_mode else "",
        )

        # 3. Diff against cache
        changed = self.cache.update_and_diff(new_prices)
        if not changed:
            return

        logger.info(
            "Prices changed: %s  cache_stats=%s",
            {s: str(p) for s, p in changed.items()},
            self.cache.stats(),
        )

        # 4. Broadcast spot_update to affected subscribers
        # Enrich with intraday change / changesPercentage from FMP quote cache
        change_map: dict[str, str] = {}
        changepct_map: dict[str, str] = {}
        for sym in changed:
            c = yfinance_client.get_change_cached(sym)
            cp = yfinance_client.get_changepct_cached(sym)
            if c is not None:
                change_map[sym] = str(c)
            if cp is not None:
                changepct_map[sym] = str(cp)

        spot_msg = {
            "type": "spot_update",
            "data": {s: str(p) for s, p in changed.items()},
            "change": change_map,
            "changepct": changepct_map,
        }
        # Send to all connections that have at least one changed symbol
        for conn in list(self.manager._connections.values()):
            if conn.subscribed_symbols & set(changed.keys()):
                await self.manager.send_json(conn.ws, spot_msg)

        # 4.5 Check price alerts
        if self.alert_engine and changed:
            try:
                await self.alert_engine.check_alerts(changed)
            except Exception:
                logger.exception("Alert check error")

        # 5. Recompute holdings for affected users/portfolios
        await self._broadcast_holdings_updates(changed)

    # ── Holdings recomputation & broadcast ────────────────────────────────

    async def _broadcast_holdings_updates(
        self, changed_prices: dict[str, Decimal]
    ) -> None:
        """
        For each active subscription affected by price changes,
        recompute HoldingGroups and push holdings_update.
        """
        global _vol_cache, _vol_cache_ts

        # Refresh vol cache if stale
        now = time.monotonic()
        if now - _vol_cache_ts > _VOL_CACHE_TTL:
            all_syms = list(self.manager.all_subscribed_symbols())
            if all_syms:
                vols = await asyncio.gather(
                    *[yfinance_client.get_hist_vol(s) for s in all_syms]
                )
                _vol_cache = dict(zip(all_syms, vols))
                _vol_cache_ts = now
                logger.debug("Vol cache refreshed: %d symbols", len(all_syms))

        # Build full spot map from cache
        all_spots = self.cache.all_prices()

        # Deduplicate: {(user_id, portfolio_id)} that need updates
        seen: set[tuple[int, int]] = set()

        for conn in list(self.manager._connections.values()):
            # Check if this connection cares about any changed symbol
            if not (conn.subscribed_symbols & set(changed_prices.keys())):
                continue

            for pid in conn.subscribed_portfolio_ids:
                key = (conn.user_id, pid)
                if key in seen:
                    continue
                seen.add(key)

                try:
                    await self._compute_and_send_holdings(
                        conn.user_id, pid, all_spots
                    )
                except Exception:
                    logger.exception(
                        "Holdings update failed: user=%d pid=%d",
                        conn.user_id, pid,
                    )

    async def _compute_and_send_holdings(
        self,
        user_id: int,
        portfolio_id: int,
        spot_map: dict[str, Decimal],
    ) -> None:
        """Compute HoldingGroups for one user/portfolio and broadcast."""
        async with AsyncSessionLocal() as db:
            pids = await resolve_portfolio_ids(db, user_id, portfolio_id)
            positions = await position_engine.calculate_positions(
                db, portfolio_ids=pids
            )

        if not positions:
            return

        # Build spot/vol maps for this portfolio's symbols
        symbols = list({pos.instrument.symbol for pos in positions})
        port_spot = {s: spot_map.get(s) for s in symbols}
        port_vol  = {s: _vol_cache.get(s, Decimal("0.30")) for s in symbols}

        # ── Track 1: Heatmap % — underlying's price performance ──────────────
        # get_perf_cached reads from pre-warmed _last_known cache (zero API calls
        # when warm).  Returns the underlying's daily/weekly/monthly % move —
        # consistent across stocks and option underlyings.
        perf_results = await asyncio.gather(
            *[yfinance_client.get_perf_cached(s) for s in symbols],
            return_exceptions=True,
        )
        port_perf: dict[str, dict] = {}
        for sym, result in zip(symbols, perf_results):
            if isinstance(result, dict):
                port_perf[sym] = result

        # ── Track 2: BS $ P&L — mark-to-market precision per group ───────────
        # For options: Σ (BS(spot_now) - BS(prev_close)) × net_contracts × 100
        # For stocks:  Σ net_shares × (spot_now - prev_close)
        # This drives the hero "Daily Unrealized P&L" card.
        _today = date.today()
        _r_f = Decimal(str(settings.risk_free_rate))
        bs_pnl_map: dict[str, Decimal] = {}

        for sym in symbols:
            spot = port_spot.get(sym)
            prev_close = yfinance_client.get_prev_close_cached_only(sym)
            if spot is None or prev_close is None:
                continue

            group_pnl = Decimal("0")
            for pos in positions:
                if pos.instrument.symbol != sym:
                    continue
                inst = pos.instrument
                if inst.instrument_type.value == "OPTION":
                    if not (inst.option_type and inst.strike and inst.expiry):
                        continue
                    dte = (inst.expiry - _today).days
                    T = Decimal(str(max(dte, 0) / 365.0))
                    if T <= 0:
                        continue
                    vol = port_vol.get(sym, Decimal("0.30"))
                    otype = inst.option_type.value
                    mark_now  = calculate_option_price(spot,       inst.strike, T, otype, vol, _r_f)
                    mark_prev = calculate_option_price(prev_close, inst.strike, T, otype, vol, _r_f)
                    multiplier = inst.multiplier or 100
                    group_pnl += (mark_now - mark_prev) * Decimal(str(pos.net_contracts)) * Decimal(str(multiplier))
                else:
                    # Stock / ETF: simple (spot - prev_close) × shares
                    group_pnl += (spot - prev_close) * Decimal(str(pos.net_contracts))

            bs_pnl_map[sym] = group_pnl.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        groups = compute_holding_groups(
            positions, port_spot, port_vol,
            perf_map=port_perf or None,
            bs_pnl_map=bs_pnl_map or None,
        )

        # Serialize via Pydantic
        holdings_msg = {
            "type": "holdings_update",
            "portfolio_id": portfolio_id,
            "data": [g.model_dump(mode="json") for g in groups],
        }
        await self.manager.broadcast_to_user(user_id, holdings_msg)

        # ── Also compute and broadcast risk_update ───────────────────
        risk_summary = compute_risk_summary(positions, port_spot, port_vol)
        risk_msg = {
            "type": "risk_update",
            "portfolio_id": portfolio_id,
            "data": {
                "total_net_delta": str(risk_summary["total_net_delta"]),
                "total_gamma": str(risk_summary["total_gamma"]),
                "total_theta_daily": str(risk_summary["total_theta_daily"]),
                "total_vega": str(risk_summary["total_vega"]),
                "maintenance_margin_total": str(risk_summary["maintenance_margin_total"]),
                "var_1d_95": str(risk_summary["var_1d_95"]) if risk_summary["var_1d_95"] else None,
                "positions_count": risk_summary["positions_count"],
                "risk_alerts": risk_summary["risk_alerts"],
            },
        }
        await self.manager.broadcast_to_user(user_id, risk_msg)

    # ── Mock-mode helpers ──────────────────────────────────────────────────

    def _generate_mock_prices(
        self, symbols: list[str]
    ) -> dict[str, Decimal]:
        """
        Generate random +/-0.05% jitter from cached or seed prices.
        Enables live demos without a market-data feed.
        """
        current = self.cache.all_prices()
        result: dict[str, Decimal] = {}
        for sym in symbols:
            base = current.get(sym) or _MOCK_SEED_PRICES.get(sym)
            if base is None:
                continue
            jitter = Decimal(str(random.uniform(-0.0005, 0.0005)))
            new_price = (base * (1 + jitter)).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            result[sym] = new_price
        return result
