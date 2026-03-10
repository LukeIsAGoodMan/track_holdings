"""
migrate_asset_class.py — one-shot DB migration.

Updates instrument_type on all non-OPTION instruments so that
the DB matches the classifications in master_symbols.json.

Usage:
    cd backend
    python migrate_asset_class.py

Safe to re-run (idempotent).
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Make sure app package is importable
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import select, update
from app.database import AsyncSessionLocal, init_db
from app.models import Instrument, InstrumentType
from app.routers.symbols import _symbol_map, _TYPE_MAP


async def run() -> None:
    await init_db()

    async with AsyncSessionLocal() as db:
        # Load all non-OPTION instruments
        result = await db.execute(
            select(Instrument).where(Instrument.instrument_type != InstrumentType.OPTION)
        )
        instruments: list[Instrument] = list(result.scalars().all())

        changed = 0
        skipped = 0
        unknown = 0

        for inst in instruments:
            sym = inst.symbol.upper()
            entry = _symbol_map.get(sym)
            if entry is None:
                unknown += 1
                continue

            asset_class = entry.get("t") or "stock"
            target_type_str = _TYPE_MAP.get(asset_class, "STOCK")
            target_type = InstrumentType(target_type_str)

            if inst.instrument_type != target_type:
                print(
                    f"  UPDATE {sym}: {inst.instrument_type.value} → {target_type.value}"
                )
                inst.instrument_type = target_type
                changed += 1
            else:
                skipped += 1

        await db.commit()

    print(f"\nMigration complete: {changed} updated, {skipped} already correct, {unknown} not in symbol map")


if __name__ == "__main__":
    asyncio.run(run())
