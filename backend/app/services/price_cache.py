"""
In-memory spot-price cache with TTL.

Avoids hammering yfinance on every WebSocket broadcast cycle.
Thread-safe for asyncio (single-threaded event loop, no locks needed).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from decimal import Decimal


@dataclass
class CacheEntry:
    price: Decimal
    updated_at: float  # time.monotonic()


class PriceCache:
    """TTL-based in-memory price cache."""

    def __init__(self, ttl_seconds: float = 30.0) -> None:
        self._ttl = ttl_seconds
        self._store: dict[str, CacheEntry] = {}
        # Stats
        self.hits: int = 0
        self.misses: int = 0

    # ── Read ──────────────────────────────────────────────────────────────

    def get(self, symbol: str) -> Decimal | None:
        """Return cached price if within TTL, else None."""
        entry = self._store.get(symbol)
        if entry is None:
            self.misses += 1
            return None
        if time.monotonic() - entry.updated_at > self._ttl:
            self.misses += 1
            return None
        self.hits += 1
        return entry.price

    def get_many(self, symbols: list[str]) -> dict[str, Decimal]:
        """Return {symbol: price} for all cache hits (skips misses)."""
        result: dict[str, Decimal] = {}
        for sym in symbols:
            price = self.get(sym)
            if price is not None:
                result[sym] = price
        return result

    # ── Write ─────────────────────────────────────────────────────────────

    def set(self, symbol: str, price: Decimal) -> None:
        self._store[symbol] = CacheEntry(price=price, updated_at=time.monotonic())

    def set_many(self, prices: dict[str, Decimal]) -> None:
        now = time.monotonic()
        for sym, price in prices.items():
            self._store[sym] = CacheEntry(price=price, updated_at=now)

    # ── Diff ──────────────────────────────────────────────────────────────

    def update_and_diff(self, new_prices: dict[str, Decimal]) -> dict[str, Decimal]:
        """
        Update cache and return only the prices that actually changed.
        Useful for broadcasting only diffs to WebSocket subscribers.
        """
        changed: dict[str, Decimal] = {}
        now = time.monotonic()
        for sym, price in new_prices.items():
            old = self._store.get(sym)
            if old is None or old.price != price:
                changed[sym] = price
            self._store[sym] = CacheEntry(price=price, updated_at=now)
        return changed

    # ── Utility ───────────────────────────────────────────────────────────

    def all_prices(self) -> dict[str, Decimal]:
        """Return all cached prices (regardless of TTL)."""
        return {sym: e.price for sym, e in self._store.items()}

    @property
    def hit_rate(self) -> float:
        total = self.hits + self.misses
        return self.hits / total if total > 0 else 0.0

    def stats(self) -> dict:
        return {
            "entries": len(self._store),
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": f"{self.hit_rate:.1%}",
        }
