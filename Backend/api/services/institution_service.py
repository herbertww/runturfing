"""
Runturfing – institution service.

School standings for an orientation season. The individual game is unchanged:
cells still belong to one runner. What this adds is a second reading of the same
data, where every cell a runner holds also counts for the school they declared.

The table ranks on **total turf held**. Not on turf per runner.

An average was the obvious first move, on the reasoning that it stops a large
campus winning on headcount. It fails badly in the other direction: a school
fielding one strong runner and nobody else posts an unbeatable average, and
every additional entrant can only drag it down. That makes recruiting a
schoolmate an act of self-harm, in the one season whose entire purpose is to
spread through orientation group chats.

Totalling has the property the season actually needs. Every runner a school
adds moves it up, or at worst leaves it where it was, so the invite is always
worth sending. It does favour the larger campuses, which is a real cost and the
accepted one: a season that rewards mobilisation is the point.

`runners` and `active_runners` are still reported, as context beside the score
rather than as part of it.
"""

from dataclasses import dataclass
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class InstitutionStanding:
    institution_id: str
    slug: str
    name: str
    short_name: str
    kind: str
    color: str
    runners: int
    active_runners: int
    turf_cells: int
    total_km: float
    rank: int


# `active_runners` counts members who have actually run. It is reported beside
# the score rather than dividing it, so a member who signs up and never starts
# costs their school nothing.
_STANDINGS_SQL = """
WITH latest AS (
    SELECT MAX(snapshot_date) AS d FROM leaderboard_daily
),
member_stats AS (
    SELECT u.institution_id,
           u.id                                        AS user_id,
           COALESCE(ld.season_territory, 0)            AS cells,
           COALESCE(ld.season_mileage_km, 0)           AS km
    FROM users u
    LEFT JOIN leaderboard_daily ld
           ON ld.user_id = u.id
          AND ld.snapshot_date = (SELECT d FROM latest)
    WHERE u.institution_id IS NOT NULL
      AND u.is_active
      AND NOT u.is_banned
)
SELECT i.id, i.slug, i.name, i.short_name, i.kind, i.color,
       COUNT(m.user_id)                                       AS runners,
       COUNT(m.user_id) FILTER (WHERE m.km > 0)               AS active_runners,
       COALESCE(SUM(m.cells), 0)                              AS turf_cells,
       COALESCE(SUM(m.km), 0)                                 AS total_km
FROM institutions i
LEFT JOIN member_stats m ON m.institution_id = i.id
WHERE i.is_active
GROUP BY i.id, i.slug, i.name, i.short_name, i.kind, i.color, i.sort_order
ORDER BY i.sort_order
"""


class InstitutionService:
    @staticmethod
    async def standings(db: AsyncSession) -> list[InstitutionStanding]:
        rows = (await db.execute(text(_STANDINGS_SQL))).fetchall()

        scored = [
            (r, r[6] or 0, r[7] or 0, r[8] or 0, float(r[9] or 0))
            for r in rows
        ]

        # Total turf held. Distance breaks ties, so two schools sitting on the
        # same number of cells are separated by how much running went into them.
        scored.sort(key=lambda s: (s[3], s[4]), reverse=True)

        return [
            InstitutionStanding(
                institution_id=str(r[0]),
                slug=r[1],
                name=r[2],
                short_name=r[3],
                kind=r[4],
                color=r[5],
                runners=runners,
                active_runners=active,
                turf_cells=cells,
                total_km=round(km, 1),
                rank=i + 1,
            )
            for i, (r, runners, active, cells, km) in enumerate(scored)
        ]

    @staticmethod
    async def get_by_slug(db: AsyncSession, slug: str) -> Optional[dict]:
        row = (await db.execute(
            text("""
                SELECT id, slug, name, short_name, kind, color
                FROM institutions
                WHERE slug = :slug AND is_active
            """).bindparams(slug=slug.lower())
        )).fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]),
            "slug": row[1],
            "name": row[2],
            "shortName": row[3],
            "kind": row[4],
            "color": row[5],
        }
