#!/usr/bin/env python
"""
debug_render_db.py — Render production diagnostic script.

Prints:
  1. All physical columns in the 'portfolios' table
  2. All users (id, username)
  3. First 5 portfolio records (id, name, user_id, parent_id, is_folder)

Usage:
  DATABASE_URL=<render_postgres_url> python debug_render_db.py

Works with both PostgreSQL (Render) and SQLite (local dev).
"""
import asyncio
import os

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine


def _normalize_url(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def main() -> None:
    raw_url = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./track_holdings.db")
    url = _normalize_url(raw_url)
    is_pg = "postgresql" in url

    print(f"\nConnecting to: {url[:60]}...")
    engine = create_async_engine(url, echo=False)

    async with engine.begin() as conn:

        # ── 1. portfolios columns ──────────────────────────────────────────
        print("\n=== portfolios columns ===")
        if is_pg:
            result = await conn.execute(text(
                "SELECT column_name, data_type, column_default, is_nullable "
                "FROM information_schema.columns "
                "WHERE table_name = 'portfolios' "
                "ORDER BY ordinal_position"
            ))
            rows = result.fetchall()
            if not rows:
                print("  (table not found or no columns)")
            for row in rows:
                print(f"  {row[0]:30s}  {row[1]:20s}  default={row[2]}  nullable={row[3]}")
        else:
            result = await conn.execute(text("PRAGMA table_info(portfolios)"))
            rows = result.fetchall()
            if not rows:
                print("  (table not found)")
            for row in rows:
                # cid, name, type, notnull, dflt_value, pk
                print(f"  {row[1]:30s}  {row[2]:20s}  notnull={row[3]}  default={row[4]}")

        # ── 2. users ───────────────────────────────────────────────────────
        print("\n=== users ===")
        try:
            result = await conn.execute(text("SELECT id, username FROM users LIMIT 10"))
            rows = result.fetchall()
            if not rows:
                print("  (no users found)")
            for row in rows:
                print(f"  id={row[0]}  username={row[1]!r}")
        except Exception as exc:
            print(f"  ERROR reading users: {exc}")

        # ── 3. portfolios (first 5) ────────────────────────────────────────
        print("\n=== portfolios (first 5) ===")
        try:
            result = await conn.execute(text(
                "SELECT id, name, user_id, parent_id FROM portfolios LIMIT 5"
            ))
            rows = result.fetchall()
            if not rows:
                print("  (no portfolios found)")
            for row in rows:
                print(f"  id={row[0]}  name={row[1]!r}  user_id={row[2]}  parent_id={row[3]}")
        except Exception as exc:
            print(f"  ERROR reading portfolios: {exc}")

        # ── 4. is_folder spot-check ────────────────────────────────────────
        print("\n=== is_folder spot-check ===")
        try:
            result = await conn.execute(text(
                "SELECT id, name, is_folder FROM portfolios LIMIT 5"
            ))
            rows = result.fetchall()
            if not rows:
                print("  (no portfolios found)")
            for row in rows:
                print(f"  id={row[0]}  name={row[1]!r}  is_folder={row[2]}")
        except Exception as exc:
            print(f"  COLUMN MISSING — is_folder: {exc}")

    await engine.dispose()
    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
