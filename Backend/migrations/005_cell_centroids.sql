-- =============================================================================
-- 005 — Cell centroids on user_cell_stats
--
-- The viewport query needs to filter cells by map bounds. H3 ids encode their
-- location, but Postgres cannot unpack them, so the old endpoint ignored the
-- viewport entirely and returned the global top 2000 rows by score. Store the
-- centroid at write time (territory_service computes it from h3 on insert)
-- and the viewport becomes a plain indexed range scan.
-- =============================================================================

ALTER TABLE user_cell_stats
    ADD COLUMN IF NOT EXISTS cell_lat DOUBLE PRECISION;

ALTER TABLE user_cell_stats
    ADD COLUMN IF NOT EXISTS cell_lng DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_ucs_centroid
    ON user_cell_stats(cell_lat, cell_lng)
    WHERE cell_lat IS NOT NULL;
