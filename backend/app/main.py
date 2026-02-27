"""
Track Holdings API — FastAPI entry point.

Startup sequence:
  1. Import all ORM models (registers with Base.metadata)
  2. init_db() creates SQLite tables if they don't exist
  3. run_seed() injects the canonical validation trade on first run (idempotent)
  4. process_expired_trades() settles any options that expired since last run
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ── MUST import models before init_db() ──────────────────────────────────────
import app.models  # noqa: F401  (registers all ORM classes with Base.metadata)

from app.database import AsyncSessionLocal, init_db
from app.routers import cash, holdings, portfolios, risk, trades
from app.routers import lifecycle as lifecycle_router
from app.services.lifecycle import process_expired_trades
from app.services.seed import run_seed


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
    yield


# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Track Holdings API",
    description="Options strategy portfolio tracker — Greeks, P&L attribution, margin.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(portfolios.router,    prefix="/api")
app.include_router(holdings.router,      prefix="/api")
app.include_router(trades.router,        prefix="/api")
app.include_router(risk.router,          prefix="/api")
app.include_router(cash.router,          prefix="/api")
app.include_router(lifecycle_router.router, prefix="/api")


@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "service": "track-holdings-api", "version": "0.1.0"}
