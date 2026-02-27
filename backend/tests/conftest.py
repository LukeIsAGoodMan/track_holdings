"""
Shared pytest fixtures for the Track Holdings test suite.

Provides an async in-memory SQLite session (`db`) that is fully isolated
per test — tables are created fresh for every test function.
"""
from __future__ import annotations

import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# Import all ORM models so they register with Base.metadata before
# create_all() is called.  The import order inside app.models is correct.
import app.models  # noqa: F401
from app.database import Base


@pytest_asyncio.fixture
async def db() -> AsyncSession:  # type: ignore[return]
    """
    Fresh in-memory SQLite session per test.

    Yields an AsyncSession backed by an ephemeral :memory: database.
    All tables are created before the test and the engine is disposed
    afterwards, giving each test a perfectly isolated state.
    """
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with factory() as session:
        yield session

    await engine.dispose()
