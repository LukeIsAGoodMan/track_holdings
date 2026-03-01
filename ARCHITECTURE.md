# Track Holdings — Architecture Reference

## System Overview

```
Browser (React 19 + Vite)                  Backend (FastAPI + SQLite)
────────────────────────────               ────────────────────────────────
React Router SPA                           Async SQLAlchemy ORM
  ├── LoginPage (public)                   SQLite (aiosqlite)
  ├── ProtectedRoute guard                 yfinance (live spot + hist-vol)
  │   ├── HoldingsPage                     anthropic SDK (Claude Haiku)
  │   ├── RiskPage + CoachPanel            PyJWT (HS256 auth)
  │   └── TradeEntryPage                   hashlib PBKDF2-SHA256 (passwords)
  │                                                │
  ▼  Axios + Bearer JWT (/api/*)                    ▼
    Vite dev proxy → http://localhost:8001
```

---

## API Endpoints

> **Auth requirement:** All endpoints below (except Auth) require `Authorization: Bearer <JWT>` header. The Coach SSE endpoint also accepts `?token=<JWT>` query param (EventSource limitation).

### Auth

| Method | Path | Body | Response | Description |
|--------|------|------|----------|-------------|
| POST | `/api/auth/register` | `{username, password}` | `TokenResponse` (201) | Create user; first user inherits orphan data |
| POST | `/api/auth/login` | `{username, password}` | `TokenResponse` (200) | Validate credentials, return JWT |

`TokenResponse`: `{access_token, token_type, user_id, username}`

### Portfolios

| Method | Path | Query | Response | Description |
|--------|------|-------|----------|-------------|
| GET | `/api/portfolios` | — | `Portfolio[]` | Full tree (parent + children) |
| POST | `/api/portfolios` | — | `Portfolio` | Create portfolio |

### Holdings

| Method | Path | Query | Response | Description |
|--------|------|-------|----------|-------------|
| GET | `/api/holdings` | `portfolio_id?` | `HoldingGroup[]` | Positions grouped by symbol; includes `strategy_type`, `strategy_label`, per-leg Greeks |

`HoldingGroup` includes: `symbol`, `underlying_price`, `strategy_type` (SINGLE/VERTICAL/STRADDLE/STRANGLE/IRON_CONDOR/CALENDAR/CUSTOM), `strategy_label` (e.g. "Bull Put Spread"), `net_contracts`, `option_legs[]`, `stock_legs[]`

### Trades

| Method | Path | Query | Response | Description |
|--------|------|-------|----------|-------------|
| POST | `/api/trades` | — | `TradeResponse` | Create trade; auto-creates Instrument + CashLedger entry |

### Risk

| Method | Path | Query | Response | Description |
|--------|------|-------|----------|-------------|
| GET | `/api/risk/dashboard` | `portfolio_id?` | `RiskDashboard` | Greeks aggregates, expiry buckets, VaR, sector exposure, benchmark YTD, risk alerts |
| GET | `/api/risk/scenario` | `portfolio_id?`, `price_change_pct`, `vol_change_ppt` | `ScenarioResult` | 2nd-order Taylor PnL estimate per symbol |
| GET | `/api/risk/attribution` | `portfolio_id?` | `AttributionResponse` | Per-position theta decay vs directional P&L split |
| GET | `/api/risk/history` | `portfolio_id?`, `benchmarks` | `AccountHistoryResponse` | Daily NLV index (100 at first trade date) vs SPY/QQQ/custom |
| GET | `/api/risk/insights` | `portfolio_id?` | `PortfolioInsight` | LLM-ready risk descriptor: Greeks, risk posture, strategy mix, top positions, VaR, natural_language_hint |

### Coach (AI)

| Method | Path | Query | Response | Description |
|--------|------|-------|----------|-------------|
| GET | `/api/coach/analyze` | `portfolio_id?`, `include_weekly?` | SSE stream | Claude Haiku diagnosis; streams `{t:"chunk",v:"..."}` then `{t:"done",assessment,weakness,steps[],weekly}` |

### Cash

| Method | Path | Query | Response | Description |
|--------|------|-------|----------|-------------|
| GET | `/api/cash` | `portfolio_id?` | `CashSummary` | Running balance + 50 most-recent ledger entries |

### Lifecycle

| Method | Path | Query | Response | Description |
|--------|------|-------|----------|-------------|
| POST | `/api/lifecycle/process` | — | `LifecycleResult` | Sweep expired options → EXPIRED/ASSIGNED + auto-stock trade + cash entry |
| GET | `/api/lifecycle/settled` | `portfolio_id?`, `since_hours?` | `SettledTradesResponse` | Settled option trades; ASSIGNED rows include `premium_per_share`, `effective_cost_per_share` |

---

## Data Model (SQLite Tables)

```
users
  id, username (unique, indexed), hashed_password, created_at

portfolios
  id, name, description, parent_id (self-ref), user_id → users (nullable), created_at

instruments
  id, symbol, instrument_type (STOCK|OPTION), strike, expiry,
  option_type (CALL|PUT), multiplier (1|100), tags (JSON)
  UNIQUE: (symbol, strike, expiry, option_type)
  [NO user_id — shared deduplication registry]

trade_events
  id, portfolio_id → portfolios, instrument_id → instruments
  user_id → users (nullable)
  action (SELL_OPEN|BUY_OPEN|BUY_CLOSE|SELL_CLOSE)
  quantity (always +), price (per share)
  status (ACTIVE|EXPIRED|ASSIGNED|CLOSED), trade_date, closed_date
  underlying_price_at_trade, notes, trade_metadata (JSON)

cash_ledger
  id, portfolio_id, trade_event_id (nullable), user_id → users (nullable),
  amount (signed), description, created_at
  [APPEND-ONLY — never updated; balance = SUM(amount)]
```

> **Note:** `user_id` columns are `nullable=True` due to SQLite ALTER TABLE limitation. Non-null enforced at application level. The `instruments` table has NO `user_id` — instruments are a shared lookup registry.

---

## Frontend State Tree

### AuthContext (global, outermost — `src/context/AuthContext.tsx`)

```typescript
{
  user:     { user_id: number; username: string } | null
  token:    string | null
  loading:  boolean       // true during initial localStorage restore
  login:    (username, password) => Promise<void>
  register: (username, password) => Promise<void>
  logout:   () => void    // clears localStorage + redirects to /login
}
```

Persistence: `localStorage` keys `th_token` (JWT) and `th_user` (JSON `{user_id, username}`). Restored on mount.

### ProtectedRoute (`src/components/common/ProtectedRoute.tsx`)

Wraps all authenticated routes. If `token` is null → `<Navigate to="/login">`. If `loading` → renders nothing (prevents flash).

### PortfolioContext (global, in `src/context/PortfolioContext.tsx`)

```typescript
{
  portfolios:             Portfolio[]     // full tree from GET /api/portfolios
  selectedPortfolioId:   number | null   // drives all API calls; auto-selects first leaf
  setSelectedPortfolioId:(id) => void
  refreshKey:             number          // increments on triggerRefresh()
  triggerRefresh:         () => void      // causes all useEffect([refreshKey]) to re-fetch
  loading:                boolean
}
```

### LanguageContext (global, `src/context/LanguageContext.tsx`)
```typescript
{ lang: 'en' | 'zh'; setLang: (l) => void; t: (key: string) => string }
```

### Page-Level State (not shared)

**HoldingsPage**: `holdings[]`, `cash`, `lifecycleResult`, `loading`, `error`
**RiskPage**: `dashboard`, `holdings[]`, `loading`, `error`
**TradeEntryPage**: form fields + `ClosePositionState` (from react-router state)
**CoachPanel**: `open`, `streamText`, `result`, `streaming`, `includeWeekly`, `error`

---

## Service Layer (backend)

| File | Exports | Purpose |
|------|---------|---------|
| `services/position_engine.py` | `calculate_positions()`, `collect_portfolio_ids()` | Replay TradeEvents → signed net positions + cost basis |
| `services/black_scholes.py` | `calculate_greeks()`, `calculate_option_price()`, `maintenance_margin()`, `get_hist_vol()` | All pricing math; pure Python, no scipy |
| `services/strategy_recognizer.py` | `identify_strategy(legs)` | Classify multi-leg structures → SINGLE/VERTICAL/etc. |
| `services/lifecycle.py` | `process_expired_trades()` | Settlement sweep; premium-to-cost-basis transfer |
| `services/yfinance_client.py` | `get_spot_price()`, `get_hist_vol()` | Async yfinance wrapper with caching |
| `services/auth.py` | `hash_password()`, `verify_password()`, `create_access_token()`, `decode_access_token()` | PBKDF2-SHA256 hashing + PyJWT HS256 token ops |
| `services/portfolio_resolver.py` | `resolve_portfolio_ids()` | Centralized user-scoped portfolio ownership check + BFS subtree |
| `services/seed.py` | `run_seed()`, `assign_orphan_data()` | Idempotent seed + migrate orphan rows to first user |

---

## Key Design Patterns

- **Immutable event log**: TradeEvents are never updated (only status/closed_date); all state derived by replay
- **Append-only cash ledger**: Balance = `SUM(amount)`; full audit trail
- **Portfolio hierarchy BFS**: `collect_portfolio_ids(root)` returns root + all descendants for roll-up queries
- **SSE streaming**: `/api/coach/analyze` uses `StreamingResponse(text/event-stream)`; frontend uses native `EventSource`
- **Frontend proxy**: Vite dev server proxies `/api/*` → `http://localhost:8001` (no CORS issues in dev)
- **Per-user isolation**: Every router uses `Depends(get_current_user)` + `resolve_portfolio_ids(db, user.id, ...)` as a gatekeeper; no cross-user data leakage possible
- **Dual-mode SSE auth**: `get_current_user_flexible` dependency accepts Bearer header OR `?token=` query param (EventSource cannot set headers)
- **Orphan migration**: `assign_orphan_data(db, user_id)` — on first user registration, UPDATE all rows WHERE user_id IS NULL
