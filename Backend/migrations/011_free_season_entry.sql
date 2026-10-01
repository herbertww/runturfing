-- =============================================================================
-- 011 — Season entry is free
--
-- Entering a season costs nothing, for every runner and every season kind, and
-- a runner is entered automatically by running while a season is open (see
-- SeasonService.auto_enter_for_run, called from POST /runs/import). The only
-- money a season takes in is the optional rundating bounty.
--
-- Two things have to change in the data for that to be true.
--
-- 1. seasons.entry_fee_cents. Migration 010 left it NULL on old rows, and NULL
--    meant "use settings.season_entry_fee_cents", which was 2000. That setting
--    no longer exists, so a NULL here would be a price with nothing behind it.
--    Every season is set to 0 and the column defaults to 0, which makes the
--    free case the one you get by saying nothing.
--
-- 2. season_entries that were written but never paid. Under the old flow those
--    sat at status 'pending' with paid_at NULL, waiting on a Stripe webhook
--    that is never going to arrive now. Group formation skipped them, so they
--    were entrants who could not be grouped and could not be refunded. They
--    are settled here instead: fee zeroed, paid_at stamped, still pending, so
--    the next group formation picks them up like any other free entry.
--
-- Entries that genuinely paid keep their entry_fee_cents. They are the only
-- rows the refund path in season_service.form_groups still looks at.
-- =============================================================================

ALTER TABLE seasons
    ALTER COLUMN entry_fee_cents SET DEFAULT 0;

UPDATE seasons
    SET entry_fee_cents = 0
    WHERE entry_fee_cents IS NULL OR entry_fee_cents <> 0;

-- Settle the entries that were stranded waiting on a payment. paid_at means
-- "settled", not "money arrived", which is the only reading that still makes
-- sense once nothing is charged.
UPDATE season_entries
    SET entry_fee_cents = 0,
        paid_at = COALESCE(paid_at, NOW())
    WHERE paid_at IS NULL
      AND status = 'pending';

-- A pending entry with money against it but no payment is now a contradiction:
-- nothing can charge for entry any more. Nothing enforces this at the schema
-- level, since old settled rows legitimately carry a fee.
