/**
 * Typed API functions — one function per backend endpoint.
 * All return the raw data shape from types/index.ts.
 */
import api from './client'
import type {
  Portfolio,
  HoldingGroup,
  TradeCreate,
  TradeResponse,
  RiskDashboard,
  ScenarioResult,
  CashSummary,
  AccountHistoryResponse,
  AttributionResponse,
  LifecycleResult,
  SettledTradesResponse,
  PortfolioInsight,
  MarketOpportunity,
  Alert,
  AlertCreate,
  AlertStatus,
  PortfolioHistoryResponse,
  MarketQuote,
  Transaction,
  SymbolSuggestion,
} from '@/types'

// ── Portfolios ────────────────────────────────────────────────────────────────

/** GET /api/portfolios → nested tree */
export const fetchPortfolios = (): Promise<Portfolio[]> =>
  api.get<Portfolio[]>('/portfolios').then((r) => r.data)

/** POST /api/portfolios */
export const createPortfolio = (body: {
  name: string
  description?: string
  parent_id?: number | null
  is_folder?: boolean
}): Promise<Portfolio> =>
  api.post<Portfolio>('/portfolios', body).then((r) => r.data)

/** PATCH /api/portfolios/reorder — batch sort_order update for siblings */
export const batchReorderPortfolios = (
  items: { id: number; sort_order: number }[],
): Promise<void> =>
  api.patch('/portfolios/reorder', items).then(() => undefined)

/** PATCH /api/portfolios/{id}/move — parent reassignment + sibling sort */
export const movePortfolio = (
  id:         number,
  parentId:   number | null,
  sortOrder:  number = 0,
): Promise<Portfolio> =>
  api
    .patch<Portfolio>(`/portfolios/${id}/move`, { parent_id: parentId, sort_order: sortOrder })
    .then((r) => r.data)

// ── Holdings ──────────────────────────────────────────────────────────────────

/** GET /api/holdings[?portfolio_id=N] */
export const fetchHoldings = (portfolioId?: number | null): Promise<HoldingGroup[]> =>
  api
    .get<HoldingGroup[]>('/holdings', {
      params: portfolioId != null ? { portfolio_id: portfolioId } : undefined,
    })
    .then((r) => r.data)

// ── Trades ────────────────────────────────────────────────────────────────────

/** POST /api/trades */
export const createTrade = (body: TradeCreate): Promise<TradeResponse> =>
  api.post<TradeResponse>('/trades', body).then((r) => r.data)

// ── Risk dashboard ────────────────────────────────────────────────────────────

/** GET /api/risk/dashboard[?portfolio_id=N] */
export const fetchRiskDashboard = (portfolioId?: number | null): Promise<RiskDashboard> =>
  api
    .get<RiskDashboard>('/risk/dashboard', {
      params: portfolioId != null ? { portfolio_id: portfolioId } : undefined,
    })
    .then((r) => r.data)

// ── Scenario engine ───────────────────────────────────────────────────────────

/** GET /api/risk/scenario — 2nd-order Taylor expansion PnL estimate */
export const fetchScenario = (
  portfolioId:    number | null | undefined,
  priceChangePct: number,   // e.g. -0.15 for -15%
  volChangePpt:   number,   // e.g. 20 for +20 vol-points
): Promise<ScenarioResult> =>
  api
    .get<ScenarioResult>('/risk/scenario', {
      params: {
        ...(portfolioId != null ? { portfolio_id: portfolioId } : {}),
        price_change_pct: priceChangePct,
        vol_change_ppt:   volChangePpt,
      },
    })
    .then((r) => r.data)

// ── Cash ──────────────────────────────────────────────────────────────────────

/** GET /api/cash[?portfolio_id=N] */
export const fetchCash = (portfolioId?: number | null): Promise<CashSummary> =>
  api
    .get<CashSummary>('/cash', {
      params: portfolioId != null ? { portfolio_id: portfolioId } : undefined,
    })
    .then((r) => r.data)

// ── Alpha Dashboard — account NLV vs benchmark history ───────────────────────

/**
 * GET /api/risk/history
 * Returns normalized NLV index for the account + each benchmark.
 * Both start at 100 at the account's first trade date.
 * `benchmarks` is a comma-separated list, e.g. "SPY,QQQ,NVDA".
 */
// ── Lifecycle automation ──────────────────────────────────────────────────────

/**
 * POST /api/lifecycle/process
 * Triggers the expired-option settlement sweep.
 * Returns a summary of what was settled.
 */
export const triggerLifecycle = (): Promise<LifecycleResult> =>
  api.post<LifecycleResult>('/lifecycle/process').then((r) => r.data)

/** GET /api/lifecycle/settled[?portfolio_id=N&since_hours=N] */
export const fetchSettledTrades = (
  portfolioId?: number | null,
  sinceHours?: number | null,
): Promise<SettledTradesResponse> =>
  api
    .get<SettledTradesResponse>('/lifecycle/settled', {
      params: {
        ...(portfolioId != null ? { portfolio_id: portfolioId } : {}),
        ...(sinceHours != null ? { since_hours: sinceHours } : {}),
      },
    })
    .then((r) => r.data)

// ── P&L Attribution ───────────────────────────────────────────────────────────

/** GET /api/risk/attribution[?portfolio_id=N] */
export const fetchAttribution = (portfolioId?: number | null): Promise<AttributionResponse> =>
  api
    .get<AttributionResponse>('/risk/attribution', {
      params: portfolioId != null ? { portfolio_id: portfolioId } : undefined,
    })
    .then((r) => r.data)

// ── LLM-Ready Portfolio Insights ─────────────────────────────────────────────

/** GET /api/risk/insights[?portfolio_id=N] */
export const fetchInsights = (portfolioId?: number | null): Promise<PortfolioInsight> =>
  api
    .get<PortfolioInsight>('/risk/insights', {
      params: portfolioId != null ? { portfolio_id: portfolioId } : undefined,
    })
    .then((r) => r.data)

// ── Alpha Dashboard — account NLV vs benchmark history ───────────────────────

// ── Market Scanner ──────────────────────────────────────────────────────────

/** GET /api/scanner/opportunities */
export const fetchOpportunities = (): Promise<MarketOpportunity[]> =>
  api.get<MarketOpportunity[]>('/scanner/opportunities').then((r) => r.data)

// ── Alpha Dashboard — account NLV vs benchmark history ───────────────────────

// ── Alerts ────────────────────────────────────────────────────────────────────

/** GET /api/alerts */
export const fetchAlerts = (): Promise<Alert[]> =>
  api.get<Alert[]>('/alerts').then((r) => r.data)

/** POST /api/alerts */
export const createAlert = (body: AlertCreate): Promise<Alert> =>
  api.post<Alert>('/alerts', body).then((r) => r.data)

/** PATCH /api/alerts/:id */
export const updateAlert = (
  id: number,
  body: Partial<AlertCreate & { status: AlertStatus }>,
): Promise<Alert> =>
  api.patch<Alert>(`/alerts/${id}`, body).then((r) => r.data)

/** DELETE /api/alerts/:id */
export const deleteAlert = (id: number): Promise<void> =>
  api.delete(`/alerts/${id}`)

// ── Alpha Dashboard — account NLV vs benchmark history ───────────────────────

// ── Portfolio History (Phase 13) ─────────────────────────────────────────────

/** GET /api/portfolio/history[?portfolio_id=N&days=N] */
export const fetchPortfolioHistory = (
  portfolioId?: number | null,
  days = 30,
): Promise<PortfolioHistoryResponse> =>
  api
    .get<PortfolioHistoryResponse>('/portfolio/history', {
      params: {
        ...(portfolioId != null ? { portfolio_id: portfolioId } : {}),
        days,
      },
    })
    .then((r) => r.data)

// ── Transaction History ───────────────────────────────────────────────────────

/** GET /api/portfolios/{id}/trades */
export const fetchTransactionHistory = (portfolioId: number): Promise<Transaction[]> =>
  api.get<Transaction[]>(`/portfolios/${portfolioId}/trades`).then((r) => r.data)

// ── Market Quotes (SPY / QQQ / DIA / VIX) ────────────────────────────────────

/** GET /api/market/quotes?symbols=SPY,QQQ,DIA,VIX */
export const fetchMarketQuotes = (symbols: string[]): Promise<MarketQuote[]> =>
  api
    .get<MarketQuote[]>('/market/quotes', { params: { symbols: symbols.join(',') } })
    .then((r) => r.data)

// ── Alpha Dashboard — account NLV vs benchmark history ───────────────────────

export const fetchAccountHistory = (
  portfolioId: number | null | undefined,
  benchmarks:  string[],
): Promise<AccountHistoryResponse> =>
  api
    .get<AccountHistoryResponse>('/risk/history', {
      params: {
        ...(portfolioId != null ? { portfolio_id: portfolioId } : {}),
        benchmarks: benchmarks.join(','),
      },
    })
    .then((r) => r.data)

// ── Symbol search & validation (Phase 14.5) ───────────────────────────────────

/** PATCH /api/portfolios/{id} — rename */
export const updatePortfolioName = (id: number, name: string): Promise<Portfolio> =>
  api.patch<Portfolio>(`/portfolios/${id}`, { name }).then((r) => r.data)

/** DELETE /api/portfolios/{id} — cascade delete subtree */
export const deletePortfolio = (id: number): Promise<void> =>
  api.delete(`/portfolios/${id}`).then(() => undefined)

/** GET /api/symbols/search?q=NVD → up to 5 SymbolSuggestion */
export const searchSymbols = (q: string): Promise<SymbolSuggestion[]> =>
  api.get<SymbolSuggestion[]>('/symbols/search', { params: { q } }).then((r) => r.data)

/** GET /api/symbols/validate/{symbol} → {valid, symbol, type, name} */
export const validateSymbol = (symbol: string): Promise<{ valid: boolean; symbol: string; type: string; name: string }> =>
  api.get<{ valid: boolean; symbol: string; type: string; name: string }>(`/symbols/validate/${encodeURIComponent(symbol)}`).then((r) => r.data)
