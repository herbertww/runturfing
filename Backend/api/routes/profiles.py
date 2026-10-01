"""Runturfing Backend – Profile Routes"""

import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
from typing import Optional

from api.config import settings
from api.database import get_db
from api.services.season_economics import params_from_settings, referral_multiplier
from api.services.rank_inputs import load_rank_inputs
from api.services.rank_service import compute_rank, ladder_payload

# Referral bonus rates come from the same params the payout maths uses, so the
# number shown in the app cannot drift from the number that gets paid.
ECONOMICS = params_from_settings(settings)

router = APIRouter()


class UpdateProfileRequest(BaseModel):
    bio: Optional[str] = None
    privacy_level: Optional[str] = None
    home_fuzz_enabled: Optional[bool] = None
    is_season_eligible: Optional[bool] = None


OWNING_STATES = ("claimed", "defended", "reclaimed", "contested")

# No 0/O, 1/I/L — these get read aloud and typed in by hand.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6


class RedeemReferralRequest(BaseModel):
    code: str


async def _ensure_referral_code(db: AsyncSession, user_id: str) -> str:
    """Fetch the user's code, minting one on first use."""
    row = (await db.execute(
        text("SELECT referral_code FROM users WHERE id = :uid").bindparams(uid=user_id)
    )).fetchone()
    if row and row[0]:
        return row[0]

    for _ in range(10):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        try:
            await db.execute(
                text("""
                    UPDATE users SET referral_code = :code
                    WHERE id = :uid AND referral_code IS NULL
                """).bindparams(code=code, uid=user_id)
            )
            await db.commit()
            return code
        except IntegrityError:
            # Unique index collision. Vanishingly rare at 31^6, but retrying is
            # cheaper than reasoning about how rare.
            await db.rollback()

    raise HTTPException(status_code=500, detail="Could not allocate a referral code")


@router.get("/me/referrals")
async def get_my_referrals(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Runturfing standing: the code to share, who has been brought in, and what
    the multiplier currently works out at.

    Counts are deliberately split. Signups are shown because people want to see
    them, but they are worth nothing — only referrals that have PAID move the
    multiplier, and the women's bonus only lands once she is actually paid out
    at settlement. Showing one number would imply a signup is worth money.
    """
    user_id = request.state.user_id
    code = await _ensure_referral_code(db, user_id)

    counts = (await db.execute(
        text("""
            SELECT COUNT(*)                                                   AS signed_up,
                   COUNT(*) FILTER (WHERE se.paid_at IS NOT NULL)             AS paid,
                   COUNT(*) FILTER (WHERE se.paid_at IS NOT NULL
                                      AND u.gender = 'female')                AS paid_women
            FROM referrals r
            JOIN users u ON u.id = r.referred_user_id
            LEFT JOIN season_entries se ON se.user_id = r.referred_user_id
                 AND se.season_id = (SELECT id FROM seasons WHERE status = 'active' LIMIT 1)
            WHERE r.referrer_user_id = :uid
        """).bindparams(uid=user_id)
    )).fetchone()

    signed_up, paid, paid_women = (counts[0] or 0), (counts[1] or 0), (counts[2] or 0)
    multiplier = referral_multiplier(paid, paid_women, ECONOMICS)

    referred_by = (await db.execute(
        text("""
            SELECT u.display_name FROM referrals r
            JOIN users u ON u.id = r.referrer_user_id
            WHERE r.referred_user_id = :uid
        """).bindparams(uid=user_id)
    )).fetchone()

    return {
        "code": code,
        "signedUp": signed_up,
        "paidEntries": paid,
        "paidWomen": paid_women,
        "multiplier": round(multiplier, 2),
        "maxMultiplier": ECONOMICS.max_referral_multiplier,
        "perReferralBonus": ECONOMICS.referral_bonus,
        "perWomanBonus": ECONOMICS.referral_female_bonus,
        "atCap": multiplier >= ECONOMICS.max_referral_multiplier,
        # Null unless someone else brought you in — the redeem field hides once set.
        "referredBy": referred_by[0] if referred_by else None,
    }


@router.post("/me/referrals/redeem")
async def redeem_referral(
    body: RedeemReferralRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Claim a code. Once only, and never your own."""
    user_id = request.state.user_id
    code = body.code.strip().upper()

    if not code:
        raise HTTPException(status_code=400, detail="Enter a code")

    existing = (await db.execute(
        text("SELECT 1 FROM referrals WHERE referred_user_id = :uid").bindparams(uid=user_id)
    )).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail="You have already used a referral code")

    owner = (await db.execute(
        text("SELECT id FROM users WHERE referral_code = :code").bindparams(code=code)
    )).fetchone()
    if not owner:
        raise HTTPException(status_code=404, detail="That code does not exist")
    if str(owner[0]) == str(user_id):
        raise HTTPException(status_code=400, detail="You cannot refer yourself")

    # A refers B and B refers A would let a pair inflate each other for free.
    circular = (await db.execute(
        text("""
            SELECT 1 FROM referrals
            WHERE referrer_user_id = :uid AND referred_user_id = :owner
        """).bindparams(uid=user_id, owner=str(owner[0]))
    )).fetchone()
    if circular:
        raise HTTPException(status_code=400, detail="You already referred that person")

    await db.execute(
        text("""
            INSERT INTO referrals (id, referrer_user_id, referred_user_id)
            VALUES (:id, :ref, :uid)
        """).bindparams(id=str(uuid.uuid4()), ref=str(owner[0]), uid=user_id)
    )
    return {"status": "ok"}


@router.get("/me/rank")
async def get_my_rank(request: Request, db: AsyncSession = Depends(get_db)):
    """The runner's rung plus both ladders, so the app can draw the whole
    progression and show which track they are locked out of."""
    rank = compute_rank(await load_rank_inputs(db, request.state.user_id))
    return {"rank": rank.to_dict(), "ladders": ladder_payload()}


PLATFORMS = ("instagram", "tiktok", "twitter", "strava")


class LinkSocialRequest(BaseModel):
    platform: str
    handle: str


@router.post("/me/social")
async def link_social(
    body: LinkSocialRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Attach a social handle. This is a LINK, not a verification.

    `verified` stays false: anyone can type any handle, so this earns no
    capture bonus and claims nothing about who owns the account. It exists so
    people can find each other, which is most of the value and needs no
    third-party API at all.

    Proving ownership is a separate OAuth flow per platform, and it is the only
    thing that sets verified = TRUE.
    """
    user_id = request.state.user_id
    platform = body.platform.strip().lower()
    handle = body.handle.strip().lstrip("@")

    if platform not in PLATFORMS:
        raise HTTPException(
            status_code=400, detail=f"platform must be one of {', '.join(PLATFORMS)}"
        )
    if not handle or len(handle) > 60:
        raise HTTPException(status_code=400, detail="Enter a valid handle")
    if any(c in handle for c in " /?&#"):
        raise HTTPException(status_code=400, detail="That does not look like a handle")

    await db.execute(
        text("""
            INSERT INTO social_accounts (id, user_id, platform, handle, verified)
            VALUES (:id, :uid, :platform, :handle, FALSE)
            ON CONFLICT (user_id, platform)
            DO UPDATE SET handle = EXCLUDED.handle, verified = FALSE
        """).bindparams(
            id=str(uuid.uuid4()), uid=user_id, platform=platform, handle=handle
        )
    )
    return {"platform": platform, "handle": handle, "verified": False}


@router.delete("/me/social/{platform}")
async def unlink_social(platform: str, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = request.state.user_id
    await db.execute(
        text("""
            DELETE FROM social_accounts
            WHERE user_id = :uid AND platform = :platform
        """).bindparams(uid=user_id, platform=platform.strip().lower())
    )
    return {"status": "unlinked"}


@router.get("/me")
async def get_my_profile(request: Request, db: AsyncSession = Depends(get_db)):
    """
    The whole profile tab in one call, shaped to match UserProfile in
    Android/src/types/index.ts — camelCase, nested user/stats/recentRuns.

    Declared before /{user_id} on purpose: FastAPI matches in declaration
    order, and the other way round "me" is swallowed as a user id and sent to
    Postgres as a UUID.
    """
    user_id = request.state.user_id

    user_row = (await db.execute(
        text("""
            SELECT u.id, u.display_name, u.city, u.gender, u.created_at,
                   p.bio, p.avatar_url, p.privacy_level, p.home_fuzz_enabled,
                   p.is_season_eligible
            FROM users u
            LEFT JOIN profiles p ON p.user_id = u.id
            WHERE u.id = :uid
        """).bindparams(uid=user_id)
    )).fetchone()
    if not user_row:
        raise HTTPException(status_code=404, detail="Profile not found")

    totals = (await db.execute(
        text("""
            SELECT COUNT(*), COALESCE(SUM(distance_meters), 0)
            FROM runs
            WHERE user_id = :uid AND status <> 'flagged'
        """).bindparams(uid=user_id)
    )).fetchone()

    cell_total = (await db.execute(
        text("""
            SELECT COUNT(*) FROM user_cell_stats
            WHERE user_id = :uid AND achievement_state = ANY(:states)
        """).bindparams(uid=user_id, states=list(OWNING_STATES))
    )).fetchone()

    seasons_done = (await db.execute(
        text("""
            SELECT COUNT(*) FROM season_entries se
            JOIN seasons s ON s.id = se.season_id
            WHERE se.user_id = :uid AND s.status IN ('ended', 'settled')
        """).bindparams(uid=user_id)
    )).fetchone()

    # Distinct run days, newest first, for the streak walk below.
    day_rows = (await db.execute(
        text("""
            SELECT DISTINCT DATE(started_at) AS d
            FROM runs
            WHERE user_id = :uid AND status <> 'flagged'
            ORDER BY d DESC
            LIMIT 400
        """).bindparams(uid=user_id)
    )).fetchall()
    run_days = [r[0] for r in day_rows]
    current_streak, longest_streak = _streaks(run_days)

    # Recent runs, with the territory outcome of each folded in from the
    # achievement events that run emitted.
    run_rows = (await db.execute(
        text("""
            SELECT r.id, r.user_id, r.started_at, r.ended_at, r.distance_meters,
                   r.duration_seconds, r.cell_count, rr.encoded_polyline,
                   COUNT(*) FILTER (WHERE ae.event_type = 'cell_claimed')      AS claimed,
                   COUNT(*) FILTER (WHERE ae.event_type = 'cell_defended')     AS defended,
                   COUNT(*) FILTER (WHERE ae.event_type = 'corridor_reclaimed') AS reclaimed
            FROM runs r
            LEFT JOIN run_routes rr        ON rr.run_id = r.id
            LEFT JOIN achievement_events ae ON ae.run_id = r.id
            WHERE r.user_id = :uid
            GROUP BY r.id, rr.encoded_polyline
            ORDER BY r.started_at DESC
            LIMIT 10
        """).bindparams(uid=user_id)
    )).fetchall()

    social_rows = (await db.execute(
        text("""
            SELECT platform, handle, verified, created_at
            FROM social_accounts WHERE user_id = :uid
        """).bindparams(uid=user_id)
    )).fetchall()

    # The vanity ladder. Computed live rather than read from the snapshot so a
    # runner who just imported a run sees the promotion straight away instead of
    # waiting for the hourly job.
    rank = compute_rank(await load_rank_inputs(db, user_id))

    # Influence: cells with any live score, whether or not they are led. The
    # live count is now; the averages come off the daily snapshots, which is the
    # only place a history exists.
    influence_now = (await db.execute(
        text("""
            SELECT COUNT(*) FROM user_cell_stats
            WHERE user_id = :uid AND decayed_score > 0
        """).bindparams(uid=user_id)
    )).fetchone()

    influence_row = (await db.execute(
        text("""
            SELECT influence_cells, influence_ma_7, influence_ma_30, cells_led
            FROM leaderboard_daily
            WHERE user_id = :uid
            ORDER BY snapshot_date DESC
            LIMIT 1
        """).bindparams(uid=user_id)
    )).fetchone()

    # A 14-point sparkline of the influence count, oldest first, for the chart
    # on the profile. Reversed in Python because the query has to sort newest
    # first to take the most recent rows.
    influence_series = (await db.execute(
        text("""
            SELECT snapshot_date, influence_cells
            FROM leaderboard_daily
            WHERE user_id = :uid
            ORDER BY snapshot_date DESC
            LIMIT 14
        """).bindparams(uid=user_id)
    )).fetchall()

    history_rows = (await db.execute(
        text("""
            SELECT DATE(occurred_at) AS d,
                   COUNT(*) FILTER (WHERE event_type IN ('cell_claimed', 'corridor_reclaimed')) AS claimed
            FROM achievement_events
            WHERE user_id = :uid AND occurred_at > NOW() - INTERVAL '30 days'
            GROUP BY d
            ORDER BY d
        """).bindparams(uid=user_id)
    )).fetchall()

    return {
        "user": {
            "id": str(user_row[0]),
            "displayName": user_row[1],
            "city": user_row[2],
            "gender": user_row[3],
            "createdAt": user_row[4].isoformat() if user_row[4] else None,
            "bio": user_row[5],
            "avatarUrl": user_row[6],
            "privacyLevel": user_row[7],
            "homeFuzzEnabled": user_row[8],
            "isSeasonEligible": user_row[9],
        },
        "stats": {
            "totalRuns": totals[0] or 0,
            "totalKm": round((totals[1] or 0) / 1000, 2),
            "totalCells": cell_total[0] or 0,
            "currentStreak": current_streak,
            "longestStreak": longest_streak,
            "seasonsCompleted": seasons_done[0] or 0,
            # Wallet owns payouts; surfacing it here would need a second source
            # of truth for the same number.
            "payoutsReceived": 0,
        },
        "rank": rank.to_dict(),
        "influence": {
            # Cells you are scoring in right now, led or not.
            "cellsNow": influence_now[0] or 0,
            "cellsAtLastSnapshot": (influence_row[0] if influence_row else 0) or 0,
            "movingAverage7": round(float(influence_row[1]), 1) if influence_row else 0.0,
            "movingAverage30": round(float(influence_row[2]), 1) if influence_row else 0.0,
            # The winner-takes-all number, for reading against the average.
            "cellsLed": (influence_row[3] if influence_row else 0) or 0,
            "series": [
                {"date": s[0].isoformat(), "cells": s[1] or 0}
                for s in reversed(influence_series)
            ],
        },
        "socialAccounts": [
            {
                "platform": s[0],
                "handle": s[1],
                "verified": s[2],
                "linkedAt": s[3].isoformat() if s[3] else None,
            }
            for s in social_rows
        ],
        "recentRuns": [
            {
                "id": str(r[0]),
                "userId": str(r[1]),
                "startedAt": r[2].isoformat(),
                "endedAt": r[3].isoformat(),
                "distanceMeters": r[4],
                "durationSeconds": r[5],
                "routeEncoded": r[7],
                "cellsUpdated": r[6] or 0,
                "newCellsClaimed": (r[8] or 0) + (r[10] or 0),
                "cellsDefended": r[9] or 0,
                # Losing a cell happens on someone else's run, so it is not
                # attributable to one of yours.
                "cellsLost": 0,
            }
            for r in run_rows
        ],
        "territoryHistory": [
            {"date": h[0].isoformat(), "cellsClaimed": h[1] or 0, "cellsLost": 0}
            for h in history_rows
        ],
    }


def _streaks(run_days: list) -> tuple[int, int]:
    """Current and longest consecutive-day run streaks. run_days is distinct
    dates, newest first."""
    if not run_days:
        return 0, 0

    from datetime import date as _date, timedelta

    today = _date.today()
    current = 0
    # A streak survives until you have missed a whole day, so today and
    # yesterday both count as still going.
    if run_days[0] in (today, today - timedelta(days=1)):
        current = 1
        for prev, nxt in zip(run_days, run_days[1:]):
            if prev - nxt == timedelta(days=1):
                current += 1
            else:
                break

    longest, streak = 1, 1
    for prev, nxt in zip(run_days, run_days[1:]):
        streak = streak + 1 if prev - nxt == timedelta(days=1) else 1
        longest = max(longest, streak)

    return current, longest


@router.get("/{user_id}")
async def get_profile(user_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("""
            SELECT p.id, p.user_id, p.bio, p.avatar_url, p.privacy_level,
                   p.home_fuzz_enabled, p.is_season_eligible,
                   u.display_name, u.city, u.gender
            FROM profiles p
            JOIN users u ON u.id = p.user_id
            WHERE p.user_id = :uid
        """).bindparams(uid=user_id)
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Profile not found")

    # Social links
    social_result = await db.execute(
        text("SELECT id, platform, handle, verified FROM social_accounts WHERE user_id = :uid")
        .bindparams(uid=user_id)
    )
    socials = [
        {"id": str(s[0]), "platform": s[1], "handle": s[2], "verified": s[3]}
        for s in social_result.fetchall()
    ]

    return {
        "id": str(row[0]),
        "user_id": str(row[1]),
        "bio": row[2],
        "avatar_url": row[3],
        "privacy_level": row[4],
        "home_fuzz_enabled": row[5],
        "is_season_eligible": row[6],
        "display_name": row[7],
        "city": row[8],
        "gender": row[9],
        "social_links": socials,
    }


@router.put("/{user_id}")
async def update_profile(
    user_id: str,
    body: UpdateProfileRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    if request.state.user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot edit another user's profile")

    updates = {}
    if body.bio is not None:
        updates["bio"] = body.bio
    if body.privacy_level is not None:
        if body.privacy_level not in ("public", "friends_only", "private"):
            raise HTTPException(status_code=400, detail="Invalid privacy level")
        updates["privacy_level"] = body.privacy_level
    if body.home_fuzz_enabled is not None:
        updates["home_fuzz_enabled"] = body.home_fuzz_enabled
    if body.is_season_eligible is not None:
        updates["is_season_eligible"] = body.is_season_eligible

    if updates:
        set_clause = ", ".join(f"{k} = :{k}" for k in updates)
        await db.execute(
            text(f"UPDATE profiles SET {set_clause} WHERE user_id = :uid")
            .bindparams(uid=user_id, **updates)
        )

    return await get_profile(user_id, request, db)
