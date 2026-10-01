-- =============================================================================
-- 004 — Payout identity and held payouts
--
-- Two changes, both about who is allowed to be paid and what happens when
-- that is in doubt.
--
-- 1. Stripe Connect Express is the identity control. Nobody is paid without a
--    Connect account that Stripe has verified and enabled for payouts. This is
--    what makes impersonating an eligible entrant uneconomic: collecting a
--    payout means handing a regulated processor a real legal identity and a
--    bank account in that name, and one verified identity cannot be farmed
--    across accounts.
--
-- 2. An open fraud flag now HOLDS a payout rather than removing the person
--    from the payout set. Silently dropping them was indistinguishable from
--    them never having qualified, and it quietly redistributed their share to
--    everyone else before anyone had reviewed the report.
-- =============================================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- One Connect account per user, and one user per Connect account. The second
-- half is the part that matters: it stops a single verified identity being
-- reused across several profiles.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_stripe_account
    ON users(stripe_account_id)
    WHERE stripe_account_id IS NOT NULL;

-- Impersonation is the report category the group-chat surface actually needs.
-- It is a flag that opens a review, never a verdict that withholds money on
-- its own.
ALTER TABLE fraud_flags DROP CONSTRAINT IF EXISTS fraud_flags_reason_check;
ALTER TABLE fraud_flags ADD CONSTRAINT fraud_flags_reason_check
    CHECK (reason IN ('gps_spoof', 'unrealistic_pace', 'user_report',
                      'duplicate_run', 'impersonation'));

-- 'held' = eligible and funded, but not releasable until a human resolves the
-- open flag. The money stays allocated to them rather than being split among
-- the others.
ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_check
    CHECK (status IN ('pending', 'held', 'scheduled', 'processing', 'completed', 'failed'));

CREATE INDEX IF NOT EXISTS idx_payouts_held
    ON payouts(season_id)
    WHERE status = 'held';
