-- =============================================================================
-- Runturfing – Initial Database Schema
-- Migration: 001_initial_schema.sql
-- Database: PostgreSQL 15+ with PostGIS extension
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- No PostGIS: territory is H3 cell ids (text) and viewport filtering uses the
-- plain min/max lat-lng columns below. Keeps the schema deployable on any
-- vanilla Postgres.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- for text search on display names

-- =============================================================================
-- USERS & AUTH
-- =============================================================================

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    apple_sub           TEXT UNIQUE,                        -- Apple Sign In subject
    email               TEXT UNIQUE,
    display_name        TEXT NOT NULL,
    gender              TEXT NOT NULL CHECK (gender IN ('male','female','non_binary','prefer_not_to_say')),
    date_of_birth       DATE,
    age_verified        BOOLEAN NOT NULL DEFAULT FALSE,
    city                TEXT,
    metro_region        TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    is_banned           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_apple_sub    ON users(apple_sub);
CREATE INDEX idx_users_city         ON users(city);
CREATE INDEX idx_users_metro        ON users(metro_region);
CREATE INDEX idx_users_display_name ON users USING gin(display_name gin_trgm_ops);

-- =============================================================================
-- PROFILES
-- =============================================================================

CREATE TABLE profiles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bio                 TEXT,
    avatar_url          TEXT,
    privacy_level       TEXT NOT NULL DEFAULT 'public'
                            CHECK (privacy_level IN ('public','friends_only','private')),
    home_lat            DOUBLE PRECISION,
    home_lng            DOUBLE PRECISION,
    home_fuzz_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    is_season_eligible  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id)
);

-- =============================================================================
-- SOCIAL ACCOUNTS
-- =============================================================================

CREATE TABLE social_accounts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform    TEXT NOT NULL CHECK (platform IN ('instagram','strava','twitter','tiktok')),
    handle      TEXT NOT NULL,
    verified    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, platform)
);

-- =============================================================================
-- PUSH TOKENS
-- =============================================================================

CREATE TABLE push_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL DEFAULT 'ios',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(token)
);

-- =============================================================================
-- RUNS
-- =============================================================================

CREATE TABLE runs (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at              TIMESTAMPTZ NOT NULL,
    ended_at                TIMESTAMPTZ NOT NULL,
    distance_meters         DOUBLE PRECISION NOT NULL,
    duration_seconds        INTEGER NOT NULL,
    elevation_gain_meters   DOUBLE PRECISION,
    source                  TEXT NOT NULL CHECK (source IN ('healthkit','manual','live_tracking')),
    status                  TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','processed','flagged')),
    healthkit_workout_id    TEXT UNIQUE,
    cell_count              INTEGER NOT NULL DEFAULT 0,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_runs_user_id       ON runs(user_id);
CREATE INDEX idx_runs_started_at    ON runs(started_at DESC);
CREATE INDEX idx_runs_status        ON runs(status);
CREATE INDEX idx_runs_hk_id         ON runs(healthkit_workout_id) WHERE healthkit_workout_id IS NOT NULL;

-- =============================================================================
-- RUN ROUTES (encoded polylines)
-- =============================================================================

CREATE TABLE run_routes (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id              UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    encoded_polyline    TEXT NOT NULL,      -- Google Polyline format
    min_lat             DOUBLE PRECISION NOT NULL,
    max_lat             DOUBLE PRECISION NOT NULL,
    min_lng             DOUBLE PRECISION NOT NULL,
    max_lng             DOUBLE PRECISION NOT NULL,
    UNIQUE(run_id)
);

CREATE INDEX idx_run_routes_bbox ON run_routes(min_lat, max_lat, min_lng, max_lng);

-- =============================================================================
-- RUN CELLS (which H3 cells a run touched)
-- =============================================================================

CREATE TABLE run_cells (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id      UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cell_id     TEXT NOT NULL,              -- H3 index string
    meters      DOUBLE PRECISION NOT NULL,  -- meters run through this cell
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_run_cells_run_id  ON run_cells(run_id);
CREATE INDEX idx_run_cells_user_id ON run_cells(user_id);
CREATE INDEX idx_run_cells_cell_id ON run_cells(cell_id);

-- =============================================================================
-- USER CELL STATS (incremental, per user-cell pair)
-- =============================================================================

CREATE TABLE user_cell_stats (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cell_id             TEXT NOT NULL,
    lifetime_meters     DOUBLE PRECISION NOT NULL DEFAULT 0,
    thirty_day_meters   DOUBLE PRECISION NOT NULL DEFAULT 0,
    unique_active_days  INTEGER NOT NULL DEFAULT 0,
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decayed_score       DOUBLE PRECISION NOT NULL DEFAULT 0,
    achievement_state   TEXT NOT NULL DEFAULT 'neutral'
                            CHECK (achievement_state IN
                                ('neutral','visited','familiar','claimed',
                                 'defended','contested','reclaimed','decaying')),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, cell_id)
);

CREATE INDEX idx_ucs_user_id    ON user_cell_stats(user_id);
CREATE INDEX idx_ucs_cell_id    ON user_cell_stats(cell_id);
CREATE INDEX idx_ucs_score      ON user_cell_stats(decayed_score DESC);
CREATE INDEX idx_ucs_last_seen  ON user_cell_stats(last_seen_at DESC);

-- =============================================================================
-- TERRITORY ASSETS (corridors, loops, zones)
-- =============================================================================

CREATE TABLE territory_assets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset_type      TEXT NOT NULL CHECK (asset_type IN ('corridor','loop','zone')),
    name            TEXT,
    cell_ids        TEXT[] NOT NULL DEFAULT '{}',
    centroid_lat    DOUBLE PRECISION,
    centroid_lng    DOUBLE PRECISION,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_territory_assets_user_id    ON territory_assets(user_id);
CREATE INDEX idx_territory_assets_type       ON territory_assets(asset_type);

-- =============================================================================
-- LEADERBOARD DAILY (precomputed snapshots)
-- =============================================================================

CREATE TABLE leaderboard_daily (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    snapshot_date           DATE NOT NULL,
    all_time_mileage_km     DOUBLE PRECISION NOT NULL DEFAULT 0,
    ninety_day_mileage_km   DOUBLE PRECISION NOT NULL DEFAULT 0,
    territory_held          INTEGER NOT NULL DEFAULT 0,
    consistency_streak      INTEGER NOT NULL DEFAULT 0,
    season_mileage_km       DOUBLE PRECISION,
    season_territory        INTEGER,
    defense_consistency     DOUBLE PRECISION,
    city                    TEXT,
    metro_region            TEXT,
    UNIQUE(user_id, snapshot_date)
);

CREATE INDEX idx_lb_daily_date          ON leaderboard_daily(snapshot_date DESC);
CREATE INDEX idx_lb_daily_alltime       ON leaderboard_daily(all_time_mileage_km DESC);
CREATE INDEX idx_lb_daily_90day         ON leaderboard_daily(ninety_day_mileage_km DESC);
CREATE INDEX idx_lb_daily_territory     ON leaderboard_daily(territory_held DESC);
CREATE INDEX idx_lb_daily_city          ON leaderboard_daily(city, ninety_day_mileage_km DESC);

-- =============================================================================
-- SEASONS
-- =============================================================================

CREATE TABLE seasons (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    number              INTEGER NOT NULL UNIQUE,
    starts_at           TIMESTAMPTZ NOT NULL,
    ends_at             TIMESTAMPTZ NOT NULL,
    status              TEXT NOT NULL DEFAULT 'forming'
                            CHECK (status IN ('forming','active','ended','settled')),
    pool_amount_cents   BIGINT NOT NULL DEFAULT 0,
    participant_count   INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_seasons_status     ON seasons(status);
CREATE INDEX idx_seasons_starts_at  ON seasons(starts_at DESC);

-- =============================================================================
-- SEASON ENTRIES
-- =============================================================================

CREATE TABLE season_entries (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id           UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    group_id            UUID,               -- FK added after season_groups table
    entry_fee_cents     INTEGER NOT NULL DEFAULT 0,
    bid_amount_cents    INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','matched','active','completed','refunded')),
    payout_eligible     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, season_id)
);

CREATE INDEX idx_se_user_id     ON season_entries(user_id);
CREATE INDEX idx_se_season_id   ON season_entries(season_id);
CREATE INDEX idx_se_status      ON season_entries(status);

-- =============================================================================
-- SEASON GROUPS
-- =============================================================================

CREATE TABLE season_groups (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    season_id           UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    name                TEXT,
    chat_thread_id      UUID,               -- FK added after chat_threads
    total_mileage_km    DOUBLE PRECISION NOT NULL DEFAULT 0,
    territory_cells     INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sg_season_id ON season_groups(season_id);

-- Add FK from season_entries to season_groups
ALTER TABLE season_entries
    ADD CONSTRAINT fk_se_group FOREIGN KEY (group_id) REFERENCES season_groups(id);

-- =============================================================================
-- SEASON BIDS
-- =============================================================================

CREATE TABLE season_bids (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bidder_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id       UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    amount_cents    INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','accepted','declined','refunded','settled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bids_bidder    ON season_bids(bidder_id);
CREATE INDEX idx_bids_target    ON season_bids(target_user_id);
CREATE INDEX idx_bids_season    ON season_bids(season_id);

-- =============================================================================
-- WALLET TRANSACTIONS
-- =============================================================================

CREATE TABLE wallet_transactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            TEXT NOT NULL CHECK (type IN ('entry_fee','bid','payout','refund','credit')),
    amount_cents    INTEGER NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'usd',
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','completed','failed','reversed')),
    description     TEXT,
    stripe_id       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wt_user_id     ON wallet_transactions(user_id);
CREATE INDEX idx_wt_type        ON wallet_transactions(type);
CREATE INDEX idx_wt_status      ON wallet_transactions(status);
CREATE INDEX idx_wt_stripe_id   ON wallet_transactions(stripe_id) WHERE stripe_id IS NOT NULL;

-- =============================================================================
-- PAYOUTS
-- =============================================================================

CREATE TABLE payouts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id           UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    amount_cents        INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','scheduled','processing','completed','failed')),
    scheduled_at        TIMESTAMPTZ,
    settled_at          TIMESTAMPTZ,
    stripe_transfer_id  TEXT,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payouts_user_id    ON payouts(user_id);
CREATE INDEX idx_payouts_season_id  ON payouts(season_id);
CREATE INDEX idx_payouts_status     ON payouts(status);

-- =============================================================================
-- FRAUD FLAGS
-- =============================================================================

CREATE TABLE fraud_flags (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    target_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reporter_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    run_id          UUID REFERENCES runs(id) ON DELETE SET NULL,
    reason          TEXT NOT NULL CHECK (reason IN
                        ('gps_spoof','unrealistic_pace','user_report','duplicate_run')),
    status          TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','investigating','resolved','dismissed')),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ff_target      ON fraud_flags(target_user_id);
CREATE INDEX idx_ff_status      ON fraud_flags(status);

-- =============================================================================
-- BLOCKS & REPORTS
-- =============================================================================

CREATE TABLE user_blocks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    blocker_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(blocker_id, blocked_id)
);

-- =============================================================================
-- CHAT THREADS
-- =============================================================================

CREATE TABLE chat_threads (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    season_group_id     UUID NOT NULL REFERENCES season_groups(id) ON DELETE CASCADE,
    last_message_at     TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(season_group_id)
);

-- Add FK from season_groups back to chat_threads
ALTER TABLE season_groups
    ADD CONSTRAINT fk_sg_chat FOREIGN KEY (chat_thread_id) REFERENCES chat_threads(id);

-- =============================================================================
-- CHAT MESSAGES
-- =============================================================================

CREATE TABLE chat_messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id       UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    sender_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    body            TEXT NOT NULL,
    message_type    TEXT NOT NULL DEFAULT 'text'
                        CHECK (message_type IN ('text','territory_event','system_notice')),
    event_payload   JSONB,          -- TerritoryEventPayload for territory_event messages
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cm_thread_id   ON chat_messages(thread_id);
CREATE INDEX idx_cm_sent_at     ON chat_messages(sent_at DESC);

-- =============================================================================
-- MESSAGE REACTIONS
-- =============================================================================

CREATE TABLE message_reactions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id  UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL,
    reacted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX idx_mr_message_id ON message_reactions(message_id);

-- =============================================================================
-- ACHIEVEMENT EVENTS
-- =============================================================================

CREATE TABLE achievement_events (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_id      UUID REFERENCES runs(id) ON DELETE SET NULL,
    event_type  TEXT NOT NULL CHECK (event_type IN (
                    'first_visit','loop_multi_day','cell_claimed',
                    'cell_defended','corridor_reclaimed','group_zone_held','milestone_unlocked')),
    cell_id     TEXT,
    asset_id    UUID REFERENCES territory_assets(id) ON DELETE SET NULL,
    metadata    JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ae_user_id     ON achievement_events(user_id);
CREATE INDEX idx_ae_run_id      ON achievement_events(run_id);
CREATE INDEX idx_ae_occurred_at ON achievement_events(occurred_at DESC);

-- =============================================================================
-- UPDATED_AT TRIGGER FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_ucs_updated_at
    BEFORE UPDATE ON user_cell_stats FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_ta_updated_at
    BEFORE UPDATE ON territory_assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
