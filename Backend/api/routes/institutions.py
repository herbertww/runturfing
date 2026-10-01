"""
Runturfing Backend – Institution Routes

GET  /institutions              – The pickable list (public)
GET  /institutions/standings    – School table for the orientation season (public)
GET  /institutions/me           – The caller's school and their contribution to it
PUT  /institutions/me           – Opt into a school, or switch before lock-in
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional

from api.database import get_db
from api.services.institution_service import InstitutionService

router = APIRouter()


class SetInstitutionRequest(BaseModel):
    # Slug, not id. The share links the whole campus push runs on carry slugs
    # (runturfing.com/join/nus), so the client never has to resolve one to a uuid.
    slug: Optional[str] = None


@router.get("")
@router.get("/")
async def list_institutions(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        text("""
            SELECT id, slug, name, short_name, kind, color
            FROM institutions
            WHERE is_active
            ORDER BY sort_order, name
        """)
    )).fetchall()
    return [
        {
            "id": str(r[0]),
            "slug": r[1],
            "name": r[2],
            "shortName": r[3],
            "kind": r[4],
            "color": r[5],
        }
        for r in rows
    ]


@router.get("/standings")
async def get_standings(db: AsyncSession = Depends(get_db)):
    """
    The school table. Public, because it is the thing people screenshot into
    their orientation group chat, and requiring a login to see your school
    losing would remove the reason to install the app.
    """
    standings = await InstitutionService.standings(db)
    return {
        "standings": [
            {
                "id": s.institution_id,
                "slug": s.slug,
                "name": s.name,
                "shortName": s.short_name,
                "kind": s.kind,
                "color": s.color,
                "rank": s.rank,
                "runners": s.runners,
                "activeRunners": s.active_runners,
                "turfCells": s.turf_cells,
                "totalKm": s.total_km,
            }
            for s in standings
        ],
        # Named so the client can label the column without hardcoding the rule.
        "rankedBy": "turfCells",
    }


@router.get("/me")
async def get_my_institution(request: Request, db: AsyncSession = Depends(get_db)):
    user_id = request.state.user_id
    row = (await db.execute(
        text("""
            SELECT i.id, i.slug, i.name, i.short_name, i.kind, i.color,
                   u.institution_set_at
            FROM users u
            JOIN institutions i ON i.id = u.institution_id
            WHERE u.id = :uid
        """).bindparams(uid=user_id)
    )).fetchone()

    if not row:
        return {"institution": None, "locked": False, "contribution": None}

    locked = await _is_locked(db, user_id)

    contribution = (await db.execute(
        text("""
            SELECT COALESCE(ld.season_territory, 0),
                   COALESCE(ld.season_mileage_km, 0)
            FROM leaderboard_daily ld
            WHERE ld.user_id = :uid
              AND ld.snapshot_date = (SELECT MAX(snapshot_date) FROM leaderboard_daily)
        """).bindparams(uid=user_id)
    )).fetchone()

    # How many others wear the same school. This is the number that makes an
    # invite feel like it lands somewhere rather than into a void.
    teammates = (await db.execute(
        text("""
            SELECT COUNT(*) FROM users
            WHERE institution_id = :iid AND is_active AND NOT is_banned
        """).bindparams(iid=str(row[0]))
    )).scalar() or 0

    return {
        "institution": {
            "id": str(row[0]),
            "slug": row[1],
            "name": row[2],
            "shortName": row[3],
            "kind": row[4],
            "color": row[5],
        },
        "setAt": row[6].isoformat() if row[6] else None,
        "locked": locked,
        "teammates": teammates,
        "contribution": {
            "turfCells": contribution[0] if contribution else 0,
            "km": round(float(contribution[1]), 1) if contribution else 0.0,
        },
    }


@router.put("/me")
async def set_my_institution(
    body: SetInstitutionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Opt in, switch, or clear. Passing no slug clears the opt-in.

    The pick freezes once the caller is entered in an orientation season that
    has gone active. Without that, a runner could spend two weeks taking ground
    under one crest and hand the whole lot to a rival on the final evening.
    """
    user_id = request.state.user_id

    if await _is_locked(db, user_id):
        raise HTTPException(
            status_code=409,
            detail="Your school is locked for the rest of this season.",
        )

    if body.slug is None:
        await db.execute(
            text("""
                UPDATE users SET institution_id = NULL, institution_set_at = NULL
                WHERE id = :uid
            """).bindparams(uid=user_id)
        )
        await db.commit()
        return {"institution": None, "locked": False}

    institution = await InstitutionService.get_by_slug(db, body.slug)
    if not institution:
        raise HTTPException(status_code=404, detail="Unknown institution")

    await db.execute(
        text("""
            UPDATE users
            SET institution_id = :iid, institution_set_at = NOW()
            WHERE id = :uid
        """).bindparams(iid=institution["id"], uid=user_id)
    )

    # Backfill the school onto a referral the caller was brought in by, if that
    # referral predates their opt-in. Nothing else attributes it, and a student
    # invited during orientation almost always picks the inviter's school.
    await db.execute(
        text("""
            UPDATE referrals SET institution_id = :iid
            WHERE referred_user_id = :uid AND institution_id IS NULL
        """).bindparams(iid=institution["id"], uid=user_id)
    )
    await db.commit()

    return {"institution": institution, "locked": False}


async def _is_locked(db: AsyncSession, user_id: str) -> bool:
    """True once the caller is in an orientation season that has started."""
    row = (await db.execute(
        text("""
            SELECT 1
            FROM season_entries se
            JOIN seasons s ON s.id = se.season_id
            WHERE se.user_id = :uid
              AND s.kind = 'orientation'
              AND s.status = 'active'
            LIMIT 1
        """).bindparams(uid=user_id)
    )).fetchone()
    return row is not None
