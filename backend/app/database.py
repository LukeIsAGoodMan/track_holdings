"""
Async SQLAlchemy engine + session factory for SQLite/aiosqlite.
Pattern mirrored from stocksage/backend/app/database.py.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)

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
    """
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
