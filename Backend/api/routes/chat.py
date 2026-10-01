"""
Runturfing Backend – Chat Routes
GET  /chat/{thread_id}/messages         – Paginated messages
POST /chat/{thread_id}/messages         – Send message
POST /chat/messages/{msg_id}/reactions  – Add reaction
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import uuid

from api.database import get_db

router = APIRouter()


class SendMessageRequest(BaseModel):
    body: str


class ReactionRequest(BaseModel):
    emoji: str


@router.get("/{thread_id}/messages")
async def get_messages(
    thread_id: str,
    request: Request,
    before: Optional[datetime] = None,
    db: AsyncSession = Depends(get_db),
):
    user_id = request.state.user_id

    # Verify user is in this thread's group
    access = await db.execute(
        text("""
            SELECT 1 FROM chat_threads ct
            JOIN season_groups sg ON sg.id = ct.season_group_id
            JOIN season_entries se ON se.group_id = sg.id
            WHERE ct.id = :tid AND se.user_id = :uid
        """).bindparams(tid=thread_id, uid=user_id)
    )
    if not access.fetchone():
        raise HTTPException(status_code=403, detail="Not a member of this chat")

    before_clause = "AND cm.sent_at < :before" if before else ""
    params = {"tid": thread_id, "limit": 50}
    if before:
        params["before"] = before

    result = await db.execute(
        text(f"""
            SELECT cm.id, cm.sender_id, u.display_name, cm.body,
                   cm.message_type, cm.event_payload, cm.sent_at
            FROM chat_messages cm
            LEFT JOIN users u ON u.id = cm.sender_id
            WHERE cm.thread_id = :tid {before_clause}
            ORDER BY cm.sent_at DESC
            LIMIT :limit
        """).bindparams(**params)
    )
    messages = []
    for r in result.fetchall():
        msg_id = str(r[0])
        # Get reactions
        reactions_result = await db.execute(
            text("""
                SELECT id, user_id, emoji, reacted_at
                FROM message_reactions
                WHERE message_id = :mid
            """).bindparams(mid=msg_id)
        )
        reactions = [
            {"id": str(rx[0]), "user_id": str(rx[1]), "emoji": rx[2], "reacted_at": rx[3].isoformat()}
            for rx in reactions_result.fetchall()
        ]
        messages.append({
            "id": msg_id,
            "thread_id": thread_id,
            "sender_id": str(r[1]) if r[1] else None,
            "sender_name": r[2],
            "body": r[3],
            "message_type": r[4],
            "event_payload": r[5],
            "reactions": reactions,
            "sent_at": r[6].isoformat(),
        })
    return messages


@router.post("/{thread_id}/messages")
async def send_message(
    thread_id: str,
    body: SendMessageRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = request.state.user_id

    # Verify access
    access = await db.execute(
        text("""
            SELECT 1 FROM chat_threads ct
            JOIN season_groups sg ON sg.id = ct.season_group_id
            JOIN season_entries se ON se.group_id = sg.id
            WHERE ct.id = :tid AND se.user_id = :uid
        """).bindparams(tid=thread_id, uid=user_id)
    )
    if not access.fetchone():
        raise HTTPException(status_code=403, detail="Not a member of this chat")

    if len(body.body.strip()) == 0 or len(body.body) > 500:
        raise HTTPException(status_code=400, detail="Message must be 1–500 characters")

    msg_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO chat_messages (id, thread_id, sender_id, body, message_type)
            VALUES (:id, :tid, :uid, :body, 'text')
        """).bindparams(id=msg_id, tid=thread_id, uid=user_id, body=body.body.strip())
    )

    await db.execute(
        text("UPDATE chat_threads SET last_message_at = NOW() WHERE id = :tid")
        .bindparams(tid=thread_id)
    )

    return {"id": msg_id, "thread_id": thread_id, "body": body.body, "sent_at": "now"}


@router.post("/messages/{message_id}/reactions")
async def add_reaction(
    message_id: str,
    body: ReactionRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = request.state.user_id
    reaction_id = str(uuid.uuid4())
    try:
        await db.execute(
            text("""
                INSERT INTO message_reactions (id, message_id, user_id, emoji)
                VALUES (:id, :mid, :uid, :emoji)
                ON CONFLICT (message_id, user_id, emoji) DO NOTHING
            """).bindparams(id=reaction_id, mid=message_id, uid=user_id, emoji=body.emoji)
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Could not add reaction")
    return {"status": "ok"}
