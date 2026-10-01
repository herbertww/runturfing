"""
Runturfing Backend – Anti-Cheat Service
Detects and flags suspicious runs.
"""

import uuid
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

logger = logging.getLogger(__name__)


class AntiCheatService:

    @staticmethod
    async def flag_run(db: AsyncSession, user_id: str, run_id: str | None, reason: str):
        logger.warning(f"[AntiCheat] Flagging user {user_id}, run {run_id}, reason: {reason}")
        await db.execute(
            text("""
                INSERT INTO fraud_flags (id, target_user_id, run_id, reason)
                VALUES (:id, :uid, :rid, :reason)
            """).bindparams(
                id=str(uuid.uuid4()),
                uid=user_id,
                rid=run_id,
                reason=reason,
            )
        )

    @staticmethod
    async def check_run(
        user_id: str,
        distance_meters: float,
        duration_seconds: int,
        encoded_polyline: str,
    ) -> list[str]:
        """
        Returns list of detected issues. Empty list = clean.
        """
        issues = []

        # Pace check
        if distance_meters > 0 and duration_seconds > 0:
            pace_sec_per_km = duration_seconds / (distance_meters / 1000)
            if pace_sec_per_km < 120:  # faster than 2 min/km
                issues.append("unrealistic_pace")

        # Distance sanity (> 200 km in a single run is suspicious)
        if distance_meters > 200_000:
            issues.append("unrealistic_distance")

        # GPS teleport detection (large gaps in polyline)
        from api.services.territory_service import decode_polyline
        import math
        coords = decode_polyline(encoded_polyline)
        for i in range(1, len(coords)):
            lat1, lng1 = coords[i-1]
            lat2, lng2 = coords[i]
            dlat = math.radians(lat2 - lat1)
            dlng = math.radians(lng2 - lng1)
            a = (math.sin(dlat/2)**2 +
                 math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2)
            gap_meters = 6_371_000 * 2 * math.asin(math.sqrt(a))
            if gap_meters > 500:  # 500 m gap between consecutive points
                issues.append("gps_spoof")
                break

        return issues
