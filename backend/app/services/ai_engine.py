"""
Phase 8a/9a -- AI Risk Context Synthesizer + LLM Provider Integration.

Pure functions:
  build_risk_context(positions, risk_summary, holding_groups) -> RiskContext
  _evaluate_rules(ctx) -> list[DiagnosticItem]

Provider interface:
  AiProvider.analyze(context) -> AiInsight          (abstract)
  MockAiProvider.analyze(context) -> AiInsight      (rule-based)
  ClaudeAiProvider.analyze(context) -> AiInsight    (Anthropic Claude API)
  CircuitBreakerProvider.analyze(context) -> AiInsight  (wraps LLM + auto-fallback)

Background service:
  AiInsightService  -- singleton poll loop, broadcasts ai_insight via WS.

All context-building and rule-evaluation logic is pure (no DB, no IO).
"""
from __future__ import annotations

import abc
import asyncio
import json as _json
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal

from app.schemas.ai import (
    AiInsight,
    DiagnosticItem,
    ExpiryConcentration,
    MarketContext,
    PositionContext,
    RiskContext,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pure context builder
# ---------------------------------------------------------------------------

def compute_confidence_stats(
    trade_metadata_list: list[dict | None],
) -> tuple[float | None, dict[str, int] | None]:
    """
    Pure function: compute avg_confidence and tag_distribution from trade metadata.

    Args:
        trade_metadata_list: list of trade_metadata dicts from active TradeEvent rows.

    Returns:
        (avg_confidence, tag_distribution) -- both None if no data.
    """
    scores: list[int] = []
    tags: dict[str, int] = {}

    for meta in trade_metadata_list:
        if not meta:
            continue
        cs = meta.get("confidence_score")
        if cs is not None and isinstance(cs, (int, float)):
            scores.append(int(cs))
        for tag in (meta.get("strategy_tags") or []):
            tags[tag] = tags.get(tag, 0) + 1

    avg = round(sum(scores) / len(scores), 2) if scores else None
    return avg, (tags if tags else None)


def build_risk_context(
    positions: list,              # list[PositionRow]
    risk_summary: dict,
    holding_groups: list,         # list[HoldingGroup] (Pydantic models or dicts)
    *,
    avg_confidence: float | None = None,
    tag_distribution: dict[str, int] | None = None,
    market_context: MarketContext | None = None,
) -> RiskContext:
    """
    Build a sanitized RiskContext from existing engine outputs.

    Args:
        positions:      from position_engine.calculate_positions()
        risk_summary:   from risk_engine.compute_risk_summary()
        holding_groups: from holdings_engine.compute_holding_groups()

    Returns:
        RiskContext with all absolute values converted to ratios/percentages.
        Zero-leakage: no user_id, no portfolio_id, no absolute dollar values.
    """
    n_positions = risk_summary.get("positions_count", 0)
    margin = float(risk_summary.get("maintenance_margin_total", 0))
    net_delta = float(risk_summary.get("total_net_delta", 0))
    net_gamma = float(risk_summary.get("total_gamma", 0))
    net_theta = float(risk_summary.get("total_theta_daily", 0))
    net_vega = float(risk_summary.get("total_vega", 0))
    var_1d = risk_summary.get("var_1d_95")

    # Underlyings count
    symbols: set[str] = set()
    for pos in positions:
        sym = getattr(pos, "instrument", None)
        if sym is not None:
            symbols.add(getattr(sym, "symbol", ""))
    underlyings_count = len(symbols)

    # Normalized delta: average delta exposure per position
    net_delta_normalized = round(net_delta / max(n_positions, 1), 2)

    # Delta-to-gamma ratio (convexity measure)
    delta_to_gamma_ratio: float | None = None
    if abs(net_gamma) > 1e-8:
        delta_to_gamma_ratio = round(abs(net_delta) / abs(net_gamma), 2)

    # Theta yield: |theta/day| / margin * 100
    theta_yield_pct = 0.0
    if margin > 0:
        theta_yield_pct = round(abs(net_theta) / margin * 100, 4)

    # Vega exposure ratio: |vega| / margin
    vega_exposure_ratio = 0.0
    if margin > 0:
        vega_exposure_ratio = round(abs(net_vega) / margin, 4)

    # VaR as % of margin
    var_pct: float | None = None
    if var_1d is not None and margin > 0:
        var_pct = round(float(var_1d) / margin * 100, 2)

    # Risk posture
    gamma_sign = "long" if net_gamma >= 0 else "short"
    theta_sign = "positive" if net_theta >= 0 else "negative"
    risk_posture = f"{gamma_sign}_gamma_{theta_sign}_theta"

    # Dominant risk factor
    greek_magnitudes = {
        "delta": abs(net_delta),
        "gamma": abs(net_gamma) * 100,
        "theta": abs(net_theta),
        "vega": abs(net_vega),
    }
    dominant_risk = max(greek_magnitudes, key=lambda k: greek_magnitudes[k])

    # Strategy mix from holding groups
    strategy_mix: dict[str, int] = {}
    for group in holding_groups:
        st = getattr(group, "strategy_type", None) or "UNKNOWN"
        strategy_mix[st] = strategy_mix.get(st, 0) + 1

    # Expiry concentration
    buckets = risk_summary.get("expiry_buckets", [])
    total_contracts = sum(abs(b.get("net_contracts", 0)) for b in buckets) or 1
    expiry_concentration = [
        ExpiryConcentration(
            bucket=b.get("label", ""),
            pct_of_total=round(abs(b.get("net_contracts", 0)) / total_contracts, 3),
        )
        for b in buckets
    ]

    # Top positions (sanitized: no dollar values)
    total_abs_delta = sum(
        abs(float(getattr(g, "total_delta_exposure", 0)))
        for g in holding_groups
    ) or 1.0

    sorted_groups = sorted(
        holding_groups,
        key=lambda g: abs(float(getattr(g, "total_delta_exposure", 0))),
        reverse=True,
    )[:3]

    top_positions: list[PositionContext] = []
    for g in sorted_groups:
        delta_val = float(getattr(g, "total_delta_exposure", 0))
        theta_val = float(getattr(g, "total_theta_daily", 0))
        margin_val = float(getattr(g, "total_maintenance_margin", 0))

        top_positions.append(PositionContext(
            symbol=getattr(g, "symbol", ""),
            strategy_label=getattr(g, "strategy_label", "Unknown"),
            delta_pct_of_total=round(delta_val / total_abs_delta * 100, 1)
                               if total_abs_delta > 0 else 0.0,
            theta_pct_of_margin=round(theta_val / margin_val * 100, 4)
                                if margin_val > 0 else 0.0,
            days_to_nearest_expiry=_min_dte(g),
        ))

    return RiskContext(
        positions_count=n_positions,
        underlyings_count=underlyings_count,
        net_delta_normalized=net_delta_normalized,
        delta_to_gamma_ratio=delta_to_gamma_ratio,
        theta_yield_pct=theta_yield_pct,
        vega_exposure_ratio=vega_exposure_ratio,
        var_pct_of_margin=var_pct,
        risk_posture=risk_posture,
        dominant_risk=dominant_risk,
        strategy_mix=strategy_mix,
        expiry_concentration=expiry_concentration,
        top_positions=top_positions,
        risk_alerts=risk_summary.get("risk_alerts", []),
        avg_confidence=avg_confidence,
        tag_distribution=tag_distribution,
        market_context=market_context,
        as_of=datetime.now(timezone.utc),
    )


def _min_dte(group) -> int | None:
    """Find the minimum days_to_expiry across option legs in a HoldingGroup."""
    min_val: int | None = None
    for leg in getattr(group, "option_legs", []):
        dte = getattr(leg, "days_to_expiry", None)
        if dte is not None:
            if min_val is None or dte < min_val:
                min_val = dte
    return min_val


# ---------------------------------------------------------------------------
# AiProvider interface
# ---------------------------------------------------------------------------

class AiProvider(abc.ABC):
    """Abstract interface for AI risk analysis providers."""

    @abc.abstractmethod
    async def analyze(self, context: RiskContext, language: str = "en") -> AiInsight:
        """Analyze a sanitized risk context and return structured diagnostics."""
        ...


# ---------------------------------------------------------------------------
# MockAiProvider (rule-based)
# ---------------------------------------------------------------------------

class MockAiProvider(AiProvider):
    """
    Rule-based mock AI provider.

    Matches the sanitized RiskContext against predefined diagnostic patterns
    and returns 3-5 professional diagnostic suggestions sorted by severity.
    """

    async def analyze(self, context: RiskContext, language: str = "en") -> AiInsight:
        diagnostics = _evaluate_rules(context, language=language)

        # Determine overall assessment from worst severity
        severities = [d.severity for d in diagnostics]
        if "critical" in severities:
            overall = "Danger"
        elif "warning" in severities:
            overall = "Warning"
        elif diagnostics:
            overall = "Caution"
        else:
            overall = "Safe"

        return AiInsight(
            overall_assessment=overall,
            diagnostics=diagnostics,
            generated_at=datetime.now(timezone.utc),
        )


def _evaluate_rules(ctx: RiskContext, language: str = "en") -> list[DiagnosticItem]:
    """
    Pure function: evaluate all diagnostic rules against a RiskContext.
    Returns 3-5 DiagnosticItems sorted by severity (critical > warning > info).

    Phase 11: produces bilingual diagnostics (EN/ZH) with professional
    Chinese financial terminology.
    """
    zh = language == "zh"
    items: list[DiagnosticItem] = []

    # Rule 1: High negative delta + short gamma -> concentrated directional risk
    if (ctx.risk_posture.startswith("short_gamma")
            and abs(ctx.net_delta_normalized) > 5.0):
        items.append(DiagnosticItem(
            severity="critical",
            category="delta",
            title=(
                "\u65b9\u5411\u6027\u98ce\u9669\u53e0\u52a0\u8d1f\u51f8\u6027" if zh
                else "Concentrated directional risk with short gamma"
            ),
            explanation=(
                f"\u7ec4\u5408\u6301\u4ed3\u5e73\u5747Delta\u4e3a{ctx.net_delta_normalized:+.1f}\uff0c"
                f"\u4e14\u5904\u4e8e\u5356\u51faGamma\u66b4\u9732\u72b6\u6001\u3002"
                f"\u6807\u7684\u4ef7\u683c\u5267\u70c8\u6ce2\u52a8\u5c06\u56e0\u8d1f\u51f8\u6027\u52a0\u901f\u4e8f\u635f\u3002"
                if zh else
                f"Portfolio has {ctx.net_delta_normalized:+.1f} avg delta per position "
                f"with short gamma exposure. A sharp move against this delta will "
                f"accelerate losses due to negative convexity."
            ),
            suggestion=(
                "\u5efa\u8bae\u901a\u8fc7\u6807\u7684\u80a1\u7968\u5bf9\u51b2Delta\uff0c"
                "\u6216\u4e70\u5165\u4fdd\u62a4\u6027\u671f\u6743\u5c01\u9876Gamma\u4e0b\u884c\u98ce\u9669\u3002"
                if zh else
                "Consider delta hedging with underlying shares or buying "
                "protective options to cap downside gamma risk."
            ),
        ))

    # Rule 2: High theta yield -> efficient theta harvesting
    if ctx.theta_yield_pct > 0.05:
        items.append(DiagnosticItem(
            severity="info",
            category="theta",
            title=(
                "Theta\u6536\u5272\u6548\u7387\u826f\u597d" if zh
                else "Theta harvesting is efficient"
            ),
            explanation=(
                f"\u6bcf\u65e5Theta\u6536\u76ca\u7387\u4e3a\u4fdd\u8bc1\u91d1\u7684"
                f"{ctx.theta_yield_pct:.3f}%\uff0c"
                f"\u76f8\u5bf9\u4e8e\u98ce\u9669\u8d44\u672c\u800c\u8a00\uff0c"
                f"\u6743\u5229\u91d1\u6355\u83b7\u901f\u5ea6\u5065\u5eb7\u3002"
                if zh else
                f"Daily theta yield is {ctx.theta_yield_pct:.3f}% of margin. "
                f"Premium capture is generated at a healthy rate relative to "
                f"capital at risk."
            ),
            suggestion=(
                "\u7ef4\u6301\u5f53\u524dTheta\u4ed3\u4f4d\uff0c"
                "\u5173\u6ce8\u6ce2\u52a8\u7387\u98d9\u5347\u5bf9\u65f6\u95f4\u8870\u51cf\u4f18\u52bf\u7684\u4fb5\u8680\u3002"
                if zh else
                "Maintain current theta positions. Monitor for vol spikes "
                "that could erode the time-decay advantage."
            ),
        ))

    # Rule 3: Near-term expiry concentration
    near_term_pct = 0.0
    for ec in ctx.expiry_concentration:
        if ec.bucket in ("<=7d", "8-30d"):
            near_term_pct += ec.pct_of_total
    if near_term_pct > 0.60:
        items.append(DiagnosticItem(
            severity="warning",
            category="expiry",
            title=(
                "\u5230\u671f\u65e5\u96c6\u4e2d\u4e8e\u8fd1\u6708" if zh
                else "Expiry concentration in near-term"
            ),
            explanation=(
                f"{near_term_pct * 100:.0f}%\u7684\u671f\u6743\u5408\u7ea6\u5c06\u572830\u5929\u5185\u5230\u671f\u3002"
                f"\u4e34\u8fd1\u5230\u671f\u65f6Gamma\u98ce\u9669\u52a0\u901f\uff0c"
                f"\u865a\u503c\u9644\u8fd1\u5356\u51fa\u4ed3\u4f4d\u9762\u4e34\u884c\u6743\u98ce\u9669\u3002"
                if zh else
                f"{near_term_pct * 100:.0f}% of option contracts expire within "
                f"30 days. Gamma risk accelerates into expiry, and assignment "
                f"risk increases for short positions near the money."
            ),
            suggestion=(
                "\u8003\u8651\u5c55\u671f\u6216\u5e73\u4ed3\u8fd1\u6708\u4ed3\u4f4d\u4ee5\u964d\u4f4ePin\u98ce\u9669\uff0c"
                "\u5206\u6563\u5230\u671f\u65e5\u4ee5\u83b7\u5f97\u66f4\u5747\u5300\u7684\u65f6\u95f4\u8870\u51cf\u3002"
                if zh else
                "Roll or close near-term positions to reduce pin risk. "
                "Consider spreading expiry dates for more even time decay."
            ),
        ))

    # Rule 4: Delta/gamma imbalance
    if (ctx.delta_to_gamma_ratio is not None
            and ctx.delta_to_gamma_ratio < 50.0
            and abs(ctx.net_delta_normalized) > 2.0):
        items.append(DiagnosticItem(
            severity="warning",
            category="gamma",
            title=(
                "Delta-Gamma\u5931\u8861" if zh
                else "Delta-gamma imbalance detected"
            ),
            explanation=(
                f"Delta\u4e0eGamma\u6bd4\u7387\u4e3a{ctx.delta_to_gamma_ratio:.0f}\uff0c"
                f"\u610f\u5473\u7740\u6807\u7684\u4ef7\u683c\u5c0f\u5e45\u6ce2\u52a8\u5c06\u663e\u8457"
                f"\u6539\u53d8\u7ec4\u5408Delta\u66b4\u9732\u3002"
                if zh else
                f"Delta-to-gamma ratio is {ctx.delta_to_gamma_ratio:.0f}, "
                f"meaning a relatively small price move will materially shift "
                f"the portfolio's delta exposure."
            ),
            suggestion=(
                "\u5efa\u8bae\u5bf9\u51b2Delta\u4ee5\u964d\u4f4eDelta\u53d8\u5316\u901f\u7387\uff0c"
                "\u4e70\u5165\u671f\u6743\u6216\u6784\u5efa\u5bf9\u51b2\u4ed3\u4f4d\u7a33\u5b9a\u7ec4\u5408\u3002"
                if zh else
                "Consider delta hedging to reduce the rate of delta change. "
                "Buying options or adding opposing delta can stabilize the book."
            ),
        ))

    # Rule 5: Low VaR relative to margin -> favorable risk-adjusted return
    if ctx.var_pct_of_margin is not None and ctx.var_pct_of_margin < 5.0:
        items.append(DiagnosticItem(
            severity="info",
            category="delta",
            title=(
                "\u98ce\u9669\u8c03\u6574\u6536\u76ca\u826f\u597d" if zh
                else "Favorable risk-adjusted position"
            ),
            explanation=(
                f"1\u65e595% VaR\u4ec5\u4e3a\u4fdd\u8bc1\u91d1\u7684"
                f"{ctx.var_pct_of_margin:.1f}%\uff0c"
                f"\u5f53\u524d\u6ce2\u52a8\u7387\u73af\u5883\u4e0b\u98ce\u9669\u6536\u76ca\u6bd4\u4f18\u826f\u3002"
                if zh else
                f"1-day 95% VaR is only {ctx.var_pct_of_margin:.1f}% of margin. "
                f"Risk-adjusted return profile is favorable under current "
                f"volatility conditions."
            ),
            suggestion=(
                "\u4ed3\u4f4d\u7ba1\u7406\u5f97\u5f53\uff0c"
                "\u8bc4\u4f30\u662f\u5426\u6709\u7a7a\u95f4\u5728\u98ce\u9669\u9650\u989d\u5185\u6269\u5927\u89c4\u6a21\u3002"
                if zh else
                "Position sizing is well-calibrated. Consider if there is "
                "capacity to scale up within risk limits."
            ),
        ))

    # Rule 6: High VaR relative to margin -> overleveraged
    if ctx.var_pct_of_margin is not None and ctx.var_pct_of_margin > 15.0:
        items.append(DiagnosticItem(
            severity="critical",
            category="delta",
            title=(
                "VaR\u8d85\u51fa\u4fdd\u8bc1\u91d1\u5b89\u5168\u9608\u503c" if zh
                else "VaR exceeds comfortable margin threshold"
            ),
            explanation=(
                f"1\u65e595% VaR\u8fbe\u4fdd\u8bc1\u91d1\u7684"
                f"{ctx.var_pct_of_margin:.1f}%\uff0c"
                f"\u4e8c\u5341\u5206\u4e4b\u4e00\u6982\u7387\u7684\u4e0d\u5229\u884c\u60c5"
                f"\u53ef\u80fd\u6d88\u8017\u5927\u91cf\u53ef\u7528\u4fdd\u8bc1\u91d1\u3002"
                if zh else
                f"1-day 95% VaR is {ctx.var_pct_of_margin:.1f}% of margin. "
                f"A 1-in-20 day adverse move could consume a significant "
                f"portion of available margin."
            ),
            suggestion=(
                "\u7f29\u51cf\u4ed3\u4f4d\u6216\u4e70\u5165\u4fdd\u62a4\u6027\u671f\u6743\u964d\u4f4eVaR\uff0c"
                "\u8003\u8651\u6536\u7d27\u65b9\u5411\u6027\u4ed3\u4f4d\u7684\u6b62\u635f\u6c34\u5e73\u3002"
                if zh else
                "Reduce position size or buy protective options to lower VaR. "
                "Consider tighter stop-loss levels on directional positions."
            ),
        ))

    # Rule 7: High vega exposure ratio
    if ctx.vega_exposure_ratio > 0.5:
        items.append(DiagnosticItem(
            severity="warning",
            category="vega",
            title=(
                "\u6ce2\u52a8\u7387\u654f\u611f\u5ea6\u504f\u9ad8" if zh
                else "Elevated volatility sensitivity"
            ),
            explanation=(
                f"Vega\u66b4\u9732\u8fbe\u4fdd\u8bc1\u91d1\u7684"
                f"{ctx.vega_exposure_ratio:.2f}\u500d\uff0c"
                f"\u9690\u542b\u6ce2\u52a8\u73871\u4e2a\u767e\u5206\u70b9\u7684\u53d8\u52a8\u5c06\u5bf9"
                f"\u7ec4\u5408\u635f\u76ca\u4ea7\u751f\u8d85\u989d\u5f71\u54cd\u3002"
                if zh else
                f"Vega exposure is {ctx.vega_exposure_ratio:.2f}x margin. "
                f"A 1-point move in implied volatility would have an outsized "
                f"effect on portfolio P&L relative to capital committed."
            ),
            suggestion=(
                "\u8003\u8651\u901a\u8fc7\u4ef7\u5dee\u7b56\u7565\u524a\u51cf\u51c0Vega\uff0c"
                "\u6216\u5728\u9ad8IV\u6807\u7684\u4e0a\u5356\u51fa\u5bf9\u51b2\u671f\u6743\u3002"
                if zh else
                "Consider reducing net vega through vertical spreads "
                "or selling offsetting options in high-IV underlyings."
            ),
        ))

    # Rule 8: Single-name concentration
    if ctx.top_positions:
        top_delta_pct = abs(ctx.top_positions[0].delta_pct_of_total)
        sym = ctx.top_positions[0].symbol
        if top_delta_pct > 60.0 and ctx.underlyings_count > 1:
            items.append(DiagnosticItem(
                severity="warning",
                category="diversification",
                title=(
                    f"{sym}\u96c6\u4e2d\u5ea6\u8fc7\u9ad8" if zh
                    else f"Concentration risk in {sym}"
                ),
                explanation=(
                    f"{sym}\u5360\u603bDelta\u66b4\u9732\u7684{top_delta_pct:.0f}%\uff0c"
                    f"\u5355\u4e00\u6807\u7684\u4e8b\u4ef6\u53ef\u80fd\u4e3b\u5bfc\u7ec4\u5408\u635f\u76ca\u3002"
                    if zh else
                    f"{sym} accounts for "
                    f"{top_delta_pct:.0f}% of total delta exposure. "
                    f"A single-name event could dominate portfolio P&L."
                ),
                suggestion=(
                    f"\u5206\u6563Delta\u81f3\u66f4\u591a\u6807\u7684\uff0c"
                    f"\u6216\u4e13\u95e8\u5bf9\u51b2{sym}\u66b4\u9732\u3002"
                    if zh else
                    f"Diversify delta across more underlyings or hedge "
                    f"{sym} exposure specifically."
                ),
            ))

    # Rule 10: Low average confidence -- behavioral risk
    if ctx.avg_confidence is not None and ctx.avg_confidence < 2.5:
        items.append(DiagnosticItem(
            severity="warning",
            category="diversification",
            title=(
                "\u4ea4\u6613\u4fe1\u5fc3\u5ea6\u504f\u4f4e" if zh
                else "Low average trade conviction"
            ),
            explanation=(
                f"\u6d3b\u8dc3\u4ea4\u6613\u5e73\u5747\u4fe1\u5fc3\u8bc4\u5206\u4e3a"
                f"{ctx.avg_confidence:.1f}/5\uff0c"
                f"\u4f4e\u4fe1\u5fc3\u5165\u573a\u503e\u5411\u4e8e\u4f34\u968f\u66f4\u9ad8\u7684"
                f"\u60c5\u7eea\u5316\u51b3\u7b56\u98ce\u9669\u3002"
                if zh else
                f"Average confidence score across active trades is "
                f"{ctx.avg_confidence:.1f}/5. Low conviction entries tend to "
                f"correlate with higher emotional decision-making risk."
            ),
            suggestion=(
                "\u5ba1\u67e5\u4f4e\u4fe1\u5fc3\u5165\u573a\u7684\u4ed3\u4f4d\uff0c"
                "\u5bf9\u4f4e\u4fe1\u5fc3\u4ea4\u6613\u8003\u8651\u66f4\u4e25\u683c\u7684\u6b62\u635f\u6216\u66f4\u5c0f\u7684\u4ed3\u4f4d\u3002"
                if zh else
                "Review positions entered with low confidence. Consider "
                "tighter stop-losses or smaller sizes for low-conviction trades."
            ),
        ))

    # Rule 9: Risk alerts from gamma engine
    if ctx.risk_alerts:
        items.append(DiagnosticItem(
            severity="critical",
            category="gamma",
            title=(
                "\u68c0\u6d4b\u5230Gamma\u5d29\u6e83\u98ce\u9669" if zh
                else "Gamma crash risk detected"
            ),
            explanation=(
                f"\u6709{len(ctx.risk_alerts)}\u4e2a\u6d3b\u8dc3Gamma\u9884\u8b66\uff1a"
                f"{ctx.risk_alerts[0]}"
                if zh else
                f"{len(ctx.risk_alerts)} active gamma alert(s): "
                f"{ctx.risk_alerts[0]}"
            ),
            suggestion=(
                "\u5ba1\u67e5\u6807\u8bb0\u4ed3\u4f4d\uff0c"
                "\u8003\u8651\u5e73\u4ed3\u6216\u5bf9\u51b2\u4ee5\u907f\u514d\u5267\u70c8\u6ce2\u52a8\u4e2d\u7684\u52a0\u901f\u4e8f\u635f\u3002"
                if zh else
                "Review the flagged positions. Consider closing or "
                "hedging to avoid accelerated losses on a sharp move."
            ),
        ))

    # Rule 11: VIX-based macro risk (Phase 12a)
    mc = ctx.market_context
    if mc is not None:
        # 11a: Short Vega in low VIX with imminent macro event
        if (mc.vix_term == "low"
                and ctx.vega_exposure_ratio > 0.3
                and mc.days_to_next_event is not None
                and mc.days_to_next_event <= 3):
            items.append(DiagnosticItem(
                severity="critical",
                category="vega",
                title=(
                    "\u4f4eVIX\u73af\u5883\u4e0b\u5356\u51faVega\u4e34\u8fd1\u4e8b\u4ef6" if zh
                    else "Short Vega in low-VIX pre-event regime"
                ),
                explanation=(
                    f"VIX\u5904\u4e8e\u4f4e\u4f4d({mc.vix_level:.1f})\uff0c"
                    f"Vega\u66b4\u9732\u6bd4\u4e3a{ctx.vega_exposure_ratio:.2f}x\uff0c"
                    f"\u4e14{mc.next_event_name}\u5c06\u5728{mc.days_to_next_event}\u65e5\u540e\u53d1\u5e03\u3002"
                    f"\u4f4e\u6ce2\u52a8\u73af\u5883\u4e2d\u7684\u6ce2\u52a8\u7387\u98d9\u5347\u98ce\u9669\u88ab\u4e25\u91cd\u4f4e\u4f30\u3002"
                    if zh else
                    f"VIX is low ({mc.vix_level:.1f}) with vega/margin ratio at "
                    f"{ctx.vega_exposure_ratio:.2f}x, and {mc.next_event_name} is "
                    f"{mc.days_to_next_event}d away. Vol spike risk is severely "
                    f"underpriced in low-VIX environments."
                ),
                suggestion=(
                    "\u4e70\u5165\u4fdd\u62a4\u6027\u671f\u6743\u5bf9\u51b2Vega\u4e0b\u884c\u98ce\u9669\uff0c"
                    "\u6216\u4e34\u65f6\u7f29\u51cf\u5356\u51fa\u671f\u6743\u4ed3\u4f4d\u81f3\u4e8b\u4ef6\u7ed3\u675f\u3002"
                    if zh else
                    "Buy protective options to hedge vega downside, or temporarily "
                    "reduce short option exposure until the event passes."
                ),
            ))

        # 11b: Short Gamma in elevated VIX
        if mc.vix_level > 25 and ctx.risk_posture.startswith("short_gamma"):
            items.append(DiagnosticItem(
                severity="critical",
                category="gamma",
                title=(
                    "\u9ad8VIX\u73af\u5883\u4e0b\u5356\u51faGamma\u98ce\u9669" if zh
                    else "Short Gamma in elevated VIX environment"
                ),
                explanation=(
                    f"VIX\u5904\u4e8e\u504f\u9ad8\u6c34\u5e73({mc.vix_level:.1f})\uff0c"
                    f"\u5e02\u573a\u73af\u5883\u4e3a{mc.market_regime}\u3002"
                    f"\u5356\u51faGamma\u4ed3\u4f4d\u5728\u9ad8\u6ce2\u52a8\u73af\u5883\u4e2d"
                    f"\u9762\u4e34\u5c3e\u90e8\u98ce\u9669\u653e\u5927\u3002"
                    if zh else
                    f"VIX is elevated at {mc.vix_level:.1f} with market regime "
                    f"'{mc.market_regime}'. Short gamma positions face amplified "
                    f"tail risk in high-volatility environments."
                ),
                suggestion=(
                    "\u4e70\u5165\u8fdc\u671f\u671f\u6743\u5bf9\u51b2Gamma\uff0c"
                    "\u6216\u5c06\u5356\u51fa\u4ed3\u4f4d\u8f6c\u6362\u4e3a\u4ef7\u5dee\u7b56\u7565\u4ee5\u9650\u5236\u6700\u5927\u4e8f\u635f\u3002"
                    if zh else
                    "Buy far-OTM options to hedge gamma, or convert naked shorts "
                    "to spreads to cap maximum loss."
                ),
            ))

        # 11c: Favorable low-vol theta harvesting window
        if mc.vix_term == "low" and ctx.theta_yield_pct > 0.05:
            items.append(DiagnosticItem(
                severity="info",
                category="theta",
                title=(
                    "\u4f4e\u6ce2\u52a8Theta\u6536\u5272\u7a97\u53e3\u826f\u597d" if zh
                    else "Favorable low-vol theta harvesting window"
                ),
                explanation=(
                    f"VIX\u5904\u4e8e\u4f4e\u4f4d({mc.vix_level:.1f})\uff0c"
                    f"Theta\u6536\u76ca\u7387\u4e3a{ctx.theta_yield_pct:.3f}%\u3002"
                    f"\u4f4e\u6ce2\u52a8\u73af\u5883\u6709\u5229\u4e8e\u7a33\u5b9a\u7684\u65f6\u95f4\u4ef7\u503c\u6536\u5272\u3002"
                    if zh else
                    f"VIX is low ({mc.vix_level:.1f}) and theta yield is "
                    f"{ctx.theta_yield_pct:.3f}%. Low-vol regimes favor stable "
                    f"time-decay harvesting."
                ),
                suggestion=(
                    "\u7ef4\u6301\u5f53\u524dTheta\u6536\u5272\u4ed3\u4f4d\uff0c"
                    "\u4f46\u8bbe\u7f6e\u6ce2\u52a8\u7387\u98d9\u5347\u7684\u5e94\u6025\u65b9\u6848\u3002"
                    if zh else
                    "Maintain current theta positions, but have a contingency plan "
                    "for a vol spike."
                ),
            ))

        # 11d: Major macro event approaching (within 2 days)
        if mc.days_to_next_event is not None and mc.days_to_next_event <= 2:
            items.append(DiagnosticItem(
                severity="warning",
                category="vega",
                title=(
                    f"\u5b8f\u89c2\u4e8b\u4ef6\u4e34\u8fd1\uff1a{mc.next_event_name}"
                    f"\u8fd8\u6709{mc.days_to_next_event}\u65e5" if zh
                    else f"Major macro event approaching: {mc.next_event_name} in {mc.days_to_next_event}d"
                ),
                explanation=(
                    f"{mc.next_event_name}\u5c06\u5728{mc.days_to_next_event}\u65e5\u540e\u53d1\u5e03\uff0c"
                    f"\u53ef\u80fd\u5f15\u53d1\u6ce2\u52a8\u7387\u8df3\u5347\u548c\u4ef7\u683c\u7f3a\u53e3\u3002"
                    f"\u5f53\u524dVIX: {mc.vix_level:.1f} ({mc.vix_term})\u3002"
                    if zh else
                    f"{mc.next_event_name} is {mc.days_to_next_event}d away and may "
                    f"trigger a vol spike or price gap. Current VIX: {mc.vix_level:.1f} "
                    f"({mc.vix_term})."
                ),
                suggestion=(
                    "\u68c0\u67e5\u6240\u6709\u5356\u51fa\u4ed3\u4f4d\u7684\u98ce\u9669\u6562\u53e3\uff0c"
                    "\u8003\u8651\u4e34\u65f6\u7f29\u51cf\u89c4\u6a21\u6216\u4e70\u5165\u4fdd\u62a4\u6027\u5934\u5bf8\u3002"
                    if zh else
                    "Review risk exposure on all short positions. Consider reducing "
                    "size or buying protective hedges through the event."
                ),
            ))

    # Padding: ensure minimum 3 items
    posture_str = ctx.risk_posture.replace("_", " ")
    if len(items) < 3:
        items.append(DiagnosticItem(
            severity="info",
            category="theta",
            title=(
                "\u7ec4\u5408\u7ed3\u6784\u5747\u8861" if zh
                else "Portfolio structure is balanced"
            ),
            explanation=(
                f"\u7ec4\u5408\u6301\u6709{ctx.positions_count}\u4e2a\u4ed3\u4f4d\uff0c"
                f"\u6a2a\u8de8{ctx.underlyings_count}\u4e2a\u6807\u7684\uff0c"
                f"{posture_str}\u98ce\u9669\u59ff\u6001\u3002"
                if zh else
                f"Portfolio holds {ctx.positions_count} position(s) across "
                f"{ctx.underlyings_count} underlying(s) with "
                f"{posture_str} posture."
            ),
            suggestion=(
                "\u5f53\u524d\u65e0\u9700\u7acb\u5373\u64cd\u4f5c\uff0c"
                "\u6301\u7eed\u76d1\u63a7\u6ce2\u52a8\u7387\u73af\u5883\u53d8\u5316\u53ca\u4e34\u8fd1\u5230\u671f\u4e8b\u4ef6\u3002"
                if zh else
                "No immediate action required. Continue monitoring for "
                "changes in volatility environment or approaching expirations."
            ),
        ))

    # If still < 3, add padding items up to 3
    if len(items) < 3:
        items.append(DiagnosticItem(
            severity="info",
            category="delta",
            title=(
                "\u5e0c\u814a\u503c\u5904\u4e8e\u6b63\u5e38\u8303\u56f4" if zh
                else "Greeks are within normal range"
            ),
            explanation=(
                f"\u5e73\u5747\u6bcf\u4ed3\u4f4dDelta\u4e3a{ctx.net_delta_normalized:+.1f}\uff0c"
                f"\u672a\u68c0\u6d4b\u5230\u6781\u7aef\u65b9\u5411\u6027\u504f\u79bb\u3002"
                if zh else
                f"Average delta per position is {ctx.net_delta_normalized:+.1f}. "
                f"No extreme directional bias detected."
            ),
            suggestion=(
                "\u7ef4\u6301\u5f53\u524d\u7b56\u7565\uff0c"
                "\u82e5\u5e02\u573a\u73af\u5883\u8f6c\u53d8\u6216\u9690\u542b\u6ce2\u52a8\u7387\u663e\u8457\u53d8\u5316\u65f6\u91cd\u65b0\u8bc4\u4f30\u3002"
                if zh else
                "Continue current strategy. Re-evaluate if market regime "
                "shifts or implied volatility changes significantly."
            ),
        ))

    if len(items) < 3:
        items.append(DiagnosticItem(
            severity="info",
            category="diversification",
            title=(
                "\u5206\u6563\u5316\u68c0\u6d4b\u901a\u8fc7" if zh
                else "Diversification check passed"
            ),
            explanation=(
                f"\u7ec4\u5408\u6a2a\u8de8{ctx.underlyings_count}\u4e2a\u6807\u7684\uff0c"
                f"\u672a\u68c0\u6d4b\u5230\u5355\u4e00\u6807\u7684\u4e3b\u5bfc\u3002"
                if zh else
                f"Portfolio spans {ctx.underlyings_count} underlying(s). "
                f"No single-name dominance detected."
            ),
            suggestion=(
                "\u7ef4\u6301\u5f53\u524d\u5206\u6563\u5316\u6c34\u5e73\uff0c"
                "\u8003\u8651\u6dfb\u52a0\u4f4e\u76f8\u5173\u6807\u7684\u4ee5\u8fdb\u4e00\u6b65\u964d\u4f4e\u7279\u5f02\u6027\u98ce\u9669\u3002"
                if zh else
                "Maintain current diversification. Consider adding "
                "uncorrelated underlyings to further reduce idiosyncratic risk."
            ),
        ))

    # Cap at 5, sorted by severity priority
    _SEV_ORDER = {"critical": 0, "warning": 1, "info": 2}
    items.sort(key=lambda d: _SEV_ORDER.get(d.severity, 3))
    return items[:5]


# ---------------------------------------------------------------------------
# ClaudeAiProvider (Anthropic API via httpx)
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT_EN = """\
You are a senior options portfolio risk analyst. You analyze sanitized portfolio \
risk metrics (ratios and percentages only -- no dollar values) and produce \
precisely structured JSON diagnostics.

OUTPUT FORMAT -- STRICT JSON, NO PREAMBLE

Return ONLY a JSON object. No markdown, no explanation outside JSON.

{
  "overall_assessment": "Safe|Caution|Warning|Danger",
  "diagnostics": [
    {
      "severity": "critical|warning|info",
      "category": "delta|gamma|theta|vega|expiry|diversification",
      "title": "< 8 words, institutional tone >",
      "explanation": "< 1-2 sentences. Reference the specific metric that triggered this finding. >",
      "suggestion": "< 1 sentence. Concrete hedge or adjustment -- name the Greek or strategy. >"
    }
  ]
}

RULES:
1. Return 3-5 diagnostics, sorted: critical first, then warning, then info.
2. overall_assessment derived from worst severity: any critical=Danger, any warning(no critical)=Warning, all info=Caution, empty=Safe.
3. category MUST be one of: delta, gamma, theta, vega, expiry, diversification.
4. severity MUST be one of: critical, warning, info.
5. Every explanation MUST cite at least one numeric value from the input.
6. Every suggestion MUST name a specific action (hedge, roll, close, spread, reduce).
7. Do NOT repeat the same category more than twice.
8. Do NOT use filler phrases.
9. Focus on Greeks interaction effects (delta-gamma feedback, theta-vega tradeoff, expiry gamma acceleration).\
"""

_SYSTEM_PROMPT_ZH = """\
You are a senior options portfolio risk analyst writing for a Chinese-speaking \
professional audience. Analyze sanitized portfolio risk metrics and produce \
precisely structured JSON diagnostics IN CHINESE.

OUTPUT FORMAT -- STRICT JSON, NO PREAMBLE

Return ONLY a JSON object. No markdown, no explanation outside JSON.

{
  "overall_assessment": "Safe|Caution|Warning|Danger",
  "diagnostics": [
    {
      "severity": "critical|warning|info",
      "category": "delta|gamma|theta|vega|expiry|diversification",
      "title": "< Chinese, 8 chars max, institutional tone >",
      "explanation": "< 1-2 sentences IN CHINESE. Reference the specific metric. >",
      "suggestion": "< 1 sentence IN CHINESE. Concrete hedge or adjustment. >"
    }
  ]
}

LANGUAGE RULES -- MANDATORY CHINESE FINANCIAL TERMINOLOGY:
- title, explanation, suggestion MUST be written in professional Chinese
- Use standard Chinese financial terms:
  Delta\u66b4\u9732 (not "delta exposure"), Gamma\u98ce\u9669 (not "gamma risk"),
  Theta\u8870\u51cf/\u65f6\u95f4\u4ef7\u503c\u8870\u51cf (not "theta decay"),
  Vega\u654f\u611f\u5ea6/\u6ce2\u52a8\u7387\u654f\u611f\u5ea6 (not "vega sensitivity"),
  \u884c\u6743\u4ef7 (not "strike price"), \u5230\u671f\u65e5 (not "expiry"),
  \u4fdd\u8bc1\u91d1 (not "margin"), \u98ce\u9669\u4ef7\u503c(VaR) (not "Value at Risk"),
  \u5bf9\u51b2 (not "hedge"), \u5c55\u671f (not "roll"), \u5e73\u4ed3 (not "close"),
  \u4ef7\u5dee\u7b56\u7565 (not "spread"), \u6807\u7684 (not "underlying"),
  \u6743\u5229\u91d1 (not "premium"), \u51f8\u6027 (not "convexity"),
  \u5e0c\u814a\u503c (not "Greeks"), \u4ed3\u4f4d (not "position")
- overall_assessment values remain English (Safe/Caution/Warning/Danger)
- severity and category values remain English

DIAGNOSTIC RULES:
1. Return 3-5 diagnostics, sorted: critical first, then warning, then info.
2. overall_assessment derived from worst severity: any critical=Danger, any warning(no critical)=Warning, all info=Caution, empty=Safe.
3. category MUST be one of: delta, gamma, theta, vega, expiry, diversification.
4. severity MUST be one of: critical, warning, info.
5. Every explanation MUST cite at least one numeric value from the input.
6. Every suggestion MUST name a specific action (\u5bf9\u51b2, \u5c55\u671f, \u5e73\u4ed3, \u4ef7\u5dee\u7b56\u7565, \u7f29\u51cf\u4ed3\u4f4d).
7. Do NOT repeat the same category more than twice.
8. Do NOT use filler phrases.
9. Focus on Greeks interaction effects (Delta-Gamma\u53cd\u9988, Theta-Vega\u6743\u8861, \u5230\u671fGamma\u52a0\u901f).\
"""


def _get_system_prompt(language: str = "en") -> str:
    """Return the system prompt for the given language."""
    return _SYSTEM_PROMPT_ZH if language == "zh" else _SYSTEM_PROMPT_EN

_VALID_CATEGORIES = {"delta", "gamma", "theta", "vega", "expiry", "diversification"}
_VALID_SEVERITIES = {"critical", "warning", "info"}
_VALID_ASSESSMENTS = {"Safe", "Caution", "Warning", "Danger"}


def _build_user_prompt(ctx: RiskContext) -> str:
    """Build the user prompt from a sanitized RiskContext."""
    # Strategy mix
    mix_str = ", ".join(f"{v}x {k.lower()}" for k, v in ctx.strategy_mix.items()) or "none"

    # Expiry concentration
    expiry_lines = "\n".join(
        f"  {ec.bucket}: {ec.pct_of_total * 100:.1f}%"
        for ec in ctx.expiry_concentration
    ) or "  (no expiry data)"

    # Top positions
    top_lines = "\n".join(
        f"  {p.symbol} [{p.strategy_label}]: delta={p.delta_pct_of_total:+.1f}%, "
        f"theta/margin={p.theta_pct_of_margin:.3f}%, "
        f"DTE={p.days_to_nearest_expiry or 'N/A'}"
        for p in ctx.top_positions
    ) or "  (no positions)"

    # Alerts
    alerts_str = "; ".join(ctx.risk_alerts[:3]) if ctx.risk_alerts else "none"

    d2g = f"{ctx.delta_to_gamma_ratio:.1f}" if ctx.delta_to_gamma_ratio is not None else "N/A"
    var_str = f"{ctx.var_pct_of_margin:.1f}%" if ctx.var_pct_of_margin is not None else "N/A"

    # Confidence & strategy tags (Phase 10.5)
    conf_str = f"{ctx.avg_confidence:.1f}/5" if ctx.avg_confidence is not None else "N/A"
    tags_str = (
        ", ".join(f"{v}x {k}" for k, v in (ctx.tag_distribution or {}).items())
        or "none"
    )

    prompt = (
        f"Options portfolio risk snapshot ({ctx.as_of.strftime('%Y-%m-%d %H:%M UTC')}):\n"
        f"\n"
        f"Positions: {ctx.positions_count} across {ctx.underlyings_count} underlyings\n"
        f"Risk posture: {ctx.risk_posture}\n"
        f"Dominant risk: {ctx.dominant_risk}\n"
        f"\n"
        f"Greeks ratios:\n"
        f"  Net delta/position: {ctx.net_delta_normalized:+.2f}\n"
        f"  Delta/gamma ratio: {d2g}\n"
        f"  Theta yield: {ctx.theta_yield_pct:.3f}% of margin/day\n"
        f"  Vega/margin ratio: {ctx.vega_exposure_ratio:.4f}\n"
        f"\n"
        f"Risk:\n"
        f"  VaR (1d 95%): {var_str} of margin\n"
        f"  Strategy mix: {mix_str}\n"
        f"\n"
        f"Expiry concentration:\n"
        f"{expiry_lines}\n"
        f"\n"
        f"Top positions (by delta weight):\n"
        f"{top_lines}\n"
        f"\n"
        f"Active risk alerts: {alerts_str}\n"
        f"\n"
        f"Trader confidence:\n"
        f"  Avg confidence score: {conf_str}\n"
        f"  Strategy tag mix: {tags_str}"
    )

    # Phase 12a: append macro context if available
    if ctx.market_context:
        mc = ctx.market_context
        prompt += (
            f"\n\nMarket macro context:\n"
            f"  SPX: {mc.spx_price:.2f} ({mc.spx_change_pct:+.2f}%)\n"
            f"  VIX: {mc.vix_level:.2f} ({mc.vix_term})\n"
            f"  Market regime: {mc.market_regime}"
        )
        if mc.next_event_name:
            prompt += f"\n  Next major event: {mc.next_event_name} in {mc.days_to_next_event}d"

    return prompt


def _parse_llm_response(raw: str) -> AiInsight:
    """
    Parse LLM JSON response into AiInsight.
    Raises ValueError on invalid JSON or missing/wrong fields.
    """
    # Strip markdown fences if model wraps JSON in ```json ... ```
    text = raw.strip()
    if text.startswith("```"):
        # Remove opening fence
        first_nl = text.index("\n")
        text = text[first_nl + 1:]
        # Remove closing fence
        if text.endswith("```"):
            text = text[:-3].strip()

    data = _json.loads(text)

    assessment = data.get("overall_assessment", "")
    if assessment not in _VALID_ASSESSMENTS:
        raise ValueError(f"Invalid overall_assessment: {assessment!r}")

    diagnostics: list[DiagnosticItem] = []
    raw_diags = data.get("diagnostics", [])
    if not isinstance(raw_diags, list) or len(raw_diags) < 1:
        raise ValueError(f"Expected 1-5 diagnostics, got {len(raw_diags) if isinstance(raw_diags, list) else type(raw_diags)}")

    for d in raw_diags[:5]:
        sev = d.get("severity", "")
        cat = d.get("category", "")
        if sev not in _VALID_SEVERITIES:
            raise ValueError(f"Invalid severity: {sev!r}")
        if cat not in _VALID_CATEGORIES:
            raise ValueError(f"Invalid category: {cat!r}")
        diagnostics.append(DiagnosticItem(
            severity=sev,
            category=cat,
            title=d.get("title", ""),
            explanation=d.get("explanation", ""),
            suggestion=d.get("suggestion", ""),
        ))

    return AiInsight(
        overall_assessment=assessment,
        diagnostics=diagnostics,
        generated_at=datetime.now(timezone.utc),
    )


class ClaudeAiProvider(AiProvider):
    """
    Anthropic Claude API provider via async httpx.

    Uses the Messages API directly (no SDK dependency beyond httpx).
    """

    def __init__(
        self,
        api_key: str,
        model: str = "claude-haiku-4-5-20251001",
        max_tokens: int = 600,
        timeout: int = 15,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._max_tokens = max_tokens
        self._timeout = timeout

    async def analyze(self, context: RiskContext, language: str = "en") -> AiInsight:
        """Call Claude Messages API, parse structured JSON response."""
        import httpx

        user_prompt = _build_user_prompt(context)

        payload = {
            "model": self._model,
            "max_tokens": self._max_tokens,
            "temperature": 0.0,
            "system": _get_system_prompt(language),
            "messages": [{"role": "user", "content": user_prompt}],
        }

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                json=payload,
                headers={
                    "x-api-key": self._api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
            )
            resp.raise_for_status()

        body = resp.json()
        raw_text = body["content"][0]["text"]
        return _parse_llm_response(raw_text)


# ---------------------------------------------------------------------------
# CircuitBreakerProvider — wraps LLM provider + auto-fallback to Mock
# ---------------------------------------------------------------------------

class CircuitBreakerProvider(AiProvider):
    """
    Wraps a primary LLM provider with circuit breaker logic.

    After `max_failures` consecutive failures, opens the circuit and falls
    back to MockAiProvider for `cooldown_seconds`.  After cooldown, the
    next call attempts the primary provider again (half-open state).
    """

    def __init__(
        self,
        primary: AiProvider,
        fallback: AiProvider | None = None,
        max_failures: int = 3,
        cooldown_seconds: float = 300.0,
    ) -> None:
        self._primary = primary
        self._fallback = fallback or MockAiProvider()
        self._max_failures = max_failures
        self._cooldown = cooldown_seconds
        self._consecutive_failures = 0
        self._circuit_open_until: float = 0.0  # time.monotonic() timestamp

    @property
    def is_open(self) -> bool:
        """True when circuit is open (using fallback)."""
        return (
            self._consecutive_failures >= self._max_failures
            and time.monotonic() < self._circuit_open_until
        )

    async def analyze(self, context: RiskContext, language: str = "en") -> AiInsight:
        # Circuit open -> use fallback directly
        if self.is_open:
            logger.warning("Circuit open -- using fallback MockAiProvider")
            return await self._fallback.analyze(context, language=language)

        # Half-open or closed -> try primary
        try:
            result = await self._primary.analyze(context, language=language)
            # Success -> reset failure counter
            self._consecutive_failures = 0
            return result
        except Exception as exc:
            self._consecutive_failures += 1
            logger.warning(
                "LLM provider failed (%d/%d): %s",
                self._consecutive_failures,
                self._max_failures,
                exc,
            )
            if self._consecutive_failures >= self._max_failures:
                self._circuit_open_until = time.monotonic() + self._cooldown
                logger.error(
                    "Circuit breaker OPEN -- falling back to MockAiProvider for %ds",
                    self._cooldown,
                )
            # Fallback for this request
            return await self._fallback.analyze(context, language=language)


# ---------------------------------------------------------------------------
# Provider factory
# ---------------------------------------------------------------------------

def create_provider() -> AiProvider:
    """
    Create the appropriate AiProvider based on config.

    Returns:
      - MockAiProvider if ai_provider_type == "mock"
      - CircuitBreakerProvider(ClaudeAiProvider) if ai_provider_type == "claude"
    """
    from app.config import settings

    provider_type = settings.ai_provider_type.lower()

    if provider_type == "mock":
        logger.info("AI provider: MockAiProvider (rule-based)")
        return MockAiProvider()

    if provider_type == "claude":
        api_key = settings.ai_api_key
        if not api_key:
            logger.warning("AI_API_KEY not set — falling back to MockAiProvider")
            return MockAiProvider()
        primary = ClaudeAiProvider(
            api_key=api_key,
            model=settings.ai_model,
            max_tokens=settings.ai_max_tokens,
            timeout=settings.ai_timeout,
        )
        logger.info("AI provider: ClaudeAiProvider (model=%s) with circuit breaker", settings.ai_model)
        return CircuitBreakerProvider(primary)

    logger.warning("Unknown ai_provider_type=%r — falling back to MockAiProvider", provider_type)
    return MockAiProvider()


# ---------------------------------------------------------------------------
# AiInsightService -- background poll loop
# ---------------------------------------------------------------------------

# Shared vol cache reference (set from main.py, same pattern as nlv_sampler)
_vol_cache_ref: dict[str, Decimal] | None = None


def set_vol_cache_ref(cache: dict[str, Decimal]) -> None:
    """Called from main.py to share the price_feed vol cache."""
    global _vol_cache_ref
    _vol_cache_ref = cache


class AiInsightService:
    """Background AI insight generator -- broadcasts ai_insight every N seconds."""

    def __init__(
        self,
        manager,                          # ConnectionManager
        cache,                            # PriceCache
        provider: AiProvider | None = None,
        poll_interval: float | None = None,
        voice=None,                       # TtsProvider | None
        audio_cache=None,                 # AudioCache | None
        macro_service=None,               # MacroService | None (Phase 12a)
    ) -> None:
        from app.config import settings
        self._manager = manager
        self._cache = cache
        self._provider = provider or MockAiProvider()
        self._poll_interval = poll_interval or settings.ai_insight_interval
        self._voice = voice
        self._audio_cache = audio_cache
        self._macro_service = macro_service
        self._task: asyncio.Task | None = None
        self._running = False

    # -- Lifecycle -----------------------------------------------------------

    def start(self) -> None:
        if self._task is not None:
            return
        self._running = True
        self._task = asyncio.create_task(self._poll_loop(), name="ai_insight")
        logger.info(
            "AiInsightService started (interval=%ds, provider=%s)",
            self._poll_interval,
            type(self._provider).__name__,
        )

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("AiInsightService stopped")

    # -- Main loop -----------------------------------------------------------

    async def _poll_loop(self) -> None:
        while self._running:
            try:
                await self._generate_once()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("AI insight generation error")
            await asyncio.sleep(self._poll_interval)

    async def _generate_once(self) -> None:
        """Generate insights for all subscribed (user_id, portfolio_id) pairs."""
        # Phase 11: collect language preference per (user_id, pid) pair.
        # If a user has multiple connections with different languages, use the
        # most recently connected language (last wins).
        seen: dict[tuple[int, int], str] = {}  # (user_id, pid) -> language
        for conn in list(self._manager._connections.values()):
            for pid in conn.subscribed_portfolio_ids:
                seen[(conn.user_id, pid)] = conn.language

        if not seen:
            return

        for (user_id, portfolio_id), language in seen.items():
            try:
                await self._analyze_and_broadcast(user_id, portfolio_id, language=language)
            except Exception:
                logger.exception(
                    "AI insight failed: user=%d pid=%d", user_id, portfolio_id,
                )

    async def _analyze_and_broadcast(
        self,
        user_id: int,
        portfolio_id: int,
        language: str = "en",
    ) -> None:
        """Compute risk context, run AI analysis, broadcast result."""
        from app.database import AsyncSessionLocal
        from app.services import position_engine
        from app.services.holdings_engine import compute_holding_groups
        from app.services.portfolio_resolver import resolve_portfolio_ids
        from app.services.risk_engine import compute_risk_summary

        # 1. Get positions + trade metadata from DB
        async with AsyncSessionLocal() as db:
            pids = await resolve_portfolio_ids(db, user_id, portfolio_id)
            positions = await position_engine.calculate_positions(
                db, portfolio_ids=pids,
            )

            # Phase 10.5: fetch trade_metadata for active trades
            from sqlalchemy import select as sa_select
            from app.models import TradeEvent as _TE, TradeStatus as _TS
            _meta_result = await db.execute(
                sa_select(_TE.trade_metadata)
                .where(_TE.portfolio_id.in_(pids))
                .where(_TE.status == _TS.ACTIVE)
                .where(_TE.trade_metadata.is_not(None))
            )
            _metadata_list = [row[0] for row in _meta_result.fetchall()]

        if not positions:
            return

        # 2. Get market data from shared caches
        spot_map = self._cache.all_prices()
        vol_map = dict(_vol_cache_ref) if _vol_cache_ref else {}

        # 3. Compute risk summary + holding groups (pure functions, reuse existing)
        risk_summary = compute_risk_summary(positions, spot_map, vol_map)
        holding_groups = compute_holding_groups(positions, spot_map, vol_map)

        # 4. Build sanitized context (pure function -- zero leakage)
        avg_conf, tag_dist = compute_confidence_stats(_metadata_list)

        # Phase 12a: inject macro context from MacroService
        macro_ctx = None
        if self._macro_service:
            macro_ctx = self._macro_service.get_latest()

        risk_context = build_risk_context(
            positions, risk_summary, holding_groups,
            avg_confidence=avg_conf,
            tag_distribution=tag_dist,
            market_context=macro_ctx,
        )

        # 5. Run AI analysis (Phase 11: pass language for bilingual output)
        insight = await self._provider.analyze(risk_context, language=language)

        # 6. TTS synthesis for critical diagnostics (Phase 10a/11: language-aware)
        audio_url = None
        has_critical = any(d.severity == "critical" for d in insight.diagnostics)
        if self._voice and self._audio_cache and has_critical:
            try:
                from app.config import settings as _tts_settings
                from app.services.voice_service import build_narration
                narration = build_narration(
                    insight.diagnostics, insight.overall_assessment, language=language,
                )
                voice_name = (
                    _tts_settings.tts_voice_zh if language == "zh"
                    else _tts_settings.tts_voice_en
                )
                mp3_bytes = await self._voice.synthesize(narration, voice_name)
                audio_id = self._audio_cache.put(mp3_bytes)
                audio_url = f"/api/tts/audio/{audio_id}"
                logger.debug("TTS generated: %s (%d bytes)", audio_url, len(mp3_bytes))
            except Exception:
                logger.exception("TTS synthesis failed, skipping audio")

        # 7. Broadcast via WS (user_id used for routing only, never in payload)
        msg = {
            "type": "ai_insight",
            "portfolio_id": portfolio_id,
            "data": {
                "overall_assessment": insight.overall_assessment,
                "diagnostics": [
                    {
                        "severity": d.severity,
                        "category": d.category,
                        "title": d.title,
                        "explanation": d.explanation,
                        "suggestion": d.suggestion,
                    }
                    for d in insight.diagnostics
                ],
                "generated_at": insight.generated_at.isoformat(),
                "audio_url": audio_url,
            },
        }
        await self._manager.broadcast_to_user(user_id, msg)
        logger.debug(
            "AI insight broadcast: user=%d pid=%d assessment=%s diagnostics=%d audio=%s",
            user_id, portfolio_id, insight.overall_assessment,
            len(insight.diagnostics), audio_url or "none",
        )
