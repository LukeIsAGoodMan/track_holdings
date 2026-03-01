"""
Authentication service — password hashing + JWT token operations.

Uses stdlib hashlib.pbkdf2_hmac (no bcrypt dependency issues on Python 3.14).
"""
from __future__ import annotations

import hashlib
import os
from datetime import datetime, timedelta, timezone

import jwt

from app.config import settings

# ── Password hashing (stdlib PBKDF2-SHA256) ──────────────────────────────

_ITERATIONS = 600_000  # OWASP 2023 recommendation for PBKDF2-SHA256


def hash_password(plain: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, _ITERATIONS)
    return f"{salt.hex()}${dk.hex()}"


def verify_password(plain: str, hashed: str) -> bool:
    try:
        salt_hex, dk_hex = hashed.split("$", 1)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(dk_hex)
        dk = hashlib.pbkdf2_hmac("sha256", plain.encode(), salt, _ITERATIONS)
        return dk == expected
    except (ValueError, AttributeError):
        return False


# ── JWT ───────────────────────────────────────────────────────────────────

ALGORITHM = "HS256"


def create_access_token(user_id: int, username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """
    Returns decoded payload dict.
    Raises jwt.ExpiredSignatureError or jwt.InvalidTokenError on failure.
    """
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[ALGORITHM])
