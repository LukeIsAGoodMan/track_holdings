# Track Holdings — Project State

> **Bootstrap instruction for a new session:**
> Read `ARCHITECTURE.md` and `CORE_LOGIC.md` first.
> They contain the complete API surface, data model, and all non-trivial formulas.
> No other files need to be read to understand the global logic.

---

## Project Summary

Options portfolio tracker built across 6 phases (2026-01-xx → 2026-02-28).

| Phase | Theme | Status |
|-------|-------|--------|
| 1 | Core ledger — instruments, trades, portfolios | ✅ Complete |
| 2 | Black-Scholes Greeks engine (stdlib-only, no scipy) | ✅ Complete |
| 3 | Position engine, P&L attribution, NLV history | ✅ Complete |
| 4 | Strategy auto-tagging, Delta-Normal VaR, IV Skew, LLM Insights | ✅ Complete |
| 5 | Lifecycle settlement (premium transfer) + AI Trading Coach (SSE) | ✅ Complete |
| 6 | Multi-user JWT auth, per-user data isolation, login/register UI | ✅ Complete |

---

## Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Backend runtime | **Python 3.14** | No binary wheels (scipy/pandas) — stdlib math only |
| API server | **FastAPI** on port **8001** | `python -m uvicorn app.main:app --port 8001 --reload` |
| Database | **SQLite** (async via aiosqlite) | `backend/track_holdings.db`, auto-seeded on first run |
| AI model | **Claude Haiku** (`claude-haiku-4-5-20251001`) | Streamed SSE via `AsyncAnthropic` |
| Frontend | **React + Vite** on port **5173** | `npm run dev` in `frontend/` |
| Language i18n | English + Chinese (zh) | `frontend/src/i18n/translations.ts` |

---

## Completed Features (Phase 1–5)

### Math / Backend
- **Black-Scholes engine** — delta, gamma, theta, vega using `math.erfc` (no scipy)
- **Delta-Normal VaR** — 1-day 95%, per-symbol uncorrelated sum-of-squares
- **Scenario engine** — 2nd-order Taylor expansion (Δ·ΔS + ½Γ·ΔS² + V·ΔIV)
- **Strategy auto-recognition** — VERTICAL / STRADDLE / IRON_CONDOR / CALENDAR / CUSTOM
- **NLV history** — cumulative cash flows normalized to index-100 at first trade date
- **Alpha vs benchmark** — yfinance SPY/QQQ normalized identically; alpha + Sharpe
- **Lifecycle settlement** — auto-EXPIRED (OTM) and auto-ASSIGNED (ITM) on startup sweep
- **Premium-to-cost-basis transfer** — effective stock price = strike ± weighted avg premium

### Frontend
- **Holdings page** — grouped by strategy, Greeks table, One-Click Close (✕ Exit)
- **Trade Entry** — Smart Parser (clipboard OCC format), close-position amber banner
- **Risk dashboard** — Greeks summary, VaR weather panel, IV Skew scenario, Alpha chart
- **AI Coach panel** — right-side SSE drawer, typewriter stream, structured cards
- **Settlement widget** — 24h / All toggle, premium + effective-cost columns

### Auth & Multi-User (Phase 6)
- **JWT authentication** — PyJWT HS256, 24h expiry, stdlib PBKDF2-SHA256 password hashing (600k iterations)
- **Per-user data isolation** — `user_id` FK on portfolios, trade_events, cash_ledger; all queries scoped
- **Portfolio resolver** — centralized ownership check + BFS subtree resolution for every API call
- **Orphan data migration** — first registered user inherits all pre-existing (NULL user_id) data
- **Login/Register UI** — unified form with EN/ZH i18n, AuthContext + ProtectedRoute guard
- **SSE auth fallback** — EventSource uses `?token=` query param (no custom headers)

---

## Context Index (new session bootstrap)

| File | Contains |
|------|---------|
| `ARCHITECTURE.md` | All 15 API endpoints, SQLite schema, frontend state tree, service layer |
| `CORE_LOGIC.md` | All formulas: B-S Greeks, VaR, Taylor scenario, NLV, lifecycle, cost basis |
| `PROJECT_STATE.md` | This file — phase completion, stack, bootstrap guide |
| `backend/app/routers/` | FastAPI route handlers (one file per domain) |
| `backend/app/services/` | Pure business logic (black_scholes, lifecycle, position_engine, strategy_recognizer, auth, portfolio_resolver) |
| `frontend/src/pages/` | React pages: Holdings, Risk, Trades |
| `backend/tests/` | 83 passing tests (pytest-asyncio, in-memory SQLite) |

---

## Key Runtime Commands

```bash
# Backend (from backend/)
python -m uvicorn app.main:app --port 8001 --reload

# Frontend (from frontend/)
npm run dev

# Tests (from backend/)
python -m pytest tests/ -v

# Cleanliness check (from project root)
python scripts/check_clean.py
```

---

## Critical Gotchas

- Always `python -m uvicorn`, never bare `uvicorn` (miniconda PATH conflict)
- All `SAEnum` columns need `native_enum=False` for SQLite compatibility
- Seed expiry date must be a future date (currently 2026-12-18)
- `STOCK multiplier=1`, `OPTION multiplier=100` — set in `_get_or_create_instrument`
- Greek chars (Δ Γ) in Python f-strings → use ASCII on Windows (GBK encoding)
- Windows `uvicorn --reload` unreliable; kill PID via `python -c "import os,signal; os.kill(PID, signal.SIGTERM)"`
- AI Coach requires `ANTHROPIC_API_KEY` env var on the backend process
- Password hashing uses stdlib `hashlib.pbkdf2_hmac` (PBKDF2-SHA256) — passlib/bcrypt incompatible with Python 3.14
- JWT secret defaults to `"CHANGE-ME-IN-PRODUCTION"` — override via `JWT_SECRET_KEY` env var
- `user_id` columns are `nullable=True` (SQLite ALTER TABLE limitation) — enforced at app level
