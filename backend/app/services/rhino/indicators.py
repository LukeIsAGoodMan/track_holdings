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
    sma30: float | None = None,
    sma100: float | None = None,
) -> list[dict]:
    """
    Generate S/R zones via candidate collection → clustering → scoring.

    1. Collect ALL candidates: swing pivots, volume profile, SMA30/100/200
    2. Cluster nearby candidates (within ATR-based threshold) into zones
    3. Multi-source zones get significant score boost
    4. Returns list of zone dicts sorted by strength descending
    """
    if len(bars) < 21:
        return []

    atr20 = compute_atr(bars, 20) or (last_price * 0.02)
    half_width = max(last_price * 0.004, atr20 * 0.3)
    cluster_threshold = max(last_price * 0.01, atr20 * 0.6)

    # ── Step 1: Collect all raw candidate levels ──────────────────────────
    candidates: list[dict] = []

    # Volume profile: POC + HVN
    if poc is not None:
        candidates.append({"price": poc, "source": "volume_profile", "base_strength": 0.9, "zone_type": "consolidation", "validity_days": 0})
    for lvl in hvn_levels:
        if poc is not None and abs(lvl - poc) < cluster_threshold:
            continue
        candidates.append({"price": lvl, "source": "volume_profile", "base_strength": 0.75, "zone_type": "consolidation", "validity_days": 0})

    # Moving averages
    if sma30 is not None:
        candidates.append({"price": sma30, "source": "sma30", "base_strength": 0.55, "zone_type": "MA", "validity_days": 0})
    if sma100 is not None:
        candidates.append({"price": sma100, "source": "sma100", "base_strength": 0.6, "zone_type": "MA", "validity_days": 0})
    if sma200 is not None:
        candidates.append({"price": sma200, "source": "sma200", "base_strength": 0.65, "zone_type": "MA", "validity_days": 0})

    # Swing pivots
    pivots = _find_swing_pivots(bars[-90:] if len(bars) >= 90 else bars)
    for p in pivots:
        source = "pivot_high" if p["type"] == "high" else "pivot_low"
        strength = min(p["touches"] / 4, 1.0) * 0.7
        candidates.append({"price": p["price"], "source": source, "base_strength": strength, "zone_type": "pivot", "validity_days": p.get("validity_days", 0)})

    # ── Step 2: Cluster nearby candidates ─────────────────────────────────
    candidates.sort(key=lambda c: c["price"])
    clusters: list[list[dict]] = []
    for cand in candidates:
        merged = False
        for cluster in clusters:
            cluster_center = sum(c["price"] for c in cluster) / len(cluster)
            if abs(cand["price"] - cluster_center) < cluster_threshold:
                cluster.append(cand)
                merged = True
                break
        if not merged:
            clusters.append([cand])

    # ── Step 3: Build zones from clusters ─────────────────────────────────
    zones: list[dict] = []
    for cluster in clusters:
        center = sum(c["price"] for c in cluster) / len(cluster)
        sources = list({c["source"] for c in cluster})
        best_strength = max(c["base_strength"] for c in cluster)
        best_validity = max(c.get("validity_days", 0) for c in cluster)

        # Multi-source confluence bonus
        multi_bonus = min(len(sources) - 1, 3) * 0.12  # +0.12 per additional source, cap at 3
        strength = min(best_strength + multi_bonus, 1.0)

        # Zone type: prefer volume_profile > pivot > MA
        zone_type = "consolidation"
        if any(s.startswith("pivot") for s in sources):
            zone_type = "pivot"
        if "volume_profile" in sources:
            zone_type = "consolidation"
        if all(s.startswith("sma") for s in sources):
            zone_type = "MA"

        zones.append({
            "center": round(center, 4),
            "lower": round(center - half_width, 4),
            "upper": round(center + half_width, 4),
            "strength": round(strength, 3),
            "sources": sources,
            "zone_type": zone_type,
            "validity_days": best_validity,
        })

    zones.sort(key=lambda z: z["strength"], reverse=True)
    return zones


def _find_swing_pivots(bars: list[dict]) -> list[dict]:
    """Detect swing highs/lows with 5-bar confirmation and consolidation merging."""
    if len(bars) < 5:
        return []
    tolerance = bars[-1]["close"] * 0.005
    pivots: list[dict] = []
    last_date = bars[-1].get("date", "")

    for i in range(2, len(bars) - 2):
        low = bars[i]["low"]
        high = bars[i]["high"]
        bar_date = bars[i].get("date", "")

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
                # Keep earliest date for validity tracking
            else:
                pivots.append({
                    "price": low, "type": "low", "touches": 1,
                    "first_date": bar_date,
                })

        if is_swing_high:
            existing = next(
                (p for p in pivots if p["type"] == "high" and abs(p["price"] - high) < tolerance),
                None,
            )
            if existing:
                existing["touches"] += 1
                existing["price"] = (existing["price"] + high) / 2
            else:
                pivots.append({
                    "price": high, "type": "high", "touches": 1,
                    "first_date": bar_date,
                })

    # Compute validity_days from first_date to last bar date
    for p in pivots:
        p["validity_days"] = _date_diff_days(p.get("first_date", ""), last_date)

    return pivots


def _date_diff_days(d1: str, d2: str) -> int:
    """Simple date diff for YYYY-MM-DD strings. Returns 0 on parse failure."""
    try:
        parts1 = d1.split("-")
        parts2 = d2.split("-")
        if len(parts1) < 3 or len(parts2) < 3:
            return 0
        from datetime import date
        dt1 = date(int(parts1[0]), int(parts1[1]), int(parts1[2]))
        dt2 = date(int(parts2[0]), int(parts2[1]), int(parts2[2]))
        return max(0, (dt2 - dt1).days)
    except (ValueError, IndexError):
        return 0
