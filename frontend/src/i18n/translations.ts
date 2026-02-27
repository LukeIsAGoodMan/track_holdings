/**
 * i18n translation dictionary.
 * Keys are semantic identifiers; values are { en, zh } pairs.
 */
export type Lang = 'en' | 'zh'

export const TRANSLATIONS = {
  // ── Navigation ──────────────────────────────────────────────────────────
  nav_holdings:    { en: 'Holdings',       zh: '持仓' },
  nav_trade:       { en: 'Trade Entry',    zh: '录入交易' },
  nav_risk:        { en: 'Risk Dashboard', zh: '风险仪表盘' },

  // ── Holdings page ────────────────────────────────────────────────────────
  holdings_title:  { en: 'Holdings',                zh: '持仓总览' },
  holdings_sub:    { en: 'Live Greeks · Black-Scholes · recursive roll-up',
                     zh: '实时希腊字母 · BS定价 · 递归汇总' },
  cash_balance:    { en: 'Cash Balance',             zh: '现金余额' },
  net_long_cash:   { en: 'NET LONG CASH',            zh: '净多头现金' },
  net_short_cash:  { en: 'NET SHORT CASH',           zh: '净空头现金' },
  no_positions:    { en: 'No active positions. Add a trade via Trade Entry.',
                     zh: '暂无持仓。请在「录入交易」页面添加交易。' },

  // ── Holdings table headers ────────────────────────────────────────────────
  col_type:        { en: 'Type',       zh: '类型' },
  col_strike:      { en: 'Strike',     zh: '行权价' },
  col_expiry:      { en: 'Expiry',     zh: '到期日' },
  col_dte:         { en: 'DTE',        zh: '剩余天' },
  col_net_qty:     { en: 'Net Qty',    zh: '净张数' },
  col_cost:        { en: 'Cost',       zh: '成本' },
  col_delta:       { en: 'Delta',      zh: 'Delta' },
  col_delta_exp:   { en: 'Δ Exposure', zh: 'Delta敞口' },
  col_theta:       { en: 'Θ / day',    zh: 'Θ/天' },
  col_margin:      { en: 'Margin',     zh: '保证金' },
  col_shares:      { en: 'Shares',     zh: '股数' },
  col_mkt_value:   { en: 'Mkt Value',  zh: '市值' },
  col_delta_exposure: { en: 'Δ Exposure', zh: 'Delta敞口' },

  // ── Group header labels ──────────────────────────────────────────────────
  delta_exposure:  { en: 'Δ Exposure',  zh: 'Delta敞口' },
  margin_req:      { en: 'Margin Req.', zh: '保证金要求' },
  cap_efficiency:  { en: 'Eff',         zh: '效率' },

  // ── Risk dashboard ───────────────────────────────────────────────────────
  risk_title:      { en: 'Risk Dashboard',                zh: '风险仪表盘' },
  risk_sub:        { en: 'Real-time Greeks across all positions.',
                     zh: '所有持仓的实时希腊字母汇总。' },
  stat_net_delta:  { en: 'Net Delta (Δ)',   zh: '净Delta (Δ)' },
  stat_gamma:      { en: 'Gamma (Γ)',       zh: 'Gamma (Γ)' },
  stat_theta:      { en: 'Theta / day',     zh: 'Theta/天' },
  stat_vega:       { en: 'Vega (V)',         zh: 'Vega (V)' },
  stat_margin:     { en: 'Margin Req.',      zh: '保证金需求' },
  expiry_dist:     { en: 'Expiry Distribution', zh: '到期分布' },
  delta_contrib:   { en: 'Delta Contribution', zh: 'Delta贡献' },
  sector_exposure: { en: 'Sector Exposure',    zh: '行业暴露' },
  alpha_vs_market: { en: 'Alpha vs Market',    zh: '对比市场' },
  top_efficient:   { en: 'Top Efficient',      zh: '最高效标的' },
  ytd_return:      { en: 'YTD Return',          zh: '年初至今涨幅' },

  // ── Trade entry ──────────────────────────────────────────────────────────
  trade_title:     { en: 'Trade Entry',     zh: '录入交易' },
  trade_sub:       { en: 'TradeEvent + CashLedger written atomically.',
                     zh: 'TradeEvent + CashLedger 原子写入。' },
  action:          { en: 'Action',          zh: '操作' },
  instrument:      { en: 'Instrument',      zh: '资产类型' },
  symbol:          { en: 'Symbol',          zh: '标的代码' },
  option_type:     { en: 'Option Type',     zh: '期权类型' },
  strike:          { en: 'Strike ($)',      zh: '行权价 ($)' },
  expiry:          { en: 'Expiry',          zh: '到期日' },
  quantity:        { en: 'Quantity',        zh: '数量' },
  price:           { en: 'Price / share',   zh: '价格 / 股' },
  notes:           { en: 'Notes',           zh: '备注' },
  record_trade:    { en: 'Record Trade',    zh: '记录交易' },
  recording:       { en: 'Recording…',     zh: '记录中…' },

  // ── Coach UI ──────────────────────────────────────────────────────────────
  coach_section:   { en: 'Trading Coach',        zh: '交易教练' },
  coach_confidence:{ en: 'Confidence',            zh: '信心评级' },
  coach_reason:    { en: 'Trade Reason',          zh: '交易理由' },
  coach_support:   { en: 'Near support level?',   zh: '接近支撑位？' },
  coach_reason_ph: { en: 'e.g. IV rank high, wheel strategy, support at 580',
                     zh: '例：IV rank偏高，Wheel策略，支撑位在580' },

  // ── Capital Efficiency ────────────────────────────────────────────────────
  capital_efficiency: { en: 'Capital Efficiency', zh: '资本效率' },

  // ── Scenario simulation / Stress Test ────────────────────────────────────
  scenario_sim:   { en: 'Scenario Simulation',    zh: '情景模拟' },
  stress_test:    { en: 'Stress Test',             zh: '压力测试' },
  price_shift:    { en: 'Price Shift',             zh: '价格偏移' },
  iv_shift:       { en: 'IV Shift (pp)',           zh: '波动率偏移 (pp)' },
  est_pnl:        { en: 'Est. PnL',               zh: '预估盈亏' },
  pnl_formula:    { en: 'Δ×ΔP + ½Γ×ΔP² + V×ΔIV', zh: 'Δ×ΔP + ½Γ×ΔP² + V×ΔIV' },
  by_symbol:      { en: 'By Symbol',              zh: '分标的' },

  // ── Risk alerts ───────────────────────────────────────────────────────────
  risk_alerts:    { en: 'Risk Alerts',             zh: '风险预警' },
  no_alerts:      { en: 'No critical gamma concentrations detected.',
                    zh: '未检测到严重的Gamma集中风险。' },

  // ── Alpha Dashboard (NLV vs benchmark chart) ──────────────────────────────
  alpha_dashboard:  { en: 'Alpha Dashboard',               zh: 'Alpha仪表盘' },
  nlv_chart:        { en: 'NLV vs Benchmark',              zh: '净值 vs 基准' },
  add_benchmark:    { en: 'Add',                           zh: '添加' },
  benchmark_search: { en: 'Symbol (e.g. TSLA, BTC-USD)…', zh: '代码（如 TSLA、BTC-USD）…' },
  alpha_relative:   { en: 'Alpha vs SPY',                  zh: 'Alpha vs SPY' },
  sharpe_ratio:     { en: 'Sharpe Ratio',                  zh: '夏普比率' },
  no_history:       { en: 'No trade history yet. Record your first trade to begin tracking.',
                       zh: '暂无交易历史。录入第一笔交易后开始追踪净值曲线。' },
  nlv_normalized:   { en: 'Index · first trade = 100',    zh: '指数 · 首笔交易日=100' },
  indicative:       { en: '(indicative, limited history)',  zh: '（参考值，历史较短）' },

  // ── Lifecycle / settlement ────────────────────────────────────────────────
  settled_history:  { en: 'Settlement History',          zh: '结算记录' },
  no_settled:       { en: 'No settled positions yet.',   zh: '暂无结算记录。' },
  settled_status:   { en: 'Status',                      zh: '状态' },
  settled_assign:   { en: 'Auto-Assignment',             zh: '自动指派' },
  settled_date:     { en: 'Settled',                     zh: '结算日期' },
  lifecycle_notice: { en: 'Auto-settled on startup',     zh: '启动时自动结算' },
  settled_premium:  { en: 'Premium',                     zh: '权利金' },
  settled_eff_cost: { en: 'Eff. Cost',                   zh: '有效成本' },
  settled_24h:      { en: 'Last 24h',                    zh: '最近24h' },
  settled_all_hist: { en: 'All',                         zh: '全部' },

  // ── P&L Attribution ───────────────────────────────────────────────────────
  pnl_attribution:   { en: 'P&L Attribution',             zh: '盈亏归因' },
  attr_time_decay:   { en: 'Time Decay (Theta)',           zh: '时间价值 (Theta)' },
  attr_directional:  { en: 'Directional (Delta/Gamma)',    zh: '方向性 (Delta/Gamma)' },
  attr_total:        { en: 'Total Unrealized',             zh: '未实现总盈亏' },
  attr_cost_basis:   { en: 'Cost Basis',                   zh: '成本基础' },
  attr_empty:        { en: 'No open positions to attribute.',
                        zh: '暂无持仓数据。' },
  attr_subtitle:     { en: 'Theta income vs delta/gamma move — BS estimated, indicative',
                        zh: 'Theta收益 vs Delta/Gamma价差 — BS估算，仅供参考' },

  // ── Strategy tagging ──────────────────────────────────────────────────────
  strategy_label:  { en: 'Strategy',       zh: '策略' },
  strat_single:    { en: 'Single',         zh: '单腿' },
  strat_vertical:  { en: 'Vertical',       zh: '价差' },
  strat_straddle:  { en: 'Straddle',       zh: '跨式' },
  strat_strangle:  { en: 'Strangle',       zh: '宽跨式' },
  strat_condor:    { en: 'Iron Condor',    zh: '铁鹰' },
  strat_calendar:  { en: 'Calendar',       zh: '日历价差' },
  strat_custom:    { en: 'Custom',         zh: '自定义' },

  // ── Risk Weather (VaR) ────────────────────────────────────────────────────
  risk_weather:    { en: 'Risk Weather',         zh: '风险天气' },
  var_1d_95:       { en: '1-Day 95% VaR',        zh: '1日95%风险值' },
  var_subtitle:    { en: 'Max expected daily loss at 95% confidence · delta-normal',
                     zh: '95%置信度下最大预期日亏损 · Delta正态法' },
  var_sunny:       { en: 'Sunny — low risk',      zh: '晴天 — 低风险' },
  var_cloudy:      { en: 'Cloudy — moderate risk', zh: '多云 — 中等风险' },
  var_stormy:      { en: 'Stormy — elevated risk', zh: '风暴 — 高风险' },
  var_thunder:     { en: 'Thunderstorm — critical', zh: '雷暴 — 极高风险' },
  var_no_data:     { en: 'No positions — no market risk.', zh: '无持仓，无市场风险。' },

  // ── IV Skew scenario ──────────────────────────────────────────────────────
  iv_skew_toggle:  { en: 'IV Skew (panic vol)',   zh: 'IV偏斜（恐慌波动率）' },
  iv_skew_hint:    { en: 'On down moves, auto-adds panic vol: |ΔP%| × 50pp',
                     zh: '下跌时自动增加恐慌波动率：|ΔP%| × 50pp' },

  // ── Insights ─────────────────────────────────────────────────────────────
  insights_title:  { en: 'AI Coach Context',      zh: 'AI教练上下文' },
  insights_posture:{ en: 'Risk Posture',           zh: '风险姿态' },
  insights_hint:   { en: 'Natural Language Hint',  zh: '自然语言摘要' },
  dominant_risk:   { en: 'Dominant Risk',          zh: '主导风险' },

  // ── One-click close ───────────────────────────────────────────────────────
  close_position:  { en: 'Exit',           zh: '平仓' },
  closing_mode:    { en: 'Closing Mode',   zh: '平仓模式' },
  closing_mode_desc: { en: 'Form is pre-filled. Enter the current market price and confirm.',
                        zh: '表单已预填。请输入当前市价后确认。' },

  // ── Clipboard import (smart parser) ──────────────────────────────────────
  clipboard_import:    { en: 'Clipboard Import',         zh: '剪贴板解析' },
  clipboard_ph:        { en: 'Paste trade confirmation — e.g. "STO 2 NVDA 600P 01/17/2026 @ 5.50" or an OCC ticker like "NVDA260117P00600000"',
                          zh: '粘贴成交单 — 如 "STO 2 NVDA 600P 01/17/2026 @ 5.50" 或 OCC格式 "NVDA260117P00600000"' },
  clipboard_apply:     { en: 'Apply to Form',            zh: '填入表单' },
  clipboard_clear:     { en: 'Clear',                    zh: '清空' },
  clipboard_result:    { en: 'Parsed Result',            zh: '解析结果' },
  clipboard_confidence:{ en: 'Confidence',               zh: '置信度' },
  clipboard_no_match:  { en: 'Could not parse — try: STO 1 NVDA 600P 01/17/2026 @ 5.50',
                          zh: '无法识别 — 请尝试：STO 1 NVDA 600P 01/17/2026 @ 5.50' },
  clipboard_low:       { en: 'Low confidence — verify fields before applying',
                          zh: '置信度较低 — 请在填入前核对字段' },
  clipboard_hint:      { en: 'Supported: OCC ticker · STO/BTO/BTC/STC · "Sell to open" · "-1 NVDA 600P …"',
                          zh: '支持：OCC格式 · STO/BTO/BTC/STC缩写 · "Sell to open"短语 · "-1 NVDA 600P …"' },
} as const

export type TKey = keyof typeof TRANSLATIONS
