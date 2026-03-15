"""
Bilingual string templates for the report layer.

Data only — no rendering logic. Imported by report.py.
"""
from __future__ import annotations

EN = {
    "overview": "{symbol} is trading at ${price}. {change_desc}",
    "change_up": "Up {change_pct}% from previous close",
    "change_down": "Down {change_pct}% from previous close",
    "change_flat": "Flat from previous close",

    "technical_above_sma200": "Price is above the 200-day moving average, indicating a long-term uptrend",
    "technical_below_sma200": "Price is below the 200-day moving average, indicating a long-term downtrend",
    "technical_volume_high": "Volume is {volume_ratio}x the 50-day average — significant institutional activity",
    "technical_volume_low": "Volume is only {volume_ratio}x the 50-day average — thin trading",
    "technical_support_count": "{count} support zone(s) identified below current price",
    "technical_resistance_count": "{count} resistance zone(s) identified above current price",
    "technical_nearest_support": "Nearest support at ${level} ({pct_below}% below)",
    "technical_nearest_resistance": "Nearest resistance at ${level} ({pct_above}% above)",

    "pattern_break_below_support": "ALERT: Price has broken below a key support zone",
    "pattern_dead_cat_bounce": "WARNING: Dead cat bounce pattern detected — rally may be unsustainable",
    "pattern_reversal_at_support": "Reversal at support zone — potential bounce setup",
    "pattern_false_break_recovery": "False breakout recovered — bullish signal",
    "pattern_limbo_zone": "Price is in a limbo zone between support and resistance — wait for direction",

    "valuation_deeply_undervalued": "Valuation: DEEPLY UNDERVALUED. Price is well below the fair value band (${low}-${high})",
    "valuation_undervalued": "Valuation: UNDERVALUED. Price is below the fair value band (${low}-${high})",
    "valuation_fair_value": "Valuation: FAIR VALUE. Price is within the fair value band (${low}-${high})",
    "valuation_overvalued": "Valuation: OVERVALUED. Price is above the fair value band (${low}-${high})",
    "valuation_deeply_overvalued": "Valuation: DEEPLY OVERVALUED. Price is well above the fair value band (${low}-${high})",
    "valuation_unavailable": "Valuation unavailable — insufficient analyst estimates",
    "valuation_eps": "FY1 EPS: ${fy1_eps}, FY2 EPS: ${fy2_eps} ({growth_pct}% growth)",
    "valuation_eps_no_growth": "FY1 EPS: ${fy1_eps} (FY2 estimate unavailable)",

    "macro_calm": "Macro: VIX at {vix} — calm conditions. Low volatility favors risk-on positioning",
    "macro_normal": "Macro: VIX at {vix} — normal conditions",
    "macro_elevated": "Macro: VIX at {vix} — ELEVATED. Consider tighter position sizing",
    "macro_crisis": "Macro: VIX at {vix} — CRISIS. Risk-off environment, defensive positioning recommended",
    "macro_vix_unavailable": "Macro: VIX data unavailable",
    "macro_rates": "10Y Treasury at {rate}% — {regime} environment",
    "macro_haircut": "Fair value haircut of {pct}% applied for macro conditions",

    "playbook_strong_buy": "PLAYBOOK: STRONG BUY — {rationale}",
    "playbook_defensive_buy": "PLAYBOOK: DEFENSIVE BUY — {rationale}",
    "playbook_hold_watch": "PLAYBOOK: HOLD / WATCH — {rationale}",
    "playbook_reduce": "PLAYBOOK: REDUCE EXPOSURE — {rationale}",
    "playbook_stop_loss": "PLAYBOOK: STOP LOSS — {rationale}",

    "confidence": "Analysis confidence: {grade} ({score}/100). {reasons}",
}


ZH = {
    "overview": "{symbol} 当前价格 ${price}。{change_desc}",
    "change_up": "较前一交易日收盘价上涨 {change_pct}%",
    "change_down": "较前一交易日收盘价下跌 {change_pct}%",
    "change_flat": "与前一交易日收盘价持平",

    "technical_above_sma200": "价格位于200日均线上方，表明长期处于上升趋势",
    "technical_below_sma200": "价格位于200日均线下方，表明长期处于下降趋势",
    "technical_volume_high": "成交量为50日均量的 {volume_ratio} 倍 — 机构资金显著活跃",
    "technical_volume_low": "成交量仅为50日均量的 {volume_ratio} 倍 — 交易清淡",
    "technical_support_count": "当前价格下方识别到 {count} 个支撑区域",
    "technical_resistance_count": "当前价格上方识别到 {count} 个阻力区域",
    "technical_nearest_support": "最近支撑位于 ${level} (低于当前价 {pct_below}%)",
    "technical_nearest_resistance": "最近阻力位于 ${level} (高于当前价 {pct_above}%)",

    "pattern_break_below_support": "警告: 价格已跌破关键支撑区域",
    "pattern_dead_cat_bounce": "注意: 检测到死猫反弹形态 — 反弹可能不可持续",
    "pattern_reversal_at_support": "支撑位反转 — 潜在反弹机会",
    "pattern_false_break_recovery": "假突破后恢复 — 看涨信号",
    "pattern_limbo_zone": "价格处于支撑与阻力之间的中间区域 — 等待方向选择",

    "valuation_deeply_undervalued": "估值: 严重低估。价格远低于合理价值区间 (${low}-${high})",
    "valuation_undervalued": "估值: 低估。价格低于合理价值区间 (${low}-${high})",
    "valuation_fair_value": "估值: 合理。价格处于合理价值区间内 (${low}-${high})",
    "valuation_overvalued": "估值: 高估。价格高于合理价值区间 (${low}-${high})",
    "valuation_deeply_overvalued": "估值: 严重高估。价格远高于合理价值区间 (${low}-${high})",
    "valuation_unavailable": "估值不可用 — 分析师预估数据不足",
    "valuation_eps": "FY1每股收益: ${fy1_eps}, FY2每股收益: ${fy2_eps} (增长 {growth_pct}%)",
    "valuation_eps_no_growth": "FY1每股收益: ${fy1_eps} (FY2预估不可用)",

    "macro_calm": "宏观: VIX {vix} — 市场平静。低波动有利于风险偏好型配置",
    "macro_normal": "宏观: VIX {vix} — 正常水平",
    "macro_elevated": "宏观: VIX {vix} — 偏高。建议控制仓位",
    "macro_crisis": "宏观: VIX {vix} — 危机水平。风险规避环境，建议防御性配置",
    "macro_vix_unavailable": "宏观: VIX 数据不可用",
    "macro_rates": "10年期美债收益率 {rate}% — {regime}环境",
    "macro_haircut": "宏观条件导致合理价值折扣 {pct}%",

    "playbook_strong_buy": "策略: 强烈买入 — {rationale}",
    "playbook_defensive_buy": "策略: 防御性买入 — {rationale}",
    "playbook_hold_watch": "策略: 持有观望 — {rationale}",
    "playbook_reduce": "策略: 减仓 — {rationale}",
    "playbook_stop_loss": "策略: 止损 — {rationale}",

    "confidence": "分析置信度: {grade} ({score}/100)。{reasons}",
}

TEMPLATES: dict[str, dict[str, str]] = {"en": EN, "zh": ZH}
