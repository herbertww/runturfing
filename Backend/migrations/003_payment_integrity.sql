-- =============================================================================
-- 003 — Payment integrity
--
-- Before this, POST /seasons/join read entry_fee_cents from the request body
-- and added it directly to seasons.pool_amount_cents. Since payouts are
-- pool * (1 - platform_fee) / eligible, any caller could inflate the payout
-- without paying anything. The pool now moves only when Stripe confirms a
-- payment, which needs three things the schema did not have:
--
--   1. a way to mark an entry as actually paid,
--   2. a link from a wallet transaction back to the season it paid for,
--   3. a uniqueness guarantee on stripe_id so webhook redelivery — which
--      Stripe does routinely — cannot credit the same pool twice.
-- =============================================================================

ALTER TABLE season_entries
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- Group formation and pool totals both filter on paid entries within a season.
CREATE INDEX IF NOT EXISTS idx_se_season_paid
    ON season_entries(season_id)
    WHERE paid_at IS NOT NULL;

ALTER TABLE wallet_transactions
    ADD COLUMN IF NOT EXISTS season_id UUID REFERENCES seasons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wt_season
    ON wallet_transactions(season_id)
    WHERE season_id IS NOT NULL;

-- The webhook's ON CONFLICT DO NOTHING was a no-op: without a unique
-- constraint there was no conflict to detect, so a redelivered
-- payment_intent.succeeded inserted a second transaction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wt_stripe_id
    ON wallet_transactions(stripe_id)
    WHERE stripe_id IS NOT NULL;
