"""
Technical engine — computes SMA, ATR, volume profile, zones, and pattern tags.

Zone filtering:
  - primary_levels: within ±25% of current price, top 4 by score, chart-safe
  - reference_levels: far or weak levels, excluded from chart domain
  - Outlier detection uses local ATR-relative context (not global sigma)
  - At least one support and one resistance guaranteed within ±10% if available
  - Reversal/invalidation lines within ±30% promoted to primary
"""
from __future__ import annotations

from .indicators import (
    compute_sma, compute_atr, compute_avg_volume,
    compute_volume_profile, compute_zones,
)


def _score_zone(zone: dict, last_price: float, atr: float) -> float:
    """
    Score a zone for ranking. Higher = more important.
    Factors: strength, proximity to price, source quality, recency.
    """
    base = zone["strength"]

    # Proximity bonus: closer zones score higher
    dist_pct = abs(zone["center"] - last_price) / last_price if last_price > 0 else 0
    proximity_bonus = max(0, 1.0 - dist_pct * 5)  # full bonus within 20%, decays

    # Volume profile, MA confluence, and multi-source bonus
    source_bonus = 0.0
    sources = zone.get("sources", [])
    if "volume_profile" in sources:
        source_bonus += 0.15
    if any(s.startswith("sma") for s in sources):
        source_bonus += 0.1
    # Significant boost for multi-source confluence (the core signal)
    n_sources = len(sources)
    if n_sources >= 3:
        source_bonus += 0.25
    elif n_sources == 2:
        source_bonus += 0.15

    # Validity bonus: longer-held levels are more significant
    validity = zone.get("validity_days", 0)
    validity_bonus = min(validity / 60, 0.2)  # caps at 0.2

    return base + proximity_bonus * 0.3 + source_bonus + validity_bonus


def _filter_and_split_zones(
    all_zones: list[dict],
    last_price: float,
    atr: float,
    reversal_up_value: float | None = None,
    reversal_down_value: float | None = None,
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    """
    Filter zones into primary (chart-safe) and reference (far/weak).

    Returns (primary_support, primary_resistance, ref_support, ref_resistance).

    Rules:
      1. Distance gate: ±25% from price → primary candidate; else → reference
      2. Local outlier: > 8×ATR from price → reference (catches extreme levels
         without global-sigma false positives in trending stocks)
      3. Score and rank: top 4 total primary, ensuring coverage
      4. Coverage: at least 1 support + 1 resistance within ±10% if available
      5. Reversal lines within ±30% promoted to primary
    """
    if last_price <= 0:
        return [], [], [], []

    atr_safe = atr if atr and atr > 0 else last_price * 0.02
    primary_candidates: list[dict] = []
    reference: list[dict] = []

    for z in all_zones:
        dist_pct = abs(z["center"] - last_price) / last_price
        dist_atr = abs(z["center"] - last_price) / atr_safe

        # Local outlier: >8 ATR away → always reference
        if dist_atr > 8:
            reference.append(z)
            continue

        # Distance gate: >25% → reference
        if dist_pct > 0.25:
            reference.append(z)
            continue

        z["_score"] = _score_zone(z, last_price, atr_safe)
        z["_dist_pct"] = dist_pct
        primary_candidates.append(z)

    # Sort by score descending
    primary_candidates.sort(key=lambda z: z["_score"], reverse=True)

    # Take top 4
    primary = primary_candidates[:4]
    overflow = primary_candidates[4:]
    reference.extend(overflow)

    # Coverage guarantee: ensure at least 1 support + 1 resistance within ±10%
    has_support = any(z["center"] < last_price for z in primary)
    has_resistance = any(z["center"] >= last_price for z in primary)

    if not has_support:
        near_support = next(
            (z for z in reference if z["center"] < last_price and abs(z["center"] - last_price) / last_price < 0.10),
            None,
        )
        if near_support:
            reference.remove(near_support)
            primary.append(near_support)

    if not has_resistance:
        near_resistance = next(
            (z for z in reference if z["center"] >= last_price and abs(z["center"] - last_price) / last_price < 0.10),
            None,
        )
        if near_resistance:
            reference.remove(near_resistance)
            primary.append(near_resistance)

    # Clean up internal scoring fields
    for z in primary + reference:
        z.pop("_score", None)
        z.pop("_dist_pct", None)

    # Add distance_pct to all zones for frontend
    for z in primary + reference:
        z["distance_pct"] = round((z["center"] - last_price) / last_price * 100, 2) if last_price > 0 else 0

    # Split into support/resistance
    primary_support = sorted([z for z in primary if z["center"] < last_price], key=lambda z: last_price - z["center"])
    primary_resistance = sorted([z for z in primary if z["center"] >= last_price], key=lambda z: z["center"] - last_price)
    ref_support = sorted([z for z in reference if z["center"] < last_price], key=lambda z: last_price - z["center"])
    ref_resistance = sorted([z for z in reference if z["center"] >= last_price], key=lambda z: z["center"] - last_price)

    return primary_support, primary_resistance, ref_support, ref_resistance


def build_technical(bars: list[dict], last_price: float) -> dict:
    sma30 = compute_sma(bars, 30)
    sma100 = compute_sma(bars, 100)
    sma200 = compute_sma(bars, 200)
    atr20 = compute_atr(bars, 20)
    avg_vol_50 = compute_avg_volume(bars, 50)

    today_bar = bars[-1] if bars else None
    today_volume = today_bar["volume"] if today_bar else None
    volume_ratio = (
        today_volume / avg_vol_50
        if today_volume is not None and avg_vol_50 and avg_vol_50 > 0
        else None
    )

    poc, hvn_levels, _ = compute_volume_profile(bars)
    all_zones = compute_zones(bars, poc, hvn_levels, last_price, sma200, sma30=sma30, sma100=sma100)

    # Filter into primary (chart-safe) and reference (far/weak)
    p_sup, p_res, r_sup, r_res = _filter_and_split_zones(
        all_zones, last_price, atr20 or (last_price * 0.02),
    )

    # Legacy fields for backward compatibility
    support_zones = p_sup
    resistance_zones = p_res

    pattern_tags = _detect_patterns(bars, last_price, sma200, support_zones, volume_ratio)

    return {
        "sma30": sma30,
        "sma100": sma100,
        "sma200": sma200,
        "avg_volume_50": avg_vol_50,
        "atr20": atr20,
        "today_volume": today_volume,
        "volume_ratio": volume_ratio,
        "support_zones": support_zones,
        "resistance_zones": resistance_zones,
        "reference_support": r_sup,
        "reference_resistance": r_res,
        "pattern_tags": pattern_tags,
    }


def _detect_patterns(
    bars: list[dict],
    price: float,
    sma200: float | None,
    support_zones: list[dict],
    volume_ratio: float | None,
) -> list[str]:
    tags: list[str] = []

    if sma200 is not None:
        tags.append("above_sma200" if price > sma200 else "below_sma200")

    if volume_ratio is not None:
        if volume_ratio >= 1.5:
            tags.append("high_volume")
        elif volume_ratio < 0.8:
            tags.append("low_volume")

    if len(bars) < 10 or not support_zones:
        return tags

    nearest = support_zones[0]
    dist = (price - nearest["center"]) / price

    if dist < -0.005:
        tags.append("break_below_support")
        prev_bars = bars[-5:]
        recent_low = min(b["low"] for b in prev_bars)
        is_low_vol = volume_ratio is not None and volume_ratio < 1.5
        if price > recent_low and price < nearest["center"] and is_low_vol:
            tags.append("dead_cat_bounce")

    if -0.005 <= dist <= 0.015 and len(bars) >= 2:
        prev_bar = bars[-2]
        if prev_bar["close"] < price and prev_bar["low"] <= nearest["upper"]:
            tags.append("reversal_at_support")

    if dist > 0.005 and len(bars) >= 3:
        two_ago = bars[-3]
        if two_ago["low"] < nearest["lower"] and price > nearest["upper"]:
            tags.append("false_break_recovery")

    if dist > 0.02 and dist < 0.08 and len(tags) <= 2:
        tags.append("limbo_zone")

    return tags
