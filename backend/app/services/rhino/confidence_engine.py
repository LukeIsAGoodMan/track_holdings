"""
Confidence engine — grades analysis quality from data completeness and signal clarity.
"""
from __future__ import annotations


def build_confidence(dq: dict, tech: dict, val: dict) -> dict:
    score = 0
    reasons: list[str] = []

    # Data availability (max 40)
    if dq["has_quote"]:
        score += 10
    else:
        reasons.append("No live quote")

    if dq["has_history"] and dq["history_days"] >= 200:
        score += 15
    elif dq["has_history"]:
        score += 8
        reasons.append(f"Only {dq['history_days']} days of history (200 preferred)")
    else:
        reasons.append("No price history")

    if dq["has_estimates"]:
        score += 10
    else:
        reasons.append("No analyst estimates — valuation unavailable")

    if dq["has_vix"]:
        score += 3
    else:
        reasons.append("VIX unavailable")

    if dq["has_treasury"]:
        score += 2
    else:
        reasons.append("Treasury rates unavailable")

    # Technical signal quality (max 30)
    if tech.get("sma200") is not None:
        score += 10
    support_count = len(tech.get("support_zones", []))
    if support_count >= 2:
        score += 10
    elif support_count >= 1:
        score += 5
        reasons.append("Few support zones identified")
    else:
        reasons.append("No support zones found")

    if tech.get("volume_ratio") is not None:
        score += 5
    if tech.get("pattern_tags"):
        score += 5

    # Valuation quality (max 30)
    if val.get("available"):
        score += 15
        if val.get("eps_growth_pct") is not None:
            score += 10
        else:
            reasons.append("No FY2 estimates — growth rate unavailable")
        if val.get("status") != "unavailable":
            score += 5
    else:
        reasons.append("Valuation engine has no usable data")

    score = min(score, 100)
    grade = "A" if score >= 80 else "B" if score >= 60 else "C" if score >= 40 else "D"

    return {"score": score, "grade": grade, "reasons": reasons}
