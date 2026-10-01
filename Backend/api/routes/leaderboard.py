"""
Runturfing Backend – Leaderboard Routes
GET /leaderboard                    – The app's leaderboard tab (LeaderboardPage)
GET /leaderboard/perpetual          – All-time + 90-day leaderboard (legacy shape)
GET /leaderboard/groups             – Groups of a season ranked against each other
GET /leaderboard/season/{season_id} – Season-specific leaderboard (legacy shape)

Two boards, and they measure different things. `GET /leaderboard` ranks
INDIVIDUALS, and its seasonal type ranks every runner in the season against
every other one — it is not scoped to the six a runner was matched with.
`GET /leaderboard/groups` is the intergroup board: groups of six, ranked
against each other on the season total. The `scope=group` filter on the
individual board is a lens on the open board, not a separate competition.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db
from api.config import settings

router = APIRouter()
PAGE_SIZE = settings.__class__.__dict__.get("leaderboard_page_size", 50)


# Each metric names the snapshot column it sorts on, the unit the app prints
# under the number, and how many decimals the value carries.
#
# influence_ma is the one metric that is not winner-takes-all. Every other
# territory figure counts cells a runner leads, so coming second across a whole
# neighbourhood scores zero. This one counts cells they have any live score in,
# averaged over 30 snapshots so a single strong week cannot settle it.
METRICS: dict[str, tuple[str, str, int]] = {
    # perpetual
    "alltime_mileage": ("all_time_mileage_km", "km", 1),
    "mileage_90d": ("ninety_day_mileage_km", "km", 1),
    "territory_held": ("territory_held", "cells", 0),
    "streak": ("consistency_streak", "days", 0),
    "influence_ma": ("influence_ma_30", "cells (30d avg)", 1),
    "cells_led": ("cells_led", "cells led", 0),
    "rank": ("rank_points", "rank pts", 0),
    # seasonal
    "season_mileage": ("season_mileage_km", "km", 1),
    "territory_control": ("season_territory", "cells", 0),
    "defense_consistency": ("defense_consistency", "%", 0),
    # No threshold column exists on the snapshot. Active run days in the last 30
    # is the input the season threshold is actually judged on, so it is what the
    # progress metric shows rather than inventing a percentage.
    "threshold_progress": ("consistency_streak", "active days", 0),
}

DEFAULT_METRIC = {"perpetual": "alltime_mileage", "seasonal": "season_mileage"}


@router.get("")
@router.get("/")
async def leaderboard(
    request: Request,
    type: str = "perpetual",
    metric: str | None = None,
    scope: str = "global",
    page: int = 0,
    pageSize: int = 50,
    seasonId: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """
    The leaderboard tab in one call, shaped to LeaderboardPage in
    Android/src/types/index.ts.

    Ranking runs over the whole filtered field before the page is cut, so rank
    numbers are absolute and the caller's own row can be appended below the page
    with its true position. Without that, a runner outside the top 50 saw no
    row at all, which is the case the metric is most worth reading in.
    """
    user_id = request.state.user_id

    if type not in ("perpetual", "seasonal"):
        raise HTTPException(status_code=400, detail="type must be perpetual or seasonal")
    metric = metric or DEFAULT_METRIC[type]
    if metric not in METRICS:
        raise HTTPException(status_code=400, detail=f"Unknown metric: {metric}")

    column, unit, decimals = METRICS[metric]
    page = max(0, page)
    page_size = max(1, min(100, pageSize))
    offset = page * page_size

    joins, where, params = "", [], {"uid": user_id}

    if scope == "city":
        city_row = (await db.execute(
            text("SELECT city FROM users WHERE id = :uid").bindparams(uid=user_id)
        )).fetchone()
        city = city_row[0] if city_row else None
        if city:
            where.append("ld.city = :city")
            params["city"] = city

    elif scope in ("group", "friends"):
        # A lens on the open board, not a separate competition: the rank numbers
        # a runner sees here are their position among the six, while their real
        # season standing is the unscoped board. "friends" is the old name for
        # the same filter and still answers, because shipped clients send it.
        joins += """
            JOIN season_entries mine_se
                 ON mine_se.user_id = :uid AND mine_se.group_id IS NOT NULL
            JOIN season_entries their_se
                 ON their_se.group_id = mine_se.group_id
                AND their_se.user_id = ld.user_id
        """

    if type == "seasonal":
        if seasonId:
            joins += """
                JOIN season_entries se_filter
                     ON se_filter.user_id = ld.user_id AND se_filter.season_id = :sid
            """
            params["sid"] = seasonId
        else:
            joins += """
                JOIN season_entries se_filter ON se_filter.user_id = ld.user_id
                JOIN seasons s_filter
                     ON s_filter.id = se_filter.season_id AND s_filter.status = 'active'
            """

    where_sql = ("AND " + " AND ".join(where)) if where else ""

    # Rank change is measured against the snapshot a week back on the same
    # metric. A runner with no snapshot then has no delta rather than a
    # fabricated jump from last place.
    sql = f"""
        WITH latest AS (SELECT MAX(snapshot_date) AS d FROM leaderboard_daily),
        current_board AS (
            SELECT ld.user_id, u.display_name, p.avatar_url, ld.city,
                   COALESCE(ld.{column}, 0) AS value,
                   ld.rank_track, ld.rank_code, ld.rank_index,
                   ld.influence_cells, ld.influence_ma_7, ld.influence_ma_30,
                   ld.cells_led,
                   ROW_NUMBER() OVER (
                       ORDER BY COALESCE(ld.{column}, 0) DESC, u.display_name ASC
                   ) AS rank
            FROM leaderboard_daily ld
            JOIN users u ON u.id = ld.user_id
            LEFT JOIN profiles p ON p.user_id = ld.user_id
            {joins}
            WHERE ld.snapshot_date = (SELECT d FROM latest)
              AND u.is_banned = FALSE
              {where_sql}
        ),
        prior_board AS (
            SELECT ld.user_id,
                   ROW_NUMBER() OVER (
                       ORDER BY COALESCE(ld.{column}, 0) DESC, u.display_name ASC
                   ) AS rank
            FROM leaderboard_daily ld
            JOIN users u ON u.id = ld.user_id
            {joins}
            WHERE ld.snapshot_date = (SELECT d FROM latest) - 7
              AND u.is_banned = FALSE
              {where_sql}
        )
        SELECT c.*, (p.rank - c.rank) AS delta,
               COUNT(*) OVER () AS total_count
        FROM current_board c
        LEFT JOIN prior_board p ON p.user_id = c.user_id
        ORDER BY c.rank
    """

    # Only bind what the assembled statement actually mentions — SQLAlchemy
    # rejects a bindparam that has no placeholder, and :uid disappears from the
    # SQL entirely on a global perpetual board.
    bound = {k: v for k, v in params.items() if f":{k}" in sql}
    rows = (await db.execute(text(sql).bindparams(**bound))).fetchall()

    total = int(rows[0][-1]) if rows else 0
    page_rows = rows[offset:offset + page_size]
    entries = [_entry(r, user_id, unit, decimals) for r in page_rows]

    mine = next((r for r in rows if str(r[0]) == str(user_id)), None)
    current_entry = _entry(mine, user_id, unit, decimals) if mine is not None else None

    return {
        "entries": entries,
        "currentUserEntry": current_entry,
        "totalCount": total,
        "page": page,
        "pageSize": page_size,
    }


def _entry(r, user_id: str, unit: str, decimals: int) -> dict:
    value = float(r[4] or 0)
    return {
        "rank": int(r[12]),
        "userId": str(r[0]),
        "displayName": r[1],
        "avatarUrl": r[2],
        "city": r[3],
        "value": round(value, decimals) if decimals else int(round(value)),
        "unit": unit,
        "delta": int(r[13]) if r[13] is not None else None,
        "isCurrentUser": str(r[0]) == str(user_id),
        # Carried on every row so the list can show the ladder badge and the
        # influence average next to whatever metric is being sorted on.
        "rankTrack": r[5],
        "rankCode": r[6],
        "rankIndex": r[7],
        "influenceCells": r[8] or 0,
        "influenceMa7": round(float(r[9] or 0), 1),
        "influenceMa30": round(float(r[10] or 0), 1),
        "cellsLed": r[11] or 0,
    }


@router.get("/perpetual")
async def perpetual_leaderboard(
    request: Request,
    filter: str = "global",
    page: int = 0,
    db: AsyncSession = Depends(get_db),
):
    user_id = request.state.user_id
    offset = page * 50

    if filter == "city":
        # Get user's city first
        city_result = await db.execute(
            text("SELECT city FROM users WHERE id = :uid").bindparams(uid=user_id)
        )
        city_row = city_result.fetchone()
        city = city_row[0] if city_row else None
        where_clause = "AND ld.city = :city" if city else ""
        params = {"offset": offset, "city": city} if city else {"offset": offset}
    else:
        where_clause = ""
        params = {"offset": offset}

    result = await db.execute(
        text(f"""
            SELECT ld.user_id, u.display_name, p.avatar_url, u.city,
                   ld.all_time_mileage_km, ld.ninety_day_mileage_km,
                   ld.territory_held, ld.consistency_streak,
                   ROW_NUMBER() OVER (ORDER BY ld.ninety_day_mileage_km DESC) AS rank
            FROM leaderboard_daily ld
            JOIN users u ON u.id = ld.user_id
            LEFT JOIN profiles p ON p.user_id = ld.user_id
            WHERE ld.snapshot_date = (SELECT MAX(snapshot_date) FROM leaderboard_daily)
              {where_clause}
            ORDER BY ld.ninety_day_mileage_km DESC
            LIMIT 50 OFFSET :offset
        """).bindparams(**params)
    )
    rows = result.fetchall()
    return [_format_lb_row(r) for r in rows]


# The intergroup board. Groups are all six runners, so these are totals, never
# averages: an average would mean a group's sixth runner could only drag it down
# and a group carried by one runner would be unbeatable. Same reasoning as the
# institution standings in docs/ORIENTATION_SEASON.md.
GROUP_METRICS: dict[str, tuple[str, str, str, int]] = {
    # key: (snapshot column, aggregate, unit, decimals)
    "season_mileage": ("season_mileage_km", "SUM", "km", 1),
    "territory_control": ("season_territory", "SUM", "cells", 0),
    # The exception. Defense is already a rate per runner, so summing six rates
    # produces a number with no meaning; this one averages.
    "defense_consistency": ("defense_consistency", "AVG", "%", 0),
}


@router.get("/groups")
async def group_leaderboard(
    request: Request,
    metric: str = "season_mileage",
    seasonId: str | None = None,
    page: int = 0,
    pageSize: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """
    Groups of a season ranked against each other.

    This is the intergroup competition the season is built on, and it is a
    different board from `GET /leaderboard`: that one ranks every runner in the
    season openly, this one ranks the groups. A runner reads both — where they
    sit among everyone, and how the six they were matched with are doing against
    the other groups.

    Defaults to the active season when no seasonId is given.
    """
    user_id = request.state.user_id

    if metric not in GROUP_METRICS:
        raise HTTPException(status_code=400, detail=f"Unknown group metric: {metric}")
    column, agg, unit, decimals = GROUP_METRICS[metric]

    page = max(0, page)
    page_size = max(1, min(100, pageSize))
    offset = page * page_size

    params: dict = {"uid": user_id}
    if seasonId:
        season_clause = "sg.season_id = :sid"
        params["sid"] = seasonId
    else:
        season_clause = "s.status = 'active'"

    # Members are counted from entries rather than assumed to be six: a group
    # part-way through matching has fewer, and printing "6 runners" over four of
    # them is the kind of small lie that makes the whole board look invented.
    sql = f"""
        WITH latest AS (SELECT MAX(snapshot_date) AS d FROM leaderboard_daily),
        board AS (
            SELECT sg.id AS group_id,
                   sg.name AS group_name,
                   sg.season_id,
                   COUNT(DISTINCT se.user_id) AS members,
                   COALESCE({agg}(ld.{column}), 0) AS value,
                   BOOL_OR(se.user_id = :uid) AS is_mine,
                   ROW_NUMBER() OVER (
                       ORDER BY COALESCE({agg}(ld.{column}), 0) DESC, sg.id ASC
                   ) AS rank
            FROM season_groups sg
            JOIN seasons s ON s.id = sg.season_id
            JOIN season_entries se ON se.group_id = sg.id
            LEFT JOIN users u ON u.id = se.user_id AND u.is_banned = FALSE
            LEFT JOIN leaderboard_daily ld
                   ON ld.user_id = u.id AND ld.snapshot_date = (SELECT d FROM latest)
            WHERE {season_clause}
            GROUP BY sg.id, sg.name, sg.season_id
        )
        SELECT * FROM board
    """

    total = (await db.execute(
        text(f"SELECT COUNT(*) FROM ({sql}) c").bindparams(**params)
    )).scalar() or 0

    rows = (await db.execute(
        text(f"{sql} ORDER BY rank LIMIT :limit OFFSET :offset")
        .bindparams(**params, limit=page_size, offset=offset)
    )).fetchall()

    def shape(r) -> dict:
        return {
            "rank": int(r.rank),
            "groupId": str(r.group_id),
            # Groups are matched, not named by anyone, so most have no name.
            "groupName": r.group_name or f"Group {int(r.rank)}",
            "seasonId": str(r.season_id),
            "members": int(r.members),
            "value": round(float(r.value or 0), decimals),
            "unit": unit,
            "isMyGroup": bool(r.is_mine),
        }

    entries = [shape(r) for r in rows]

    # The caller's own group, appended when it fell outside the page. A runner
    # whose group is 40th should not open the board to no row of their own.
    my_row = None
    if not any(e["isMyGroup"] for e in entries):
        found = (await db.execute(
            text(f"SELECT * FROM ({sql} ) b WHERE b.is_mine LIMIT 1").bindparams(**params)
        )).fetchone()
        if found:
            my_row = shape(found)

    return {
        "entries": entries,
        "myGroup": my_row,
        "metric": metric,
        "unit": unit,
        "page": page,
        "pageSize": page_size,
        "total": int(total),
        "hasMore": offset + len(entries) < int(total),
    }


@router.get("/season/{season_id}")
async def season_leaderboard(
    season_id: str,
    request: Request,
    page: int = 0,
    db: AsyncSession = Depends(get_db),
):
    offset = page * 50
    result = await db.execute(
        text("""
            SELECT ld.user_id, u.display_name, p.avatar_url, u.city,
                   ld.all_time_mileage_km, ld.ninety_day_mileage_km,
                   ld.territory_held, ld.consistency_streak,
                   ld.season_mileage_km, ld.season_territory, ld.defense_consistency,
                   ROW_NUMBER() OVER (ORDER BY ld.season_mileage_km DESC NULLS LAST) AS rank
            FROM leaderboard_daily ld
            JOIN users u ON u.id = ld.user_id
            LEFT JOIN profiles p ON p.user_id = ld.user_id
            JOIN season_entries se ON se.user_id = ld.user_id AND se.season_id = :sid
            WHERE ld.snapshot_date = (SELECT MAX(snapshot_date) FROM leaderboard_daily)
            ORDER BY ld.season_mileage_km DESC NULLS LAST
            LIMIT 50 OFFSET :offset
        """).bindparams(sid=season_id, offset=offset)
    )
    rows = result.fetchall()
    return [_format_lb_row(r, seasonal=True) for r in rows]


def _format_lb_row(r, seasonal: bool = False) -> dict:
    entry = {
        "id": str(r[0]),
        "user_id": str(r[0]),
        "display_name": r[1],
        "avatar_url": r[2],
        "city": r[3],
        "rank": int(r[8] if not seasonal else r[11]),
        "all_time_mileage_km": r[4],
        "ninety_day_mileage_km": r[5],
        "territory_held": r[6],
        "consistency_streak": r[7],
    }
    if seasonal:
        entry["season_mileage_km"] = r[8]
        entry["season_territory_control"] = r[9]
        entry["defense_consistency"] = r[10]
    return entry
