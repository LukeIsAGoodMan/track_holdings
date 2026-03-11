"""
Async SQLAlchemy engine + session factory.

Supports both SQLite (local dev) and PostgreSQL (production on Render).
Render provides DATABASE_URL as postgres:// which needs conversion to
postgresql+asyncpg:// for SQLAlchemy async.
"""
from sqlalchemy import inspect as sa_inspect, text
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
    Additive-only migrations — dialect-agnostic (SQLite + PostgreSQL).

    Uses SQLAlchemy inspect() via run_sync instead of SQLite-only PRAGMA,
    so migrations run correctly on both local SQLite and Render PostgreSQL.
    Safe to run on every startup — no-ops when columns already exist.
    """
    is_pg = "postgresql" in str(engine.url)

    async with engine.begin() as conn:
        def get_cols(sync_conn, table: str) -> set[str]:
            try:
                return {c["name"] for c in sa_inspect(sync_conn).get_columns(table)}
            except Exception:
                return set()

        # ── instruments.tags ─────────────────────────────────────────────
        inst_cols = await conn.run_sync(get_cols, "instruments")
        if "tags" not in inst_cols:
            col_type = "JSONB" if is_pg else "JSON"
            await conn.execute(text(f"ALTER TABLE instruments ADD COLUMN tags {col_type}"))

        # ── trade_events.trade_metadata ───────────────────────────────────
        te_cols = await conn.run_sync(get_cols, "trade_events")
        if "trade_metadata" not in te_cols:
            col_type = "JSONB" if is_pg else "JSON"
            await conn.execute(
                text(f"ALTER TABLE trade_events ADD COLUMN trade_metadata {col_type}")
            )

        # ── portfolios.parent_id + user_id + is_folder ─────────────────
        port_cols = await conn.run_sync(get_cols, "portfolios")
        if "parent_id" not in port_cols:
            await conn.execute(
                text("ALTER TABLE portfolios ADD COLUMN parent_id INTEGER REFERENCES portfolios(id)")
            )
        if "user_id" not in port_cols:
            await conn.execute(
                text("ALTER TABLE portfolios ADD COLUMN user_id INTEGER REFERENCES users(id)")
            )
        # Data recovery: portfolios created before user isolation → assign to user 1
        await conn.execute(
            text("UPDATE portfolios SET user_id = 1 WHERE user_id IS NULL")
        )
        if "is_folder" not in port_cols:
            bool_ddl = "BOOLEAN NOT NULL DEFAULT FALSE" if is_pg else "INTEGER NOT NULL DEFAULT 0"
            await conn.execute(
                text(f"ALTER TABLE portfolios ADD COLUMN is_folder {bool_ddl}")
            )

        # ── trade_events.user_id ────────────────────────────────────────
        te_cols2 = await conn.run_sync(get_cols, "trade_events")
        if "user_id" not in te_cols2:
            await conn.execute(
                text("ALTER TABLE trade_events ADD COLUMN user_id INTEGER REFERENCES users(id)")
            )

        # ── cash_ledger.user_id ─────────────────────────────────────────
        cl_cols = await conn.run_sync(get_cols, "cash_ledger")
        if "user_id" not in cl_cols:
            await conn.execute(
                text("ALTER TABLE cash_ledger ADD COLUMN user_id INTEGER REFERENCES users(id)")
            )

        # ── alerts.trigger_count (Phase 7e) ──────────────────────────────
        alert_cols = await conn.run_sync(get_cols, "alerts")
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
