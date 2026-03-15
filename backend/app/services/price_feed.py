"""
PriceFeedService — Dirty-Flag + Dual-Loop architecture for real-time
portfolio updates via WebSocket.

Architecture:
  FeedStateManager    — Memory index: portfolio <-> symbols, dirty flags
  Spot Loop  (30s)    — Fetch prices, broadcast spot_update, flag dirty portfolios
  Recompute Loop (120s) — Consume dirty set atomically, recompute holdings/risk

Lifecycle:
  start() — called in FastAPI lifespan (startup)
  stop()  — called in FastAPI lifespan (shutdown)

External triggers:
  mark_portfolio_dirty(pid)      — trades, cash adjustments, macro events
  sync_portfolio_index(pid, syms) — WS subscribe/unsubscribe
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
import time
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP

from app.config import settings
from app.database import AsyncSessionLocal
from app.services import position_engine, yfinance_client
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


# ═══════════════════════════════════════════════════════════════════════════
# PortfolioContext — single DB fetch shared by holdings + risk recompute
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class PortfolioContext:
    """
    Immutable snapshot of a portfolio's state for one recompute cycle.

    Fetched once from the DB, then passed to both holdings and risk
    computation — eliminates the duplicate DB round-trip.

    Empty-portfolio semantics:
      If positions is empty, the portfolio has no active holdings.
      The recompute pipeline will clear its symbol index (ghost prevention)
      and skip holdings/risk broadcasts — no error, no empty-array message.
      The portfolio remains eligible for future re-subscription when new
      trades arrive.
    """
    portfolio_id: int
    user_id: int
    positions: list  # list[PositionRow] from position_engine
    symbols: list[str] = field(default_factory=list)
    spot_map: dict[str, Decimal | None] = field(default_factory=dict)
    vol_map: dict[str, Decimal] = field(default_factory=dict)


# ═══════════════════════════════════════════════════════════════════════════
# FeedStateManager — async-safe portfolio <-> symbol memory index
# ═══════════════════════════════════════════════════════════════════════════

class FeedStateManager:
    """
    In-memory index mapping portfolios to their constituent symbols and
    tracking which portfolios need recomputation (dirty flags).

    All index and dirty-set mutations are protected by a single asyncio.Lock
    so the spot loop and recompute loop never race on shared state.
    """

    def __init__(self) -> None:
        # portfolio_id -> set of symbols held in that portfolio
        self._portfolio_symbols: dict[int, set[str]] = {}
        # symbol -> set of portfolio_ids that hold it (inverse index)
        self._symbol_portfolios: dict[str, set[int]] = {}
        # portfolio_ids that need recomputation
        self._dirty: set[int] = set()
        # portfolio_id -> user_id (for broadcast routing)
        self._portfolio_owner: dict[int, int] = {}
        # Unified lock for ALL index + dirty-set operations
        self._lock = asyncio.Lock()

    # ── Portfolio <-> Symbol indexing (all async, lock-protected) ────────

    async def sync_portfolio_index(
        self, portfolio_id: int, user_id: int, current_symbols: set[str]
    ) -> None:
        """
        Idempotent rebuild: replace the symbol set for a portfolio.

        Called when a WS client subscribes or when positions change.
        Rebuilds from scratch rather than incremental diff to guarantee
        the memory mirror stays consistent with the DB.

        Empty-portfolio semantics:
          If current_symbols is empty, the portfolio's forward index,
          inverse index entries, and owner mapping are all removed.
          This prevents "ghost dirtying" — an empty portfolio will no
          longer be flagged dirty by price changes.  The portfolio
          remains eligible for re-indexing when new positions appear.
        """
        async with self._lock:
            # Remove old inverse entries
            old_symbols = self._portfolio_symbols.get(portfolio_id, set())
            for sym in old_symbols:
                pids = self._symbol_portfolios.get(sym)
                if pids:
                    pids.discard(portfolio_id)
                    if not pids:
                        del self._symbol_portfolios[sym]

            # Write new forward + inverse entries
            if current_symbols:
                self._portfolio_symbols[portfolio_id] = set(current_symbols)
                self._portfolio_owner[portfolio_id] = user_id
                for sym in current_symbols:
                    self._symbol_portfolios.setdefault(sym, set()).add(portfolio_id)
            else:
                # Empty positions: clean up entirely (ghost prevention)
                self._portfolio_symbols.pop(portfolio_id, None)
                self._portfolio_owner.pop(portfolio_id, None)

    async def remove_portfolio(self, portfolio_id: int) -> None:
        """Clean up when a portfolio is unsubscribed or deleted."""
        async with self._lock:
            old_symbols = self._portfolio_symbols.pop(portfolio_id, set())
            self._portfolio_owner.pop(portfolio_id, None)
            for sym in old_symbols:
                pids = self._symbol_portfolios.get(sym)
                if pids:
                    pids.discard(portfolio_id)
                    if not pids:
                        del self._symbol_portfolios[sym]

    async def portfolios_for_symbols(self, symbols: set[str]) -> set[int]:
        """Return all portfolio_ids that hold ANY of the given symbols."""
        async with self._lock:
            result: set[int] = set()
            for sym in symbols:
                pids = self._symbol_portfolios.get(sym)
                if pids:
                    result.update(pids)
            return result

    async def all_indexed_symbols(self) -> set[str]:
        """All symbols across all indexed portfolios."""
        async with self._lock:
            return set(self._symbol_portfolios.keys())

    async def get_owner(self, portfolio_id: int) -> int | None:
        """Return the user_id that owns a portfolio, or None."""
        async with self._lock:
            return self._portfolio_owner.get(portfolio_id)

    # ── Dirty flagging ────────────────────────────────────────────────────

    async def mark_dirty(self, portfolio_ids: set[int]) -> None:
        """Mark portfolios for recomputation (price-triggered or external)."""
        async with self._lock:
            self._dirty.update(portfolio_ids)

    async def mark_dirty_one(self, portfolio_id: int) -> None:
        """Convenience: mark a single portfolio dirty."""
        async with self._lock:
            self._dirty.add(portfolio_id)

    async def consume_dirty(self) -> set[int]:
        """
        Atomically snapshot and clear the dirty set.

        Returns the set of portfolio_ids that need recomputation.
        """
        async with self._lock:
            snapshot = set(self._dirty)
            self._dirty.clear()
            return snapshot


# ═══════════════════════════════════════════════════════════════════════════
# PriceFeedService — Dual-Loop orchestrator
# ═══════════════════════════════════════════════════════════════════════════

class PriceFeedService:
    """
    Dual-loop background service:
      - Spot Loop  (30s): fetch prices -> broadcast spot_update -> flag dirty
      - Recompute Loop (120s): consume dirty -> fresh DB fetch -> broadcast holdings/risk
    """

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
        self.recompute_interval: float = 120.0
        self.alert_engine: AlertEngine | None = alert_engine
        self.state = FeedStateManager()

        self._spot_task: asyncio.Task | None = None
        self._recompute_task: asyncio.Task | None = None
        self._running = False
        self._mock_mode = os.environ.get("USE_MOCK_DATA", "").strip() in ("1", "true", "yes")

    # ── Public API for external triggers ──────────────────────────────────

    async def mark_portfolio_dirty(self, portfolio_id: int) -> None:
        """
        External trigger: mark a portfolio for recomputation.

        Call this after trades, cash adjustments, manual refreshes, or
        macro events that should update the holdings view even when
        prices haven't changed.
        """
        await self.state.mark_dirty_one(portfolio_id)
        logger.debug("Portfolio %d marked dirty (external trigger)", portfolio_id)

    async def sync_portfolio_index(
        self, portfolio_id: int, user_id: int, symbols: set[str]
    ) -> None:
        """
        Update the portfolio <-> symbol index when a WS client subscribes.

        Called from the WS subscribe handler. Idempotent — safe to call
        on every reconnect.
        """
        await self.state.sync_portfolio_index(portfolio_id, user_id, symbols)

    async def remove_portfolio_index(self, portfolio_id: int) -> None:
        """Clean up index when a WS client unsubscribes."""
        await self.state.remove_portfolio(portfolio_id)

    # ── Lifecycle ─────────────────────────────────────────────────────────

    def start(self) -> None:
        if self._spot_task is not None:
            return
        self._running = True
        self._spot_task = asyncio.create_task(
            self._spot_loop(), name="price_feed_spot"
        )
        self._recompute_task = asyncio.create_task(
            self._recompute_loop(), name="price_feed_recompute"
        )
        logger.info(
            "PriceFeedService started (spot=%ss, recompute=%ss)",
            self.poll_interval, self.recompute_interval,
        )

    async def stop(self) -> None:
        self._running = False
        for task in (self._spot_task, self._recompute_task):
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        self._spot_task = None
        self._recompute_task = None
        logger.info("PriceFeedService stopped")

    def invalidate_alert_cache(self) -> None:
        """Force alert engine to reload from DB on next poll."""
        if self.alert_engine:
            self.alert_engine.invalidate_cache()

    # ══════════════════════════════════════════════════════════════════════
    # SPOT LOOP (30s) — fetch prices, broadcast, flag dirty
    # ══════════════════════════════════════════════════════════════════════

    async def _spot_loop(self) -> None:
        while self._running:
            deadline = time.monotonic() + self.poll_interval
            try:
                await self._spot_tick(deadline)
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Spot loop error")
            # Deadline-based sleep: constant cycle time regardless of tick duration
            remaining = deadline - time.monotonic()
            if remaining > 0:
                await asyncio.sleep(remaining)

    async def _spot_tick(self, deadline: float) -> None:
        tick_t0 = time.monotonic()

        # Per-tick metrics (best-effort, emitted even on partial failure)
        total_syms = 0
        fetched_count = 0
        significant_count = 0
        target_conn_count = 0
        affected_pid_count = 0
        fetch_ms = 0.0
        broadcast_ms = 0.0
        alert_ms = 0.0
        dirty_ms = 0.0

        try:
            # 1. Collect symbols: WS subscribers + indexed portfolios + alerts + macro
            symbols = self.manager.all_subscribed_symbols()
            symbols |= await self.state.all_indexed_symbols()
            if self.alert_engine:
                symbols |= self.alert_engine.all_alert_symbols()
            symbols |= {"^GSPC", "^VIX"}  # macro indices always tracked
            total_syms = len(symbols)
            if not symbols:
                return

            symbol_list = sorted(symbols)
            t0 = time.monotonic()

            # 2. Batch fetch (or mock jitter)
            if self._mock_mode:
                new_prices = self._generate_mock_prices(symbol_list)
            else:
                new_prices = await yfinance_client.get_spot_prices_batch(symbol_list)
            fetch_ms = (time.monotonic() - t0) * 1000
            fetched_count = len(new_prices) if new_prices else 0
            if not new_prices:
                return

            # 3. Significance-gated diff (cache always stores latest price)
            changed = self.cache.update_and_diff_significant(new_prices)
            significant_count = len(changed)
            if not changed:
                return

            # 4. Broadcast spot_update via indexed fanout
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
            changed_syms = set(changed.keys())

            t_bc = time.monotonic()
            target_conns = self.manager.connections_for_any_symbol(changed_syms)
            target_conn_count = len(target_conns)
            if target_conns:
                await asyncio.gather(
                    *[self.manager.send_json(conn.ws, spot_msg) for conn in target_conns],
                    return_exceptions=True,
                )
            broadcast_ms = (time.monotonic() - t_bc) * 1000

            # 5. Check price alerts
            t_al = time.monotonic()
            if self.alert_engine:
                try:
                    await self.alert_engine.check_alerts(changed)
                except Exception:
                    logger.exception("Alert check error")
            alert_ms = (time.monotonic() - t_al) * 1000

            # 6. Mark affected portfolios dirty via inverse index
            t_dirty = time.monotonic()
            affected_pids = await self.state.portfolios_for_symbols(changed_syms)

            # Backward-compat fallback: mark portfolios from WS connections
            # that haven't been indexed via sync_portfolio_index yet.
            # Uses read-only portfolio_subscriptions to avoid internal field access.
            for conn in target_conns:
                for pid, port_syms in conn.portfolio_subscriptions:
                    if port_syms & changed_syms:
                        affected_pids.add(pid)
                        # Backfill owner/index with this portfolio's symbols only
                        if await self.state.get_owner(pid) is None:
                            await self.state.sync_portfolio_index(
                                pid, conn.user_id, port_syms
                            )

            affected_pid_count = len(affected_pids)
            if affected_pids:
                await self.state.mark_dirty(affected_pids)
            dirty_ms = (time.monotonic() - t_dirty) * 1000

        finally:
            total_ms = (time.monotonic() - tick_t0) * 1000
            drift_ms = max(0.0, time.monotonic() - deadline) * 1000
            logger.info(
                "[Spot] Syms: %d/%d, Sig: %d, Conns: %d, Pids: %d, "
                "Fetch: %.0fms, Broadcast: %.0fms, Alerts: %.0fms, "
                "Dirty: %.0fms, Took: %.0fms%s",
                fetched_count, total_syms, significant_count,
                target_conn_count, affected_pid_count,
                fetch_ms, broadcast_ms, alert_ms, dirty_ms, total_ms,
                f", Drift: +{drift_ms:.0f}ms" if drift_ms > 0 else "",
            )

    # ══════════════════════════════════════════════════════════════════════
    # RECOMPUTE LOOP (120s) — consume dirty set, fresh DB fetch, broadcast
    # ══════════════════════════════════════════════════════════════════════

    async def _recompute_loop(self) -> None:
        # Initial delay: let spot loop warm up the cache first
        await asyncio.sleep(min(self.poll_interval * 2, 10.0))

        while self._running:
            deadline = time.monotonic() + self.recompute_interval
            try:
                await self._recompute_tick(deadline)
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Recompute loop error")
            # Deadline-based sleep: constant cycle time
            remaining = deadline - time.monotonic()
            if remaining > 0:
                await asyncio.sleep(remaining)

    async def _recompute_tick(self, deadline: float) -> None:
        tick_t0 = time.monotonic()

        # Per-tick metrics (best-effort, emitted even on partial failure)
        dirty_pid_count = 0
        resolved_count = 0
        skipped_count = 0
        context_ms = 0.0
        holdings_ms = 0.0
        risk_ms = 0.0

        try:
            # Atomic consumption: snapshot and clear dirty set
            dirty_pids = await self.state.consume_dirty()
            dirty_pid_count = len(dirty_pids)
            if not dirty_pids:
                return

            # Refresh vol cache if stale
            await self._maybe_refresh_vol_cache()

            # Build full spot map from cache
            all_spots = self.cache.all_prices()

            # Build PortfolioContexts — single DB fetch per portfolio
            t_ctx = time.monotonic()
            contexts: list[PortfolioContext] = []
            for pid in dirty_pids:
                user_id = await self._resolve_user_for_portfolio(pid)
                if user_id is None:
                    logger.debug("Skipping portfolio %d: no known user", pid)
                    skipped_count += 1
                    continue

                try:
                    ctx = await self._build_portfolio_context(pid, user_id, all_spots)
                    if ctx.positions:
                        contexts.append(ctx)
                    else:
                        # Empty portfolio: index already cleared by _build_portfolio_context.
                        # No holdings/risk broadcast needed — skip silently.
                        skipped_count += 1
                except Exception:
                    logger.exception(
                        "Context build failed: user=%d pid=%d", user_id, pid
                    )
                    skipped_count += 1
            context_ms = (time.monotonic() - t_ctx) * 1000
            resolved_count = len(contexts)

            # Compute holdings + risk for each context
            t_hold = time.monotonic()
            hold_tasks = [self._compute_and_send_holdings(ctx) for ctx in contexts]
            if hold_tasks:
                results = await asyncio.gather(*hold_tasks, return_exceptions=True)
                for ctx, result in zip(contexts, results):
                    if isinstance(result, Exception):
                        logger.error(
                            "Holdings failed: user=%d pid=%d: %s",
                            ctx.user_id, ctx.portfolio_id, result,
                        )
            holdings_ms = (time.monotonic() - t_hold) * 1000

            t_risk = time.monotonic()
            risk_tasks = [self._compute_and_send_risk(ctx) for ctx in contexts]
            if risk_tasks:
                results = await asyncio.gather(*risk_tasks, return_exceptions=True)
                for ctx, result in zip(contexts, results):
                    if isinstance(result, Exception):
                        logger.error(
                            "Risk failed: user=%d pid=%d: %s",
                            ctx.user_id, ctx.portfolio_id, result,
                        )
            risk_ms = (time.monotonic() - t_risk) * 1000

        finally:
            total_ms = (time.monotonic() - tick_t0) * 1000
            drift_ms = max(0.0, time.monotonic() - deadline) * 1000
            if dirty_pid_count > 0:
                logger.info(
                    "[Recompute] Pids: %d, Contexts: %d, Skipped: %d, "
                    "Context: %.0fms, Holdings: %.0fms, Risk: %.0fms, "
                    "Took: %.0fms%s",
                    dirty_pid_count, resolved_count, skipped_count,
                    context_ms, holdings_ms, risk_ms, total_ms,
                    f", Drift: +{drift_ms:.0f}ms" if drift_ms > 0 else "",
                )

    async def _build_portfolio_context(
        self, portfolio_id: int, user_id: int, all_spots: dict[str, Decimal]
    ) -> PortfolioContext:
        """
        Single DB fetch -> PortfolioContext shared by holdings + risk.

        Empty-portfolio handling:
          If the DB returns zero positions, the context is still returned
          with an empty positions list.  The caller is responsible for
          skipping broadcasts.  The symbol index is cleared via
          sync_portfolio_index(pid, uid, set()) to prevent ghost dirtying.
        """
        async with AsyncSessionLocal() as db:
            pids = await resolve_portfolio_ids(db, user_id, portfolio_id)
            positions = await position_engine.calculate_positions(
                db, portfolio_ids=pids
            )

        symbols = list({pos.instrument.symbol for pos in positions})
        spot_map = {s: all_spots.get(s) for s in symbols}
        vol_map = {s: _vol_cache.get(s, Decimal("0.30")) for s in symbols}

        # Update index with current symbol set.
        # Empty positions -> set() clears the mapping (ghost prevention).
        await self.state.sync_portfolio_index(
            portfolio_id, user_id, set(symbols)
        )

        return PortfolioContext(
            portfolio_id=portfolio_id,
            user_id=user_id,
            positions=positions,
            symbols=symbols,
            spot_map=spot_map,
            vol_map=vol_map,
        )

    async def _resolve_user_for_portfolio(self, portfolio_id: int) -> int | None:
        """
        Find the user_id for a portfolio — check state index first,
        then fall back to scanning WS connections.
        """
        owner = await self.state.get_owner(portfolio_id)
        if owner is not None:
            return owner
        # Fallback: scan WS connections (read-only snapshot)
        for conn in self.manager.snapshot_connections():
            if portfolio_id in conn.subscribed_portfolio_ids:
                return conn.user_id
        return None

    # ── Holdings computation & broadcast ──────────────────────────────────

    async def _compute_and_send_holdings(self, ctx: PortfolioContext) -> None:
        """
        Compute HoldingGroups from PortfolioContext -> broadcast holdings_update.

        Uses the shared context (single DB fetch) rather than re-querying.
        """
        # Underlying-only perf — identical source to REST /holdings
        perf_results = await asyncio.gather(
            *[yfinance_client.get_perf_cached(s) for s in ctx.symbols],
            return_exceptions=True,
        )
        port_perf: dict[str, dict] = {}
        for sym, result in zip(ctx.symbols, perf_results):
            if isinstance(result, dict):
                port_perf[sym] = result

        groups = compute_holding_groups(
            ctx.positions, ctx.spot_map, ctx.vol_map, perf_map=port_perf or None
        )

        holdings_msg = {
            "type": "holdings_update",
            "portfolio_id": ctx.portfolio_id,
            "data": [g.model_dump(mode="json") for g in groups],
        }
        # Portfolio-scoped broadcast: only connections subscribed to this portfolio
        target_conns = self.manager.connections_for_user_portfolio(
            ctx.user_id, ctx.portfolio_id
        )
        if target_conns:
            await asyncio.gather(
                *[self.manager.send_json(c.ws, holdings_msg) for c in target_conns],
                return_exceptions=True,
            )
        else:
            # Fallback: no portfolio-level match (e.g. initial snapshot race)
            await self.manager.broadcast_to_user(ctx.user_id, holdings_msg)

    async def _compute_and_send_risk(self, ctx: PortfolioContext) -> None:
        """
        Compute risk summary from PortfolioContext -> broadcast risk_update.

        Uses the shared context (single DB fetch) rather than re-querying.
        """
        risk_summary = compute_risk_summary(ctx.positions, ctx.spot_map, ctx.vol_map)
        risk_msg = {
            "type": "risk_update",
            "portfolio_id": ctx.portfolio_id,
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
        # Portfolio-scoped broadcast: only connections subscribed to this portfolio
        target_conns = self.manager.connections_for_user_portfolio(
            ctx.user_id, ctx.portfolio_id
        )
        if target_conns:
            await asyncio.gather(
                *[self.manager.send_json(c.ws, risk_msg) for c in target_conns],
                return_exceptions=True,
            )
        else:
            await self.manager.broadcast_to_user(ctx.user_id, risk_msg)

    # ── Vol cache management ──────────────────────────────────────────────

    async def _maybe_refresh_vol_cache(self) -> None:
        """Refresh the shared vol cache if TTL has expired."""
        global _vol_cache, _vol_cache_ts

        now = time.monotonic()
        if now - _vol_cache_ts <= _VOL_CACHE_TTL:
            return

        # Cover all symbols: WS subscriptions + indexed portfolios + alerts
        all_syms_set = self.manager.all_subscribed_symbols()
        all_syms_set |= await self.state.all_indexed_symbols()
        if self.alert_engine:
            all_syms_set |= self.alert_engine.all_alert_symbols()
        all_syms = list(all_syms_set)
        if not all_syms:
            return

        vols = await asyncio.gather(
            *[yfinance_client.get_hist_vol(s) for s in all_syms]
        )
        _vol_cache = dict(zip(all_syms, vols))
        _vol_cache_ts = now
        logger.debug("Vol cache refreshed: %d symbols", len(all_syms))

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
