-- =============================================================================
-- 006 — Index for the pressure-aware nightly decay
--
-- The decay job asks, per held cell: how many opposing runs crossed this cell
-- in the last week, by how many people? That is a correlated lookup on
-- run_cells by (cell_id, created_at); without this index it is a sequential
-- scan per held cell every night.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_run_cells_cell_time
    ON run_cells(cell_id, created_at DESC);
