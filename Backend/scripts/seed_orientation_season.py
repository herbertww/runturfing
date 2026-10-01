#!/usr/bin/env python
"""
Runturfing – create the inaugural orientation season.

Writes one row into `seasons` with kind='orientation', a zero entry fee, and a
two-week window aimed at Singapore's tertiary orientation period. Migration 010
must have been applied first; this script does not create the institutions.

    python scripts/seed_orientation_season.py --starts 2026-08-17
    python scripts/seed_orientation_season.py --starts 2026-08-17 --days 14 --dry-run

Why free: the orientation season is not a payout season. There is no pool, no
Stripe round trip, and nothing to settle. It scores schools against each other
and the standings are the whole prize. Charging students to enter the season
that is meant to introduce them to the app would cost more sign-ups than the
pool would be worth.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from api.database import engine  # noqa: E402

DEFAULT_NAME = "Orientation — Season 1"


async def main(starts: datetime, days: int, name: str, dry_run: bool) -> int:
    ends = starts + timedelta(days=days)

    async with engine.begin() as conn:
        existing = (await conn.execute(
            text("SELECT id, number, name, status FROM seasons WHERE kind = 'orientation'")
        )).fetchall()
        if existing:
            for row in existing:
                print(f"  already present: #{row[1]} {row[2]!r} ({row[3]})")
            print("An orientation season already exists. Nothing written.")
            return 1

        # Season numbers are UNIQUE across every kind, so the orientation season
        # takes the next free number rather than restarting its own count.
        next_number = ((await conn.execute(
            text("SELECT COALESCE(MAX(number), 0) FROM seasons")
        )).scalar() or 0) + 1

        institutions = (await conn.execute(
            text("SELECT COUNT(*) FROM institutions WHERE is_active")
        )).scalar() or 0
        if institutions == 0:
            print("No institutions found. Apply migrations/010 first.")
            return 1

        print(f"  season number : {next_number}")
        print(f"  name          : {name}")
        print(f"  window        : {starts:%Y-%m-%d} → {ends:%Y-%m-%d} ({days} days)")
        print(f"  entry fee     : free")
        print(f"  institutions  : {institutions} active")

        if dry_run:
            print("\n--dry-run: nothing written.")
            return 0

        await conn.execute(
            text("""
                INSERT INTO seasons
                    (number, name, kind, starts_at, ends_at, status,
                     pool_amount_cents, participant_count, entry_fee_cents)
                VALUES
                    (:number, :name, 'orientation', :starts, :ends, 'forming',
                     0, 0, 0)
            """).bindparams(number=next_number, name=name, starts=starts, ends=ends)
        )

    print("\nCreated. Status is 'forming' — flip it to 'active' on the start date.")
    return 0


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Create the inaugural orientation season.")
    p.add_argument("--starts", required=True, help="Start date, YYYY-MM-DD (UTC).")
    p.add_argument("--days", type=int, default=14, help="Season length. Default 14.")
    p.add_argument("--name", default=DEFAULT_NAME)
    p.add_argument("--dry-run", action="store_true")
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    start = datetime.strptime(args.starts, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    raise SystemExit(asyncio.run(main(start, args.days, args.name, args.dry_run)))
