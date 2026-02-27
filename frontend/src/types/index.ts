/**
 * TypeScript interfaces mirroring the backend Pydantic schemas.
 *
 * Monetary fields (DecStr on the backend) arrive as strings in JSON.
 * Use the format helpers in utils/format.ts to display them.
 */

// ── Portfolio hierarchy ───────────────────────────────────────────────────────
export interface Portfolio {
  id:                   number
  name:                 string
  description:          string | null
  parent_id:            number | null
  total_cash:           string   // DecStr
  total_delta_exposure: string   // DecStr
  total_margin:         string   // DecStr
  children:             Portfolio[]
}

// ── Holdings ──────────────────────────────────────────────────────────────────
export interface OptionLeg {
  instrument_id:      number
  option_type:        'CALL' | 'PUT'
  strike:             string          // DecStr
  expiry:             string          // ISO date "2026-12-18"
  days_to_expiry:     number
  net_contracts:      number          // signed: negative = short
  avg_open_price:     string          // DecStr — premium per share at open

  // Greeks (null when market data unavailable)
  delta:              string | null   // long-unit delta
  gamma:              string | null
  theta:              string | null   // per calendar day
  vega:               string | null   // per 1% vol

  // Position-level exposure
  delta_exposure:     string | null   // net_contracts × delta × 100
  maintenance_margin: string          // 20% × strike × 100 × |short_contracts|
}

export interface StockLeg {
  instrument_id:  number
  net_shares:     number          // signed: positive = long, negative = short
  avg_open_price: string          // DecStr — cost basis per share
  delta_exposure: string          // DecStr = net_shares (1 share = 1Δ)
  market_value:   string | null   // DecStr = spot × net_shares
}

export interface HoldingGroup {
  symbol:                   string
  spot_price:               string | null   // DecStr
  option_legs:              OptionLeg[]
  stock_legs:               StockLeg[]      // stocks/ETFs in same underlying
  total_delta_exposure:     string           // DecStr (options + stocks combined)
  total_maintenance_margin: string           // DecStr
  total_theta_daily:        string           // DecStr — signed, positive = earning theta
  capital_efficiency:       string | null    // DecStr fraction; multiply × 100 for %
  strategy_type:            string           // SINGLE | VERTICAL | STRADDLE | STRANGLE | IRON_CONDOR | CALENDAR | CUSTOM
  strategy_label:           string           // Human-readable, e.g. "Bull Put Spread"
}

// ── Trades ───────────────────────────────────────────────────────────────────
export type TradeAction   = 'SELL_OPEN' | 'BUY_OPEN' | 'BUY_CLOSE' | 'SELL_CLOSE'
export type InstrumentType = 'STOCK' | 'OPTION'
export type OptionType     = 'CALL' | 'PUT'

export interface TradeCreate {
  portfolio_id:               number
  symbol:                     string
  instrument_type:            InstrumentType
  option_type?:               OptionType | null
  strike?:                    string | null    // send as string; backend uses Decimal
  expiry?:                    string | null    // ISO date
  action:                     TradeAction
  quantity:                   number
  price:                      string           // send as string
  underlying_price_at_trade?: string | null
  notes?:                     string | null
  // Trading Coach fields
  confidence_score?:          number | null    // 1–5
  trade_reason?:              string | null
}

export interface TradeResponse {
  id:                   number
  portfolio_id:         number
  instrument_id:        number
  symbol:               string
  option_type:          string | null
  strike:               string | null   // DecStr
  expiry:               string | null
  action:               string
  quantity:             number
  price:                string          // DecStr
  cash_impact:          string          // DecStr — signed
  net_contracts_after:  number
  trade_date:           string          // ISO datetime
}

// ── Risk dashboard ────────────────────────────────────────────────────────────
export interface ExpiryBucket {
  label:         string   // "≤7d" | "8-30d" | "31-90d" | ">90d"
  net_contracts: number
  delta_exposure: string  // DecStr
}

export interface BenchmarkYTD {
  symbol:     string
  ytd_return: string | null   // DecStr fraction, e.g. "0.052" = +5.2%
}

export interface RiskDashboard {
  total_net_delta:          string   // DecStr
  total_gamma:              string
  total_theta_daily:        string
  total_vega:               string
  maintenance_margin_total: string
  expiry_buckets:           ExpiryBucket[]
  positions_count:          number
  as_of:                    string   // ISO datetime
  top_efficient_symbol:     string | null
  sector_exposure:          Record<string, string>  // tag → delta exposure DecStr
  benchmark_ytd:            BenchmarkYTD[]
  risk_alerts:              string[]  // human-readable gamma crash warnings
  var_1d_95:                string | null  // DecStr — 1-day 95% VaR (positive = max expected loss)
}

// ── LLM-Ready Portfolio Insights ──────────────────────────────────────────────
export interface PortfolioInsight {
  portfolio_id:          number | null
  as_of:                 string
  greeks_summary:        { net_delta: number; net_gamma: number; net_theta: number; net_vega: number }
  risk_posture:          string   // e.g. "short_gamma_positive_theta"
  dominant_risk:         string   // "delta" | "gamma" | "vega" | "theta"
  var_1d_95:             number | null
  strategy_mix:          Record<string, number>  // strategy_type → count
  top_positions:         Array<{ symbol: string; strategy_label: string; delta_exposure: number; theta_daily: number; margin: number }>
  risk_alerts:           string[]
  natural_language_hint: string
}

// ── Scenario engine ───────────────────────────────────────────────────────────
export interface ScenarioPnL {
  symbol:        string
  estimated_pnl: string  // DecStr — signed dollar estimate
}

export interface ScenarioResult {
  price_change_pct: number
  vol_change_ppt:   number
  estimated_pnl:    string  // DecStr — total signed dollar estimate
  by_symbol:        ScenarioPnL[]
  as_of:            string
}

// ── Alpha Dashboard — account NLV vs benchmark history ───────────────────────
export interface AccountHistoryResponse {
  dates:        string[]                    // ISO dates, ascending
  account:      number[]                    // NLV index; 100 = first trade date
  benchmarks:   Record<string, number[]>   // symbol → normalized price series
  alpha_vs_spy: number | null              // account return − SPY return (pp)
  sharpe_ratio: number | null              // simplified annualized Sharpe
  first_date:   string | null
}

// ── P&L Attribution ───────────────────────────────────────────────────────────
export interface AttributionItem {
  symbol:           string
  instrument_type:  string         // "OPTION" | "STOCK"
  option_type:      string | null  // "CALL" | "PUT" | null
  strike:           string | null  // DecStr
  expiry:           string | null  // ISO date
  net_contracts:    number
  cost_basis:       string         // DecStr
  time_decay_pnl:   string         // DecStr (positive = theta income for short)
  directional_pnl:  string         // DecStr (signed delta/gamma component)
  total_unrealized: string         // DecStr (positive = profitable)
}

export interface AttributionResponse {
  items:                  AttributionItem[]
  total_time_decay_pnl:   string  // DecStr
  total_directional_pnl:  string  // DecStr
  total_unrealized:       string  // DecStr
  as_of:                  string  // ISO datetime
}

// ── One-click close — navigation state passed from HoldingsPage → TradeEntry ──
export interface ClosePositionState {
  symbol:         string
  instrumentType: InstrumentType
  optionType?:    OptionType           // undefined for STOCK
  strike?:        string               // raw DecStr from backend, e.g. "600.000000"
  expiry?:        string               // ISO date "2026-01-17"
  action:         'BUY_CLOSE' | 'SELL_CLOSE'
  quantity:       string               // abs(net_contracts) as string
}

// ── Lifecycle automation ──────────────────────────────────────────────────────
export interface LifecycleResult {
  expired:  number
  assigned: number
  skipped:  number
  details:  string[]
}

export interface SettledTrade {
  trade_event_id:    number
  portfolio_id:      number
  symbol:            string
  option_type:       string        // "CALL" | "PUT"
  strike:            string | null // DecStr
  expiry:            string | null
  action:            string        // "SELL_OPEN" | "BUY_OPEN"
  quantity:          number
  status:            string        // "EXPIRED" | "ASSIGNED" | "CLOSED"
  settled_date:      string | null
  // ASSIGNED only
  auto_stock_action:        string | null
  auto_stock_quantity:      number | null
  auto_stock_price:         string | null // DecStr — effective cost basis (premium-adjusted)
  premium_per_share:        string | null // DecStr
  effective_cost_per_share: string | null // DecStr
}

export interface SettledTradesResponse {
  trades: SettledTrade[]
  total:  number
}

// ── Cash ledger ───────────────────────────────────────────────────────────────
export interface CashEntry {
  id:             number
  portfolio_id:   number
  trade_event_id: number | null
  amount:         string          // DecStr — signed
  description:    string | null
  created_at:     string          // ISO datetime
}

export interface CashSummary {
  balance: string       // DecStr
  entries: CashEntry[]
}
