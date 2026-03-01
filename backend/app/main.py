"""
Track Holdings API — FastAPI entry point.

Startup sequence:
  1. Import all ORM models (registers with Base.metadata)
  2. init_db() creates SQLite tables if they don't exist
  3. run_seed() injects the canonical validation trade on first run (idempotent)
  4. process_expired_trades() settles any options that expired since last run
  5. Start WebSocket PriceFeedService (Phase 7 — real-time)
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ── MUST import models before init_db() ──────────────────────────────────────
import app.models  # noqa: F401  (registers all ORM classes with Base.metadata)

from app.config import settings
from app.database import AsyncSessionLocal, init_db
from app.routers import auth, cash, coach, holdings, portfolios, risk, trades
from app.routers import alerts as alerts_router
from app.routers import lifecycle as lifecycle_router
from app.routers import scanner as scanner_router
from app.routers import tts as tts_router
from app.routers import ws as ws_router
from app.services.alert_engine import AlertEngine
from app.services.lifecycle import process_expired_trades
from app.services.ai_engine import AiInsightService, create_provider as create_ai_provider, set_vol_cache_ref as set_ai_vol_cache_ref
from app.services.nlv_sampler import NlvSamplerService, set_vol_cache_ref
from app.services.voice_service import AudioCache, EdgeTtsProvider, MockTtsProvider
from app.services.price_cache import PriceCache
from app.services.price_feed import PriceFeedService, _vol_cache
from app.services.macro_service import MacroService
from app.services.scanner_service import MarketScannerService
from app.services.seed import run_seed
from app.services.ws_manager import ConnectionManager

logger = logging.getLogger(__name__)

# ── Shared singletons (created once, live for the process lifetime) ──────────
ws_manager = ConnectionManager()
price_cache = PriceCache(ttl_seconds=settings.ws_price_cache_ttl)
alert_engine = AlertEngine(manager=ws_manager)
price_feed = PriceFeedService(
    manager=ws_manager, cache=price_cache, alert_engine=alert_engine
)
market_scanner = MarketScannerService(manager=ws_manager)
macro_service = MacroService(manager=ws_manager, cache=price_cache)
nlv_sampler = NlvSamplerService(manager=ws_manager, cache=price_cache)

# ── Voice / TTS (Phase 10a) ──────────────────────────────────────────────────
audio_cache = AudioCache(ttl=settings.tts_cache_ttl)
_voice_provider = None
if settings.tts_enabled:
    _voice_provider = (
        EdgeTtsProvider() if settings.tts_provider == "edge"
        else MockTtsProvider()
    )

ai_insight_svc = AiInsightService(
    manager=ws_manager, cache=price_cache, provider=create_ai_provider(),
    voice=_voice_provider, audio_cache=audio_cache,
    macro_service=macro_service,
)


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    async with AsyncSessionLocal() as db:
        await run_seed(db)
        await db.commit()
    # Settle any options that expired since last run (own session, don't crash startup)
    try:
        async with AsyncSessionLocal() as db:
            await process_expired_trades(db)
    except Exception:
        pass

    # ── Start real-time price feed ────────────────────────────────────────
    ws_router.init_ws_globals(ws_manager, price_cache)
    alerts_router.init_alert_globals(price_cache, price_feed)
    price_feed.start()
    logger.info("Real-time price feed started (poll every %ds)", settings.ws_price_poll_interval)

    # ── Start market scanner ────────────────────────────────────────────
    scanner_router.init_scanner_globals(market_scanner)
    market_scanner.start()
    logger.info("Market scanner started (poll every %ds)", settings.scanner_poll_interval)

    # ── Start macro service (Phase 12a) ──────────────────────────────────
    macro_service.start()
    logger.info("Macro service started (interval=%ds)", settings.macro_poll_interval)

    # ── Start NLV sampler (Phase 7f) ─────────────────────────────────────
    set_vol_cache_ref(_vol_cache)
    nlv_sampler.start()
    logger.info("NLV sampler started (interval=%ds)", settings.nlv_sample_interval)

    # ── Start AI Insight service (Phase 8a) + TTS (Phase 10a) ──────────
    set_ai_vol_cache_ref(_vol_cache)
    tts_router.init_tts_globals(audio_cache)
    ai_insight_svc.start()
    logger.info(
        "AI insight service started (interval=%ds, tts=%s)",
        settings.ai_insight_interval,
        settings.tts_provider if settings.tts_enabled else "disabled",
    )

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────
    await ai_insight_svc.stop()
    logger.info("AI insight service stopped")
    await nlv_sampler.stop()
    logger.info("NLV sampler stopped")
    await macro_service.stop()
    logger.info("Macro service stopped")
    await market_scanner.stop()
    logger.info("Market scanner stopped")
    await price_feed.stop()
    logger.info("Real-time price feed stopped")


# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Track Holdings API",
    description="Options strategy portfolio tracker — Greeks, P&L attribution, margin.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(auth.router,             prefix="/api")
app.include_router(portfolios.router,       prefix="/api")
app.include_router(holdings.router,         prefix="/api")
app.include_router(trades.router,           prefix="/api")
app.include_router(risk.router,             prefix="/api")
app.include_router(cash.router,             prefix="/api")
app.include_router(lifecycle_router.router, prefix="/api")
app.include_router(coach.router,            prefix="/api")
app.include_router(scanner_router.router,  prefix="/api")
app.include_router(alerts_router.router,   prefix="/api")
app.include_router(tts_router.router,     prefix="/api")
app.include_router(ws_router.router,       prefix="/api")


@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "service": "track-holdings-api", "version": "0.1.0"}


@app.get("/api/ws/stats", tags=["system"])
async def ws_stats():
    """Debug endpoint: WebSocket connection and cache stats."""
    return {
        "connections": ws_manager.active_count,
        "subscribed_symbols": sorted(ws_manager.all_subscribed_symbols()),
        "price_cache": price_cache.stats(),
    }
