-- =============================================================================
-- Runturfing – Row Level Security Policies
-- Migration: 002_rls_policies.sql
-- Designed for Supabase (uses auth.uid() for JWT-based user identification).
--
-- NOT APPLIED on Railway Postgres (the deployed setup, 2026-07-29): auth.uid()
-- only exists on Supabase, so this file fails on vanilla Postgres. It is also
-- unnecessary there — no end-user client ever connects to the database; the
-- FastAPI service is the sole client and enforces per-user access in its JWT
-- middleware. Keep this file only in case of a future move to Supabase.
-- =============================================================================

-- Enable RLS on all user-facing tables
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens         ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_routes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_cells           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_cell_stats     ENABLE ROW LEVEL SECURITY;
ALTER TABLE territory_assets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_daily   ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_bids         ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_flags         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_blocks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievement_events  ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- USERS
-- =============================================================================

-- Users can read their own record; public fields visible to all authenticated users
CREATE POLICY "users_select_own"
    ON users FOR SELECT
    USING (auth.uid()::uuid = id OR is_active = TRUE);

CREATE POLICY "users_update_own"
    ON users FOR UPDATE
    USING (auth.uid()::uuid = id);

-- =============================================================================
-- PROFILES
-- =============================================================================

CREATE POLICY "profiles_select_public"
    ON profiles FOR SELECT
    USING (
        privacy_level = 'public'
        OR user_id = auth.uid()::uuid
    );

CREATE POLICY "profiles_update_own"
    ON profiles FOR UPDATE
    USING (user_id = auth.uid()::uuid);

CREATE POLICY "profiles_insert_own"
    ON profiles FOR INSERT
    WITH CHECK (user_id = auth.uid()::uuid);

-- =============================================================================
-- SOCIAL ACCOUNTS
-- =============================================================================

CREATE POLICY "social_select_own"
    ON social_accounts FOR SELECT
    USING (user_id = auth.uid()::uuid);

CREATE POLICY "social_insert_own"
    ON social_accounts FOR INSERT
    WITH CHECK (user_id = auth.uid()::uuid);

CREATE POLICY "social_delete_own"
    ON social_accounts FOR DELETE
    USING (user_id = auth.uid()::uuid);

-- =============================================================================
-- PUSH TOKENS
-- =============================================================================

CREATE POLICY "push_tokens_own"
    ON push_tokens FOR ALL
    USING (user_id = auth.uid()::uuid)
    WITH CHECK (user_id = auth.uid()::uuid);

-- =============================================================================
-- RUNS
-- =============================================================================

CREATE POLICY "runs_select_own"
    ON runs FOR SELECT
    USING (user_id = auth.uid()::uuid);

CREATE POLICY "runs_insert_own"
    ON runs FOR INSERT
    WITH CHECK (user_id = auth.uid()::uuid);

-- =============================================================================
-- RUN ROUTES
-- =============================================================================

CREATE POLICY "run_routes_select"
    ON run_routes FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM runs r
            WHERE r.id = run_routes.run_id
              AND r.user_id = auth.uid()::uuid
        )
    );

-- =============================================================================
-- USER CELL STATS
-- =============================================================================

-- Users can see their own stats; territory cells visible to all (for map rendering)
CREATE POLICY "ucs_select_own"
    ON user_cell_stats FOR SELECT
    USING (user_id = auth.uid()::uuid);

-- Service role updates these via backend (no direct client writes)

-- =============================================================================
-- TERRITORY ASSETS
-- =============================================================================

CREATE POLICY "ta_select_all"
    ON territory_assets FOR SELECT
    USING (TRUE);  -- All territory visible on map

CREATE POLICY "ta_update_own"
    ON territory_assets FOR UPDATE
    USING (user_id = auth.uid()::uuid);

-- =============================================================================
-- LEADERBOARD
-- =============================================================================

CREATE POLICY "lb_select_all"
    ON leaderboard_daily FOR SELECT
    USING (TRUE);  -- Leaderboards are public

-- =============================================================================
-- SEASON ENTRIES
-- =============================================================================

CREATE POLICY "se_select_own"
    ON season_entries FOR SELECT
    USING (user_id = auth.uid()::uuid);

CREATE POLICY "se_insert_own"
    ON season_entries FOR INSERT
    WITH CHECK (user_id = auth.uid()::uuid);

-- =============================================================================
-- SEASON BIDS
-- =============================================================================

CREATE POLICY "bids_select_own"
    ON season_bids FOR SELECT
    USING (bidder_id = auth.uid()::uuid OR target_user_id = auth.uid()::uuid);

CREATE POLICY "bids_insert_own"
    ON season_bids FOR INSERT
    WITH CHECK (bidder_id = auth.uid()::uuid);

-- =============================================================================
-- WALLET TRANSACTIONS
-- =============================================================================

CREATE POLICY "wt_select_own"
    ON wallet_transactions FOR SELECT
    USING (user_id = auth.uid()::uuid);

-- =============================================================================
-- PAYOUTS
-- =============================================================================

CREATE POLICY "payouts_select_own"
    ON payouts FOR SELECT
    USING (user_id = auth.uid()::uuid);

-- =============================================================================
-- FRAUD FLAGS
-- =============================================================================

CREATE POLICY "ff_select_own_reports"
    ON fraud_flags FOR SELECT
    USING (reporter_id = auth.uid()::uuid);

CREATE POLICY "ff_insert_report"
    ON fraud_flags FOR INSERT
    WITH CHECK (reporter_id = auth.uid()::uuid);

-- =============================================================================
-- USER BLOCKS
-- =============================================================================

CREATE POLICY "blocks_own"
    ON user_blocks FOR ALL
    USING (blocker_id = auth.uid()::uuid)
    WITH CHECK (blocker_id = auth.uid()::uuid);

-- =============================================================================
-- CHAT MESSAGES
-- =============================================================================

-- Users can read messages in their season group threads
CREATE POLICY "chat_select_group_member"
    ON chat_messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM chat_threads ct
            JOIN season_groups sg ON sg.id = ct.season_group_id
            JOIN season_entries se ON se.group_id = sg.id
            WHERE ct.id = chat_messages.thread_id
              AND se.user_id = auth.uid()::uuid
        )
    );

CREATE POLICY "chat_insert_group_member"
    ON chat_messages FOR INSERT
    WITH CHECK (
        sender_id = auth.uid()::uuid
        AND EXISTS (
            SELECT 1
            FROM chat_threads ct
            JOIN season_groups sg ON sg.id = ct.season_group_id
            JOIN season_entries se ON se.group_id = sg.id
            WHERE ct.id = chat_messages.thread_id
              AND se.user_id = auth.uid()::uuid
        )
    );

-- =============================================================================
-- MESSAGE REACTIONS
-- =============================================================================

CREATE POLICY "reactions_select_all"
    ON message_reactions FOR SELECT USING (TRUE);

CREATE POLICY "reactions_insert_own"
    ON message_reactions FOR INSERT
    WITH CHECK (user_id = auth.uid()::uuid);

CREATE POLICY "reactions_delete_own"
    ON message_reactions FOR DELETE
    USING (user_id = auth.uid()::uuid);

-- =============================================================================
-- ACHIEVEMENT EVENTS
-- =============================================================================

CREATE POLICY "ae_select_own"
    ON achievement_events FOR SELECT
    USING (user_id = auth.uid()::uuid);
