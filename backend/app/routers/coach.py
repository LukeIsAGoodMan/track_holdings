"""
GET /api/coach/analyze?portfolio_id=N&include_weekly=false

AI Trading Coach — streams a Claude-generated portfolio diagnosis over SSE.

Stream format:
  data: {"t":"chunk","v":"...text..."}\n\n   — raw text chunks while Claude writes
  data: {"t":"done","assessment":"Warning","weakness":"...","steps":[...],"weekly":"..."}\n\n
  data: [DONE]\n\n                              — signals EventSource to close

The response text uses section headers the frontend can parse:
  ## RISK_ASSESSMENT: Safe|Warning|Danger
  ## KEY_WEAKNESS
  ## ACTIONABLE_STEPS
  ## WEEKLY_REVIEW   (only when include_weekly=true)
"""
from __future__ import annotations

import json
import os
import re
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user_flexible
from app.models.user import User
from app.routers.risk import get_pnl_attribution, get_portfolio_insights

router = APIRouter(tags=["coach"])

_MODEL = "claude-haiku-4-5-20251001"
_MAX_TOKENS = 700
_TEMPERATURE = 0.0

_SYSTEM_PROMPT = """\
You are a professional options trading coach with expertise in Greek-based risk management, \
portfolio hedging, and options strategy construction.

You receive a structured snapshot of an options portfolio and must respond in EXACTLY this format \
(no preamble, no deviation, no extra sections):

## RISK_ASSESSMENT: [Safe|Warning|Danger]
One sentence explaining the overall risk level.

## KEY_WEAKNESS
One or two sentences identifying the most critical vulnerability right now.

## ACTIONABLE_STEPS
1. [Specific action — reference the exact ticker or Greek if relevant]
2. [Specific action]
3. [Specific action]

## WEEKLY_REVIEW
[2-3 sentences on P&L breakdown — theta decay vs directional moves. Include ONLY when attribution data is provided; otherwise omit this section entirely.]
"""


def _build_user_prompt(insight: dict, attribution: dict | None) -> str:
    """Convert PortfolioInsight + optional AttributionResponse into a user prompt."""
    gs  = insight.get("greeks_summary", {})
    var = insight.get("var_1d_95")
    var_str = f"${var:,.2f}" if var else "unavailable"

    top = insight.get("top_positions", [])
    top_lines = "\n".join(
        f"  * {p['symbol']} [{p['strategy_label']}]: "
        f"delta_exp={p['delta_exposure']:+.1f}, "
        f"theta=${p['theta_daily']:+.2f}/day, "
        f"margin=${p['margin']:,.0f}"
        for p in top
    ) or "  (no positions)"

    mix = insight.get("strategy_mix", {})
    mix_str = ", ".join(f"{v}x {k.lower()}" for k, v in mix.items()) or "none"

    alerts = insight.get("risk_alerts", [])
    alerts_str = "; ".join(alerts[:3]) if alerts else "none"

    lines = [
        f"Portfolio snapshot as of {insight.get('as_of', 'today')}:",
        "",
        f"Risk posture  : {insight.get('risk_posture', 'unknown')}",
        f"Dominant risk : {insight.get('dominant_risk', 'unknown')}",
        f"Net delta     : {gs.get('net_delta', 0):+.2f}",
        f"Net gamma     : {gs.get('net_gamma', 0):+.6f}",
        f"Net theta     : ${gs.get('net_theta', 0):+.2f}/day",
        f"Net vega      : {gs.get('net_vega', 0):+.2f}",
        f"1-day 95% VaR : {var_str}",
        f"Strategy mix  : {mix_str}",
        f"Active alerts : {alerts_str}",
        "",
        "Top positions:",
        top_lines,
        "",
        f"Context: {insight.get('natural_language_hint', '')}",
    ]

    if attribution:
        lines += [
            "",
            "Past P&L attribution:",
            f"  Theta decay income   : ${float(attribution.get('total_time_decay_pnl', 0)):+,.2f}",
            f"  Directional P&L      : ${float(attribution.get('total_directional_pnl', 0)):+,.2f}",
            f"  Total unrealized P&L : ${float(attribution.get('total_unrealized', 0)):+,.2f}",
        ]

    return "\n".join(lines)


def _extract_section(text: str, header: str) -> str:
    """Extract the body of a ## HEADER section (stops at next ## or end)."""
    pattern = rf"##\s*{re.escape(header)}\s*\n(.*?)(?=\n##|\Z)"
    m = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
    return m.group(1).strip() if m else ""


def _extract_assessment(text: str) -> str:
    """Extract Safe/Warning/Danger from ## RISK_ASSESSMENT: Safe\n..."""
    m = re.search(r"##\s*RISK_ASSESSMENT\s*:\s*(Safe|Warning|Danger)", text, re.IGNORECASE)
    return m.group(1).capitalize() if m else "Warning"


def _extract_steps(text: str) -> list[str]:
    """Extract numbered steps from the ACTIONABLE_STEPS section."""
    section = _extract_section(text, "ACTIONABLE_STEPS")
    steps = re.findall(r"^\d+\.\s+(.+)$", section, re.MULTILINE)
    return [s.strip() for s in steps if s.strip()]


async def _stream_diagnosis(
    insight_dict: dict,
    attribution_dict: dict | None,
) -> AsyncGenerator[str, None]:
    """
    Call Claude with streaming and yield SSE-formatted events.
    Yields text chunks while Claude writes, then a single 'done' event
    with parsed structured fields.
    """
    import anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        yield f'data: {json.dumps({"t":"error","v":"ANTHROPIC_API_KEY not set"})}\n\n'
        yield "data: [DONE]\n\n"
        return

    user_prompt = _build_user_prompt(insight_dict, attribution_dict)
    client = anthropic.AsyncAnthropic(api_key=api_key)

    full_text = ""
    try:
        async with client.messages.stream(
            model=_MODEL,
            max_tokens=_MAX_TOKENS,
            temperature=_TEMPERATURE,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            async for chunk in stream.text_stream:
                full_text += chunk
                yield f'data: {json.dumps({"t":"chunk","v":chunk})}\n\n'

    except anthropic.AuthenticationError:
        yield f'data: {json.dumps({"t":"error","v":"Invalid ANTHROPIC_API_KEY"})}\n\n'
        yield "data: [DONE]\n\n"
        return
    except Exception as exc:
        yield f'data: {json.dumps({"t":"error","v":str(exc)})}\n\n'
        yield "data: [DONE]\n\n"
        return

    # Parse structured fields from the completed text
    assessment = _extract_assessment(full_text)
    weakness   = _extract_section(full_text, "KEY_WEAKNESS")
    steps      = _extract_steps(full_text)
    weekly     = _extract_section(full_text, "WEEKLY_REVIEW")

    yield f'data: {json.dumps({"t":"done","assessment":assessment,"weakness":weakness,"steps":steps,"weekly":weekly})}\n\n'
    yield "data: [DONE]\n\n"


@router.get("/coach/analyze")
async def analyze_portfolio(
    portfolio_id: int | None = Query(None),
    include_weekly: bool = Query(False),
    user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_db),
):
    """
    Stream a Claude-generated portfolio diagnosis as Server-Sent Events.

    Uses claude-haiku for fast streaming.  The ANTHROPIC_API_KEY env variable
    must be set on the server.

    Events:
      {"t":"chunk","v":"..."}   — text tokens as they arrive
      {"t":"done",...}          — structured fields (assessment, weakness, steps, weekly)
      {"t":"error","v":"..."}   — error message (API key missing, network error, etc.)
    """
    # ── Gather portfolio data ────────────────────────────────────────────────
    insight = await get_portfolio_insights(
        portfolio_id=portfolio_id, db=db, user=user, _internal_user_id=user.id,
    )

    attribution = None
    if include_weekly:
        attribution = await get_pnl_attribution(
            portfolio_id=portfolio_id, db=db, user=user, _internal_user_id=user.id,
        )

    # Serialize to plain dicts (Pydantic → JSON-serializable)
    insight_dict     = insight.model_dump(mode="json")
    attribution_dict = attribution.model_dump(mode="json") if attribution else None

    # Early-exit for empty portfolios
    if not insight_dict.get("top_positions"):
        async def _empty():
            empty_done = {
                "t": "done",
                "assessment": "Safe",
                "weakness":   "No active option positions in this portfolio.",
                "steps":      ["Open positions to receive a coaching diagnosis."],
                "weekly":     "",
            }
            yield f'data: {json.dumps(empty_done)}\n\n'
            yield "data: [DONE]\n\n"
        return StreamingResponse(
            _empty(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return StreamingResponse(
        _stream_diagnosis(insight_dict, attribution_dict),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
