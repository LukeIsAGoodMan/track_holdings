"""
Semantic engine — deterministic rule-based interpretation layer.

Converts raw analysis outputs (technical, valuation, macro) into structured
market states for UI consumption and future narrative systems.

No LLM usage.  Pure functions, fully testable.

Rhino philosophy encoded:
  - SMA200 is the "bull/bear dividing line" (多空分水岭)
  - Macro is a risk valve with veto power over technical strength
  - Volume Profile zones define structure, not prediction
  - Valuation anchors conviction; macro controls timing
"""
from __future__ import annotations


def build_semantic_state(
    price: float,
    technical: dict,
    valuation: dict,
    macro: dict,
) -> dict:
    """Build the complete semantic state from engine outputs."""
    trend = _classify_trend(price, technical)
    alignment = _classify_ma_alignment(price, technical)
    location = _classify_price_location(price, technical)
    val_zone = _classify_valuation_zone(valuation)
    macro_regime = _classify_macro_regime(macro)
    flags = _build_flags(trend, alignment, location, val_zone, macro_regime)
    risk = _classify_risk(trend, alignment, location, val_zone, macro_regime)
    stance = _classify_stance(
        trend, alignment, location, val_zone, macro_regime, flags,
    )

    return {
        "trend_state": trend,
        "ma_alignment": alignment,
        "price_location": location,
        "valuation_zone": val_zone,
        "macro_regime": macro_regime,
        "risk_state": risk,
        "stance": stance,
        "flags": flags,
    }


# ── Trend state ────────────────────────────────────────────────────────────

def _classify_trend(price: float, technical: dict) -> str:
    sma200 = technical.get("sma200")
    if sma200 is None:
        return "unavailable"

    atr20 = technical.get("atr20")
    distance = abs(price - sma200)

    # Volatility-aware "near" threshold
    if atr20 is not None and atr20 > 0:
        if distance <= 1.5 * atr20:
            return "near_sma200"
    else:
        # Fallback: 1% of SMA200
        if sma200 > 0 and distance / sma200 <= 0.01:
            return "near_sma200"

    return "above_sma200" if price > sma200 else "below_sma200"


# ── Moving average alignment ──────────────────────────────────────────────

def _classify_ma_alignment(price: float, technical: dict) -> str:
    sma30 = technical.get("sma30")
    sma100 = technical.get("sma100")
    sma200 = technical.get("sma200")

    if sma30 is None or sma100 is None or sma200 is None:
        return "unavailable"

    if price > sma30 > sma100 > sma200:
        return "bullish_alignment"

    if price < sma30 < sma100 < sma200:
        return "bearish_alignment"

    return "mixed_alignment"


# ── Price location ─────────────────────────────────────────────────────────

def _classify_price_location(price: float, technical: dict) -> str:
    support_zones = technical.get("support_zones", [])
    resistance_zones = technical.get("resistance_zones", [])

    if not support_zones and not resistance_zones:
        return "unavailable"

    # Use ATR for thresholds if available, else 2% of price
    atr = technical.get("atr20")
    threshold = atr * 0.5 if atr and atr > 0 else price * 0.02

    nearest_resistance = resistance_zones[0] if resistance_zones else None
    nearest_support = support_zones[0] if support_zones else None

    # Priority 1: breakout_zone — price meaningfully above nearest resistance
    if nearest_resistance:
        if price > nearest_resistance["upper"] + threshold:
            return "breakout_zone"

    # Priority 2: breakdown_risk — price meaningfully below nearest support
    if nearest_support:
        if price < nearest_support["lower"] - threshold:
            return "breakdown_risk"

    # Priority 3: near_resistance
    if nearest_resistance:
        if abs(price - nearest_resistance["center"]) <= threshold:
            return "near_resistance"

    # Priority 4: near_support
    if nearest_support:
        if abs(price - nearest_support["center"]) <= threshold:
            return "near_support"

    # Priority 5: mid_range
    return "mid_range"


# ── Valuation zone ────────────────────────────────────────────────────────

_VALUATION_MAP = {
    "deeply_undervalued": "undervalued",
    "undervalued": "undervalued",
    "fair_value": "fair_value",
    "overvalued": "overvalued",
    "deeply_overvalued": "overvalued",
    "unavailable": "unavailable",
}


def _classify_valuation_zone(valuation: dict) -> str:
    status = valuation.get("status", "unavailable")
    return _VALUATION_MAP.get(status, "unavailable")


# ── Macro regime ──────────────────────────────────────────────────────────

def _classify_macro_regime(macro: dict) -> str:
    vix_regime = macro.get("vix_regime", "unavailable")
    rate_regime = macro.get("rate_pressure_regime", "unavailable")

    if vix_regime == "unavailable" and rate_regime == "unavailable":
        return "unavailable"

    # Crisis VIX → stressed (hard override)
    if vix_regime == "crisis":
        return "stressed"

    # Elevated VIX + restrictive/hostile rates → restrictive_risk
    if vix_regime == "elevated" and rate_regime in ("restrictive", "hostile"):
        return "restrictive_risk"

    # Calm VIX + supportive/neutral rates → supportive
    if vix_regime in ("calm", "normal") and rate_regime in ("supportive", "neutral"):
        return "supportive"

    # Elevated VIX alone or restrictive rates alone
    if vix_regime == "elevated" or rate_regime in ("restrictive", "hostile"):
        return "restrictive_risk"

    return "mixed_macro"


# ── Flags ─────────────────────────────────────────────────────────────────

def _build_flags(
    trend: str,
    alignment: str,
    location: str,
    val_zone: str,
    macro_regime: str,
) -> list[str]:
    flags: list[str] = []

    # Trend flags
    if trend == "above_sma200":
        flags.append("trend_strong")
    elif trend in ("below_sma200", "near_sma200"):
        flags.append("trend_weak")

    # Location flags
    if location == "near_support":
        flags.append("price_near_support")
    elif location == "near_resistance":
        flags.append("price_near_resistance")

    # Valuation flags
    if val_zone in ("undervalued", "fair_value"):
        flags.append("valuation_reasonable")
    elif val_zone == "overvalued":
        flags.append("valuation_expensive")

    # Macro flags
    if macro_regime == "supportive":
        flags.append("macro_supportive")
    elif macro_regime in ("restrictive_risk", "stressed"):
        flags.append("macro_restrictive")

    # Alignment
    if alignment == "bullish_alignment":
        flags.append("ma_bullish")
    elif alignment == "bearish_alignment":
        flags.append("ma_bearish")

    return flags


# ── Risk state ────────────────────────────────────────────────────────────

def _classify_risk(
    trend: str,
    alignment: str,
    location: str,
    val_zone: str,
    macro_regime: str,
) -> str:
    score = 0

    # Trend
    if trend == "below_sma200":
        score += 2
    elif trend == "near_sma200":
        score += 1

    # Alignment
    if alignment == "bearish_alignment":
        score += 2
    elif alignment == "mixed_alignment":
        score += 1

    # Location
    if location == "breakdown_risk":
        score += 2
    elif location == "near_resistance":
        score += 1

    # Valuation
    if val_zone == "overvalued":
        score += 1

    # Macro
    if macro_regime == "stressed":
        score += 3
    elif macro_regime == "restrictive_risk":
        score += 2
    elif macro_regime == "mixed_macro":
        score += 1

    if score >= 7:
        return "high"
    if score >= 4:
        return "elevated"
    if score >= 2:
        return "moderate"
    return "low"


# ── Stance ────────────────────────────────────────────────────────────────

def _classify_stance(
    trend: str,
    alignment: str,
    location: str,
    val_zone: str,
    macro_regime: str,
    flags: list[str],
) -> str:
    # Priority 1: Stressed macro → defensive (hard override / veto)
    if macro_regime == "stressed":
        return "defensive"

    # Priority 2: Restrictive macro + bullish alignment → cautious
    if macro_regime == "restrictive_risk" and alignment == "bullish_alignment":
        return "cautious"

    # Priority 3: Bullish alignment + non-stressed macro + not overvalued → constructive
    if (alignment == "bullish_alignment"
            and macro_regime not in ("stressed", "restrictive_risk")
            and val_zone != "overvalued"):
        return "constructive"

    # Priority 4: Bearish alignment + restrictive/stressed → defensive
    if alignment == "bearish_alignment" and macro_regime in ("restrictive_risk", "stressed"):
        return "defensive"

    # Priority 5: Weak/mixed trend, near support, not expensive → opportunistic
    if (location == "near_support"
            and val_zone != "overvalued"
            and trend in ("below_sma200", "near_sma200", "unavailable")
            and alignment in ("mixed_alignment", "bearish_alignment", "unavailable")):
        return "opportunistic"

    # Priority 6: Bearish alignment alone → cautious
    if alignment == "bearish_alignment":
        return "cautious"

    # Default
    return "neutral"
