"""
WebSocket Snapshot Service — fault-isolated initial data pipeline.

On subscribe, orchestrates a multi-step snapshot:
  1. snapshot_status: "starting"
  2. spot_update (from price cache)
  3. macro_ticker (from macro service)
  4. holdings_update (DB + computation)
  5. risk_update (from positions)
  6. snapshot_status: "complete"

Each step:
  - is independently try/except guarded
  - emits snapshot_error on failure (does NOT crash session)
  - never blocks other steps
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import WebSocket

from app.database import AsyncSessionLocal
from app.services import position_engine, yfinance_client
from app.services.holdings_engine import compute_holding_groups
from app.services.portfolio_resolver import resolve_portfolio_ids
from app.services.risk_engine import compute_risk_summary
from app.services.ws_session import WSSession

logger = logging.getLogger(__name__)


class WSSnapshotService:
    """Orchestrates fault-isolated initial snapshots on subscribe."""

    def __init__(self, manager, cache, macro_service=None, price_feed=None):
        self._manager = manager
        self._cache = cache
        self._macro_service = macro_service
        self._price_feed = price_feed

    async def send_snapshot(
        self, session: WSSession, portfolio_id: int,
    ) -> None:
        """Run the full snapshot pipeline for a subscription.

        Each step is isolated — a failure in one step does NOT prevent
        subsequent steps from executing.
        """
        ws = session.ws
        ctx = f"{session.log_ctx} pid={portfolio_id}"

        # Phase 1: signal start
        await self._send(ws, {
            "type": "snapshot_status",
            "portfolio_id": portfolio_id,
            "status": "starting",
        })

        logger.info("Snapshot starting: %s", ctx)

        # Phase 2: spot snapshot (from cache — fast, no network)
        symbols = await self._step_spot(ws, session.user_id, portfolio_id, ctx)

        # Phase 3: macro ticker
        await self._step_macro(ws, ctx)

        # Phase 4+5: holdings + risk (requires DB + computation)
        await self._step_holdings_risk(ws, session.user_id, portfolio_id, symbols, ctx)

        # Phase 6: signal complete
        await self._send(ws, {
            "type": "snapshot_status",
            "portfolio_id": portfolio_id,
            "status": "complete",
        })

        logger.info("Snapshot complete: %s", ctx)

    # ── Individual steps ─────────────────────────────────────────────────

    async def _step_spot(
        self, ws: WebSocket, user_id: int, portfolio_id: int, ctx: str,
    ) -> set[str]:
        """Send cached spot prices. Returns resolved symbols for later steps."""
        symbols: set[str] = set()
        try:
            async with AsyncSessionLocal() as db:
                pids = await resolve_portfolio_ids(db, user_id, portfolio_id)
                from sqlalchemy import select
                from app.models import Instrument, TradeEvent
                result = await db.execute(
                    select(Instrument.symbol)
                    .join(TradeEvent, TradeEvent.instrument_id == Instrument.id)
                    .where(TradeEvent.portfolio_id.in_(pids))
                    .distinct()
                )
                symbols = {row[0] for row in result.all()}

            cached = self._cache.get_many(sorted(symbols))
            if cached:
                changepct_map: dict[str, str] = {}
                for sym in cached:
                    cp = yfinance_client.get_changepct_cached(sym)
                    if cp is not None:
                        changepct_map[sym] = str(cp)
                await self._send(ws, {
                    "type": "spot_update",
                    "data": {s: str(p) for s, p in cached.items()},
                    "changepct": changepct_map,
                })
        except Exception:
            logger.exception("Snapshot spot failed: %s", ctx)
            await self._send_error(ws, portfolio_id, "spot")
        return symbols

    async def _step_macro(self, ws: WebSocket, ctx: str) -> None:
        """Send current macro state."""
        try:
            if self._macro_service is None:
                return
            macro_ctx = self._macro_service.get_latest()
            if macro_ctx is None:
                return
            await self._send(ws, {
                "type": "macro_ticker",
                "data": {
                    "spx_price":          macro_ctx.spx_price,
                    "spx_change_pct":     macro_ctx.spx_change_pct,
                    "vix_level":          macro_ctx.vix_level,
                    "vix_term":           macro_ctx.vix_term,
                    "days_to_next_event": macro_ctx.days_to_next_event,
                    "next_event_name":    macro_ctx.next_event_name,
                    "market_regime":      macro_ctx.market_regime,
                    "as_of":              datetime.now(timezone.utc).isoformat(),
                },
            })
        except Exception:
            logger.exception("Snapshot macro failed: %s", ctx)
            # macro is non-critical, no error emission

    async def _step_holdings_risk(
        self, ws: WebSocket, user_id: int, portfolio_id: int,
        symbols: set[str], ctx: str,
    ) -> None:
        """Compute and send holdings + risk snapshots."""
        try:
            async with AsyncSessionLocal() as db:
                pids = await resolve_portfolio_ids(db, user_id, portfolio_id)
                positions = await position_engine.calculate_positions(
                    db, portfolio_ids=pids,
                )

            if not positions:
                return

            sym_list = list({pos.instrument.symbol for pos in positions})

            # Parallel fetch: spots, vols, perfs
            spot_results = await asyncio.gather(
                *[yfinance_client.get_spot_price(s) for s in sym_list]
            )
            spot_map = {s: p for s, p in zip(sym_list, spot_results) if p is not None}

            vol_results = await asyncio.gather(
                *[yfinance_client.get_hist_vol(s) for s in sym_list]
            )
            vol_map = dict(zip(sym_list, vol_results))

            perf_results = await asyncio.gather(
                *[yfinance_client.get_perf_cached(s) for s in sym_list]
            )
            perf_map = dict(zip(sym_list, perf_results))

            # Daily P&L: BS mark-to-market
            from app.services.price_feed import PriceFeedService
            prev_close_map = PriceFeedService._build_prev_close_map(sym_list)
            bs_pnl_map = PriceFeedService._build_daily_pnl_map(
                positions, spot_map, vol_map, prev_close_map,
            )

            groups = compute_holding_groups(
                positions, spot_map, vol_map,
                perf_map=perf_map, bs_pnl_map=bs_pnl_map,
            )
            await self._send(ws, {
                "type": "holdings_update",
                "portfolio_id": portfolio_id,
                "data": [g.model_dump(mode="json") for g in groups],
            })

            # Risk snapshot
            risk_summary = compute_risk_summary(positions, spot_map, vol_map)
            await self._send(ws, {
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
            })

        except Exception:
            logger.exception("Snapshot holdings/risk failed: %s", ctx)
            await self._send_error(ws, portfolio_id, "holdings_risk")

    # ── Helpers ───────────────────────────────────────────────────────────

    async def _send(self, ws: WebSocket, data: dict) -> bool:
        return await self._manager.send_json(ws, data)

    async def _send_error(
        self, ws: WebSocket, portfolio_id: int, step: str,
    ) -> None:
        """Emit a snapshot_error message for a failed step."""
        await self._send(ws, {
            "type": "snapshot_error",
            "portfolio_id": portfolio_id,
            "step": step,
            "message": f"Snapshot step '{step}' failed",
        })
