-- Track Holdings — PostgreSQL DDL
-- Generated for Render PostgreSQL deployment.
-- Run once to initialize schema; SQLAlchemy create_all() handles this
-- automatically on first startup, but this file serves as documentation
-- and manual bootstrap option.

-- ── Users ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(50) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_users_username ON users (username);

-- ── Portfolios ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portfolios (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(500),
    parent_id   INTEGER REFERENCES portfolios(id),
    user_id     INTEGER REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_portfolios_parent_id ON portfolios (parent_id);
CREATE INDEX IF NOT EXISTS ix_portfolios_user_id   ON portfolios (user_id);

-- ── Instruments ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS instruments (
    id              SERIAL PRIMARY KEY,
    symbol          VARCHAR(20) NOT NULL,
    instrument_type VARCHAR(10) NOT NULL,    -- 'STOCK' | 'OPTION'
    strike          NUMERIC(18, 6),
    expiry          DATE,
    option_type     VARCHAR(4),              -- 'CALL' | 'PUT' | NULL
    multiplier      INTEGER NOT NULL DEFAULT 100,
    tags            JSONB,
    CONSTRAINT uq_instrument_contract
        UNIQUE (symbol, strike, expiry, option_type)
);

CREATE INDEX IF NOT EXISTS ix_instruments_symbol ON instruments (symbol);

-- ── Trade Events ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trade_events (
    id                       SERIAL PRIMARY KEY,
    portfolio_id             INTEGER NOT NULL REFERENCES portfolios(id),
    instrument_id            INTEGER NOT NULL REFERENCES instruments(id),
    user_id                  INTEGER REFERENCES users(id),
    action                   VARCHAR(20) NOT NULL,  -- 'SELL_OPEN' | 'BUY_OPEN' | 'BUY_CLOSE' | 'SELL_CLOSE'
    quantity                 INTEGER NOT NULL,
    price                    NUMERIC(18, 6) NOT NULL,
    underlying_price_at_trade NUMERIC(18, 6),
    status                   VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',  -- 'ACTIVE' | 'EXPIRED' | 'ASSIGNED' | 'CLOSED'
    trade_date               TIMESTAMPTZ DEFAULT NOW(),
    closed_date              DATE,
    notes                    VARCHAR(500),
    trade_metadata           JSONB
);

CREATE INDEX IF NOT EXISTS ix_trade_events_portfolio_id  ON trade_events (portfolio_id);
CREATE INDEX IF NOT EXISTS ix_trade_events_instrument_id ON trade_events (instrument_id);
CREATE INDEX IF NOT EXISTS ix_trade_events_user_id       ON trade_events (user_id);

-- ── Cash Ledger ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cash_ledger (
    id              SERIAL PRIMARY KEY,
    portfolio_id    INTEGER NOT NULL REFERENCES portfolios(id),
    trade_event_id  INTEGER REFERENCES trade_events(id),
    user_id         INTEGER REFERENCES users(id),
    amount          NUMERIC(18, 6) NOT NULL,
    description     VARCHAR(200),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_cash_ledger_portfolio_id ON cash_ledger (portfolio_id);
CREATE INDEX IF NOT EXISTS ix_cash_ledger_user_id      ON cash_ledger (user_id);

-- ── Alerts ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alerts (
    id               SERIAL PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES users(id),
    symbol           VARCHAR(20) NOT NULL,
    alert_type       VARCHAR(20) NOT NULL,  -- 'PRICE_ABOVE' | 'PRICE_BELOW' | 'PCT_CHANGE_UP' | 'PCT_CHANGE_DOWN'
    status           VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',  -- 'ACTIVE' | 'TRIGGERED' | 'DISABLED'
    threshold        NUMERIC(18, 6) NOT NULL,
    reference_price  NUMERIC(18, 6),
    repeat           BOOLEAN NOT NULL DEFAULT FALSE,
    cooldown_seconds INTEGER NOT NULL DEFAULT 300,
    note             VARCHAR(500),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    triggered_at     TIMESTAMPTZ,
    trigger_count    INTEGER NOT NULL DEFAULT 0,
    expires_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_alerts_user_id ON alerts (user_id);
CREATE INDEX IF NOT EXISTS ix_alerts_symbol  ON alerts (symbol);
