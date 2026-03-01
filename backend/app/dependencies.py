"""
FastAPI dependencies — JWT authentication.

get_current_user:          Standard Bearer header auth (all protected routes).
get_current_user_flexible: Header OR ?token= query param (SSE endpoints).
"""
from __future__ import annotations

import jwt
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.services.auth import decode_access_token

# HTTPBearer extracts "Bearer <token>" from Authorization header
_bearer = HTTPBearer()
_bearer_optional = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Extract and validate JWT from Authorization header. Returns User or 401."""
    return await _resolve_user(creds.credentials, db)


async def get_current_user_flexible(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer_optional),
    token: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Resolve user from EITHER:
      1. Authorization: Bearer <token>  (standard API calls)
      2. ?token=<token>                 (SSE EventSource fallback)
    """
    raw_token = None
    if creds and creds.credentials:
        raw_token = creds.credentials
    elif token:
        raw_token = token
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return await _resolve_user(raw_token, db)


async def _resolve_user(raw_token: str, db: AsyncSession) -> User:
    """Decode JWT and load User from DB."""
    try:
        payload = decode_access_token(raw_token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired"
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )

    user_id = int(payload["sub"])
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    return user
