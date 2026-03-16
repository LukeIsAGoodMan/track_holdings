"""
Narrative engine — Rhino-style analysis commentary.

Converts structured analysis states into prose commentary with controlled
lexical variation.  No LLM.  Pure rule-based, deterministic seed.

Design:
  - Each narrative section has a small pool of sentence variants per state.
  - A deterministic hash of the symbol selects which variant to use, so the
    same symbol always gets the same phrasing within a session.
  - Joint-reasoning rules override flat single-factor narration.
  - EN and ZH are fully parallel.
"""
from __future__ import annotations

import hashlib


# ── Variant selector ──────────────────────────────────────────────────────

def _pick(variants: list[str], seed: int) -> str:
    """Deterministic variant selection using a seed index."""
    return variants[seed % len(variants)]


def _seed(symbol: str) -> int:
    """Stable per-symbol seed from hash — same symbol, same phrasing."""
    return int(hashlib.md5(symbol.encode()).hexdigest()[:8], 16)


# ── Format helpers ────────────────────────────────────────────────────────

def _fp(n: float | None) -> str:
    return f"{n:.2f}" if n is not None else "N/A"


# ═══════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════

def build_rhino_narrative(
    symbol: str,
    price: float,
    technical: dict,
    valuation: dict,
    macro: dict,
    semantic: dict,
    playbook: dict,
    lang: str = "en",
) -> dict:
    """Build structured Rhino narrative from analysis outputs."""
    s = _seed(symbol)
    pool = _EN if lang != "zh" else _ZH

    val_text = _narrate_valuation(pool, s, price, valuation, semantic)
    struct_text = _narrate_structure(pool, s, price, technical, semantic)
    macro_text = _narrate_macro(pool, s, macro, semantic)
    pattern_text = _narrate_patterns(pool, s, price, technical, semantic)
    playbook_text = _narrate_playbook(pool, s, semantic, playbook)
    summary_text = _narrate_summary(pool, s, price, semantic)

    return {
        "summary": summary_text,
        "sections": {
            "valuation": val_text,
            "structure": struct_text,
            "macro": macro_text,
            "patterns": pattern_text,
            "playbook": playbook_text,
        },
    }


# ═══════════════════════════════════════════════════════════════════════════
# ENGLISH LEXICON POOL
# ═══════════════════════════════════════════════════════════════════════════

_EN = {
    # ── Valuation ──────────────────────────────────────────────────────
    "val_undervalued": [
        "Current valuation sits in the lower part of the expected range, leaving a visible margin of safety. If forward growth has not been fully priced in, this improves the long-term risk/reward profile.",
        "Valuation suggests meaningful upside relative to the fair-value band. The stock appears to offer a margin of safety at these levels, assuming earnings estimates hold.",
        "The current price reflects a discount to the forward earnings-based fair value range. This leaves room for re-rating if fundamentals track or exceed expectations.",
    ],
    "val_fair": [
        "The stock is currently trading within a reasonable forward valuation band. Future price progress will likely require either better earnings delivery or an improvement in the macro backdrop.",
        "Valuation looks balanced relative to consensus estimates. Neither cheap enough to be a clear opportunity, nor stretched enough to warrant concern. Execution matters from here.",
        "At current levels, the stock is roughly fairly valued against the forward PE band. Any further upside depends on either multiple expansion or earnings acceleration.",
    ],
    "val_overvalued": [
        "The current price appears to have already discounted a large portion of future growth expectations. This leaves the stock exposed to valuation compression if execution or earnings fail to fully justify the premium.",
        "Valuation is stretched beyond the fair-value band. At these levels, the market is pricing in strong forward delivery, and any disappointment carries meaningful downside risk.",
        "The stock is priced above the consensus fair-value range. The premium implies confidence in continued acceleration, but also raises vulnerability to any miss in growth trajectory.",
    ],
    "val_unavailable": [
        "Valuation data is currently insufficient to establish a forward PE-based fair value range.",
    ],
    "val_eps_line": "Forward EPS: FY1 ${fy1}, FY2 ${fy2} ({growth}% growth).",
    "val_eps_no_growth": "Forward EPS: FY1 ${fy1} (FY2 estimate unavailable).",

    # ── Structure ──────────────────────────────────────────────────────
    "struct_above_sma200": [
        "Price remains above the 200-day moving average, confirming a structurally constructive longer-term trend.",
        "The stock holds above the 200-day average, keeping the broader trend intact.",
    ],
    "struct_below_sma200": [
        "Price remains below the 200-day moving average, indicating the longer-term trend is still under pressure.",
        "The stock continues to trade below the 200-day average, a signal that the broader trend has not yet recovered.",
    ],
    "struct_near_sma200": [
        "Price is hovering near the 200-day moving average, a level that often acts as a pivotal dividing line between bullish and bearish regimes.",
        "The stock is testing the 200-day average zone, a critical area that tends to attract both buyers and sellers.",
    ],
    "struct_resistance": "The next structural resistance sits near ${level}. Only a decisive breakout above this level, ideally with volume confirmation, would signal a structural reversal.",
    "struct_support": "The nearest structural support sits near ${level}. A break below this area would remove an important floor and open the path for further downside.",
    "struct_bullish_align": " All three moving averages (30/100/200) are in bullish alignment, reinforcing the uptrend conviction.",
    "struct_bearish_align": " All three moving averages (30/100/200) are in bearish alignment, adding weight to the downtrend thesis.",
    # Joint: below SMA200 + near support
    "joint_below_near_support": [
        "Although the stock remains in a weaker trend regime below the 200-day average, price has already pulled back into an important support area. The key question here is not blind capitulation, but whether volume and closing behavior begin to show stabilization.",
        "Price sits below the 200-day average but is testing a meaningful support zone. A successful defense here could mark the beginning of a base-building process, but confirmation through volume is essential.",
    ],
    # Joint: above SMA200 + near resistance
    "joint_above_near_resistance": [
        "The broader trend remains constructive, but price is now approaching a key resistance zone where upside may temporarily stall unless momentum expands.",
        "The long-term trend is healthy, yet the stock is bumping against structural resistance. A clean breakout with volume would be the signal to watch.",
    ],

    # ── Macro ──────────────────────────────────────────────────────────
    "macro_supportive": [
        "The macro backdrop is favorable. Low volatility and accommodative rate conditions reduce headwinds and support risk appetite.",
        "Macro conditions are constructive. With VIX subdued and yields contained, the environment is supportive for equity valuations.",
    ],
    "macro_mixed": [
        "Macro conditions are mixed. Neither fully supportive nor threatening, but investors should remain attentive to shifts in the rate or volatility landscape.",
        "The macro environment is in a neutral-to-cautious zone. No immediate crisis, but conditions are not yet clearly risk-on either.",
    ],
    "macro_restrictive": [
        "In the current rate environment, the discounting effect on higher-duration equities remains visible. Even strong fundamentals may struggle to fully translate into upside if the macro liquidity backdrop continues to tighten.",
        "The combination of elevated volatility and restrictive rates creates a headwind for valuation multiples. Macro pressure is compressing what the market is willing to pay for forward earnings.",
    ],
    "macro_stressed": [
        "Risk-off conditions dominate. VIX is signaling systemic stress, and capital preservation takes absolute priority over return-seeking. This is not a market for heroics.",
        "The macro environment has shifted into crisis territory. Elevated volatility, tight liquidity, and risk aversion mean defensive positioning is not optional, it is mandatory.",
    ],
    "macro_unavailable": [
        "Macro data is currently unavailable, limiting the ability to assess the external risk environment.",
    ],
    "macro_vix_line": "VIX is at {vix}, indicating {regime} conditions.",
    "macro_rate_line": "The 10-year Treasury yield sits at {rate}%, reflecting a {regime} rate posture.",
    # Joint: restrictive + overvalued
    "joint_restrictive_overvalued": [
        "With valuation already rich and the macro backdrop still restrictive, the stock faces a double headwind from both expectations and discount-rate pressure.",
        "A stretched valuation combined with restrictive macro conditions means there is limited margin for error. Any earnings miss or further rate tightening could trigger a meaningful repricing.",
    ],
    # Joint: restrictive + fair value
    "joint_restrictive_fair": [
        "Even if valuation is not excessive, macro tightening can still limit multiple expansion and reduce rebound efficiency.",
        "Although the stock is not overvalued, restrictive macro conditions act as a ceiling on sentiment and limit the scope for valuation re-rating.",
    ],

    # ── Patterns ───────────────────────────────────────────────────────
    "loc_near_support": [
        "Price is approaching a key support zone where buyers may attempt to defend the structure. Watch for volume confirmation and closing behavior before acting.",
        "The stock has pulled back into a significant support area. If this level holds with conviction, it could present a tactical entry point.",
    ],
    "loc_near_resistance": [
        "Price is pressing against a key resistance area. A failure to break through could lead to a pullback toward support.",
        "The stock is testing overhead resistance. Momentum expansion and volume confirmation would be needed to sustain a breakout.",
    ],
    "loc_breakout": [
        "Price is testing resistance and a breakout could invite momentum buying. If confirmed by volume, this would represent a meaningful structural shift.",
        "The stock is pushing above resistance. If sustained, this breakout signals a potential regime change and invites trend-following capital.",
    ],
    "loc_breakdown": [
        "A decisive break below support would signal structural weakness and could trigger another leg lower. Risk management takes priority here.",
        "Price has slipped below a key support zone. Unless buyers reclaim this area quickly, the path of least resistance shifts lower.",
    ],
    "loc_mid_range": [
        "Price sits in the middle ground between support and resistance, an area that offers no clear structural edge. Patience is warranted until a directional signal emerges.",
        "The stock is drifting in a no-man's-land between key levels. This is not the place to force a view — wait for price to come to you.",
    ],

    # ── Playbook ───────────────────────────────────────────────────────
    "stance_constructive": [
        "Momentum and structure support a constructive outlook. The setup favors measured exposure with trend-aligned positioning.",
        "The weight of evidence leans constructive. Trend, valuation, and macro align to support a building-position approach.",
    ],
    "stance_neutral": [
        "The current balance of signals does not strongly favor either direction. Maintaining existing exposure without forcing new positions is the disciplined path.",
        "With signals mixed, neither aggressive buying nor selling is justified. The prudent move is to hold steady and await further clarity.",
    ],
    "stance_cautious": [
        "The current setup calls for patience. Monitoring key levels remains more important than forcing exposure.",
        "Caution is warranted. While the trend may still be intact, conflicting signals suggest reducing aggression and watching for confirmation.",
    ],
    "stance_defensive": [
        "Risk management takes priority under current conditions. Protecting capital matters more than capturing upside in this environment.",
        "Defensive positioning is the appropriate response. The combination of macro stress and structural weakness leaves no room for complacency.",
    ],
    "stance_opportunistic": [
        "A tactical opportunity may emerge near support, but confirmation still matters. Look for volume stabilization and closing behavior before committing.",
        "The setup hints at a potential counter-trend opportunity. However, discipline requires waiting for concrete evidence of stabilization rather than front-running.",
    ],

    # ── Summary ────────────────────────────────────────────────────────
    "summary_template": [
        "{val_clause}, {trend_clause}. {macro_clause}. The current stance remains {stance}.",
        "{val_clause}. {trend_clause}, and {macro_clause}. Overall: {stance}.",
    ],
    "sum_val_undervalued": "Valuation appears attractive",
    "sum_val_fair": "Valuation appears reasonable",
    "sum_val_overvalued": "Valuation looks stretched",
    "sum_val_unavailable": "Valuation data is limited",
    "sum_trend_above": "the stock maintains a constructive longer-term trend",
    "sum_trend_below": "the stock continues to trade below the long-term trend",
    "sum_trend_near": "the stock is testing a critical long-term trend level",
    "sum_trend_unavailable": "long-term trend data is limited",
    "sum_macro_supportive": "macro conditions are favorable",
    "sum_macro_mixed": "macro conditions are mixed",
    "sum_macro_restrictive": "macro conditions remain restrictive",
    "sum_macro_stressed": "the macro backdrop signals significant stress",
    "sum_macro_unavailable": "macro assessment is limited",
}


# ═══════════════════════════════════════════════════════════════════════════
# CHINESE LEXICON POOL
# ═══════════════════════════════════════════════════════════════════════════

_ZH = {
    # ── Valuation ──────────────────────────────────────────────────────
    "val_undervalued": [
        "当前估值处于预期区间的下沿，留有可见的安全边际。若前瞻增长尚未完全被市场消化，这将改善长期风险收益比。",
        "估值显示相对于合理价值区间存在明显上行空间。在盈利预期维持的前提下，当前价格提供了安全边际。",
        "当前价格反映出对远期盈利合理价值区间的折价，若基本面跟踪或超出预期，存在估值修复空间。",
    ],
    "val_fair": [
        "股价当前处于合理的前瞻估值区间内。后续上涨需要更好的盈利兑现或宏观环境改善来驱动。",
        "估值相对于一致预期处于均衡状态。既不够便宜到构成明确机会，也不够贵到值得担忧，执行力是关键。",
        "在当前水平上，股票相对于前瞻PE区间大致合理定价。进一步上行取决于估值扩张或盈利加速。",
    ],
    "val_overvalued": [
        "当前价格似乎已经提前消化了未来增长预期的大部分。如果执行或盈利未能完全证明溢价的合理性，股票面临估值压缩风险。",
        "估值已超出合理价值区间。在这个水平上，市场定价隐含了强劲的前瞻兑现，任何令人失望的表现都将带来显著下行风险。",
        "股价高于一致预期的合理价值区间。这种溢价意味着对持续增长的信心，但也提高了对增长轨迹偏离的脆弱性。",
    ],
    "val_unavailable": [
        "估值数据不足，无法建立基于前瞻PE的合理价值区间。",
    ],
    "val_eps_line": "远期EPS: FY1 ${fy1}, FY2 ${fy2} (增长{growth}%)。",
    "val_eps_no_growth": "远期EPS: FY1 ${fy1} (FY2预估不可用)。",

    # ── Structure ──────────────────────────────────────────────────────
    "struct_above_sma200": [
        "价格保持在200日均线上方，确认中长期趋势结构性向好。",
        "股价站稳200日均线，维持整体上升趋势格局。",
    ],
    "struct_below_sma200": [
        "价格仍在200日均线下方运行，表明中长期趋势仍承压。",
        "股价持续在200日均线下方交易，说明整体趋势尚未修复。",
    ],
    "struct_near_sma200": [
        "价格正在200日均线附近徘徊——这一位置通常是多空分水岭的关键枢纽。",
        "股价正在测试200日均线区域，这是一个容易吸引多空双方博弈的关键位置。",
    ],
    "struct_resistance": "下一个结构性压力位在${level}附近。只有在成交量配合下的有效突破，才能确认结构性反转。",
    "struct_support": "最近的结构性支撑位在${level}附近。若有效跌破该区域，将移除重要底部支撑，打开进一步下行空间。",
    "struct_bullish_align": " 三条均线(30/100/200)呈多头排列，增强上升趋势的确信度。",
    "struct_bearish_align": " 三条均线(30/100/200)呈空头排列，加重下行趋势判断。",
    "joint_below_near_support": [
        "尽管股价仍处于200日均线下方的弱势格局，但已回落至一个重要支撑区域。这里的关键问题不是盲目恐慌，而是成交量和收盘行为是否开始展现止跌企稳信号。",
        "价格位于200日均线下方，但正在测试一个有意义的支撑位。如果该位置能够在量价配合下成功守住，可能标志着筑底过程的开始。",
    ],
    "joint_above_near_resistance": [
        "整体趋势保持建设性，但价格正在逼近一个关键压力区域，若动能未能扩大，上行空间可能暂时受阻。",
        "中长期趋势健康，然而股价正在触碰结构性压力位。放量突破将是需要关注的信号。",
    ],

    # ── Macro ──────────────────────────────────────────────────────────
    "macro_supportive": [
        "宏观环境友好。低波动率和宽松的利率条件减少了逆风，支撑风险偏好。",
        "宏观条件积极向好。VIX低位运行、收益率可控，环境对权益类资产估值形成支撑。",
    ],
    "macro_mixed": [
        "宏观环境处于中性偏谨慎状态。没有迫在眉睫的危机，但条件尚未明确转向风险偏好。",
        "宏观条件喜忧参半。既非完全支持，也未构成威胁，但投资者需对利率或波动率的变化保持警觉。",
    ],
    "macro_restrictive": [
        "在当前利率环境下，贴现效应对久期较长的权益资产仍然明显。即使基本面强劲，宏观流动性收紧也可能限制上行空间。",
        "波动率偏高叠加利率收紧，构成估值倍数压缩的逆风。宏观压力正在压缩市场愿意为远期盈利支付的价格。",
    ],
    "macro_stressed": [
        "风险规避情绪主导市场。VIX信号系统性压力，资本保全绝对优先于追求收益。这不是逞英雄的市场。",
        "宏观环境已进入危机状态。高波动率、紧缩流动性和风险厌恶意味着防御姿态不是可选项，而是必选项。",
    ],
    "macro_unavailable": [
        "宏观数据当前不可用，无法评估外部风险环境。",
    ],
    "macro_vix_line": "VIX处于{vix}，表明{regime}市场环境。",
    "macro_rate_line": "10年期美债收益率为{rate}%，反映{regime}利率姿态。",
    "joint_restrictive_overvalued": [
        "估值已经偏贵，叠加宏观环境仍然收紧，股价同时面临预期透支和贴现率压力的双重逆风。",
        "拉伸的估值叠加紧缩的宏观环境意味着容错空间极窄。任何盈利不及预期或进一步加息都可能触发显著的重新定价。",
    ],
    "joint_restrictive_fair": [
        "虽然估值并不过分，但宏观紧缩仍可能限制估值扩张，降低反弹效率。",
        "尽管股票并未高估，紧缩的宏观条件仍然对情绪形成天花板，限制了估值修复的空间。",
    ],

    # ── Patterns ───────────────────────────────────────────────────────
    "loc_near_support": [
        "价格正在逼近一个关键支撑区域，多头可能在此尝试防守。关注成交量确认和收盘行为再做决策。",
        "股价已回撤至重要支撑区域。如果该位置能够有信心地守住，可能提供战术性入场点。",
    ],
    "loc_near_resistance": [
        "价格正在触碰关键压力区域。若未能突破，可能回落至支撑位附近。",
        "股价正在测试上方压力。需要动能扩大和成交量确认才能维持突破。",
    ],
    "loc_breakout": [
        "价格正在测试压力位，若突破有望吸引动能买盘。如果成交量确认，将代表重要的结构性转变。",
        "股价正在突破压力位上沿。若持续站稳，这一突破信号预示着潜在的格局转换。",
    ],
    "loc_breakdown": [
        "有效跌破支撑将发出结构性走弱信号，可能触发新一轮下跌。风险管理在此处优先。",
        "价格已滑落至关键支撑位下方。除非多头迅速收复该区域，否则阻力最小的方向将转向下行。",
    ],
    "loc_mid_range": [
        "价格处于支撑和压力之间的中间地带，不具备明确的结构性优势。耐心等待方向信号出现。",
        "股价在关键位之间无方向震荡。这不是强行表态的位置——等价格主动走向你。",
    ],

    # ── Playbook ───────────────────────────────────────────────────────
    "stance_constructive": [
        "动能和结构支持积极展望。当前配置偏向顺势建仓。",
        "证据权重偏向积极。趋势、估值和宏观共同支持逐步建仓的策略。",
    ],
    "stance_neutral": [
        "当前信号组合未明确偏向任何方向。保持现有仓位、不强行开新仓是纪律的体现。",
        "信号喜忧参半，激进买入或卖出均缺乏依据。稳住心态、等待进一步明朗是审慎之举。",
    ],
    "stance_cautious": [
        "当前格局需要耐心。关注关键位的变化比强行加仓更为重要。",
        "保持谨慎是明智的。虽然趋势可能仍然存在，但矛盾的信号建议降低进攻性并等待确认。",
    ],
    "stance_defensive": [
        "在当前条件下，风险管理是第一优先级。保护资本比追逐上行更重要。",
        "防御姿态是当下最合适的回应。宏观压力与结构性弱势的叠加不容掉以轻心。",
    ],
    "stance_opportunistic": [
        "支撑附近可能出现战术性机会，但确认信号仍然重要。关注成交量企稳和收盘行为再做决策。",
        "格局暗示潜在的逆势机会。然而纪律要求等待具体的企稳证据，而非抢跑。",
    ],

    # ── Summary ────────────────────────────────────────────────────────
    "summary_template": [
        "{val_clause}，{trend_clause}。{macro_clause}。当前立场保持{stance}。",
        "{val_clause}。{trend_clause}，且{macro_clause}。综合判断：{stance}。",
    ],
    "sum_val_undervalued": "估值看起来具有吸引力",
    "sum_val_fair": "估值处于合理水平",
    "sum_val_overvalued": "估值偏高",
    "sum_val_unavailable": "估值数据有限",
    "sum_trend_above": "股价维持中长期上升趋势",
    "sum_trend_below": "股价仍在中长期趋势下方运行",
    "sum_trend_near": "股价正在测试关键的中长期趋势位",
    "sum_trend_unavailable": "中长期趋势数据有限",
    "sum_macro_supportive": "宏观环境友好",
    "sum_macro_mixed": "宏观条件喜忧参半",
    "sum_macro_restrictive": "宏观环境仍然偏紧",
    "sum_macro_stressed": "宏观背景发出显著压力信号",
    "sum_macro_unavailable": "宏观评估受限",
}


# ═══════════════════════════════════════════════════════════════════════════
# SECTION BUILDERS
# ═══════════════════════════════════════════════════════════════════════════

def _narrate_valuation(pool: dict, s: int, price: float, valuation: dict, semantic: dict) -> str:
    zone = semantic.get("valuation_zone", "unavailable")
    key = {"undervalued": "val_undervalued", "fair_value": "val_fair",
           "overvalued": "val_overvalued"}.get(zone, "val_unavailable")
    lines = [_pick(pool[key], s)]

    # EPS detail line
    if valuation.get("available"):
        fy1 = valuation.get("fy1_eps_avg")
        fy2 = valuation.get("fy2_eps_avg")
        growth = valuation.get("eps_growth_pct")
        if fy1 is not None and growth is not None:
            lines.append(pool["val_eps_line"]
                         .replace("{fy1}", _fp(fy1))
                         .replace("{fy2}", _fp(fy2))
                         .replace("{growth}", f"{growth * 100:.1f}"))
        elif fy1 is not None:
            lines.append(pool["val_eps_no_growth"].replace("{fy1}", _fp(fy1)))

        # Fair-value band context
        band = valuation.get("adjusted_fair_value")
        if band and isinstance(band, dict):
            lines.append(f"Fair-value band: ${_fp(band['low'])} \u2013 ${_fp(band['high'])}."
                         if pool is _EN else
                         f"合理价值区间: ${_fp(band['low'])} \u2013 ${_fp(band['high'])}。")

    return " ".join(lines)


def _narrate_structure(pool: dict, s: int, price: float, technical: dict, semantic: dict) -> str:
    trend = semantic.get("trend_state", "unavailable")
    location = semantic.get("price_location", "unavailable")
    alignment = semantic.get("ma_alignment", "unavailable")

    # ── Joint-reasoning overrides ──────────────────────────────────────
    if trend == "below_sma200" and location == "near_support":
        return _pick(pool["joint_below_near_support"], s)
    if trend == "above_sma200" and location == "near_resistance":
        return _pick(pool["joint_above_near_resistance"], s)

    # ── Single-factor trend ────────────────────────────────────────────
    parts: list[str] = []
    trend_key = {"above_sma200": "struct_above_sma200",
                 "below_sma200": "struct_below_sma200",
                 "near_sma200": "struct_near_sma200"}.get(trend)
    if trend_key:
        parts.append(_pick(pool[trend_key], s))

    # Alignment addendum
    if alignment == "bullish_alignment":
        parts.append(pool["struct_bullish_align"])
    elif alignment == "bearish_alignment":
        parts.append(pool["struct_bearish_align"])

    # Nearest levels
    rz = technical.get("resistance_zones", [])
    sz = technical.get("support_zones", [])
    if rz:
        parts.append(pool["struct_resistance"].replace("{level}", _fp(rz[0]["center"])))
    if sz:
        parts.append(pool["struct_support"].replace("{level}", _fp(sz[0]["center"])))

    return " ".join(parts) if parts else ""


def _narrate_macro(pool: dict, s: int, macro: dict, semantic: dict) -> str:
    regime = semantic.get("macro_regime", "unavailable")
    val_zone = semantic.get("valuation_zone", "unavailable")

    # ── Joint-reasoning overrides ──────────────────────────────────────
    if regime == "restrictive_risk" and val_zone == "overvalued":
        return _pick(pool["joint_restrictive_overvalued"], s)
    if regime == "restrictive_risk" and val_zone == "fair_value":
        return _pick(pool["joint_restrictive_fair"], s)

    # ── Single-factor macro ────────────────────────────────────────────
    key = {"supportive": "macro_supportive", "mixed_macro": "macro_mixed",
           "restrictive_risk": "macro_restrictive", "stressed": "macro_stressed",
           }.get(regime, "macro_unavailable")
    parts = [_pick(pool[key], s)]

    # Metric detail lines
    vix = macro.get("vix_level")
    if vix is not None:
        vix_regime = macro.get("vix_regime", "")
        parts.append(pool["macro_vix_line"]
                     .replace("{vix}", f"{vix:.1f}")
                     .replace("{regime}", vix_regime))

    rate = macro.get("treasury_10y")
    if rate is not None:
        rate_regime = macro.get("rate_pressure_regime", "")
        parts.append(pool["macro_rate_line"]
                     .replace("{rate}", f"{rate:.2f}")
                     .replace("{regime}", rate_regime))

    return " ".join(parts)


def _narrate_patterns(pool: dict, s: int, price: float, technical: dict, semantic: dict) -> str:
    loc = semantic.get("price_location", "unavailable")
    key = {"near_support": "loc_near_support", "near_resistance": "loc_near_resistance",
           "breakout_zone": "loc_breakout", "breakdown_risk": "loc_breakdown",
           "mid_range": "loc_mid_range"}.get(loc)
    if not key:
        return ""
    return _pick(pool[key], s)


def _narrate_playbook(pool: dict, s: int, semantic: dict, playbook: dict) -> str:
    stance = semantic.get("stance", "neutral")
    key = f"stance_{stance}"
    parts = [_pick(pool.get(key, pool["stance_neutral"]), s)]

    # Append rationale from playbook engine
    rationale = playbook.get("rationale", [])
    if rationale:
        joined = "; ".join(rationale)
        parts.append(f"({joined})" if pool is _EN else f"({joined})")

    return " ".join(parts)


def _narrate_summary(pool: dict, s: int, price: float, semantic: dict) -> str:
    val_zone = semantic.get("valuation_zone", "unavailable")
    trend = semantic.get("trend_state", "unavailable")
    macro_regime = semantic.get("macro_regime", "unavailable")
    stance = semantic.get("stance", "neutral")

    val_clause = pool.get(f"sum_val_{val_zone}", pool["sum_val_unavailable"])
    trend_key = {"above_sma200": "sum_trend_above", "below_sma200": "sum_trend_below",
                 "near_sma200": "sum_trend_near"}.get(trend, "sum_trend_unavailable")
    trend_clause = pool[trend_key]
    macro_key = {"supportive": "sum_macro_supportive", "mixed_macro": "sum_macro_mixed",
                 "restrictive_risk": "sum_macro_restrictive", "stressed": "sum_macro_stressed",
                 }.get(macro_regime, "sum_macro_unavailable")
    macro_clause = pool[macro_key]

    # Stance label
    stance_labels_en = {"constructive": "constructive", "neutral": "neutral",
                        "cautious": "cautious", "defensive": "defensive",
                        "opportunistic": "opportunistic"}
    stance_labels_zh = {"constructive": "积极", "neutral": "中性",
                        "cautious": "谨慎", "defensive": "防御",
                        "opportunistic": "机会型"}
    stance_label = (stance_labels_en if pool is _EN else stance_labels_zh).get(stance, stance)

    tmpl = _pick(pool["summary_template"], s)
    return (tmpl
            .replace("{val_clause}", val_clause)
            .replace("{trend_clause}", trend_clause)
            .replace("{macro_clause}", macro_clause)
            .replace("{stance}", stance_label))
