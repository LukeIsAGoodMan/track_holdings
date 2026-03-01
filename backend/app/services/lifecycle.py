"""
Trade lifecycle automation.

process_expired_trades(db) — sweeps all portfolios:

  1. Find every ACTIVE trade on an option instrument whose expiry < today.
  2. Group by (portfolio_id, instrument_id).
  3. Compute net position for the group using standard sign convention.
  4. Determine ITM / OTM via live spot price from yfinance.
  5a. net == 0 (already flat)    → mark opening trades CLOSED.
  5b. OTM, net != 0              → mark all trades EXPIRED.
  5c. ITM, net != 0              → mark all trades ASSIGNED
                                  + auto-create STOCK TradeEvent + CashLedger.

Assignment actions (100 shares per contract, standard US equity options):
  Short Put  (net < 0, PUT,  spot < strike) → BUY_OPEN  100×|net| sh @ strike
  Short Call (net < 0, CALL, spot > strike) → SELL_OPEN 100×|net| sh @ strike
  Long  Put  (net > 0, PUT,  spot < strike) → SELL_OPEN 100×|net| sh @ strike
  Long  Call (net > 0, CALL, spot > strike) → BUY_OPEN  100×|net| sh @ strike

All writes are committed in a single transaction at the end of the sweep.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import InstrumentType, OptionType, TradeEvent, TradeAction, TradeStatus
from app.models.instrument import Instrument
from app.models.cash_ledger import CashLedger
from app.services import yfinance_client


@dataclass
class ProcessResult:
    expired:  int = 0
    assigned: int = 0
    skipped:  int = 0
    details:  list[str] = field(default_factory=list)


async def process_expired_trades(
    db: AsyncSession, user_id: int | None = None,
) -> ProcessResult:
    """
    Sweep portfolios for expired options and settle them.
    If user_id is provided, only processes that user's trades.
    Commits internally; caller does NOT need to commit.
    """
    today = date.today()
    result = ProcessResult()

    # ── 1. All ACTIVE trades on expired option instruments ────────────────────
    stmt = (
        select(TradeEvent)
        .join(Instrument, TradeEvent.instrument_id == Instrument.id)
        .where(
            TradeEvent.status == TradeStatus.ACTIVE,
            Instrument.instrument_type == InstrumentType.OPTION,
            Instrument.expiry <= today,
        )
        .options(selectinload(TradeEvent.instrument))
        .order_by(TradeEvent.instrument_id, TradeEvent.trade_date.asc())
    )
    if user_id is not None:
        stmt = stmt.where(TradeEvent.user_id == user_id)
    rows = (await db.execute(stmt)).scalars().all()

    if not rows:
        return result

    # ── 2. Group by (portfolio_id, instrument_id) ─────────────────────────────
    groups: dict[tuple[int, int], list[TradeEvent]] = {}
    for t in rows:
        groups.setdefault((t.portfolio_id, t.instrument_id), []).append(t)

    # ── 3. Batch spot prices for all affected underlyings ─────────────────────
    symbols = list({t.instrument.symbol for t in rows})
    spot_results = await asyncio.gather(
        *[yfinance_client.get_spot_price(s) for s in symbols]
    )
    spot_map: dict[str, Decimal | None] = dict(zip(symbols, spot_results))

    # ── 4. Process each group ─────────────────────────────────────────────────
    try:
        for (portfolio_id, inst_id), trades in groups.items():
            inst = trades[0].instrument
            spot = spot_map.get(inst.symbol)

            # Compute net contracts (standard sign convention)
            net = 0
            for t in trades:
                if t.action == TradeAction.SELL_OPEN:
                    net -= t.quantity
                elif t.action == TradeAction.BUY_OPEN:
                    net += t.quantity
                elif t.action == TradeAction.BUY_CLOSE:
                    net += t.quantity   # closes a short
                elif t.action == TradeAction.SELL_CLOSE:
                    net -= t.quantity   # closes a long

            sym_label = (
                f"{inst.symbol} "
                f"{inst.option_type.value if inst.option_type else '?'} "
                f"${float(inst.strike or 0):.0f} exp {inst.expiry}"
            )

            # ── Already flat (fully closed by trader) ─────────────────────
            if net == 0:
                for t in trades:
                    if t.action in (TradeAction.SELL_OPEN, TradeAction.BUY_OPEN):
                        t.status = TradeStatus.CLOSED
                    else:
                        t.status = TradeStatus.CLOSED
                    t.closed_date = today
                result.expired += 1
                result.details.append(f"CLOSED (flat): {sym_label}")
                continue

            # ── No spot price — skip ──────────────────────────────────────
            if spot is None:
                result.skipped += 1
                result.details.append(f"SKIPPED (no spot): {sym_label}")
                continue

            # ── Determine ITM / OTM ───────────────────────────────────────
            strike_f = float(inst.strike)
            spot_f   = float(spot)
            if inst.option_type == OptionType.CALL:
                is_itm = spot_f > strike_f
            else:  # PUT
                is_itm = spot_f < strike_f

            new_status = TradeStatus.ASSIGNED if is_itm else TradeStatus.EXPIRED

            # Mark all trades in this group
            for t in trades:
                t.status     = new_status
                t.closed_date = today

            if not is_itm:
                result.expired += 1
                result.details.append(
                    f"EXPIRED: {sym_label} net={net} spot={spot_f:.2f}"
                )
                continue

            # ── ASSIGNED: auto-create stock trade ─────────────────────────
            result.assigned += 1

            # Assignment action based on option type and position direction
            if inst.option_type == OptionType.PUT:
                # Short put → must buy shares; long put → exercise by selling
                stock_action = TradeAction.BUY_OPEN if net < 0 else TradeAction.SELL_OPEN
            else:  # CALL
                # Short call → must sell shares; long call → exercise by buying
                stock_action = TradeAction.SELL_OPEN if net < 0 else TradeAction.BUY_OPEN

            total_shares = abs(net) * 100   # 100 shares per contract

            # ── Premium-to-cost-basis transfer ────────────────────────────
            # Weighted average option premium from all opening trades in this group.
            # The effective stock cost basis is adjusted by the premium collected/paid:
            #   PUT  option: effective_price = strike - avg_premium
            #     (short put collected premium → lowers cost of acquired shares)
            #     (long  put paid premium     → lowers net proceeds on sale)
            #   CALL option: effective_price = strike + avg_premium
            #     (short call collected premium → raises effective sale proceeds)
            #     (long  call paid premium     → raises effective cost of acquired shares)
            # NOTE: The actual cash flow always uses inst.strike (the real clearing price).
            #       The premium was already booked when the option was opened.
            open_qty_sum   = Decimal("0")
            open_price_sum = Decimal("0")
            for t in trades:
                if t.action in (TradeAction.SELL_OPEN, TradeAction.BUY_OPEN):
                    qty_d = Decimal(str(t.quantity))
                    open_qty_sum   += qty_d
                    open_price_sum += t.price * qty_d
            avg_premium = (
                open_price_sum / open_qty_sum
                if open_qty_sum > Decimal("0") else Decimal("0")
            )
            if inst.option_type == OptionType.PUT:
                effective_price = inst.strike - avg_premium
            else:  # CALL
                effective_price = inst.strike + avg_premium

            # Get or create the stock instrument (flush makes it visible in-session)
            stock_inst = (await db.execute(
                select(Instrument).where(
                    Instrument.symbol == inst.symbol,
                    Instrument.instrument_type == InstrumentType.STOCK,
                )
            )).scalar_one_or_none()

            if stock_inst is None:
                stock_inst = Instrument(
                    symbol=inst.symbol,
                    instrument_type=InstrumentType.STOCK,
                    multiplier=1,
                )
                db.add(stock_inst)
                await db.flush()

            # Auto-assignment TradeEvent — price = effective cost basis (premium-adjusted)
            trade_user_id = trades[0].user_id  # inherit from expired trade
            auto_trade = TradeEvent(
                portfolio_id=portfolio_id,
                user_id=trade_user_id,
                instrument_id=stock_inst.id,
                action=stock_action,
                quantity=total_shares,
                price=effective_price,
                underlying_price_at_trade=spot,
                status=TradeStatus.ACTIVE,
                trade_date=datetime.now(timezone.utc),
                notes=(
                    f"Auto-assigned from {inst.option_type.value} "
                    f"{inst.symbol} ${strike_f:.0f} exp {inst.expiry} "
                    f"(eff cost ${float(effective_price):.2f}, premium ${float(avg_premium):.2f}/sh)"
                ),
                trade_metadata={
                    "auto_assigned_from_option": True,
                    "option_instrument_id": inst_id,
                    "premium_per_share": float(avg_premium),
                    "effective_cost_per_share": float(effective_price),
                },
            )
            db.add(auto_trade)
            await db.flush()

            # Cash impact uses strike (actual clearing price), not effective_price
            is_sell = stock_action in (TradeAction.SELL_OPEN, TradeAction.SELL_CLOSE)
            cash_amount = (
                inst.strike * Decimal(str(total_shares))
                * (Decimal("1") if is_sell else Decimal("-1"))
            )
            db.add(CashLedger(
                portfolio_id=portfolio_id,
                user_id=trade_user_id,
                trade_event_id=auto_trade.id,
                amount=cash_amount,
                description=(
                    f"Auto-assign {stock_action.value} {total_shares}x "
                    f"{inst.symbol} @ ${strike_f:.2f} strike "
                    f"(eff ${float(effective_price):.2f}/sh after ${float(avg_premium):.2f} premium)"
                ),
            ))

            result.details.append(
                f"ASSIGNED: {sym_label} net={net} spot={spot_f:.2f} "
                f"-> {stock_action.value} {total_shares}sh @ ${strike_f:.2f}"
            )

        await db.commit()

    except Exception:
        await db.rollback()
        raise

    return result
