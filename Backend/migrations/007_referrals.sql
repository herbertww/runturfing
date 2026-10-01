-- =============================================================================
-- 007 — Runfluence referrals and the mixed-group guarantee
--
-- A referrer's payout share is weighted by how many of the people they brought
-- in actually got PAID this season. Signups earn nothing on their own, which is
-- what makes farming accounts pointless: to move the multiplier, the referred
-- person must clear the activity threshold AND complete Stripe Connect identity
-- verification.
--
-- Two integrity rules are enforced in the schema rather than trusted to code:
--   * one referrer per person, ever (UNIQUE on referred_user_id)
--   * nobody refers themselves (CHECK)
-- Longer cycles (A->B->A) are not expressible here and are checked on write.
-- =============================================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_referral_code
    ON users(referral_code)
    WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS referrals (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- One referrer per person for life. Being referred is not a per-season event
    -- even though the bonus is scored per season.
    referred_user_id    UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT referrals_no_self CHECK (referrer_user_id <> referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);

-- Whether an entrant bought the mixed-group guarantee, and what they paid. The
-- amount is stored rather than read from config at settlement, so a later price
-- change cannot retroactively alter an old season's pool.
ALTER TABLE season_entries
    ADD COLUMN IF NOT EXISTS guarantee_cents INTEGER NOT NULL DEFAULT 0;
