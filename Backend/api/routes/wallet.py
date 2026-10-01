"""Runturfing Backend – Wallet Routes"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from api.database import get_db

router = APIRouter()


@router.get("/transactions")
async def get_transactions(request: Request, db: AsyncSession = Depends(get_db)):
    user_id = request.state.user_id
    result = await db.execute(
        text("""
            SELECT id, type, amount_cents, currency, status, description, created_at
            FROM wallet_transactions
            WHERE user_id = :uid
            ORDER BY created_at DESC
            LIMIT 50
        """).bindparams(uid=user_id)
    )
    return [
        {
            "id": str(r[0]),
            "type": r[1],
            "amount_cents": r[2],
            "currency": r[3],
            "status": r[4],
            "description": r[5],
            "created_at": r[6].isoformat(),
        }
        for r in result.fetchall()
    ]


@router.get("/payouts")
async def get_payouts(request: Request, db: AsyncSession = Depends(get_db)):
    user_id = request.state.user_id
    result = await db.execute(
        text("""
            SELECT id, season_id, amount_cents, status, scheduled_at, settled_at
            FROM payouts
            WHERE user_id = :uid
            ORDER BY created_at DESC
        """).bindparams(uid=user_id)
    )
    return [
        {
            "id": str(r[0]),
            "season_id": str(r[1]),
            "amount_cents": r[2],
            "status": r[3],
            "scheduled_at": r[4].isoformat() if r[4] else None,
            "settled_at": r[5].isoformat() if r[5] else None,
        }
        for r in result.fetchall()
    ]
