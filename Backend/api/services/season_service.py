"""
Runturfing Backend – Season Service
Group formation algorithm, payout calculation, and refund logic.

Group formation constraints:
- 3 men + 3 women per group.
- Same city/metro region.
- Similar recent activity band.
- Preference/bid weighting.
- Avoid repeat pairings from previous seasons.

Payout rules:
- Women who meet activity threshold and linked socials are eligible.
- Payout = (pool / eligible_women_count) * platform_fee_factor.
- Unmatched or threshold-failed users get refund or credit rollover.
"""

import uuid
import logging
from typing import List, Dict, Optional
from collections import defaultdict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.config import settings
from api.services.season_economics import (
    EconomicsParams,
    params_from_settings,
    referral_multiplier,
    split_pool_weighted,
)

logger = logging.getLogger(__name__)

# Single source of truth for the money numbers, built from env-backed settings.
PARAMS: EconomicsParams = params_from_settings(settings)

PLATFORM_FEE_RATE = PARAMS.platform_fee_rate


class SeasonService:

    # -----------------------------------------------------------------------
    # Entry
    #
    # Entering a season is free and needs no decision from the runner. Both
    # doors lead here: POST /seasons/join for someone who wants in before they
    # have run, and the automatic entry that fires on the first run inside the
    # season window. Nothing is charged, so an entry settles the moment it is
    # written and paid_at means "settled", not "money arrived".
    # -----------------------------------------------------------------------

    @staticmethod
    async def enter_season(db: AsyncSession, user_id: str, season_id: str):
        """
        Enter a runner into a season, once. Returns (entry_id, created).

        Idempotent by way of the UNIQUE(user_id, season_id) constraint, because
        two runs landing at the same moment would otherwise race to insert the
        same entry. Does not commit: the caller owns the transaction, so an
        auto-entry lands or fails together with the run that triggered it.
        """
        inserted = await db.execute(
            text("""
                INSERT INTO season_entries
                    (id, user_id, season_id, entry_fee_cents, status, paid_at)
                VALUES (:id, :uid, :sid, 0, 'pending', NOW())
                ON CONFLICT (user_id, season_id) DO NOTHING
                RETURNING id
            """).bindparams(id=str(uuid.uuid4()), uid=user_id, sid=season_id)
        )
        row = inserted.fetchone()

        if row is None:
            existing = await db.execute(
                text("SELECT id FROM season_entries WHERE user_id = :uid AND season_id = :sid")
                .bindparams(uid=user_id, sid=season_id)
            )
            return str(existing.scalar_one()), False

        # Headcount moves on entry. The pool does not: it is funded by rundating
        # bounties alone, and entering costs nothing.
        await db.execute(
            text("UPDATE seasons SET participant_count = participant_count + 1 WHERE id = :sid")
            .bindparams(sid=season_id)
        )
        return str(row[0]), True

    @staticmethod
    async def auto_enter_for_run(db: AsyncSession, user_id: str, run_started_at) -> Optional[str]:
        """
        Enter a runner into whichever open season their run falls inside.

        Called from POST /runs/import. A run dated inside an open season is the
        only signal needed; showing up is the entry. Returns the season id if
        the runner is now entered, or None when the run falls outside every
        open season, which is not an error.
        """
        season = (await db.execute(
            text("""
                SELECT id FROM seasons
                WHERE status IN ('forming', 'active')
                  AND :ran_at >= starts_at AND :ran_at <= ends_at
                ORDER BY starts_at DESC
                LIMIT 1
            """).bindparams(ran_at=run_started_at)
        )).fetchone()

        if not season:
            return None

        season_id = str(season[0])
        _, created = await SeasonService.enter_season(db, user_id, season_id)
        if created:
            logger.info(f"[Season] Auto-entered {user_id} into {season_id} on a run")
        return season_id

    # -----------------------------------------------------------------------
    # Group Formation
    # -----------------------------------------------------------------------

    @staticmethod
    async def form_groups(db: AsyncSession, season_id: str):
        """
        Run group formation for a season.
        Algorithm:
        1. Fetch all pending entries with user metadata.
        2. Separate by gender.
        3. Sort by activity band (recent 30-day mileage).
        4. Apply bid weights to preference matching.
        5. Form balanced groups of 3M + 3W.
        6. Create season_groups and update season_entries.
        7. Create chat threads for each group.
        """
        logger.info(f"[Season] Forming groups for season {season_id}")

        # Fetch entries
        result = await db.execute(
            text("""
                SELECT se.id, se.user_id, u.gender, u.city, u.metro_region,
                       COALESCE(ld.ninety_day_mileage_km, 0) AS activity,
                       COALESCE(SUM(sb.amount_cents), 0) AS bid_weight
                FROM season_entries se
                JOIN users u ON u.id = se.user_id
                LEFT JOIN leaderboard_daily ld ON ld.user_id = se.user_id
                    AND ld.snapshot_date = (SELECT MAX(snapshot_date) FROM leaderboard_daily)
                LEFT JOIN season_bids sb ON sb.target_user_id = se.user_id
                    AND sb.season_id = :sid AND sb.status = 'pending'
                -- No paid_at gate. Entry is free, so every pending entry
                -- is a real entrant; requiring a payment here would have
                -- formed groups out of nobody.
                WHERE se.season_id = :sid AND se.status = 'pending'
                GROUP BY se.id, se.user_id, u.gender, u.city, u.metro_region, ld.ninety_day_mileage_km
            """).bindparams(sid=season_id)
        )
        entries = result.fetchall()

        men   = [e for e in entries if e[2] == "male"]
        women = [e for e in entries if e[2] == "female"]

        # Sort by activity band (descending) then bid weight (descending)
        men.sort(key=lambda e: (e[5], e[6]), reverse=True)
        women.sort(key=lambda e: (e[5], e[6]), reverse=True)

        # Group into sets of 3
        men_groups   = [men[i:i+3]   for i in range(0, len(men),   3)]
        women_groups = [women[i:i+3] for i in range(0, len(women), 3)]

        # Pair men and women groups
        n_groups = min(len(men_groups), len(women_groups))
        formed_groups = []
        for i in range(n_groups):
            group_members = men_groups[i] + women_groups[i]
            if len(group_members) < 2:
                continue
            formed_groups.append(group_members)

        # Persist groups
        for idx, members in enumerate(formed_groups):
            group_id  = str(uuid.uuid4())
            thread_id = str(uuid.uuid4())
            group_name = f"Group {idx + 1}"

            await db.execute(
                text("""
                    INSERT INTO season_groups (id, season_id, name)
                    VALUES (:id, :sid, :name)
                """).bindparams(id=group_id, sid=season_id, name=group_name)
            )

            await db.execute(
                text("""
                    INSERT INTO chat_threads (id, season_group_id)
                    VALUES (:tid, :gid)
                """).bindparams(tid=thread_id, gid=group_id)
            )

            await db.execute(
                text("""
                    UPDATE season_groups SET chat_thread_id = :tid WHERE id = :gid
                """).bindparams(tid=thread_id, gid=group_id)
            )

            for member in members:
                entry_id = str(member[0])
                await db.execute(
                    text("""
                        UPDATE season_entries
                        SET group_id = :gid, status = 'matched'
                        WHERE id = :eid
                    """).bindparams(gid=group_id, eid=entry_id)
                )

            # Post welcome message
            await db.execute(
                text("""
                    INSERT INTO chat_messages (id, thread_id, body, message_type)
                    VALUES (:id, :tid, :body, 'system_notice')
                """).bindparams(
                    id=str(uuid.uuid4()),
                    tid=thread_id,
                    body=f"Welcome to {group_name}! Your 2-week season starts now. "
                         "Run your routes, claim territory, and defend your turf. Good luck! 🏃",
                )
            )

        # Free entries that did not land in a group stay pending. There is
        # nothing to refund, and marking them 'refunded' would write a payment
        # that never happened into the runner's transaction history.
        unmatched = (await db.execute(
            text("""
                SELECT COUNT(*) FROM season_entries
                WHERE season_id = :sid AND status = 'pending' AND entry_fee_cents = 0
            """).bindparams(sid=season_id)
        )).scalar_one()
        if unmatched:
            logger.info(
                f"[Season] {unmatched} entrants went unmatched in {season_id} and stay "
                "pending — entry was free, so nothing is owed back"
            )

        # Legacy only: seasons that ran while entry was still charged can hold
        # entries with money against them, and those are owed a refund if they
        # went unmatched. This marks them; issuing the Stripe refund is not built.
        owed = await db.execute(
            text("""
                UPDATE season_entries
                SET status = 'refunded'
                WHERE season_id = :sid AND status = 'pending'
                  AND entry_fee_cents > 0 AND paid_at IS NOT NULL
                RETURNING id
            """).bindparams(sid=season_id)
        )
        refund_count = len(owed.fetchall())
        if refund_count:
            logger.warning(
                f"[Season] {refund_count} paid legacy entries went unmatched in {season_id} "
                "and are marked refunded — no Stripe refund has been issued"
            )

        # Update season status to active
        await db.execute(
            text("UPDATE seasons SET status = 'active' WHERE id = :sid").bindparams(sid=season_id)
        )

        await db.commit()
        logger.info(f"[Season] Formed {len(formed_groups)} groups for season {season_id}")

    # -----------------------------------------------------------------------
    # Payout Calculation
    # -----------------------------------------------------------------------

    @staticmethod
    async def calculate_payouts(db: AsyncSession, season_id: str):
        """
        Calculate payouts at season end.
        - Eligible women: linked socials + met activity threshold + no open fraud flags.
        - Payout = pool * (1 - platform_fee) / eligible_count.
        - Ineligible entries: refund or credit rollover.
        """
        logger.info(f"[Season] Calculating payouts for season {season_id}")

        # Get season pool
        season_result = await db.execute(
            text("SELECT pool_amount_cents FROM seasons WHERE id = :sid").bindparams(sid=season_id)
        )
        season_row = season_result.fetchone()
        if not season_row:
            logger.error(f"[Season] Season {season_id} not found")
            return

        pool_cents = season_row[0]

        # Eligibility reads season mileage off the latest leaderboard snapshot.
        # If leaderboard_materialize.py has not run, every entrant reads as
        # zero km, nobody qualifies, and the season used to settle having paid
        # nobody — no error, no alert, no way to tell it apart from a season
        # where nobody genuinely qualified. Refuse to settle instead.
        snapshot = (await db.execute(
            text("SELECT MAX(snapshot_date) FROM leaderboard_daily")
        )).scalar()

        if snapshot is None:
            logger.error(
                f"[Season] Refusing to settle {season_id}: leaderboard_daily is empty. "
                "Run api/jobs/leaderboard_materialize.py first."
            )
            return

        from datetime import date as _date
        snapshot_age = (_date.today() - snapshot).days
        if snapshot_age > settings.payout_snapshot_max_age_days:
            logger.error(
                f"[Season] Refusing to settle {season_id}: newest leaderboard snapshot is "
                f"{snapshot_age} days old (max {settings.payout_snapshot_max_age_days}). "
                "Payout eligibility would be computed against stale mileage."
            )
            return

        # The pool must equal what actually arrived. Any drift means the pool
        # was credited by something other than a confirmed payment.
        confirmed = (await db.execute(
            text("""
                SELECT COALESCE(SUM(entry_fee_cents + guarantee_cents), 0)
                FROM season_entries
                WHERE season_id = :sid AND paid_at IS NOT NULL
            """).bindparams(sid=season_id)
        )).scalar_one()

        if confirmed != pool_cents:
            logger.error(
                f"[Season] Pool mismatch on {season_id}: seasons.pool_amount_cents is "
                f"{pool_cents} but confirmed paid entries total {confirmed}. "
                "Paying out against the confirmed total."
            )
            pool_cents = confirmed

        # Find eligible women
        eligible_result = await db.execute(
            text("""
                SELECT se.user_id, se.entry_fee_cents, se.bid_amount_cents,
                       EXISTS (
                           SELECT 1 FROM fraud_flags ff
                           WHERE ff.target_user_id = se.user_id AND ff.status = 'open'
                       ) AS has_open_flag
                FROM season_entries se
                JOIN users u ON u.id = se.user_id
                JOIN profiles p ON p.user_id = se.user_id
                LEFT JOIN leaderboard_daily ld ON ld.user_id = se.user_id
                    AND ld.snapshot_date = (SELECT MAX(snapshot_date) FROM leaderboard_daily)
                WHERE se.season_id = :sid
                  AND u.gender = 'female'
                  AND p.is_season_eligible = TRUE
                  -- Stripe Connect Express is the identity gate. No verified
                  -- payouts-enabled account, no payout — this is what makes
                  -- impersonating an eligible entrant uneconomic.
                  AND u.stripe_account_id IS NOT NULL
                  AND u.stripe_payouts_enabled = TRUE
                  AND COALESCE(ld.season_mileage_km, 0) >= :min_km
                  -- An open fraud flag no longer removes someone here. They
                  -- stay in the set and their payout is created 'held', so a
                  -- pending report cannot quietly redistribute their share.
                  AND (
                      SELECT COUNT(*) FROM runs r
                      WHERE r.user_id = se.user_id AND r.status = 'processed'
                        AND r.started_at >= (SELECT starts_at FROM seasons WHERE id = :sid)
                        AND r.started_at <= (SELECT ends_at FROM seasons WHERE id = :sid)
                  ) >= :min_runs
            """).bindparams(
                sid=season_id,
                min_km=settings.threshold_min_km,
                min_runs=settings.threshold_min_runs,
            )
        )
        eligible = eligible_result.fetchall()

        if not eligible:
            logger.info(f"[Season] No eligible payouts for season {season_id}")
            await db.execute(
                text("UPDATE seasons SET status = 'settled' WHERE id = :sid").bindparams(sid=season_id)
            )
            await db.commit()
            return

        eligible_ids = [str(row[0]) for row in eligible]

        # Runturfing referral weights.
        #
        # Base bonus: a referred person who entered this season and actually
        # paid. Female bonus: a referred woman who is in this season's payout
        # set, so it is contingent on a real payout rather than a signup.
        # Neither counts for a referral that only ever created an account.
        weight_rows = (await db.execute(
            text("""
                SELECT r.referrer_user_id,
                       COUNT(*) FILTER (WHERE se.paid_at IS NOT NULL)               AS paid_entries,
                       COUNT(*) FILTER (WHERE se.user_id = ANY(:eligible_ids))      AS paid_women
                FROM referrals r
                JOIN season_entries se ON se.user_id = r.referred_user_id
                                      AND se.season_id = :sid
                WHERE r.referrer_user_id = ANY(:eligible_ids)
                GROUP BY r.referrer_user_id
            """).bindparams(sid=season_id, eligible_ids=eligible_ids)
        )).fetchall()

        referral_counts = {str(r[0]): (r[1] or 0, r[2] or 0) for r in weight_rows}
        weights = {}
        for uid in eligible_ids:
            entries, women = referral_counts.get(uid, (0, 0))
            weights[uid] = referral_multiplier(entries, women, PARAMS)

        amounts, split = split_pool_weighted(pool_cents, weights, PARAMS)

        if not amounts or max(amounts.values()) <= 0:
            logger.error(
                f"[Season] Refusing to settle {season_id}: pool {pool_cents} across "
                f"{len(eligible)} eligible entrants rounds to zero."
            )
            return

        held_count = 0
        for user_id, entry_fee, bid_amount, has_open_flag in eligible:
            payout_id = str(uuid.uuid4())
            status = "held" if has_open_flag else "pending"
            if has_open_flag:
                held_count += 1
            per_person_cents = amounts.get(str(user_id), 0)
            if per_person_cents <= 0:
                logger.warning(f"[Season] {user_id} weighted to zero; skipping payout")
                continue
            await db.execute(
                text("""
                    INSERT INTO payouts (id, user_id, season_id, amount_cents, status, notes)
                    VALUES (:id, :uid, :sid, :amount, :status, :notes)
                """).bindparams(
                    id=payout_id, uid=str(user_id),
                    sid=season_id, amount=per_person_cents, status=status,
                    notes="Held pending review of an open report" if has_open_flag else None,
                )
            )
            await db.execute(
                text("""
                    UPDATE season_entries
                    SET payout_eligible = TRUE, status = 'completed'
                    WHERE user_id = :uid AND season_id = :sid
                """).bindparams(uid=str(user_id), sid=season_id)
            )

        # Mark ineligible entries as completed (refund handled separately)
        await db.execute(
            text("""
                UPDATE season_entries
                SET status = 'completed'
                WHERE season_id = :sid AND status = 'active'
            """).bindparams(sid=season_id)
        )

        await db.execute(
            text("UPDATE seasons SET status = 'settled' WHERE id = :sid").bindparams(sid=season_id)
        )
        await db.commit()
        logger.info(
            f"[Season] Created {len(amounts)} payouts from a {pool_cents} pool "
            f"(platform {split.platform_cents}, avg {split.per_person_cents}, "
            f"unallocated remainder {split.remainder_cents}). "
            f"{held_count} held pending report review. "
            f"Referral weights ranged {min(weights.values()):.2f}-{max(weights.values()):.2f}x. "
            "Nothing transfers them yet."
        )
