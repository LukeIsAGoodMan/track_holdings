"""
Macro engine — classifies VIX regime and rate pressure from raw data.
"""
from __future__ import annotations


def build_macro(raw: dict) -> dict:
    vix = raw.get("vix")
    us10y = raw.get("us10y")

    vix_regime = _classify_vix(vix)
    rate_regime = _classify_rates(us10y)
    haircut = _compute_haircut(vix_regime, rate_regime)
    alerts = _build_alerts(raw, vix_regime, rate_regime)

    return {
        "vix_level": vix,
        "vix_regime": vix_regime,
        "treasury_10y": us10y,
        "rate_pressure_regime": rate_regime,
        "recommended_haircut_pct": haircut,
        "alerts": alerts,
    }


def _classify_vix(vix: float | None) -> str:
    if vix is None:
        return "normal"
    if vix <= 15:
        return "calm"
    if vix <= 20:
        return "normal"
    if vix <= 30:
        return "elevated"
    return "crisis"


def _classify_rates(us10y: float | None) -> str:
    if us10y is None:
        return "neutral"
    if us10y <= 3.0:
        return "supportive"
    if us10y <= 4.0:
        return "neutral"
    if us10y <= 5.0:
        return "restrictive"
    return "hostile"


_VIX_HAIRCUT = {"calm": 0, "normal": 2, "elevated": 5, "crisis": 12}
_RATE_HAIRCUT = {"supportive": 0, "neutral": 2, "restrictive": 5, "hostile": 10}


def _compute_haircut(vix_regime: str, rate_regime: str) -> float:
    return _VIX_HAIRCUT.get(vix_regime, 0) + _RATE_HAIRCUT.get(rate_regime, 0)


def _build_alerts(raw: dict, vix_regime: str, rate_regime: str) -> list[str]:
    alerts: list[str] = []
    if vix_regime == "elevated":
        alerts.append("VIX elevated — consider tighter stops")
    if vix_regime == "crisis":
        alerts.append("VIX in crisis territory — risk-off environment")
    if rate_regime == "restrictive":
        alerts.append("10Y yield restrictive — growth multiples compressed")
    if rate_regime == "hostile":
        alerts.append("10Y yield hostile — significant valuation headwind")
    if raw.get("vix") is None:
        alerts.append("VIX data unavailable")
    if raw.get("us10y") is None:
        alerts.append("Treasury data unavailable")
    return alerts
