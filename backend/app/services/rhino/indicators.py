"""
Technical indicators — pure functions, no I/O.

SMA, ATR, fixed-bin volume profile, and support/resistance zone detection.
"""
from __future__ import annotations

import math


# ── SMA ──────────────────────────────────────────────────────────────────────

def compute_sma(bars: list[dict], period: int) -> float | None:
    if len(bars) < period:
        return None
    return sum(b["close"] for b in bars[-period:]) / period


def compute_sma_series_multi(
    bars: list[dict], periods: list[int],
) -> dict[int, list[dict]]:
    """Compute multiple SMA date-series in a single pass over the close array.

    Returns {period: [{date, value}, ...]} for each requested period.
    Each series is chronologically ordered.  Empty list if insufficient bars.
    Complexity: O(n) per period (one running-sum sweep each).
    """
    closes = [b["close"] for b in bars]
    n = len(closes)
    result: dict[int, list[dict]] = {}

    for period in periods:
        if n < period:
            result[period] = []
            continue

        series: list[dict] = []
        running_sum = sum(closes[:period])
        for i in range(period, n + 1):
            if i > period:
                running_sum += closes[i - 1] - closes[i - period - 1]
            series.append({
                "date": bars[i - 1]["date"],
                "value": round(running_sum / period, 4),
            })
        result[period] = series

    return result


# ── ATR ──────────────────────────────────────────────────────────────────────

def compute_atr(bars: list[dict], period: int = 20) -> float | None:
    if len(bars) < period + 1:
        return None
    relevant = bars[-(period + 1):]
    total = 0.0
    for i in range(1, len(relevant)):
        curr = relevant[i]
        prev_close = relevant[i - 1]["close"]
        tr = max(
            curr["high"] - curr["low"],
            abs(curr["high"] - prev_close),
            abs(curr["low"] - prev_close),
        )
        total += tr
    return total / period


# ── Average Volume ───────────────────────────────────────────────────────────

def compute_avg_volume(bars: list[dict], period: int = 50) -> float | None:
    if len(bars) < period:
        return None
    return sum(b["volume"] for b in bars[-period:]) / period


# ── Volume Profile (fixed-bin, 40 bins — NOT clustering) ────────────────────

def compute_volume_profile(bars: list[dict], num_bins: int = 40):
    """Returns (poc, hvn_levels, lvn_levels) or (None, [], []) if insufficient data."""
    if len(bars) < 20:
        return None, [], []

    price_high = max(b["high"] for b in bars)
    price_low = min(b["low"] for b in bars)
    price_range = price_high - price_low
    if price_range <= 0:
        return None, [], []

    bin_width = price_range / num_bins
    bin_volumes = [0.0] * num_bins

    for bar in bars:
        typical = (bar["high"] + bar["low"]) / 2
        idx = min(int((typical - price_low) / bin_width), num_bins - 1)
        bin_volumes[idx] += bar["volume"]

    # POC = bin with max volume
    poc_idx = max(range(num_bins), key=lambda i: bin_volumes[i])
    poc = price_low + (poc_idx + 0.5) * bin_width

    # HVN / LVN thresholds
    non_zero = sorted(v for v in bin_volumes if v > 0)
    if not non_zero:
        return poc, [], []

    p85 = non_zero[int(len(non_zero) * 0.85)]
    p15 = non_zero[int(len(non_zero) * 0.15)]

    hvn_levels = [
        price_low + (i + 0.5) * bin_width
        for i, v in enumerate(bin_volumes) if v >= p85
    ]
    lvn_levels = [
        price_low + (i + 0.5) * bin_width
        for i, v in enumerate(bin_volumes) if 0 < v <= p15
    ]

    return poc, hvn_levels, lvn_levels


# ── Support / Resistance Zones ──────────────────────────────────────────────

def compute_zones(
    bars: list[dict],
    poc: float | None,
    hvn_levels: list[float],
    last_price: float,
    sma200: float | None,
) -> list[dict]:
    """Returns list of zone dicts with center/lower/upper/strength/sources."""
    if len(bars) < 21:
        return []

    atr20 = compute_atr(bars, 20) or (last_price * 0.02)
    half_width = max(last_price * 0.008, atr20 * 0.5)
    zones: list[dict] = []

    def _add(center: float, hw: float, strength: float, sources: list[str]):
        zones.append({
            "center": center,
            "lower": center - hw,
            "upper": center + hw,
            "strength": strength,
            "sources": sources,
        })

    if poc is not None:
        _add(poc, half_width, 0.9, ["volume_profile"])

    for lvl in hvn_levels:
        if poc is not None and abs(lvl - poc) < half_width:
            continue
        _add(lvl, half_width, 0.75, ["volume_profile"])

    if sma200 is not None:
        _add(sma200, half_width * 0.8, 0.6, ["sma200"])

    # Swing pivots from last 60 bars
    pivots = _find_swing_pivots(bars[-60:] if len(bars) >= 60 else bars)
    for p in pivots:
        if any(abs(z["center"] - p["price"]) < half_width for z in zones):
            continue
        source = "pivot_high" if p["type"] == "high" else "pivot_low"
        strength = min(p["touches"] / 4, 1.0) * 0.7
        _add(p["price"], half_width, strength, [source])

    zones.sort(key=lambda z: z["strength"], reverse=True)
    return zones


def _find_swing_pivots(bars: list[dict]) -> list[dict]:
    if len(bars) < 5:
        return []
    tolerance = bars[-1]["close"] * 0.005
    pivots: list[dict] = []

    for i in range(2, len(bars) - 2):
        low = bars[i]["low"]
        high = bars[i]["high"]

        is_swing_low = all(low <= bars[i + d]["low"] for d in (-2, -1, 1, 2))
        is_swing_high = all(high >= bars[i + d]["high"] for d in (-2, -1, 1, 2))

        if is_swing_low:
            existing = next(
                (p for p in pivots if p["type"] == "low" and abs(p["price"] - low) < tolerance),
                None,
            )
            if existing:
                existing["touches"] += 1
                existing["price"] = (existing["price"] + low) / 2
            else:
                pivots.append({"price": low, "type": "low", "touches": 1})

        if is_swing_high:
            existing = next(
                (p for p in pivots if p["type"] == "high" and abs(p["price"] - high) < tolerance),
                None,
            )
            if existing:
                existing["touches"] += 1
                existing["price"] = (existing["price"] + high) / 2
            else:
                pivots.append({"price": high, "type": "high", "touches": 1})

    return pivots
