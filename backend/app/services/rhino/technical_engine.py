"""
Technical engine — computes SMA, ATR, volume profile, zones, and pattern tags.
"""
from __future__ import annotations

from .indicators import (
    compute_sma, compute_atr, compute_avg_volume,
    compute_volume_profile, compute_zones,
)


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
    all_zones = compute_zones(bars, poc, hvn_levels, last_price, sma200)

    # Split + sort by proximity (nearest first)
    support_zones = sorted(
        [z for z in all_zones if z["center"] < last_price],
        key=lambda z: last_price - z["center"],
    )
    resistance_zones = sorted(
        [z for z in all_zones if z["center"] >= last_price],
        key=lambda z: z["center"] - last_price,
    )

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

    # Volume thresholds aligned with analysis.py:
    # >1.5x = extreme volume, <0.8x = severe low volume
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
        # analysis.py: dead cat bounce requires no volume confirmation
        # "缩量反弹：反弹没有大幅放量，说明空头回补停下来了"
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
