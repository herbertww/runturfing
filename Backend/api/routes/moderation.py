"""Runturfing Backend – Moderation Routes"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel
import uuid
from api.database import get_db

router = APIRouter()


class ReportRequest(BaseModel):
    target_user_id: str
    reason: str


class BlockRequest(BaseModel):
    target_user_id: str


@router.post("/report")
async def report_user(body: ReportRequest, request: Request, db: AsyncSession = Depends(get_db)):
    reporter_id = request.state.user_id
    # 'impersonation' is the group-chat category. It opens a review and holds
    # any payout for that account; it never decides eligibility by itself, and
    # it carries no weight beyond any other report.
    valid_reasons = {
        "gps_spoof", "unrealistic_pace", "user_report", "duplicate_run", "impersonation",
    }
    if body.reason not in valid_reasons:
        raise HTTPException(
            status_code=400,
            detail=f"reason must be one of {', '.join(sorted(valid_reasons))}",
        )
    if body.target_user_id == reporter_id:
        raise HTTPException(status_code=400, detail="Cannot report yourself")

    await db.execute(
        text("""
            INSERT INTO fraud_flags (id, target_user_id, reporter_id, reason)
            VALUES (:id, :target, :reporter, :reason)
        """).bindparams(
            id=str(uuid.uuid4()),
            target=body.target_user_id,
            reporter=reporter_id,
            reason=body.reason,
        )
    )
    return {"status": "reported"}


@router.post("/block")
async def block_user(body: BlockRequest, request: Request, db: AsyncSession = Depends(get_db)):
    blocker_id = request.state.user_id
    await db.execute(
        text("""
            INSERT INTO user_blocks (id, blocker_id, blocked_id)
            VALUES (:id, :blocker, :blocked)
            ON CONFLICT DO NOTHING
        """).bindparams(id=str(uuid.uuid4()), blocker=blocker_id, blocked=body.target_user_id)
    )
    return {"status": "blocked"}
