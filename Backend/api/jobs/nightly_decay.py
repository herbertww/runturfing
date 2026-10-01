"""
Runturfing Backend – Nightly Decay Job
Run via cron: 0 3 * * * python -m api.jobs.nightly_decay

Applies ONE night of pressure-aware decay to every user_cell_stats row whose
holder has not run the cell within the grace period. The model (tunables in
territory_scoring.ScoringParams, exercised offline by scripts/simulate_turf.py):

  - last run <= grace_days ago              -> untouched (a run buys 3 quiet days)
  - contested (opposing runs in the window) -> decays with attack frequency and
                                               contender count, floored per night
  - uncontested, inside the hold period     -> near-flat drift
  - uncontested, past two weeks             -> real decay; upkeep or lose it

"Opposing" excludes the holder's own runs: running your own street is upkeep
(and refreshes last_seen_at anyway), never an attack on yourself.

One night per run, never the elapsed span — this job doesn't stamp last_seen_at,
so exponentiating elapsed days compounded across nights (rate^(N(N+1)/2)). A
missed night under-decays by one day, which is the gentler failure.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import text
from api.database import AsyncSessionLocal
from api.config import settings
from api.services.territory_scoring import params_from_settings

logger = logging.getLogger(__name__)

PARAMS = params_from_settings(settings)


async def run_decay():
    logger.info("[Decay] Starting nightly decay job")
    async with AsyncSessionLocal() as db:
        try:
            result = await db.execute(
                text("""
                    WITH pressured AS (
                        SELECT ucs.id,
                               GREATEST(:floor,
                                   CASE
                                       WHEN p.attacks > 0 THEN
                                           POWER(:atk_rate, LEAST(p.attacks, :max_atk))
                                           * POWER(:cont_rate, LEAST(p.contenders, :max_cont))
                                       WHEN (CURRENT_DATE - DATE(ucs.last_seen_at)) <= :hold_days
                                           THEN :hold_rate
                                       ELSE :natural_rate
                                   END
                               ) AS mult
                        FROM user_cell_stats ucs
                        LEFT JOIN LATERAL (
                            SELECT COUNT(*)                AS attacks,
                                   COUNT(DISTINCT rc.user_id) AS contenders
                            FROM run_cells rc
                            WHERE rc.cell_id = ucs.cell_id
                              AND rc.user_id <> ucs.user_id
                              AND rc.created_at > NOW() - make_interval(days => :window)
                        ) p ON TRUE
                        WHERE ucs.decayed_score > 0
                          AND (CURRENT_DATE - DATE(ucs.last_seen_at)) > :grace_days
                    )
                    UPDATE user_cell_stats ucs
                    SET decayed_score = ucs.decayed_score * pressured.mult,
                        achievement_state = CASE
                            WHEN ucs.decayed_score * pressured.mult < 1 THEN 'neutral'
                            WHEN ucs.achievement_state IN ('claimed', 'defended', 'reclaimed')
                                AND ucs.decayed_score * pressured.mult < :threshold
                            THEN 'decaying'
                            ELSE ucs.achievement_state
                        END,
                        updated_at = NOW()
                    FROM pressured
                    WHERE ucs.id = pressured.id
                """).bindparams(
                    floor=PARAMS.contested_floor,
                    atk_rate=PARAMS.contested_attack_rate,
                    cont_rate=PARAMS.contested_contender_rate,
                    max_atk=PARAMS.max_counted_attacks,
                    max_cont=PARAMS.max_counted_contenders,
                    hold_days=PARAMS.uncontested_hold_days,
                    hold_rate=PARAMS.uncontested_hold_rate,
                    natural_rate=PARAMS.natural_decay_rate,
                    window=PARAMS.pressure_window_days,
                    grace_days=PARAMS.grace_days,
                    threshold=PARAMS.ownership_threshold,
                )
            )
            logger.info(f"[Decay] Updated {result.rowcount} cell stats")

            # Clean up thirty_day_meters for old entries
            cutoff = datetime.now(timezone.utc) - timedelta(days=30)
            await db.execute(
                text("""
                    UPDATE user_cell_stats
                    SET thirty_day_meters = 0
                    WHERE last_seen_at < :cutoff AND thirty_day_meters > 0
                """).bindparams(cutoff=cutoff)
            )

            await db.commit()
            logger.info("[Decay] Nightly decay complete")
        except Exception as e:
            await db.rollback()
            logger.error(f"[Decay] Job failed: {e}", exc_info=True)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_decay())
