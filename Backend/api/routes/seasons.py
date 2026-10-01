"""
Runturfing Backend – Season Routes
GET  /seasons/current       – Current active season
GET  /seasons/{id}/my-group – User's group in a season
POST /seasons/join          – Enter a season (free, idempotent)
POST /seasons/bid           – Place a preference bid
POST /seasons/lock          – Admin: lock groups for a season
GET  /seasons/{id}/payout-preview – Preview payout eligibility
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
import uuid
from datetime import datetime, timezone

from api.database import get_db
from api.config import settings
from api.services.season_service import SeasonService

router = APIRouter()


class JoinSeasonRequest(BaseModel):
    season_id: str
    # No entry_fee_cents, and no price to name: entering a season is free.


class BidRequest(BaseModel):
    target_user_id: str
    season_id: str
    amount_cents: int


@router.get("/current")
async def get_current_season(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("""
            SELECT id, number, starts_at, ends_at, status, pool_amount_cents,
                   participant_count, kind, name
            FROM seasons
            WHERE status IN ('forming', 'active')
            ORDER BY starts_at DESC
            LIMIT 1
        """)
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No active season")
    return {
        "id": str(row[0]),
        "number": row[1],
        "starts_at": row[2].isoformat(),
        "ends_at": row[3].isoformat(),
        "status": row[4],
        "pool_amount_cents": row[5],
        "participant_count": row[6],
        "kind": row[7],
        "name": row[8],
        # Always zero. The key stays in the response because the client reads
        # it, but entering a season is free and the seasons.entry_fee_cents
        # column is no longer consulted (migration 011 zeroed it).
        "entry_fee_cents": 0,
    }


@router.get("/{season_id}/my-group")
async def get_my_group(
    season_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = request.state.user_id
    result = await db.execute(
        text("""
            SELECT sg.id, sg.name, sg.chat_thread_id, sg.total_mileage_km, sg.territory_cells
            FROM season_groups sg
            JOIN season_entries se ON se.group_id = sg.id
            WHERE se.user_id = :uid AND se.season_id = :sid
        """).bindparams(uid=user_id, sid=season_id)
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Not in a group for this season")

    group_id = str(row[0])
    # Get members
    members_result = await db.execute(
        text("""
            SELECT se.user_id, u.display_name, p.avatar_url, u.gender,
                   COALESCE(ld.season_mileage_km, 0) AS mileage
            FROM season_entries se
            JOIN users u ON u.id = se.user_id
            LEFT JOIN profiles p ON p.user_id = se.user_id
            LEFT JOIN leaderboard_daily ld ON ld.user_id = se.user_id
                AND ld.snapshot_date = (SELECT MAX(snapshot_date) FROM leaderboard_daily)
            WHERE se.group_id = :gid
        """).bindparams(gid=group_id)
    )
    members = [
        {
            "id": str(m[0]),
            "user_id": str(m[0]),
            "display_name": m[1],
            "avatar_url": m[2],
            "gender": m[3],
            "mileage_km": m[4] or 0,
        }
        for m in members_result.fetchall()
    ]

    return {
        "id": group_id,
        "season_id": season_id,
        "name": row[1],
        "chat_thread_id": str(row[2]) if row[2] else None,
        "total_mileage_km": row[3],
        "territory_cells": row[4],
        "members": members,
    }


@router.post("/join")
async def join_season(
    body: JoinSeasonRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Enter a season. Free, and safe to call more than once.

    Most runners never call this: the first run inside the season window enters
    them automatically (SeasonService.auto_enter_for_run, from /runs/import).
    This is the door for someone who wants to be in before they have run. It
    used to 409 on a second call, which now fires constantly — a runner who has
    already run is already entered — so a repeat call returns the entry that
    exists instead of an error.
    """
    user_id = request.state.user_id

    season = (await db.execute(
        text("SELECT kind, status FROM seasons WHERE id = :sid")
        .bindparams(sid=body.season_id)
    )).fetchone()
    if not season:
        raise HTTPException(status_code=404, detail="No such season")

    kind, status = season[0], season[1]
    if status not in ("forming", "active"):
        raise HTTPException(status_code=409, detail=f"Season is {status}, not open for entry")

    entry_id, created = await SeasonService.enter_season(db, user_id, body.season_id)
    await db.commit()

    return {
        "id": entry_id,
        "status": "pending",
        "season_id": body.season_id,
        "season_kind": kind,
        "entry_fee_cents": 0,
        # Nothing is owed, so an entry is settled as soon as it exists.
        "paid": True,
        "already_entered": not created,
    }


@router.post("/bid")
async def place_bid(
    body: BidRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = request.state.user_id
    if body.amount_cents <= 0:
        raise HTTPException(status_code=400, detail="Bid amount must be positive")

    bid_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO season_bids (id, bidder_id, target_user_id, season_id, amount_cents)
            VALUES (:id, :bidder, :target, :sid, :amount)
        """).bindparams(
            id=bid_id, bidder=user_id, target=body.target_user_id,
            sid=body.season_id, amount=body.amount_cents,
        )
    )

    # Record wallet transaction
    await db.execute(
        text("""
            INSERT INTO wallet_transactions (id, user_id, type, amount_cents, status, description)
            VALUES (:id, :uid, 'bid', :amount, 'pending', 'Season preference bid')
        """).bindparams(id=str(uuid.uuid4()), uid=user_id, amount=body.amount_cents)
    )

    return {"id": bid_id, "status": "pending"}


@router.post("/lock")
async def lock_season_groups(
    season_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Admin endpoint: run group formation algorithm and lock groups."""
    # In production: verify admin role
    await SeasonService.form_groups(db, season_id)
    return {"status": "groups_formed"}


@router.get("/{season_id}/payout-preview")
async def payout_preview(
    season_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = request.state.user_id
    result = await db.execute(
        text("""
            SELECT se.payout_eligible, se.status,
                   COALESCE(ld.season_mileage_km, 0) AS mileage_km
            FROM season_entries se
            LEFT JOIN leaderboard_daily ld ON ld.user_id = se.user_id
                AND ld.snapshot_date = (SELECT MAX(snapshot_date) FROM leaderboard_daily)
            WHERE se.user_id = :uid AND se.season_id = :sid
        """).bindparams(uid=user_id, sid=season_id)
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Not entered in this season")

    return {
        "payout_eligible": row[0],
        "entry_status": row[1],
        "season_mileage_km": row[2],
        "threshold": {
            "min_runs": settings.threshold_min_runs,
            "min_km": settings.threshold_min_km,
            "min_days": settings.threshold_min_days,
        },
    }
