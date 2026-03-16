"""
Report builder — renders structured analysis data into localized text sections.

No business logic here. Reads semantic tags from engine output, maps to templates.
"""
from __future__ import annotations

from .templates import TEMPLATES


def build_report(lang: str, ctx: dict) -> dict:
    t = TEMPLATES.get(lang, TEMPLATES["en"])
    return {
        "lang": lang,
        "sections": {
            "overview": _overview(t, ctx),
            "technical": _technical(t, ctx),
            "valuation": _valuation(t, ctx),
            "macro": _macro(t, ctx),
            "playbook": _playbook(t, ctx),
            "confidence": _confidence(t, ctx),
        },
    }


def _fmt(template: str, **kw) -> str:
    result = template
    for k, v in kw.items():
        result = result.replace("{" + k + "}", str(v))
    return result


def _fp(n: float) -> str:
    return f"{n:.2f}"


# ── Section renderers ────────────────────────────────────────────────────────

def _overview(t: dict, ctx: dict) -> str:
    quote = ctx.get("quote")
    pct = quote.get("change_pct") if quote else None
    if pct is None or abs(pct) < 0.01:
        desc = t["change_flat"]
    elif pct > 0:
        desc = _fmt(t["change_up"], change_pct=f"{abs(pct):.2f}")
    else:
        desc = _fmt(t["change_down"], change_pct=f"{abs(pct):.2f}")
    return _fmt(t["overview"], symbol=ctx["symbol"], price=_fp(ctx["price"]), change_desc=desc)


def _technical(t: dict, ctx: dict) -> str:
    tech = ctx["technical"]
    lines: list[str] = []

    tags = tech.get("pattern_tags", [])
    if "above_sma200" in tags:
        lines.append(t["technical_above_sma200"])
    elif "below_sma200" in tags:
        lines.append(t["technical_below_sma200"])

    vr = tech.get("volume_ratio")
    if vr is not None:
        if vr >= 1.5:
            lines.append(_fmt(t["technical_volume_high"], volume_ratio=f"{vr:.1f}"))
        elif vr <= 0.5:
            lines.append(_fmt(t["technical_volume_low"], volume_ratio=f"{vr:.1f}"))

    sz = tech.get("support_zones", [])
    rz = tech.get("resistance_zones", [])
    lines.append(_fmt(t["technical_support_count"], count=len(sz)))
    lines.append(_fmt(t["technical_resistance_count"], count=len(rz)))

    price = ctx["price"]
    if sz:
        ns = sz[0]
        pct_below = f"{(price - ns['center']) / price * 100:.1f}"
        lines.append(_fmt(t["technical_nearest_support"], level=_fp(ns["center"]), pct_below=pct_below))
    if rz:
        nr = rz[0]
        pct_above = f"{(nr['center'] - price) / price * 100:.1f}"
        lines.append(_fmt(t["technical_nearest_resistance"], level=_fp(nr["center"]), pct_above=pct_above))

    for tag in tags:
        key = f"pattern_{tag}"
        if key in t:
            lines.append(t[key])

    return "\n".join(lines)


def _valuation(t: dict, ctx: dict) -> str:
    val = ctx["valuation"]
    if not val.get("available"):
        return t["valuation_unavailable"]

    lines: list[str] = []
    band = val["adjusted_fair_value"]
    key = f"valuation_{val['status']}"
    if key in t:
        lines.append(_fmt(t[key], low=_fp(band["low"]), high=_fp(band["high"])))

    if val.get("eps_growth_pct") is not None:
        lines.append(_fmt(t["valuation_eps"],
                          fy1_eps=_fp(val["fy1_eps_avg"]),
                          fy2_eps=_fp(val["fy2_eps_avg"]),
                          growth_pct=f"{val['eps_growth_pct'] * 100:.1f}"))
    elif val.get("fy1_eps_avg") is not None:
        lines.append(_fmt(t["valuation_eps_no_growth"], fy1_eps=_fp(val["fy1_eps_avg"])))

    return "\n".join(lines)


def _macro(t: dict, ctx: dict) -> str:
    m = ctx["macro"]
    lines: list[str] = []

    if m.get("vix_level") is not None:
        key = f"macro_{m['vix_regime']}"
        if key in t:
            lines.append(_fmt(t[key], vix=f"{m['vix_level']:.1f}"))
    else:
        lines.append(t["macro_vix_unavailable"])

    if m.get("treasury_10y") is not None:
        lines.append(_fmt(t["macro_rates"],
                          rate=f"{m['treasury_10y']:.2f}",
                          regime=m["rate_pressure_regime"]))
    else:
        lines.append(t["macro_rates_unavailable"])

    if m.get("recommended_haircut_pct", 0) > 0:
        lines.append(_fmt(t["macro_haircut"], pct=m["recommended_haircut_pct"]))

    return "\n".join(lines)


def _playbook(t: dict, ctx: dict) -> str:
    pb = ctx["playbook"]
    key = f"playbook_{pb['action_tag']}"
    rationale = "; ".join(
        item.get("en", str(item)) if isinstance(item, dict) else str(item)
        for item in pb["rationale"]
    )
    return _fmt(t.get(key, rationale), rationale=rationale)


def _confidence(t: dict, ctx: dict) -> str:
    c = ctx["confidence"]
    reasons = ". ".join(c["reasons"]) if c["reasons"] else ""
    return _fmt(t["confidence"], grade=c["grade"], score=c["score"], reasons=reasons)
