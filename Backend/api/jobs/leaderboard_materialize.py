"""
Runturfing Backend – Leaderboard Materialization Job
Run via cron: 0 * * * * python -m api.jobs.leaderboard_materialize  (hourly)

Precomputes leaderboard snapshots into leaderboard_daily.
Only inserts/updates today's snapshot row per user.

Three things happen here that the API cannot do per request:

  * influence — the count of cells a runner has any live score in, whether or
    not they lead them, plus its 7 and 30 day moving averages. Cell ownership is
    winner-takes-all, so a runner who is narrowly second across a whole
    neighbourhood reads as zero on the map. The moving average is the number
    that says otherwise, and it is an average precisely so one strong week does
    not settle it.
  * cells_led — the winner-takes-all count, kept alongside influence so the two
    can be read against each other.
  * rank — the SAF ladder in api/services/rank_service.py, cached on the row so
    the leaderboard can sort by it.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import text
from api.database import AsyncSessionLocal
from api.services.rank_inputs import load_all_rank_inputs
from api.services.rank_service import compute_rank

logger = logging.getLogger(__name__)


async def materialize():
    logger.info("[Leaderboard] Starting materialization")
    today = datetime.now(timezone.utc).date()
    cutoff_90 = datetime.now(timezone.utc) - timedelta(days=90)

    async with AsyncSessionLocal() as db:
        try:
            # Upsert today's leaderboard snapshot for all active users
            await db.execute(
                text("""
                    INSERT INTO leaderboard_daily
                        (id, user_id, snapshot_date, all_time_mileage_km,
                         ninety_day_mileage_km, territory_held, consistency_streak,
                         season_mileage_km, season_territory, city, metro_region,
                         influence_cells)
                    SELECT
                        gen_random_uuid(),
                        u.id,
                        :today,
                        COALESCE(SUM(r.distance_meters) / 1000.0, 0) AS all_time_km,
                        COALESCE(SUM(CASE WHEN r.started_at >= :cutoff90
                                    THEN r.distance_meters / 1000.0 ELSE 0 END), 0) AS ninety_day_km,
                        COALESCE((SELECT COUNT(*) FROM user_cell_stats ucs
                                  WHERE ucs.user_id = u.id
                                    AND ucs.achievement_state IN ('claimed','defended','reclaimed')), 0),
                        0,  -- consistency_streak computed separately
                        NULL, NULL,
                        u.city, u.metro_region,
                        -- Any live score at all, led or not. This is the wider
                        -- number the moving average is built from.
                        COALESCE((SELECT COUNT(*) FROM user_cell_stats ucs2
                                  WHERE ucs2.user_id = u.id
                                    AND ucs2.decayed_score > 0), 0)
                    FROM users u
                    LEFT JOIN runs r ON r.user_id = u.id AND r.status = 'processed'
                    WHERE u.is_active = TRUE AND u.is_banned = FALSE
                    GROUP BY u.id, u.city, u.metro_region
                    ON CONFLICT (user_id, snapshot_date) DO UPDATE
                        SET all_time_mileage_km   = EXCLUDED.all_time_mileage_km,
                            ninety_day_mileage_km = EXCLUDED.ninety_day_mileage_km,
                            territory_held        = EXCLUDED.territory_held,
                            influence_cells       = EXCLUDED.influence_cells,
                            city                  = EXCLUDED.city,
                            metro_region          = EXCLUDED.metro_region
                """).bindparams(today=today, cutoff90=cutoff_90)
            )

            # Update consistency streaks
            await _update_streaks(db, today)

            # Update season mileage for active season
            await _update_season_stats(db)

            # Cells actually led, and the moving averages over influence.
            await _update_cells_led(db, today)
            await _update_influence_moving_average(db, today)

            # The vanity ladder, cached on today's row.
            await _update_ranks(db, today)

            await db.commit()
            logger.info("[Leaderboard] Materialization complete")
        except Exception as e:
            await db.rollback()
            logger.error(f"[Leaderboard] Failed: {e}", exc_info=True)


async def _update_streaks(db, today):
    """
    Compute consistency streak: consecutive days with at least one run.
    Simplified: count distinct run days in last 30 days.
    Full streak computation done via window function.
    """
    await db.execute(
        text("""
            UPDATE leaderboard_daily ld
            SET consistency_streak = (
                SELECT COUNT(DISTINCT DATE(r.started_at))
                FROM runs r
                WHERE r.user_id = ld.user_id
                  AND r.status = 'processed'
                  AND r.started_at >= NOW() - INTERVAL '30 days'
            )
            WHERE ld.snapshot_date = :today
        """).bindparams(today=today)
    )


async def _update_season_stats(db):
    """Update season-specific mileage and territory for active season."""
    await db.execute(
        text("""
            UPDATE leaderboard_daily ld
            SET season_mileage_km = (
                SELECT COALESCE(SUM(r.distance_meters) / 1000.0, 0)
                FROM runs r
                JOIN seasons s ON r.started_at BETWEEN s.starts_at AND s.ends_at
                WHERE r.user_id = ld.user_id
                  AND r.status = 'processed'
                  AND s.status = 'active'
            ),
            season_territory = (
                SELECT COUNT(*)
                FROM user_cell_stats ucs
                WHERE ucs.user_id = ld.user_id
                  AND ucs.achievement_state IN ('claimed','defended','reclaimed')
            )
            WHERE ld.snapshot_date = CURRENT_DATE
        """)
    )


async def _update_cells_led(db, today):
    """
    How many cells this runner is the top scorer in.

    DISTINCT ON picks one row per cell — the leader — and the outer count is how
    many of those rows belong to each user. Runners who lead nothing are left at
    the column default of zero rather than appearing in the join.
    """
    await db.execute(
        text("""
            UPDATE leaderboard_daily ld
            SET cells_led = COALESCE(led.n, 0)
            FROM (
                SELECT leader.user_id, COUNT(*) AS n
                FROM (
                    SELECT DISTINCT ON (cell_id) cell_id, user_id
                    FROM user_cell_stats
                    WHERE decayed_score > 0
                    ORDER BY cell_id, decayed_score DESC
                ) leader
                GROUP BY leader.user_id
            ) led
            WHERE led.user_id = ld.user_id AND ld.snapshot_date = :today
        """).bindparams(today=today)
    )


async def _update_influence_moving_average(db, today):
    """
    Mean influence over the trailing 7 and 30 snapshots, today included.

    Averaged over however many snapshots exist rather than assuming 7 or 30, so
    a runner in their first week gets a real figure instead of one divided by
    days they were not registered for.
    """
    await db.execute(
        text("""
            UPDATE leaderboard_daily ld
            SET influence_ma_7 = COALESCE((
                    SELECT AVG(w.influence_cells) FROM (
                        SELECT p.influence_cells FROM leaderboard_daily p
                        WHERE p.user_id = ld.user_id AND p.snapshot_date <= :today
                        ORDER BY p.snapshot_date DESC LIMIT 7
                    ) w
                ), 0),
                influence_ma_30 = COALESCE((
                    SELECT AVG(w.influence_cells) FROM (
                        SELECT p.influence_cells FROM leaderboard_daily p
                        WHERE p.user_id = ld.user_id AND p.snapshot_date <= :today
                        ORDER BY p.snapshot_date DESC LIMIT 30
                    ) w
                ), 0)
            WHERE ld.snapshot_date = :today
        """).bindparams(today=today)
    )


async def _update_ranks(db, today):
    """Score every runner on the SAF ladder and write the result to today's row."""
    inputs_by_user = await load_all_rank_inputs(db)
    if not inputs_by_user:
        return

    rows = []
    for user_id, inputs in inputs_by_user.items():
        rank = compute_rank(inputs)
        rows.append({
            "uid": user_id,
            "track": rank.track,
            "code": rank.code,
            "idx": rank.index,
            "pts": rank.points,
            "today": today,
        })

    # executemany: one statement, one round trip per batch, rather than a
    # correlated subquery that would have to redo the streak walk in SQL.
    await db.execute(
        text("""
            UPDATE leaderboard_daily
            SET rank_track = :track, rank_code = :code,
                rank_index = :idx, rank_points = :pts
            WHERE user_id = CAST(:uid AS UUID) AND snapshot_date = :today
        """),
        rows,
    )
    logger.info("[Leaderboard] Ranked %d runners", len(rows))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(materialize())
