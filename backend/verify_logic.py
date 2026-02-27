"""
Standalone core-logic verification script.
Does NOT start FastAPI — runs pure DB + calculation layer.

Usage (from track_holdings/backend/):
    python verify_logic.py

Assertions:
  1. Cash balance  == $250,000.00
  2. Net contracts == -5
  3. Delta exposure > 0  (short put → positive delta)
"""
from __future__ import annotations

import asyncio
import io
import sys
from decimal import Decimal
from pathlib import Path

# Force UTF-8 output on Windows (avoids GBK encoding errors for ✓ / ✗)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# Ensure 'app' package is importable when running from backend/
sys.path.insert(0, str(Path(__file__).parent))

# Import all models FIRST so Base.metadata is fully populated before init_db()
import app.models  # noqa: F401  (side-effect: registers all ORM classes)

from app.database import init_db, AsyncSessionLocal
from app.models import (
    Instrument,
    TradeEvent,
    TradeAction,
    CashLedger,
)
from app.services.seed import run_seed
from app.services.black_scholes import (
    calculate_greeks,
    net_delta_exposure,
    maintenance_margin,
    DEFAULT_SIGMA,
    RISK_FREE,
)

from datetime import date
from sqlalchemy import select, func


# ── Spot price helper (yfinance with fallback) ───────────────────────────────
def _fetch_spot(ticker: str) -> Decimal:
    try:
        import yfinance as yf
        price = yf.Ticker(ticker).fast_info.last_price
        if price and price > 0:
            return Decimal(str(round(float(price), 4)))
    except Exception as exc:
        print(f"  [warn] yfinance error: {exc}")
    # Fallback: NVDA ≈ $115 (early 2026 estimate)
    return Decimal("115.00")


# ── Main verification routine ────────────────────────────────────────────────
async def main() -> None:
    SEP = "=" * 62

    print(SEP)
    print("  TRACK HOLDINGS — CORE LOGIC VERIFICATION")
    print(SEP)

    # ── Step 1: initialize database ──────────────────────────────────────
    await init_db()
    print("✓ Database initialized  (track_holdings.db created)")

    # ── Step 2: inject seed data ─────────────────────────────────────────
    async with AsyncSessionLocal() as db:
        inserted = await run_seed(db)
        await db.commit()

    if inserted:
        print("✓ Seed data inserted")
    else:
        print("  Seed data already present — skipping insert")

    # ── Step 3: query state ───────────────────────────────────────────────
    async with AsyncSessionLocal() as db:

        # --- Cash balance (SUM of CashLedger.amount) ---------------------
        raw_cash = await db.execute(select(func.sum(CashLedger.amount)))
        raw = raw_cash.scalar()
        cash_balance = Decimal(str(raw)) if raw is not None else Decimal("0")

        # --- Replay TradeEvents → net contracts --------------------------
        trades_result = await db.execute(select(TradeEvent))
        trades = trades_result.scalars().all()

        net_contracts: int = 0
        for t in trades:
            if t.action in (TradeAction.SELL_OPEN, TradeAction.SELL_CLOSE):
                net_contracts -= t.quantity
            else:
                net_contracts += t.quantity

        # --- Fetch the NVDA option instrument ----------------------------
        inst_result = await db.execute(
            select(Instrument).where(Instrument.symbol == "NVDA")
        )
        instrument = inst_result.scalar_one_or_none()

        if instrument is None:
            print("ERROR: NVDA instrument not found in DB — seed may have failed.")
            sys.exit(1)

    # ── Step 4: fetch live spot & compute Greeks ──────────────────────────
    print("  Fetching NVDA spot price from yfinance…", end=" ", flush=True)
    spot = await asyncio.to_thread(_fetch_spot, "NVDA")
    print(f"${spot:.2f}")

    today   = date.today()
    dte     = (instrument.expiry - today).days
    T_years = Decimal(str(max(dte, 0) / 365.0))

    greeks   = calculate_greeks(
        S=spot,
        K=instrument.strike,
        T=T_years,
        option_type=instrument.option_type.value,
        sigma=DEFAULT_SIGMA,
        r=RISK_FREE,
    )
    delta_exp = net_delta_exposure(net_contracts, greeks)
    margin    = maintenance_margin(net_contracts, instrument.strike)

    # ── Step 5: display results ───────────────────────────────────────────
    print()
    print(SEP)
    print("  RESULTS")
    print(SEP)
    print(f"  Cash Balance        : ${cash_balance:>15,.2f}")
    print(f"  Net Contracts       : {net_contracts:>16}")
    print(f"  NVDA Spot           : ${spot:>15,.2f}")
    print(f"  Strike              : ${instrument.strike:>15,.2f}")
    print(f"  Expiry              : {str(instrument.expiry):>16}")
    print(f"  DTE                 : {dte:>15} days")
    print()
    print(f"  ── Greeks (long-unit basis) ──────────────────────")
    print(f"  Delta               : {greeks.delta:>16.6f}")
    print(f"  Gamma               : {greeks.gamma:>16.6f}")
    print(f"  Theta (per day)     : {greeks.theta:>16.6f}")
    print(f"  Vega  (per 1% vol)  : {greeks.vega:>16.6f}")
    print()
    print(f"  ── Position ──────────────────────────────────────")
    print(f"  Delta Exposure      : {delta_exp:>16.2f}  (net_contracts × delta × 100)")
    print(f"  Maint. Margin (20%) : ${margin:>15,.2f}")

    # ── Step 6: assertions ────────────────────────────────────────────────
    print()
    print(SEP)
    print("  ASSERTIONS")
    print(SEP)

    results: list[tuple[bool, str]] = []

    ok1 = cash_balance == Decimal("250000")
    results.append((ok1, f"Cash Balance = $250,000.00  → got ${cash_balance:,.2f}"))

    ok2 = net_contracts == -5
    results.append((ok2, f"Net Contracts = -5          → got {net_contracts}"))

    ok3 = delta_exp > Decimal("0")
    results.append((ok3, f"Delta Exposure > 0          → got {delta_exp:.4f}"))

    all_ok = True
    for passed, msg in results:
        icon = "✓" if passed else "✗"
        print(f"  {icon} {msg}")
        if not passed:
            all_ok = False

    print()
    if all_ok:
        print("  ✓ ALL ASSERTIONS PASSED")
    else:
        print("  ✗ SOME ASSERTIONS FAILED")
        sys.exit(1)

    print(SEP)


if __name__ == "__main__":
    asyncio.run(main())
