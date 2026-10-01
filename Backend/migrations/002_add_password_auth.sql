-- =============================================================================
-- 002 — Email/password auth
-- Adds a password hash column so users can register/login with email + password
-- (in addition to Apple Sign In). Nullable: Apple/Google users have no password.
-- =============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Partial index to speed up email/password login lookups.
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
