"""
Runturfing Backend – Territory Service
Orchestration around the scoring engine in territory_scoring.py.

Key design principles:
- INCREMENTAL ONLY: only update cells touched by a new run.
- Never recompute all influence from scratch.
- Ownership: user with highest score above threshold owns the cell.
- Contested: top two scores within CONTESTED_DELTA of each other.
- Achievement events are emitted for state transitions.

Decay is owned by api/jobs/nightly_decay.py and applied there once per night.
This service must not decay again on read, or the two compound.

H3 integration:
  Install: pip install 'h3>=4.0,<5'   (the code uses the v4 API surface)
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from api.config import settings
from api.services.territory_scoring import (
    ScoringParams,
    cell_centroid,
    compute_run_score,
    coords_to_h3_cells,
    decode_polyline,
    enclosed_cells,
    determine_cell_state,
    params_from_settings,
    state_transition_event as _state_transition_event,
)

logger = logging.getLogger(__name__)

# Single source of truth for the tunables, built from the env-backed settings.
PARAMS: ScoringParams = params_from_settings(settings)

OWNERSHIP_THRESHOLD = PARAMS.ownership_threshold
CONTESTED_DELTA = PARAMS.contested_delta
DAILY_DECAY = PARAMS.daily_decay_rate


# ---------------------------------------------------------------------------
# Main processing function
# ---------------------------------------------------------------------------

class TerritoryService:

    @staticmethod
    async def process_run(
        run_id: str,
        user_id: str,
        encoded_polyline: str,
        run_date: datetime,
    ):
        """
        Process a completed run:
        1. Decode polyline to GPS coordinates.
        2. Convert to H3 cells with per-cell meter counts.
        3. Incrementally update user_cell_stats for touched cells only.
        4. Emit achievement events for state transitions.
        5. Update run status to 'processed'.
        6. Update territory assets (corridors, loops, zones).
        """
        from api.database import AsyncSessionLocal

        logger.info(f"[Territory] Processing run {run_id} for user {user_id}")

        coords = decode_polyline(encoded_polyline)
        if len(coords) < 2:
            logger.warning(f"[Territory] Run {run_id} has insufficient coordinates")
            return

        cell_meters = coords_to_h3_cells(coords, PARAMS)
        if not cell_meters:
            logger.warning(f"[Territory] Run {run_id} produced no cells")
            return

        # Enclosure capture: finish where you started and you take the ground
        # inside the loop, not just the line you ran. Without this the map is
        # thin corridors with dead pockets between them, and a lap round the
        # lake is worth no more than an out-and-back down one side.
        enclosure = enclosed_cells(coords, cell_meters, PARAMS)
        if enclosure.cells:
            # Credited as an equivalent run-through at a reduced rate, so the
            # existing scoring path handles them uniformly. Note this makes
            # user_cell_stats.lifetime_meters a measure of influence rather than
            # metres physically run; runs.distance_meters remains the true
            # distance and is what mileage leaderboards read.
            equivalent_meters = (
                PARAMS.max_score_per_run / PARAMS.score_per_meter
            ) * PARAMS.enclosure_score_share
            for cell_id in enclosure.cells:
                cell_meters.setdefault(cell_id, equivalent_meters)
            logger.info(
                f"[Territory] Run {run_id} closed a {enclosure.perimeter_m:.0f}m loop, "
                f"enclosing {len(enclosure.cells)} extra cells"
                + (f" ({enclosure.reason})" if enclosure.reason else "")
            )
        elif enclosure.reason:
            logger.debug(f"[Territory] Run {run_id} not an enclosure: {enclosure.reason}")

        run_date_utc = run_date.replace(tzinfo=timezone.utc) if run_date.tzinfo is None else run_date
        today = run_date_utc.date()

        async with AsyncSessionLocal() as db:
            try:
                achievement_events = []

                # Proven social identity earns a small flat bonus on capture.
                # Read once per run rather than per cell.
                social_verified = bool((await db.execute(
                    text("""
                        SELECT 1 FROM social_accounts
                        WHERE user_id = :uid AND verified = TRUE LIMIT 1
                    """).bindparams(uid=user_id)
                )).fetchone())

                for cell_id, meters in cell_meters.items():
                    # Fetch existing stats for this user-cell pair
                    existing = await db.execute(
                        text("""
                            SELECT id, lifetime_meters, thirty_day_meters, unique_active_days,
                                   last_seen_at, decayed_score, achievement_state
                            FROM user_cell_stats
                            WHERE user_id = :uid AND cell_id = :cid
                        """).bindparams(uid=user_id, cid=cell_id)
                    )
                    row = existing.fetchone()

                    if row:
                        stat_id          = str(row[0])
                        lifetime_m       = row[1]
                        thirty_day_m     = row[2]
                        unique_days      = row[3]
                        last_seen        = row[4]
                        current_score    = row[5]
                        prev_state       = row[6]

                        # No decay here. nightly_decay.py already stepped this
                        # row down once for every day since last_seen_at, and
                        # decaying again on write compounded the two — a cell
                        # left alone for 20 days lost 99.8% of its score instead
                        # of 46%. If that job stops running, scores hold rather
                        # than evaporate, which is the safer failure.
                        current_score = current_score or 0.0

                        # Check if this is a new day
                        is_new_day = last_seen.date() < today
                        if is_new_day:
                            unique_days += 1

                        # Compute new score contribution
                        is_defending = prev_state in ("claimed", "defended")
                        run_score = compute_run_score(
                            meters, unique_days, is_defending, PARAMS,
                            social_verified=social_verified,
                        )
                        new_score = current_score + run_score

                        # Update 30-day meters (approximate; nightly job does exact cleanup)
                        new_thirty_day = thirty_day_m + meters

                        await db.execute(
                            text("""
                                UPDATE user_cell_stats
                                SET lifetime_meters   = lifetime_meters + :m,
                                    thirty_day_meters = :t30,
                                    unique_active_days = :days,
                                    last_seen_at      = :now,
                                    decayed_score     = :score
                                WHERE id = :sid
                            """).bindparams(
                                m=meters, t30=new_thirty_day, days=unique_days,
                                now=run_date_utc, score=new_score, sid=stat_id,
                            )
                        )

                        # Record run-cell
                        await db.execute(
                            text("""
                                INSERT INTO run_cells (id, run_id, user_id, cell_id, meters)
                                VALUES (:id, :rid, :uid, :cid, :m)
                            """).bindparams(
                                id=str(uuid.uuid4()), rid=run_id, uid=user_id,
                                cid=cell_id, m=meters,
                            )
                        )

                        # Determine new state
                        top_result = await db.execute(
                            text("""
                                SELECT decayed_score FROM user_cell_stats
                                WHERE cell_id = :cid
                                ORDER BY decayed_score DESC
                                LIMIT 2
                            """).bindparams(cid=cell_id)
                        )
                        scores = [r[0] for r in top_result.fetchall()]
                        top_score    = scores[0] if scores else 0
                        second_score = scores[1] if len(scores) > 1 else 0

                        new_state = determine_cell_state(
                            new_score, top_score, second_score, unique_days, prev_state, PARAMS
                        )

                        await db.execute(
                            text("""
                                UPDATE user_cell_stats
                                SET achievement_state = :state
                                WHERE id = :sid
                            """).bindparams(state=new_state, sid=stat_id)
                        )

                        # Emit achievement events for state transitions
                        if prev_state != new_state:
                            event_type = _state_transition_event(prev_state, new_state)
                            if event_type:
                                achievement_events.append({
                                    "id": str(uuid.uuid4()),
                                    "user_id": user_id,
                                    "run_id": run_id,
                                    "event_type": event_type,
                                    "cell_id": cell_id,
                                    "metadata": {"prev_state": prev_state, "new_state": new_state},
                                })

                    else:
                        # First visit to this cell
                        new_score = compute_run_score(
                            meters, 1, False, PARAMS, social_verified=social_verified
                        )
                        # Centroid stored at write time so the viewport query
                        # can range-scan it — Postgres can't unpack an H3 id.
                        c_lat, c_lng = cell_centroid(cell_id)
                        await db.execute(
                            text("""
                                INSERT INTO user_cell_stats
                                    (id, user_id, cell_id, cell_lat, cell_lng,
                                     lifetime_meters, thirty_day_meters,
                                     unique_active_days, last_seen_at, decayed_score, achievement_state)
                                VALUES (:id, :uid, :cid, :clat, :clng, :m, :m, 1, :now, :score, 'visited')
                            """).bindparams(
                                id=str(uuid.uuid4()), uid=user_id, cid=cell_id,
                                clat=c_lat, clng=c_lng,
                                m=meters, now=run_date_utc, score=new_score,
                            )
                        )

                        await db.execute(
                            text("""
                                INSERT INTO run_cells (id, run_id, user_id, cell_id, meters)
                                VALUES (:id, :rid, :uid, :cid, :m)
                            """).bindparams(
                                id=str(uuid.uuid4()), rid=run_id, uid=user_id,
                                cid=cell_id, m=meters,
                            )
                        )

                        achievement_events.append({
                            "id": str(uuid.uuid4()),
                            "user_id": user_id,
                            "run_id": run_id,
                            "event_type": "first_visit",
                            "cell_id": cell_id,
                            "metadata": {},
                        })

                if enclosure.cells:
                    achievement_events.append({
                        "id": str(uuid.uuid4()),
                        "user_id": user_id,
                        "run_id": run_id,
                        "event_type": "enclosure_claimed",
                        "cell_id": None,
                        "metadata": {
                            "cells": len(enclosure.cells),
                            "perimeter_m": round(enclosure.perimeter_m),
                        },
                    })

                # Persist achievement events
                for ev in achievement_events:
                    await db.execute(
                        # CAST(... AS jsonb), not :meta::jsonb — SQLAlchemy
                        # parses `::` as part of the parameter name and then
                        # cannot find it, which failed every run before the
                        # cells were ever written.
                        text("""
                            INSERT INTO achievement_events
                                (id, user_id, run_id, event_type, cell_id, metadata)
                            VALUES (:id, :uid, :rid, :type, :cid, CAST(:meta AS jsonb))
                        """).bindparams(
                            id=ev["id"], uid=ev["user_id"], rid=ev["run_id"],
                            type=ev["event_type"], cid=ev.get("cell_id"),
                            # json.dumps, not str().replace() — the old version
                            # produced invalid JSON for anything containing a
                            # quote, and None/True became null/true only by luck.
                            meta=json.dumps(ev["metadata"]),
                        )
                    )

                # Update run status and cell count
                await db.execute(
                    text("""
                        UPDATE runs
                        SET status = 'processed', cell_count = :count
                        WHERE id = :rid
                    """).bindparams(count=len(cell_meters), rid=run_id)
                )

                # Update bounding box on run_routes
                if coords:
                    lats = [c[0] for c in coords]
                    lngs = [c[1] for c in coords]
                    await db.execute(
                        text("""
                            UPDATE run_routes
                            SET min_lat = :minlat, max_lat = :maxlat,
                                min_lng = :minlng, max_lng = :maxlng
                            WHERE run_id = :rid
                        """).bindparams(
                            minlat=min(lats), maxlat=max(lats),
                            minlng=min(lngs), maxlng=max(lngs),
                            rid=run_id,
                        )
                    )

                await db.commit()
                logger.info(f"[Territory] Run {run_id} processed: {len(cell_meters)} cells, "
                            f"{len(achievement_events)} events")

                # Trigger chat event messages for significant achievements
                await TerritoryService._emit_chat_events(db, user_id, achievement_events)

            except Exception as e:
                await db.rollback()
                logger.error(f"[Territory] Failed to process run {run_id}: {e}", exc_info=True)
                await db.execute(
                    text("UPDATE runs SET status = 'flagged' WHERE id = :rid").bindparams(rid=run_id)
                )
                await db.commit()

    @staticmethod
    async def _emit_chat_events(db: AsyncSession, user_id: str, events: list):
        """Post territory event messages to the user's active group chat."""
        significant = [e for e in events if e["event_type"] in
                       ("cell_defended", "corridor_reclaimed", "group_zone_held", "milestone_unlocked")]
        if not significant:
            return

        # Find user's active group chat thread
        thread_result = await db.execute(
            text("""
                SELECT ct.id FROM chat_threads ct
                JOIN season_groups sg ON sg.id = ct.season_group_id
                JOIN season_entries se ON se.group_id = sg.id
                JOIN seasons s ON s.id = se.season_id
                WHERE se.user_id = :uid AND s.status = 'active'
                LIMIT 1
            """).bindparams(uid=user_id)
        )
        thread_row = thread_result.fetchone()
        if not thread_row:
            return

        thread_id = str(thread_row[0])
        for ev in significant[:3]:  # cap at 3 auto-messages per run
            body = _event_chat_message(ev["event_type"])
            await db.execute(
                text("""
                    INSERT INTO chat_messages (id, thread_id, sender_id, body, message_type, event_payload)
                    VALUES (:id, :tid, NULL, :body, 'territory_event', CAST(:payload AS jsonb))
                """).bindparams(
                    id=str(uuid.uuid4()), tid=thread_id, body=body,
                    payload=json.dumps({"event_type": ev["event_type"]}),
                )
            )
        await db.commit()


def _event_chat_message(event_type: str) -> str:
    messages = {
        "cell_defended":      "🛡️ Territory defended! Your group is holding the line.",
        "corridor_reclaimed": "⚡ Corridor reclaimed! You took it back.",
        "group_zone_held":    "🏆 Zone secured! Your group controls this neighborhood.",
        "milestone_unlocked": "🎯 Milestone unlocked! Keep pushing.",
    }
    return messages.get(event_type, "Territory event occurred.")
