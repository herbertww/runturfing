"""
Runturfing Backend – Runs Routes
POST /runs/import  – Import a completed run (HealthKit or live tracking),
                     which also enters the runner into any open season
GET  /runs         – List user's runs
GET  /runs/{id}    – Get single run

Live tracking is recorded on the device and posted once to /runs/import when
the runner stops. There is no server-side session: a run that loses signal or
crashes mid-way keeps its points locally instead of stranding half a route here.

Payloads are snake_case in, camelCase out, matching the Run interface in
Android/src/types/index.ts.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid

from api.database import get_db
from api.services.territory_service import TerritoryService
from api.services.anticheat_service import AntiCheatService
from api.services.season_service import SeasonService

router = APIRouter()


SOURCES = ("healthkit", "manual", "live_tracking")


class RunImportRequest(BaseModel):
    source: str
    started_at: datetime
    ended_at: datetime
    distance_meters: float
    duration_seconds: int
    elevation_gain_meters: Optional[float] = None
    encoded_polyline: str
    healthkit_workout_id: Optional[str] = None


def _run_json(row) -> dict:
    """Shape a runs row as the client's Run interface."""
    return {
        "id": str(row[0]),
        "userId": str(row[1]),
        "startedAt": row[2].isoformat(),
        "endedAt": row[3].isoformat(),
        "distanceMeters": row[4],
        "durationSeconds": row[5],
        "cellsUpdated": row[6] or 0,
        "status": row[7],
        "source": row[8],
        "newCellsClaimed": 0,
        "cellsDefended": 0,
        "cellsLost": 0,
    }


@router.post("/import")
async def import_run(
    body: RunImportRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    user_id = request.state.user_id

    if body.source not in SOURCES:
        raise HTTPException(
            status_code=400,
            detail=f"source must be one of {', '.join(SOURCES)}",
        )
    if body.duration_seconds <= 0 or body.distance_meters <= 0:
        raise HTTPException(status_code=400, detail="Run has no distance or duration")
    if not body.encoded_polyline:
        raise HTTPException(status_code=400, detail="Run has no route")

    # Validate pace (anti-cheat: < 2 min/km is suspicious for a run)
    if body.distance_meters > 0:
        pace_sec_per_km = body.duration_seconds / (body.distance_meters / 1000)
        if pace_sec_per_km < 120:  # faster than 2 min/km
            await AntiCheatService.flag_run(db, user_id, None, "unrealistic_pace")

    # Deduplicate HealthKit imports
    if body.healthkit_workout_id:
        result = await db.execute(
            text("SELECT id FROM runs WHERE healthkit_workout_id = :hk_id")
            .bindparams(hk_id=body.healthkit_workout_id)
        )
        if result.fetchone():
            raise HTTPException(status_code=409, detail="Run already imported")

    run_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO runs (id, user_id, started_at, ended_at, distance_meters,
                              duration_seconds, elevation_gain_meters, source, status,
                              healthkit_workout_id)
            VALUES (:id, :uid, :start, :end, :dist, :dur, :elev, :src, 'pending', :hk_id)
        """).bindparams(
            id=run_id, uid=user_id,
            start=body.started_at, end=body.ended_at,
            dist=body.distance_meters, dur=body.duration_seconds,
            elev=body.elevation_gain_meters, src=body.source,
            hk_id=body.healthkit_workout_id,
        )
    )

    # Store route
    route_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO run_routes (id, run_id, encoded_polyline, min_lat, max_lat, min_lng, max_lng)
            VALUES (:id, :run_id, :poly, 0, 0, 0, 0)
        """).bindparams(id=route_id, run_id=run_id, poly=body.encoded_polyline)
    )

    # Showing up is the entry. A run dated inside an open season enters this
    # runner into it, once, with nothing to pay and nothing to confirm. It runs
    # inside the same transaction as the run, so an entry cannot survive a run
    # that failed to save.
    await SeasonService.auto_enter_for_run(db, user_id, body.started_at)

    # Process territory in background
    background_tasks.add_task(
        TerritoryService.process_run,
        run_id=run_id,
        user_id=user_id,
        encoded_polyline=body.encoded_polyline,
        run_date=body.started_at,
    )

    await db.commit()

    return {
        "id": run_id,
        "userId": str(user_id),
        "startedAt": body.started_at.isoformat(),
        "endedAt": body.ended_at.isoformat(),
        "distanceMeters": body.distance_meters,
        "durationSeconds": body.duration_seconds,
        "status": "pending",
        "source": body.source,
        # Territory runs in the background, so the counts are all zero here.
        # The client re-reads the run once processing lands.
        "cellsUpdated": 0,
        "newCellsClaimed": 0,
        "cellsDefended": 0,
        "cellsLost": 0,
    }


@router.get("")
async def list_runs(
    request: Request,
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Pages are 1-based, matching runsApi.listRuns in the client."""
    user_id = request.state.user_id
    page = max(1, page)
    page_size = min(max(1, page_size), 100)

    total = (await db.execute(
        text("SELECT COUNT(*) FROM runs WHERE user_id = :uid").bindparams(uid=user_id)
    )).scalar_one()

    rows = (await db.execute(
        text("""
            SELECT id, user_id, started_at, ended_at, distance_meters,
                   duration_seconds, cell_count, status, source
            FROM runs
            WHERE user_id = :uid
            ORDER BY started_at DESC
            LIMIT :limit OFFSET :offset
        """).bindparams(uid=user_id, limit=page_size, offset=(page - 1) * page_size)
    )).fetchall()

    return {"runs": [_run_json(r) for r in rows], "total": total}


@router.get("/{run_id}")
async def get_run(run_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = request.state.user_id
    row = (await db.execute(
        text("""
            SELECT r.id, r.user_id, r.started_at, r.ended_at, r.distance_meters,
                   r.duration_seconds, r.cell_count, r.status, r.source,
                   rr.encoded_polyline,
                   COUNT(*) FILTER (WHERE ae.event_type = 'cell_claimed')       AS claimed,
                   COUNT(*) FILTER (WHERE ae.event_type = 'cell_defended')      AS defended,
                   COUNT(*) FILTER (WHERE ae.event_type = 'corridor_reclaimed') AS reclaimed
            FROM runs r
            LEFT JOIN run_routes rr         ON rr.run_id = r.id
            LEFT JOIN achievement_events ae ON ae.run_id = r.id
            WHERE r.id = :rid AND r.user_id = :uid
            GROUP BY r.id, rr.encoded_polyline
        """).bindparams(rid=run_id, uid=user_id)
    )).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Run not found")

    return {
        **_run_json(row),
        "routeEncoded": row[9],
        "newCellsClaimed": (row[10] or 0) + (row[12] or 0),
        "cellsDefended": row[11] or 0,
    }
