"""
User-scoped portfolio ID resolution.

Replaces the dangerous "if portfolio_id is None: return ALL data" pattern
with user-isolated queries.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.portfolio import Portfolio
from app.services.position_engine import collect_portfolio_ids


async def resolve_portfolio_ids(
    db: AsyncSession,
    user_id: int,
    portfolio_id: int | None = None,
) -> set[int]:
    """
    Given a user and optional portfolio_id, return the set of portfolio IDs
    to query.

    - If portfolio_id given: validates ownership (user_id match), returns
      its BFS subtree via collect_portfolio_ids.
    - If None: returns ALL of this user's portfolio IDs.

    Raises HTTP 404 if the portfolio is not found or not owned by user.
    """
    if portfolio_id is not None:
        port = await db.get(Portfolio, portfolio_id)
        if port is None or port.user_id != user_id:
            raise HTTPException(status_code=404, detail="Portfolio not found")
        return await collect_portfolio_ids(db, portfolio_id)
    else:
        result = await db.execute(
            select(Portfolio.id).where(Portfolio.user_id == user_id)
        )
        return set(result.scalars().all())
