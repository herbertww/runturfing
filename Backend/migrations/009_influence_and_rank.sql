-- =============================================================================
-- 009 — Influence moving average and the vanity rank ladder
--
-- Two additions, both about crediting work that the cell display cannot show.
--
-- INFLUENCE. Cell ownership is winner-takes-all: the top scorer in a cell owns
-- it and everyone else registers as nothing, however close they came. The
-- influence count is the wider number — every cell where a runner has any live
-- score at all — and the moving averages smooth it, so a runner who holds
-- second place across forty cells for a month has a figure that reflects that.
-- Snapshots are daily rows in leaderboard_daily, so the averages are computed
-- from history rather than stored as a running total that cannot be audited.
--
-- RANK. Cached on the daily snapshot so the leaderboard can sort and display it
-- without recomputing per row. api/services/rank_service.py owns the ladder;
-- these columns only hold its output.
-- =============================================================================

ALTER TABLE leaderboard_daily
    -- Cells where this runner has any live score, led or not.
    ADD COLUMN IF NOT EXISTS influence_cells      INTEGER NOT NULL DEFAULT 0,
    -- Mean of influence_cells over the trailing 7 and 30 snapshots.
    ADD COLUMN IF NOT EXISTS influence_ma_7       DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS influence_ma_30      DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- Cells actually led. territory_held already counts owning states; this is
    -- the same idea measured off the leader comparison, kept separate so the
    -- ratio influence -> led is readable without a join.
    ADD COLUMN IF NOT EXISTS cells_led            INTEGER NOT NULL DEFAULT 0,
    -- Rank ladder output. track is 'officer' or 'specialist'; nobody holds both.
    ADD COLUMN IF NOT EXISTS rank_track           TEXT,
    ADD COLUMN IF NOT EXISTS rank_code            TEXT,
    ADD COLUMN IF NOT EXISTS rank_index           INTEGER,
    ADD COLUMN IF NOT EXISTS rank_points          DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_lb_daily_influence_ma
    ON leaderboard_daily(snapshot_date DESC, influence_ma_30 DESC);

CREATE INDEX IF NOT EXISTS idx_lb_daily_rank
    ON leaderboard_daily(snapshot_date DESC, rank_index DESC);

-- The influence and MA columns are read per user for the trailing window, so
-- the snapshot lookup needs to be cheap in user order too.
CREATE INDEX IF NOT EXISTS idx_lb_daily_user_date
    ON leaderboard_daily(user_id, snapshot_date DESC);
