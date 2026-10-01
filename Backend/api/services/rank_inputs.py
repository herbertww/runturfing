"""
Runturfing – Loading the aggregates the rank ladder scores.

Kept apart from rank_service so the ladder itself stays pure. One SQL statement
serves both callers: the profile route binds a user id, the hourly leaderboard
job binds nothing and gets a row per runner.

Flagged runs are excluded everywhere. A run under anti-cheat review must not
promote anyone, and letting it count and then demoting them later reads as the
app taking a rank away.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.rank_service import RankInputs

# Distinct run days per user, then the classic gaps-and-islands trick: subtract
# the row number from the date and consecutive days collapse to one group, so
# the longest run of days is the largest group.
_RANK_AGGREGATE_SQL = """
WITH eligible AS (
    SELECT user_id, started_at, distance_meters, duration_seconds
    FROM runs
    WHERE status <> 'flagged'
      {user_filter}
),
days AS (
    SELECT DISTINCT user_id, DATE(started_at) AS d FROM eligible
),
grouped AS (
    SELECT user_id, d,
           d - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY d))::int AS island
    FROM days
),
streaks AS (
    SELECT user_id, island, COUNT(*) AS run_length
    FROM grouped GROUP BY user_id, island
),
longest AS (
    SELECT user_id, MAX(run_length) AS longest_streak FROM streaks GROUP BY user_id
),
active90 AS (
    SELECT user_id, COUNT(*) AS active_days
    FROM days WHERE d >= (CURRENT_DATE - INTERVAL '90 days')
    GROUP BY user_id
),
weeks AS (
    SELECT user_id, DATE_TRUNC('week', d) AS wk, COUNT(*) AS run_days
    FROM days WHERE d >= (CURRENT_DATE - INTERVAL '365 days')
    GROUP BY user_id, DATE_TRUNC('week', d)
),
consistent AS (
    SELECT user_id, COUNT(*) AS consistent_weeks
    FROM weeks WHERE run_days >= 3 GROUP BY user_id
),
totals AS (
    SELECT user_id,
           COALESCE(SUM(distance_meters), 0) / 1000.0 AS total_km,
           COALESCE(SUM(duration_seconds), 0)         AS total_seconds
    FROM eligible GROUP BY user_id
)
SELECT t.user_id,
       t.total_km,
       -- Distance over time across every run, not the best single one.
       CASE WHEN t.total_seconds > 0
            THEN t.total_km / (t.total_seconds / 3600.0)
            ELSE 0 END                       AS avg_speed_kmh,
       COALESCE(a.active_days, 0)            AS active_days_90,
       COALESCE(l.longest_streak, 0)         AS longest_streak,
       COALESCE(c.consistent_weeks, 0)       AS consistent_weeks
FROM totals t
LEFT JOIN active90   a ON a.user_id = t.user_id
LEFT JOIN longest    l ON l.user_id = t.user_id
LEFT JOIN consistent c ON c.user_id = t.user_id
"""


def _row_to_inputs(row) -> RankInputs:
    return RankInputs(
        total_km=float(row[1] or 0),
        avg_speed_kmh=float(row[2] or 0),
        active_days_90=int(row[3] or 0),
        longest_streak=int(row[4] or 0),
        consistent_weeks=int(row[5] or 0),
    )


async def load_rank_inputs(db: AsyncSession, user_id: str) -> RankInputs:
    """One runner's aggregates. Returns empty inputs for a runner with no runs,
    which places them at Recruit rather than erroring."""
    sql = _RANK_AGGREGATE_SQL.format(user_filter="AND user_id = :uid")
    row = (await db.execute(text(sql).bindparams(uid=user_id))).fetchone()
    return _row_to_inputs(row) if row else RankInputs()


async def load_all_rank_inputs(db: AsyncSession) -> dict[str, RankInputs]:
    """Every runner who has logged a run, keyed by user id."""
    sql = _RANK_AGGREGATE_SQL.format(user_filter="")
    rows = (await db.execute(text(sql))).fetchall()
    return {str(r[0]): _row_to_inputs(r) for r in rows}
