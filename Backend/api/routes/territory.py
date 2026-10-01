"""
Runturfing Backend – Territory Routes
GET /territory/viewport     – Cells inside the map viewport, shaped for the app
GET /territory/user/{uid}   – User's territory assets
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.database import get_db
from api.services.territory_scoring import cell_boundary, cell_neighbours, leader_density

router = APIRouter()

# States that read as "someone owns this" on the map.
OWNING_STATES = ("claimed", "defended", "reclaimed", "contested")


@router.get("/viewport")
async def get_viewport(
    request: Request,
    swLat: float,
    swLng: float,
    neLat: float,
    neLng: float,
    db: AsyncSession = Depends(get_db),
):
    """
    Everything the map screen draws, in the shape of the client's
    TerritoryViewport type (camelCase, cells + zones + userStats).

    Parameter names are camelCase deliberately — they are what the app already
    sends. The previous endpoint lived at a different path, took different
    parameter names, and ignored them anyway, returning the global top 2000
    rows by score; cells now come from an indexed range scan on the stored
    centroids (migration 005).

    One row per cell: the top scorer's view of it. Each cell carries its real
    H3 boundary so the client draws exactly what the server scored — the app's
    old client-side hexagon was a fixed ~50 m approximation, roughly 4x too
    small for r9, and did not tile.
    """
    user_id = request.state.user_id

    # DISTINCT ON keeps the highest-scoring row per cell. The margin between
    # top and second determines contested, so fetch the runner-up score too.
    cells_result = await db.execute(
        text("""
            SELECT DISTINCT ON (ucs.cell_id)
                   ucs.cell_id, ucs.cell_lat, ucs.cell_lng,
                   ucs.achievement_state, ucs.decayed_score,
                   ucs.lifetime_meters, ucs.thirty_day_meters,
                   ucs.unique_active_days, ucs.last_seen_at,
                   ucs.user_id, u.display_name,
                   -- The caller's own stake in the same cell. Without this the
                   -- map showed only the leader, so running ground somebody
                   -- else holds looked identical to never having been there —
                   -- your own effort was invisible until you overtook them.
                   mine.decayed_score AS my_score,
                   mine.achievement_state AS my_state,
                   -- The holder's picture, so the map can show whose ground a
                   -- cell is without the user tapping it.
                   op.avatar_url AS owner_avatar
            FROM user_cell_stats ucs
            JOIN users u ON u.id = ucs.user_id
            LEFT JOIN profiles op ON op.user_id = ucs.user_id
            LEFT JOIN user_cell_stats mine
                   ON mine.cell_id = ucs.cell_id AND mine.user_id = :uid
            WHERE ucs.decayed_score > 0
              AND ucs.cell_lat BETWEEN :sw_lat AND :ne_lat
              AND ucs.cell_lng BETWEEN :sw_lng AND :ne_lng
            ORDER BY ucs.cell_id, ucs.decayed_score DESC
            LIMIT 2000
        """).bindparams(uid=user_id, sw_lat=swLat, ne_lat=neLat, sw_lng=swLng, ne_lng=neLng)
    )

    cells = []
    for r in cells_result.fetchall():
        cells.append({
            "h3Index": r[0],
            "lat": r[1],
            "lng": r[2],
            # Real hex outline, drawn verbatim by the client.
            "boundary": [[lat, lng] for lat, lng in cell_boundary(r[0])],
            "state": r[3],
            "score": r[4],
            "lifetimeMeters": r[5],
            "thirtyDayMeters": r[6],
            "uniqueActiveDays": r[7],
            "lastSeen": r[8].isoformat() if r[8] else None,
            "ownerUserId": str(r[9]),
            "ownerDisplayName": r[10],
            "ownerAvatarUrl": r[13],
            "isContested": r[3] == "contested",
            # The caller's own standing here. yourScore is 0 when they have
            # never run this cell; isYours distinguishes "I hold this" from
            # "I have been here but someone else holds it".
            "yourScore": round(r[11], 1) if r[11] is not None else 0,
            "yourState": r[12] or "neutral",
            "isYours": str(r[9]) == str(user_id),
            # How far off taking it. Zero when it is already yours.
            "pointsBehind": (
                0 if str(r[9]) == str(user_id)
                else round(r[4] - (r[11] or 0), 1)
            ),
        })

    # Participation density. One hex tells you who leads it and nothing about
    # whether that lead is a fluke, so the map needs a second dimension: how
    # much of the ground immediately around a cell the same person also leads.
    # Dense patches paint heavier, which is what makes a stronghold read as a
    # region instead of a scattering of individually-coloured tiles.
    owner_by_cell = {c["h3Index"]: c["ownerUserId"] for c in cells}
    for c in cells:
        c["leaderDensity"] = round(leader_density(owner_by_cell, c["h3Index"]), 3)
        # Same owner within two steps, itself included. This is the number the
        # "stronghold" label is drawn from — a full immediate ring can happen by
        # accident on a single loop, a filled two-ring cannot.
        near = cell_neighbours(c["h3Index"], radius=2)
        c["strongholdSize"] = 1 + sum(
            1 for n in near if owner_by_cell.get(n) == c["ownerUserId"]
        )

    # The peak of each owner's patch, so the client can label a stronghold once
    # rather than on every cell in it.
    peaks: dict[str, dict] = {}
    for c in cells:
        best = peaks.get(c["ownerUserId"])
        if best is None or c["strongholdSize"] > best["strongholdSize"]:
            peaks[c["ownerUserId"]] = c
    for c in cells:
        c["isStrongholdCore"] = False
    for owner, c in peaks.items():
        # Below this it is a route, not a hold, and labelling it would clutter
        # the map with a badge on every runner's commute.
        if c["strongholdSize"] >= 5:
            c["isStrongholdCore"] = True

    # The caller's own standing, for the stats bar.
    stats_row = (await db.execute(
        text("""
            SELECT COUNT(*) FILTER (WHERE decayed_score > 0),
                   COUNT(*) FILTER (WHERE achievement_state = ANY(:owning)),
                   COUNT(*) FILTER (WHERE achievement_state = 'contested'),
                   COALESCE(SUM(lifetime_meters), 0)
            FROM user_cell_stats
            WHERE user_id = :uid
        """).bindparams(uid=user_id, owning=list(OWNING_STATES))
    )).fetchone()

    return {
        "cells": cells,
        # Zones (named neighbourhood groupings) have no producer yet — nothing
        # writes territory_assets. Empty list keeps the client contract honest.
        "zones": [],
        "userStats": {
            "totalCells": stats_row[0] or 0,
            "claimedCells": stats_row[1] or 0,
            "contestedCells": stats_row[2] or 0,
            "totalMeters": stats_row[3] or 0,
        },
    }


@router.get("/user/{target_user_id}")
async def get_user_territory(
    target_user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            SELECT id, user_id, asset_type, name, cell_ids, centroid_lat, centroid_lng
            FROM territory_assets
            WHERE user_id = :uid
            ORDER BY updated_at DESC
        """).bindparams(uid=target_user_id)
    )
    return [
        {
            "id": str(r[0]),
            "user_id": str(r[1]),
            "asset_type": r[2],
            "name": r[3],
            "cell_ids": r[4] or [],
            "centroid_lat": r[5],
            "centroid_lng": r[6],
        }
        for r in result.fetchall()
    ]
