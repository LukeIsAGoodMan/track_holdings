"""
Async SQLAlchemy engine + session factory.

Supports both SQLite (local dev) and PostgreSQL (production on Render).
Render provides DATABASE_URL as postgres:// which needs conversion to
postgresql+asyncpg:// for SQLAlchemy async.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


def _normalize_db_url(url: str) -> str:
    """Convert Render's postgres:// to postgresql+asyncpg:// for async SA."""
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


engine = create_async_engine(_normalize_db_url(settings.database_url), echo=False)

AsyncSessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Create all tables. Must be called after all models are imported."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _migrate_db()


async def _migrate_db():
    """
    Additive-only SQLite migrations.
    Each block checks for a missing column via PRAGMA and adds it if absent.
    Safe to run on every startup — no-ops when columns already exist.

    Skipped on PostgreSQL — create_all() creates the complete schema.
    """
    if "sqlite" not in str(engine.url):
        await _seed_instrument_tags()
        return

    async with engine.begin() as conn:
        # ── instruments.tags ─────────────────────────────────────────────
        result = await conn.execute(text("PRAGMA table_info(instruments)"))
        inst_cols = {row[1] for row in result.fetchall()}
        if "tags" not in inst_cols:
            await conn.execute(text("ALTER TABLE instruments ADD COLUMN tags JSON"))

        # ── trade_events.trade_metadata ───────────────────────────────────
        result = await conn.execute(text("PRAGMA table_info(trade_events)"))
        te_cols = {row[1] for row in result.fetchall()}
        if "trade_metadata" not in te_cols:
            await conn.execute(
                text("ALTER TABLE trade_events ADD COLUMN trade_metadata JSON")
            )

        # ── portfolios.parent_id + user_id + is_folder ─────────────────
        result = await conn.execute(text("PRAGMA table_info(portfolios)"))
        port_cols = {row[1] for row in result.fetchall()}
        if "parent_id" not in port_cols:
            await conn.execute(
                text("ALTER TABLE portfolios ADD COLUMN parent_id INTEGER REFERENCES portfolios(id)")
            )
        if "user_id" not in port_cols:
            await conn.execute(
                text("ALTER TABLE portfolios ADD COLUMN user_id INTEGER REFERENCES users(id)")
            )
        if "is_folder" not in port_cols:
            await conn.execute(
                text("ALTER TABLE portfolios ADD COLUMN is_folder INTEGER NOT NULL DEFAULT 0")
            )

        # ── trade_events.user_id ────────────────────────────────────────
        # Re-read: te_cols was read above for trade_metadata migration
        result = await conn.execute(text("PRAGMA table_info(trade_events)"))
        te_cols2 = {row[1] for row in result.fetchall()}
        if "user_id" not in te_cols2:
            await conn.execute(
                text("ALTER TABLE trade_events ADD COLUMN user_id INTEGER REFERENCES users(id)")
            )

        # ── cash_ledger.user_id ─────────────────────────────────────────
        result = await conn.execute(text("PRAGMA table_info(cash_ledger)"))
        cl_cols = {row[1] for row in result.fetchall()}
        if "user_id" not in cl_cols:
            await conn.execute(
                text("ALTER TABLE cash_ledger ADD COLUMN user_id INTEGER REFERENCES users(id)")
            )

        # ── alerts table (Phase 7e) ─────────────────────────────────────
        # New table created by create_all(); guard future column adds here.
        result = await conn.execute(text("PRAGMA table_info(alerts)"))
        alert_cols = {row[1] for row in result.fetchall()}
        if alert_cols and "trigger_count" not in alert_cols:
            await conn.execute(
                text("ALTER TABLE alerts ADD COLUMN trigger_count INTEGER DEFAULT 0")
            )

    # ── Seed instrument tags (data migration) ─────────────────────────────
    # Idempotent: only sets tags where tags IS NULL and symbol is known.
    await _seed_instrument_tags()


# Known sector/factor tags per underlying symbol.
# Add more symbols here as the portfolio grows.
_SYMBOL_TAGS: dict[str, list[str]] = {
    "NVDA": ["AI", "Semiconductor", "Growth"],
    "AVGO": ["Semiconductor", "Networking"],
    "SPY":  ["Index", "Broad Market"],
    "QQQ":  ["Index", "Tech-Heavy"],
    "TSLA": ["EV", "Growth", "Volatile"],
    "AAPL": ["Big Tech", "Consumer"],
    "MSFT": ["Big Tech", "AI", "Cloud"],
    "AMZN": ["Big Tech", "Cloud"],
    "GOOG": ["Big Tech", "AI"],
    "META": ["Big Tech", "Social"],
}


async def _seed_instrument_tags() -> None:
    """
    Back-fill instrument.tags for known symbols where tags is NULL.
    Runs on every startup; no-ops when tags already set.
    """
    import json
    async with engine.begin() as conn:
        for symbol, tags in _SYMBOL_TAGS.items():
            await conn.execute(
                text(
                    "UPDATE instruments SET tags = :tags "
                    "WHERE symbol = :sym AND tags IS NULL"
                ),
                {"tags": json.dumps(tags), "sym": symbol},
            )
