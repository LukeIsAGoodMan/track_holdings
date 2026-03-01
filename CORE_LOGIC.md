# Track Holdings — Core Logic & Formulas

> Self-contained reference for all non-trivial mathematical and business logic.
> Read this file before reading source code in a new session.

---

## 1. Black-Scholes Greeks (`services/black_scholes.py`)

### Standard Normal Helpers
```python
# CDF — uses math.erfc (stdlib only, no scipy)
N(x)  =  0.5 * erfc(-x / sqrt(2))
# PDF
n(x)  =  exp(-0.5 * x²) / sqrt(2π)
```

### d1 / d2 Inputs: S=spot, K=strike, T=time-to-expiry (years), r=risk-free, σ=vol
```
d1 = (ln(S/K) + (r + 0.5·σ²)·T) / (σ·√T)
d2 = d1 - σ·√T
```

### Greeks (per 1 long unit, per-share — NOT per contract)

| Greek | Call | Put |
|-------|------|-----|
| **Price** | `S·N(d1) - K·e^(-rT)·N(d2)` | `K·e^(-rT)·N(-d2) - S·N(-d1)` |
| **Delta Δ** | `N(d1)` ∈ [0,+1] | `N(d1) - 1` ∈ [-1,0] |
| **Gamma Γ** | `n(d1) / (S·σ·√T)` | same |
| **Theta Θ** (per calendar day) | `(-S·n(d1)·σ/(2√T) - r·K·e^(-rT)·N(d2)) / 365` | `(-S·n(d1)·σ/(2√T) + r·K·e^(-rT)·N(-d2)) / 365` |
| **Vega V** (per 1% vol) | `S·n(d1)·√T / 100` | same |

**Expired option (T ≤ 0):**
```
Call price = max(S - K, 0)   Put price = max(K - S, 0)
All Greeks = 0
```

### Signed Net Delta Exposure
```python
# net_contracts is SIGNED (negative = short position)
delta_exposure = net_contracts × delta × 100   # MULTIPLIER = 100
# e.g. net_contracts=-5 (short put), delta=-0.30 → exposure = +150 (positive)
```

### Maintenance Margin (Reg-T simplified)
```python
margin = 0 if net_contracts >= 0 else 0.20 × strike × 100 × |net_contracts|
# Only SHORT positions require margin
```

### Historical Volatility (annualized)
```python
log_returns = [ln(close[i] / close[i-1]) for i in 1..n]
σ_annual    = stdev(log_returns) × √252
# Requires ≥5 data points; falls back to DEFAULT_SIGMA = 0.30 (30%)
```

---

## 2. Delta-Normal VaR (`routers/risk.py`)

**Formula (1-day, 95% confidence, cross-symbol independence assumed):**
```
VaR_1d_95 = 1.645 × √[ Σᵢ (|Δ_exp_i| × Spot_i × σ_daily_i)² ]

Where:
  Δ_exp_i   = |net_contracts| × |delta| × 100  (dollar delta per symbol)
  σ_daily_i = σ_annual_i / √252
  1.645     = z-score for 95th percentile
```

**Implementation note:** Computed per-symbol then combined as uncorrelated sum-of-squares (conservative assumption — actual corr > 0, so real VaR is lower).

---

## 3. Scenario Engine (`routers/risk.py` + frontend `computeScenarioPnL`)

**2nd-order Taylor expansion:**
```
ΔPnL ≈ Δ_exp · ΔS  +  0.5 · Γ_exp · ΔS²  +  V_exp · ΔIV

Where:
  ΔS   = spot × price_change_pct
  ΔIV  = effective_iv_shift (vol-points, not percent)

IV Skew enhancement (frontend only):
  If price_change_pct < 0 and skew_enabled:
    effective_iv_shift += |price_change_pct| × 50   (panic vol)
```

---

## 4. P&L Attribution (`routers/risk.py`)

Splits unrealized P&L into time-decay vs directional components:

```
time_decay_pnl   = theta_at_open × days_elapsed × |net_contracts| × 100
                   [positive = theta income for short positions]

total_unrealized = (open_premium - current_premium) × |net_contracts| × 100 × sign
                   [positive = profitable, regardless of long/short]

directional_pnl  = total_unrealized - time_decay_pnl
                   [delta/gamma driven residual, signed]
```

**sign convention:** +1 for short (SELL_OPEN) positions, -1 for long (BUY_OPEN).

---

## 5. NLV History — Index Normalization (`routers/risk.py`)

Converts cumulative cash-flow series into a 100-indexed series:

```python
# daily_flows[date] = Σ(price × qty × multiplier × ±sign) for trades on that date
# Positive = SELL_OPEN/SELL_CLOSE cash inflow; Negative = BUY_OPEN/BUY_CLOSE outflow

cumulative[d]    = Σ daily_flows[t] for t ≤ d   (carry-forward on non-trade days)
ref              = cumulative[first_trade_date]

normalized[d]    = (cumulative[d] - ref) / |ref| × 100 + 100
                   → 100 at anchor date; e.g. +5% = 105
```

**Alpha vs SPY:**
```
alpha = (account_return% - SPY_return%) at last common date
      = (normalized_account[-1] - 100) - (normalized_spy[-1] - 100)
```

**Benchmark normalization:** yfinance `Close` series, indexed identically:
```python
ref_bench = bench_closes[first_trade_date]
bench_normalized[d] = (bench_close[d] / ref_bench - 1) × 100 + 100
```

---

## 6. Strategy Auto-Recognition (`services/strategy_recognizer.py`)

Input: `list[LegSnapshot(option_type, strike, expiry, net_contracts)]`

Decision tree:

```
0 legs   → SINGLE  "Stock / ETF"
1 leg    → SINGLE  "{Short|Long} {Call|Put}"
2 legs, same type, same expiry  → VERTICAL
  | short_strike > long_strike (PUTs) → "Bull Put Spread"
  | short_strike < long_strike (PUTs) → "Bear Put Spread"
  | short_strike < long_strike (CALLs)→ "Bear Call Spread"
  | short_strike > long_strike (CALLs)→ "Bull Call Spread"
2 legs, different types, same expiry:
  | same strike                → STRADDLE
  | different strikes          → STRANGLE
2 legs, same type, same strike, different expiry → CALENDAR
4 legs, 2 PUTs + 2 CALLs, same expiry:
  | 2 short inner + 2 long outer → IRON_CONDOR
else → CUSTOM
```

**Sort order for HoldingsPage:** IRON_CONDOR(0) → VERTICAL(1) → STRADDLE(2) → STRANGLE(3) → CALENDAR(4) → CUSTOM(5) → SINGLE(6)

---

## 7. Lifecycle Settlement — Premium Transfer (`services/lifecycle.py`)

When an option expires ITM and is assigned, the stock trade records **effective cost basis** (not raw strike):

```python
# Weighted average premium across all opening trades in the group
avg_premium = Σ(price × qty) / Σ(qty)   for SELL_OPEN and BUY_OPEN trades

# Effective stock price (adjusts for premium already collected/paid)
PUT  option:  effective_price = strike - avg_premium
CALL option:  effective_price = strike + avg_premium

# Rationale:
#   Short PUT assigned → you BUY shares; premium collected offsets cost
#   Short CALL assigned → you SELL shares; premium collected adds to proceeds
#   Long PUT exercised → you SELL shares; premium paid reduces net proceeds
#   Long CALL exercised → you BUY shares; premium paid increases total cost
```

**Cash ledger always uses strike** (actual clearing price), not effective_price:
```python
cash_amount = strike × total_shares × ±sign
# The premium was already booked when the option was opened
```

**trade_metadata fields on auto-generated stock trade:**
```json
{
  "auto_assigned_from_option": true,
  "option_instrument_id": 42,
  "premium_per_share": 5.0,
  "effective_cost_per_share": 595.0
}
```

---

## 8. Position Engine — Append-Only Ledger & Cost Basis (`services/position_engine.py`)

> **Design invariant (Append-Only Ledger)**: Trades are NEVER mutated, only appended.
> Every derived value (Greeks, P&L, NLV, AI coaching context) is computed by replaying
> the immutable ledger from scratch. This makes historical P&L attribution and the
> lifecycle premium-to-cost-basis transfer provably correct.

```python
# Only OPENING trades contribute to cost basis
for trade in trades_chronological:
    if action in (SELL_OPEN, BUY_OPEN):
        open_qty       += quantity
        open_price_sum += price × quantity

avg_open_price   = open_price_sum / open_qty
total_open_value = avg_open_price × |net_contracts| × multiplier

# CLOSING trades (BUY_CLOSE, SELL_CLOSE) do NOT reset the average
# Net contracts sign: SELL_OPEN → -qty, BUY_OPEN → +qty, BUY_CLOSE → +qty, SELL_CLOSE → -qty
```

---

## 9. AI Coach — SSE Protocol (`routers/coach.py`)

```
GET /api/coach/analyze?portfolio_id=N&include_weekly=true

Stream events (text/event-stream):
  data: {"t":"chunk","v":"...text..."}    ← token-by-token Claude output
  data: {"t":"done","assessment":"Warning","weakness":"...","steps":[...],"weekly":"..."}
  data: {"t":"error","v":"...message..."}  ← API key missing, etc.
  data: [DONE]                             ← EventSource should close

Model:  claude-haiku-4-5-20251001
Params: max_tokens=700, temperature=0
Input:  PortfolioInsight + optional AttributionResponse → formatted USER prompt
Output: Structured sections parsed by regex: ## RISK_ASSESSMENT / KEY_WEAKNESS / ACTIONABLE_STEPS / WEEKLY_REVIEW
```

---

## 10. Cash Flow Sign Convention

```
Action          Cash direction    sign
──────────────────────────────────────
SELL_OPEN       +inflow           +1
SELL_CLOSE      +inflow           +1
BUY_OPEN        -outflow          -1
BUY_CLOSE       -outflow          -1

cash_amount = price × quantity × multiplier × sign
```

**STOCK multiplier = 1; OPTION multiplier = 100**

---

## 11. Portfolio Resolver — Permission Gatekeeper (`services/portfolio_resolver.py`)

Every authenticated router calls `resolve_portfolio_ids()` before touching any data. This is the single choke-point for user-scoped access control.

```python
async def resolve_portfolio_ids(db, user_id, portfolio_id=None) -> set[int]:
    """
    Returns a set of portfolio IDs the caller is allowed to query.

    Case 1: portfolio_id is None
      → SELECT id FROM portfolios WHERE user_id = :user_id
      → Returns ALL portfolio IDs owned by this user

    Case 2: portfolio_id is given
      → SELECT * FROM portfolios WHERE id = :portfolio_id
      → If portfolio.user_id != user_id → HTTP 404 (not "403" — don't leak existence)
      → If owned → BFS walk all children → return {portfolio_id, child_1, child_2, ...}
    """
```

**Usage pattern in every router:**
```python
@router.get("/something")
async def get_something(
    portfolio_id: int | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pids = await resolve_portfolio_ids(db, user.id, portfolio_id)
    # All subsequent queries: .where(SomeModel.portfolio_id.in_(pids))
```

**BFS subtree walk** reuses the existing `collect_portfolio_ids()` from `position_engine.py` — loads all portfolios into memory and walks descendants of the root node.

**Design decisions:**
- Returns 404 (not 403) when another user's portfolio_id is requested — prevents enumeration
- All 7 routers use this function; no router queries data without it
- `instruments` table is exempt (shared deduplication registry, no user_id)

---

## 12. Authentication (`services/auth.py` + `dependencies.py`)

### Password Hashing (stdlib PBKDF2-SHA256)
```python
# Hash: 16-byte random salt + 600,000 PBKDF2 iterations (OWASP 2023)
# Format stored in DB: "{salt_hex}${derived_key_hex}"
hash   = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600_000)
stored = f"{salt.hex()}${hash.hex()}"

# Verify: split on $, re-derive, constant-time compare
```

Chosen over passlib/bcrypt because bcrypt wheels are incompatible with Python 3.14.

### JWT Token
```python
# Create: PyJWT HS256, 24h expiry
payload = {"sub": str(user_id), "username": username, "exp": now + 24h}
token   = jwt.encode(payload, settings.jwt_secret_key, algorithm="HS256")

# Decode: raises ExpiredSignatureError or InvalidTokenError
payload = jwt.decode(token, settings.jwt_secret_key, algorithms=["HS256"])
```

### FastAPI Dependencies
```python
get_current_user(creds: HTTPBearer, db)        # Standard: Authorization header only
get_current_user_flexible(creds, token_query, db)  # SSE: header OR ?token= query param
```

### Orphan Data Migration
```python
# Called on FIRST user registration only
async def assign_orphan_data(db, user_id):
    for table in ("portfolios", "trade_events", "cash_ledger"):
        UPDATE {table} SET user_id = :uid WHERE user_id IS NULL
```

---

## Quick Reference: Key Constants

| Name | Value | Location |
|------|-------|----------|
| `MULTIPLIER` | 100 | `black_scholes.py` |
| `DEFAULT_SIGMA` | 0.30 (30%) | `black_scholes.py` |
| `RISK_FREE` | 0.045 (4.5%) | `config.py settings.risk_free_rate` |
| `_Z95` | 1.645 | `routers/risk.py` (VaR) |
| `_SQRT252` | √252 | `routers/risk.py` (annualize daily vol) |
| `GAMMA_ALERT_THRESHOLD_PCT` | 20.0 | `routers/risk.py` |
| Coach model | `claude-haiku-4-5-20251001` | `routers/coach.py` |
| `_ITERATIONS` | 600,000 | `services/auth.py` (PBKDF2) |
| `jwt_expire_hours` | 24 | `config.py` |
| `jwt_secret_key` | `"CHANGE-ME-IN-PRODUCTION"` | `config.py` (override via env) |
