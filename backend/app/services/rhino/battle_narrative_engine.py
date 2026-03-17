"""
Battle narrative engine -- bilingual Rhino War Report generator.

Pure presentation layer. Reads structured battle report output only.
NEVER recomputes analytical logic. NEVER calls upstream engines.

Voice:
  ZH: 像一个老交易员在写盘前备忘录 — calm, restrained, direct, opinionated.
  EN: Seasoned trader's pre-market memo — concise, direct, opinionated.

Sections:
  1. Valuation anchor
  2. Battlefield structure
  3. Macro radar + volume mirror
  4. Tactical playbook

Safety rules:
  - No guaranteed returns
  - No emotional language
  - No exaggeration
  - No uncalculated inferences

Graceful degradation:
  - Missing fields produce natural shorter sentences via safe_phrase helper
  - Never broken placeholders, never N/A in final output
"""
from __future__ import annotations

from typing import NamedTuple

from .fundamental_narrative_engine import FundamentalNarrative


class BattleNarrativeReport(NamedTuple):
    """Four-section narrative output for the battle report."""
    fundamental: str
    battlefield: str
    macro: str
    playbook: str


# =====================================================================
# CENTRALIZED LABEL MAPS — read-only consumption of structured data
# =====================================================================

_CLASS_LABELS_ZH = {
    "deep_value": "deep_value_zh",
    "discount":   "discount_zh",
    "fair":       "fair_zh",
    "premium":    "premium_zh",
}

_STYLE_LABELS_ZH = {
    "growth":           "growth_zh",
    "quality_mega_cap": "quality_mega_cap_zh",
    "cyclical":         "cyclical_zh",
    "financial":        "financial_zh",
    "defensive":        "defensive_zh",
    "hyper_growth":     "hyper_growth_zh",
    "pre_profit":       "pre_profit_zh",
    "unknown":          "unknown_zh",
}

_STYLE_EXPLANATION_ZH: dict[str, str] = {
    "growth":           "growth_expl_zh",
    "quality_mega_cap": "qmc_expl_zh",
    "cyclical":         "cyclical_expl_zh",
    "financial":        "financial_expl_zh",
    "defensive":        "defensive_expl_zh",
    "hyper_growth":     "hyper_growth_expl_zh",
    "pre_profit":       "pre_profit_expl_zh",
}

# English label maps
_CLASS_LABELS_EN = {
    "deep_value": "Deep Value",
    "discount":   "Discount",
    "fair":       "Fair Value",
    "premium":    "Premium",
}

_STYLE_LABELS_EN = {
    "growth":           "Growth",
    "quality_mega_cap": "Quality Mega-Cap",
    "cyclical":         "Cyclical",
    "financial":        "Financial",
    "defensive":        "Defensive",
    "hyper_growth":     "Hyper-Growth",
    "pre_profit":       "Pre-Profit",
    "unknown":          "General",
}

_STYLE_EXPLANATION_EN: dict[str, str] = {
    "growth":           "The market pays a premium for stable growth — upside comes from valuation expansion.",
    "quality_mega_cap": "Quality mega-cap premiums persist longer but re-price when growth slows.",
    "cyclical":         "Cyclical valuations follow mean reversion, not sustained expansion.",
    "financial":        "Financial valuations are driven by rate spreads and credit cycles. PE bands are relatively stable.",
    "defensive":        "Defensive assets follow a recovery path, not expansion-driven.",
    "hyper_growth":     "Hyper-growth PE cannot be compressed to mature-company standards. Valuation depends on growth durability.",
    "pre_profit":       "Pre-profit companies cannot use PE frameworks. Focus on revenue growth and cash flow trends.",
}

# Populated below after Chinese string definitions
_ZH: dict[str, str] = {}


# =====================================================================
# VOLUME LABEL MAPPER — centralized, consistent with technical_engine
# thresholds: >= 1.5 high, < 0.8 low, else normal
# =====================================================================

class VolumeLabelMapper:
    """Maps volume risk signals to Chinese war-report labels.

    Three states aligned with technical_engine thresholds:
      - strong_volume (>= 1.5x): 放量确认
      - weak_volume   (< 0.8x):  缩量反弹
      - normal        (else):    资金观望

    Consumes structured macro.risks[] signal names only.
    Never reads raw volume_ratio directly.
    """

    _LABELS = {
        "strong": {"zh": "\u653e\u91cf\u786e\u8ba4", "en": "volume confirmation"},
        "weak":   {"zh": "\u7f29\u91cf\u53cd\u5f39", "en": "low-volume bounce"},
        "normal": {"zh": "\u8d44\u91d1\u89c2\u671b", "en": "capital on sidelines"},
    }

    @staticmethod
    def label(risks: list[dict], lang: str = "zh") -> str:
        has_strong = any(r.get("signal") == "strong_volume" for r in risks)
        if has_strong:
            return VolumeLabelMapper._LABELS["strong"][lang]
        has_weak = any(r.get("signal") == "weak_volume" for r in risks)
        if has_weak:
            return VolumeLabelMapper._LABELS["weak"][lang]
        return VolumeLabelMapper._LABELS["normal"][lang]


# =====================================================================
# GRACEFUL DEGRADATION — safe_phrase helper
# =====================================================================

def safe_phrase(
    template: str,
    **kwargs: float | str | None,
) -> str:
    """Build a phrase only if ALL required values are non-None.

    Returns the formatted string if all kwargs are valid,
    or empty string if any value is None.

    Usage:
        safe_phrase("EPS anchor ${eps}", eps=narrative.anchor_eps)
        -> "EPS anchor $5.00" or ""
    """
    for v in kwargs.values():
        if v is None:
            return ""
    # Format numeric values
    formatted: dict[str, str] = {}
    for k, v in kwargs.items():
        if isinstance(v, float):
            formatted[k] = f"{v:,.2f}"
        elif isinstance(v, int):
            formatted[k] = str(v)
        else:
            formatted[k] = str(v)
    return template.format(**formatted)


# =====================================================================
# FORMATTING HELPERS
# =====================================================================

def _f(n: float | None, d: int = 2) -> str:
    if n is None:
        return ""
    return f"{n:,.{d}f}"


def _pct(n: float | None) -> str:
    if n is None:
        return ""
    return f"{n * 100:.1f}%"


# =====================================================================
# CHINESE STRING POOL
# =====================================================================

_ZH = {
    # Classification
    "deep_value_zh":      "\u6df1\u5ea6\u6298\u4ef7",
    "discount_zh":        "\u6298\u4ef7",
    "fair_zh":            "\u5408\u7406\u4f30\u503c",
    "premium_zh":         "\u6ea2\u4ef7",

    # Style
    "growth_zh":          "\u6210\u957f\u578b",
    "quality_mega_cap_zh": "\u8d28\u91cf\u578b\u5927\u76d8\u80a1",
    "cyclical_zh":        "\u5468\u671f\u578b",
    "financial_zh":       "\u91d1\u878d\u578b",
    "defensive_zh":       "\u9632\u5fa1\u578b",
    "hyper_growth_zh":    "\u9ad8\u901f\u6210\u957f\u578b",
    "pre_profit_zh":      "\u672a\u76c8\u5229\u578b",
    "unknown_zh":         "\u901a\u7528\u578b",

    # Style explanations — signature voice
    "growth_expl_zh":     "\u5e02\u573a\u613f\u610f\u4e3a\u7a33\u5b9a\u6210\u957f\u652f\u4ed8\u6ea2\u4ef7\uff0c\u4e0a\u884c\u7a7a\u95f4\u66f4\u591a\u6765\u81ea\u4f30\u503c\u6269\u5f20\u3002",
    "qmc_expl_zh":        "\u8d28\u91cf\u578b\u5927\u76d8\u80a1\u7684\u6ea2\u4ef7\u53ef\u4ee5\u6301\u7eed\u66f4\u4e45\uff0c\u4f46\u589e\u901f\u653e\u7f13\u65f6\u4f1a\u91cd\u65b0\u5b9a\u4ef7\u3002",
    "cyclical_expl_zh":   "\u5468\u671f\u80a1\u4f30\u503c\u8d70\u5747\u503c\u56de\u5f52\u903b\u8f91\uff0c\u4e0d\u662f\u6301\u7eed\u6269\u5f20\u3002",
    "financial_expl_zh":  "\u91d1\u878d\u80a1\u7684\u4f30\u503c\u53d7\u5229\u5dee\u548c\u4fe1\u8d37\u5468\u671f\u9a71\u52a8\uff0cPE\u533a\u95f4\u76f8\u5bf9\u7a33\u5b9a\u3002",
    "defensive_expl_zh":  "\u9632\u5fa1\u578b\u8d44\u4ea7\u8d70\u4fee\u590d\u8def\u5f84\uff0c\u4e0d\u662f\u6269\u5f20\u9a71\u52a8\u3002",
    "hyper_growth_expl_zh": "\u9ad8\u901f\u6210\u957f\u80a1\u7684PE\u4e0d\u80fd\u7528\u6210\u719f\u516c\u53f8\u6807\u51c6\u538b\u7f29\uff0c\u4f30\u503c\u66f4\u591a\u53d6\u51b3\u4e8e\u589e\u901f\u7684\u6301\u7eed\u6027\u3002",
    "pre_profit_expl_zh": "\u672a\u76c8\u5229\u516c\u53f8\u65e0\u6cd5\u4f7f\u7528PE\u4f30\u503c\u6846\u67b6\uff0c\u5f53\u524d\u5173\u6ce8\u8425\u6536\u589e\u957f\u548c\u73b0\u91d1\u6d41\u8d8b\u52bf\u3002",

    # VIX
    "vix_normal":         "\u7a33\u5b9a",
    "vix_elevated":       "\u8b66\u60d5",
    "vix_crisis":         "\u7d27\u5f20",

    # Rate
    "rate_neutral":       "\u4e2d\u6027",
    "rate_restrictive":   "\u538b\u529b",
    "rate_supportive":    "\u652f\u6301",

    # Bias
    "bias_bullish":       "\u770b\u591a",
    "bias_bearish":       "\u9632\u5b88",
    "bias_neutral":       "\u89c2\u671b",

    # Action
    "action_strong_buy":    "\u5f3a\u70c8\u770b\u591a",
    "action_defensive_buy": "\u8c28\u614e\u770b\u591a",
    "action_hold_watch":    "\u4e2d\u6027\u89c2\u671b",
    "action_reduce":        "\u9632\u5b88\u51cf\u4ed3",
    "action_stop_loss":     "\u98ce\u63a7\u4f18\u5148\uff0c\u4e25\u683c\u6b62\u635f",

    # Framing
    "framing_expansion":  "\u4f30\u503c\u6269\u5f20\u8def\u5f84",
    "framing_recovery":   "\u4fee\u590d\u8def\u5f84",

    # Macro conclusion
    "macro_favorable":    "\u8fdb\u653b",
    "macro_defensive":    "\u9632\u5b88",
    "macro_mixed":        "\u8c28\u614e",
}

# ── English label pool ──────────────────────────────────────────────

_EN = {
    # VIX
    "vix_normal":       "stable",
    "vix_elevated":     "cautious",
    "vix_crisis":       "stressed",

    # Rate
    "rate_neutral":     "neutral",
    "rate_restrictive": "restrictive",
    "rate_supportive":  "supportive",

    # Bias
    "bias_bullish":     "bullish",
    "bias_bearish":     "defensive",
    "bias_neutral":     "neutral",

    # Action
    "action_strong_buy":    "strong buy",
    "action_defensive_buy": "defensive buy",
    "action_hold_watch":    "hold / watch",
    "action_reduce":        "reduce",
    "action_stop_loss":     "risk-first, strict stop-loss",

    # Framing
    "framing_expansion":  "valuation expansion path",
    "framing_recovery":   "recovery path",

    # Macro conclusion
    "macro_favorable":  "offensive",
    "macro_defensive":  "defensive",
    "macro_mixed":      "cautious",
}


# =====================================================================
# SECTION 1 — Valuation Anchor
# =====================================================================

def _build_fundamental_narrative(
    narrative: FundamentalNarrative,
    price: float,
    lang: str = "zh",
) -> str:
    if narrative.raw_mid is None:
        if lang == "zh":
            return (
                "\u4f30\u503c\u6570\u636e\u4e0d\u8db3\uff0c\u65e0\u6cd5\u5efa\u7acb\u524d\u77bbPE\u5b9a\u4ef7\u6846\u67b6\u3002"
                "\u9ed8\u8ba4\u5f52\u7c7b\u4e3a\u5408\u7406\u4f30\u503c\uff0c\u5f85\u6570\u636e\u5145\u5206\u540e\u91cd\u65b0\u5ba1\u89c6\u3002"
            )
        return (
            "Insufficient valuation data to build a forward PE framework. "
            "Defaulting to fair value classification pending more data."
        )

    parts: list[str] = []

    if lang == "zh":
        # EPS anchor
        eps_phrase = safe_phrase(
            "\u5b9a\u4ef7\u951a\uff1a\u524d\u77bb EPS ${eps}\u3002",
            eps=narrative.anchor_eps,
        )
        if eps_phrase:
            parts.append(eps_phrase)

        # Growth + PE band
        if narrative.growth_pct is not None and narrative.pe_band_low is not None:
            parts.append(
                f"\u589e\u901f {_pct(narrative.growth_pct)}\uff0c"
                f"\u7eaa\u5f8b\u7ed9\u51fa PE {_f(narrative.pe_band_low, 1)}\u2013{_f(narrative.pe_band_high, 1)} \u500d\u3002"
            )
        elif narrative.pe_band_low is not None and narrative.pe_band_high is not None:
            parts.append(
                f"\u7eaa\u5f8b\u7ed9\u51fa PE {_f(narrative.pe_band_low, 1)}\u2013{_f(narrative.pe_band_high, 1)} \u500d\u3002"
            )

        # Fair value band
        fv_phrase = safe_phrase(
            "\u5408\u7406\u4ef7\u683c\u533a\u95f4 ${low}\u2013${high}\u3002",
            low=narrative.raw_low,
            high=narrative.raw_high,
        )
        if fv_phrase:
            parts.append(fv_phrase)

        # Classification
        class_label = _ZH.get(_CLASS_LABELS_ZH.get(narrative.classification, ""), narrative.classification)
        parts.append(f"\u5f53\u524d ${_f(price)} \u5904\u4e8e{class_label}\u4f4d\u7f6e\u3002")

        # Style
        style_label = _ZH.get(_STYLE_LABELS_ZH.get(narrative.valuation_style, ""), narrative.valuation_style)
        parts.append(f"\u98ce\u683c\u5f52\u7c7b\uff1a{style_label}\u3002")

        # Style explanation
        expl_key = _STYLE_EXPLANATION_ZH.get(narrative.valuation_style)
        if expl_key:
            expl = _ZH.get(expl_key)
            if expl:
                parts.append(expl)
    else:
        # EN: EPS anchor
        eps_phrase = safe_phrase(
            "Pricing anchor: forward EPS ${eps}.",
            eps=narrative.anchor_eps,
        )
        if eps_phrase:
            parts.append(eps_phrase)

        # Growth + PE band
        if narrative.growth_pct is not None and narrative.pe_band_low is not None:
            parts.append(
                f"Growth {_pct(narrative.growth_pct)}, "
                f"discipline yields PE {_f(narrative.pe_band_low, 1)}\u2013{_f(narrative.pe_band_high, 1)}x."
            )
        elif narrative.pe_band_low is not None and narrative.pe_band_high is not None:
            parts.append(
                f"Discipline yields PE {_f(narrative.pe_band_low, 1)}\u2013{_f(narrative.pe_band_high, 1)}x."
            )

        # Fair value band
        fv_phrase = safe_phrase(
            "Fair value range ${low}\u2013${high}.",
            low=narrative.raw_low,
            high=narrative.raw_high,
        )
        if fv_phrase:
            parts.append(fv_phrase)

        # Classification
        class_label = _CLASS_LABELS_EN.get(narrative.classification, narrative.classification)
        parts.append(f"Current ${_f(price)} is in {class_label} territory.")

        # Style
        style_label = _STYLE_LABELS_EN.get(narrative.valuation_style, narrative.valuation_style)
        parts.append(f"Style classification: {style_label}.")

        # Style explanation
        expl = _STYLE_EXPLANATION_EN.get(narrative.valuation_style)
        if expl:
            parts.append(expl)

    return " ".join(parts) if lang == "en" else "".join(parts)


# =====================================================================
# SECTION 2 — Battlefield Structure
# =====================================================================

def _build_battlefield_narrative(
    ladder: dict,
    price: float,
    lang: str = "zh",
) -> str:
    support = ladder.get("support", [])
    resistance = ladder.get("resistance", [])

    if not support and not resistance:
        if lang == "zh":
            return (
                "\u5f53\u524d\u7f3a\u4e4f\u660e\u786e\u652f\u6491\u548c\u538b\u529b\u4f4d\uff0c"
                "\u65e0\u6cd5\u8bc6\u522b\u6218\u672f\u62d0\u70b9\u3002"
            )
        return "No clear support or resistance levels identified. Unable to define tactical inflection points."

    parts: list[str] = []

    if lang == "zh":
        # Resistance
        if resistance:
            r1 = resistance[0]
            parts.append(
                f"\u4e0a\u65b9\u538b\u529b ${_f(r1['level'])}"
                f"\uff08+{_f(r1.get('dist_pct', 0), 1)}%\uff09"
            )
            if len(resistance) >= 2:
                r2 = resistance[1]
                parts[-1] += f"\uff0c\u7a81\u7834\u540e\u770b\u5411 ${_f(r2['level'])}\u3002"
            else:
                parts[-1] += "\u3002"

        # Support
        if support:
            s1 = support[0]
            parts.append(
                f"\u4e0b\u65b9\u652f\u6491 ${_f(s1['level'])}"
                f"\uff08-{_f(s1.get('dist_pct', 0), 1)}%\uff09"
            )
            if len(support) >= 2:
                s2 = support[1]
                parts[-1] += f"\uff0c\u5931\u5b88\u5219\u56de\u6d4b ${_f(s2['level'])}\u3002"
            else:
                parts[-1] += "\u3002"

        # Structure-aware reversal
        pattern_tags = ladder.get("pattern_tags", [])
        is_bearish = "below_sma200" in pattern_tags

        if is_bearish and resistance:
            overhead = resistance[0]
            parts.append(
                f"\u5728\u91cd\u65b0\u7ad9\u4e0a ${_f(overhead['level'])} \u4e4b\u524d\uff0c"
                f"\u53cd\u5f39\u5747\u89c6\u4e3a\u7ed3\u6784\u4fee\u590d\u3002"
            )
        elif support and resistance:
            s_top = support[0]["level"]
            r_bottom = resistance[0]["level"]
            if s_top < price < r_bottom:
                parts.append(
                    f"\u5728\u7a81\u7834\u7bb1\u4f53\u4e0a\u6cbf ${_f(r_bottom)} \u4e4b\u524d\uff0c"
                    f"\u5f53\u524d\u4ecd\u6309\u533a\u95f4\u9707\u8361\u5904\u7406\u3002"
                )
            else:
                parts.append(
                    f"\u8dcc\u7834 ${_f(s_top)} \u540e\uff0c\u5f53\u524d\u4fee\u590d\u7ed3\u6784\u5931\u6548\u3002"
                )
        elif support:
            parts.append(
                f"\u8dcc\u7834 ${_f(support[0]['level'])} \u540e\uff0c\u5f53\u524d\u4fee\u590d\u7ed3\u6784\u5931\u6548\u3002"
            )
    else:
        # EN: Resistance
        if resistance:
            r1 = resistance[0]
            parts.append(
                f"Overhead resistance at ${_f(r1['level'])} (+{_f(r1.get('dist_pct', 0), 1)}%)"
            )
            if len(resistance) >= 2:
                r2 = resistance[1]
                parts[-1] += f", breakout targets ${_f(r2['level'])}."
            else:
                parts[-1] += "."

        # EN: Support
        if support:
            s1 = support[0]
            parts.append(
                f"Support floor at ${_f(s1['level'])} (-{_f(s1.get('dist_pct', 0), 1)}%)"
            )
            if len(support) >= 2:
                s2 = support[1]
                parts[-1] += f", breach targets ${_f(s2['level'])}."
            else:
                parts[-1] += "."

        # EN: Structure-aware reversal
        pattern_tags = ladder.get("pattern_tags", [])
        is_bearish = "below_sma200" in pattern_tags

        if is_bearish and resistance:
            overhead = resistance[0]
            parts.append(
                f"Until ${_f(overhead['level'])} is reclaimed, "
                f"any bounce is treated as structural repair only."
            )
        elif support and resistance:
            s_top = support[0]["level"]
            r_bottom = resistance[0]["level"]
            if s_top < price < r_bottom:
                parts.append(
                    f"Until ${_f(r_bottom)} breaks out, "
                    f"current action is range-bound consolidation."
                )
            else:
                parts.append(
                    f"A break below ${_f(s_top)} invalidates the current repair structure."
                )
        elif support:
            parts.append(
                f"A break below ${_f(support[0]['level'])} invalidates the current repair structure."
            )

    return " ".join(parts) if lang == "en" else "".join(parts)


# =====================================================================
# SECTION 3 — Macro Radar + Volume Mirror
# =====================================================================

def _build_macro_narrative(macro: dict, lang: str = "zh") -> str:
    parts: list[str] = []
    risks = macro.get("risks", [])
    vix_regime = macro.get("vix_regime", "unavailable")
    rate_regime = macro.get("rate_regime", "unavailable")
    haircut = macro.get("haircut_pct", 0)

    pool = _ZH if lang == "zh" else _EN

    if lang == "zh":
        # VIX
        vix_label = pool.get(f"vix_{vix_regime}", vix_regime)
        vix_val = None
        for r in risks:
            if r["signal"] == "high_vix":
                try:
                    vix_val = r["label"].split("VIX at ")[1].split(" ")[0]
                except (IndexError, KeyError):
                    pass
        if vix_val:
            parts.append(f"VIX {vix_val}\uff0c\u60c5\u7eea{vix_label}\u3002")
        else:
            parts.append(f"\u5e02\u573a\u60c5\u7eea{vix_label}\u3002")

        # Rates
        rate_label = pool.get(f"rate_{rate_regime}", rate_regime)
        treasury_val = None
        for r in risks:
            if r["signal"] == "high_yield":
                try:
                    treasury_val = r["label"].split("yield at ")[1].split("%")[0]
                except (IndexError, KeyError):
                    pass
        if treasury_val:
            parts.append(f"10\u5e74\u671f {treasury_val}%\uff0c\u5229\u7387{rate_label}\u3002")
        else:
            parts.append(f"\u5229\u7387\u73af\u5883{rate_label}\u3002")

        # Volume
        vol_label = VolumeLabelMapper.label(risks, lang)
        parts.append(f"\u6210\u4ea4\u91cf\u4fe1\u53f7\uff1a{vol_label}\u3002")

        # Conclusion
        if not risks:
            conclusion = pool["macro_favorable"]
        elif any(r.get("severity") == "high" for r in risks):
            conclusion = pool["macro_defensive"]
        else:
            conclusion = pool["macro_mixed"]
        parts.append(f"\u7efc\u5408\u7b56\u7565\uff1a{conclusion}\u3002")

        if haircut > 0:
            parts.append(f"\u5df2\u5e94\u7528 {haircut}% \u4f30\u503c\u6298\u6263\u3002")
    else:
        # EN: VIX
        vix_label = pool.get(f"vix_{vix_regime}", vix_regime)
        vix_val = None
        for r in risks:
            if r["signal"] == "high_vix":
                try:
                    vix_val = r["label"].split("VIX at ")[1].split(" ")[0]
                except (IndexError, KeyError):
                    pass
        if vix_val:
            parts.append(f"VIX at {vix_val}, sentiment {vix_label}.")
        else:
            parts.append(f"Market sentiment {vix_label}.")

        # EN: Rates
        rate_label = pool.get(f"rate_{rate_regime}", rate_regime)
        treasury_val = None
        for r in risks:
            if r["signal"] == "high_yield":
                try:
                    treasury_val = r["label"].split("yield at ")[1].split("%")[0]
                except (IndexError, KeyError):
                    pass
        if treasury_val:
            parts.append(f"10Y at {treasury_val}%, rate environment {rate_label}.")
        else:
            parts.append(f"Rate environment {rate_label}.")

        # EN: Volume
        vol_label = VolumeLabelMapper.label(risks, lang)
        parts.append(f"Volume signal: {vol_label}.")

        # EN: Conclusion
        if not risks:
            conclusion = pool["macro_favorable"]
        elif any(r.get("severity") == "high" for r in risks):
            conclusion = pool["macro_defensive"]
        else:
            conclusion = pool["macro_mixed"]
        parts.append(f"Overall strategy: {conclusion}.")

        if haircut > 0:
            parts.append(f"Applied {haircut}% valuation haircut.")

    return " ".join(parts) if lang == "en" else "".join(parts)


# =====================================================================
# SECTION 4 — Tactical Playbook
# =====================================================================

def _build_playbook_narrative(
    playbook: dict,
    lang: str = "zh",
) -> str:
    parts: list[str] = []

    bias = playbook.get("bias_tag", "neutral")
    action = playbook.get("action_tag", "hold_watch")
    upside = playbook.get("upside", {})
    downside = playbook.get("downside", {})
    risk_rule = playbook.get("risk_rule", "")

    pool = _ZH if lang == "zh" else _EN

    # Bias + action
    bias_label = pool.get(f"bias_{bias}", bias)
    action_label = pool.get(f"action_{action}", action)

    # Framing
    framing = upside.get("framing", "expansion")
    framing_label = pool.get(f"framing_{framing}", framing)

    # Reversal confirmation line
    reversal_line = playbook.get("reversal_confirmation_line")

    trigger = upside.get("trigger")
    target = upside.get("target")
    down_trigger = downside.get("trigger")
    down_target = downside.get("target")

    if lang == "zh":
        parts.append(f"\u504f\u5411{bias_label}\uff0c\u64cd\u4f5c\u5efa\u8bae{action_label}\u3002")

        # Upside
        if trigger is not None and target is not None:
            parts.append(
                f"\u7a81\u7834 ${_f(trigger)} \u540e\uff0c{framing_label}\u770b\u5411 ${_f(target)}\u3002"
            )
        elif trigger is not None:
            if reversal_line is not None:
                parts.append(
                    f"\u53cd\u5f39\u4fee\u590d\u76ee\u6807 ${_f(trigger)}\uff0c"
                    f"\u786e\u8ba4\u53cd\u8f6c\u9700\u7ad9\u7a33\u8be5\u4f4d\u3002"
                )
            else:
                parts.append(
                    f"\u7a81\u7834 ${_f(trigger)} \u540e\uff0c{framing_label}\u53ef\u80fd\u6253\u5f00\u3002"
                )
        else:
            parts.append("\u5f53\u524d\u7ed3\u6784\u672a\u663e\u793a\u660e\u786e\u4e0a\u884c\u76ee\u6807\u3002")

        # Downside
        if down_trigger is not None and down_target is not None:
            parts.append(
                f"\u8dcc\u7834 ${_f(down_trigger)} \u5219\u98ce\u9669\u6269\u5927\u81f3 ${_f(down_target)}\u3002"
            )
        elif down_trigger is not None:
            parts.append(f"${_f(down_trigger)} \u4e3a\u5173\u952e\u652f\u6491\uff0c\u5931\u5b88\u9700\u4e25\u683c\u98ce\u63a7\u3002")
        else:
            parts.append("\u65e0\u660e\u786e\u652f\u6491\u4f4d\u4f5c\u4e3a\u6b62\u635f\u53c2\u8003\u3002")

        # Rationale
        rationale = playbook.get("rationale", [])
        if rationale:
            zh_items = []
            for item in rationale:
                if isinstance(item, dict):
                    zh_items.append(item.get("zh", item.get("en", "")))
                else:
                    zh_items.append(str(item))
            joined = "\uff1b".join(zh_items)
            parts.append(f"\u5173\u952e\u56e0\u7d20\uff1a{joined}\u3002")

        # Risk rule
        risk_rule_zh = playbook.get("risk_rule_zh", "")
        display_rule = risk_rule_zh or risk_rule
        if display_rule:
            parts.append(f"\u4ed3\u4f4d\u7eaa\u5f8b\uff1a{display_rule}\u3002")
    else:
        parts.append(f"Bias: {bias_label}. Recommendation: {action_label}.")

        # Upside
        if trigger is not None and target is not None:
            parts.append(
                f"Breakout above ${_f(trigger)} opens {framing_label} toward ${_f(target)}."
            )
        elif trigger is not None:
            if reversal_line is not None:
                parts.append(
                    f"Repair target ${_f(trigger)}, "
                    f"reversal confirmation requires holding above this level."
                )
            else:
                parts.append(
                    f"Breakout above ${_f(trigger)} may open the {framing_label}."
                )
        else:
            parts.append("No clear upside target identified in current structure.")

        # Downside
        if down_trigger is not None and down_target is not None:
            parts.append(
                f"Break below ${_f(down_trigger)} extends risk to ${_f(down_target)}."
            )
        elif down_trigger is not None:
            parts.append(f"${_f(down_trigger)} is key support; breach requires strict risk control.")
        else:
            parts.append("No clear support level for stop-loss reference.")

        # Rationale
        rationale = playbook.get("rationale", [])
        if rationale:
            en_items = []
            for item in rationale:
                if isinstance(item, dict):
                    en_items.append(item.get("en", str(item)))
                else:
                    en_items.append(str(item))
            joined = "; ".join(en_items)
            parts.append(f"Key factors: {joined}.")

        # Risk rule
        display_rule = risk_rule
        if display_rule:
            parts.append(f"Position discipline: {display_rule}.")

    return " ".join(parts) if lang == "en" else "".join(parts)


# =====================================================================
# PUBLIC API
# =====================================================================

def build_battle_narrative(
    price: float,
    narrative: FundamentalNarrative,
    ladder: dict,
    macro: dict,
    playbook: dict,
    lang: str = "zh",
) -> BattleNarrativeReport:
    """Build four-section bilingual war report from structured battle report data.

    Pure presentation -- no analytical recomputation.
    All data consumed from structured upstream outputs.
    Voice: seasoned trader's pre-market memo.
    """
    return BattleNarrativeReport(
        fundamental=_build_fundamental_narrative(narrative, price, lang),
        battlefield=_build_battlefield_narrative(ladder, price, lang),
        macro=_build_macro_narrative(macro, lang),
        playbook=_build_playbook_narrative(playbook, lang),
    )
