-- =============================================================================
-- 010 — Singapore tertiary institutions and the inaugural orientation season
--
-- Two things land here.
--
-- 1. Institutions. A runner opts into exactly one school. The opt-in is the
--    unit the orientation season scores on: individual turf still belongs to
--    the individual, but every owned cell also counts toward the school the
--    owner declared. Switching schools mid-season would let someone carry a
--    campus's worth of cells across to a rival, so the pick freezes once the
--    season a user is entered in goes active (enforced in the route, since the
--    rule depends on season state rather than on the row itself).
--
-- 2. Season kind. Standard seasons are the paid groups-of-6 format. Orientation
--    seasons are free to enter, score by school, and pay out nothing — which is
--    why entry_fee_cents moves onto the season row. Reading the fee from config
--    at join time meant every season alive at once had to cost the same, and a
--    later price change would have rewritten what an old season charged.
-- =============================================================================

-- ── Institutions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS institutions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Stable handle used in share links (/join/nus) and in the seed below, so
    -- re-running the seed updates rather than duplicates.
    slug            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    short_name      TEXT NOT NULL,
    kind            TEXT NOT NULL
                        CHECK (kind IN ('university','polytechnic','ite','arts')),
    country         TEXT NOT NULL DEFAULT 'SG',
    -- Display colour for the school's fill on the map and its row on the
    -- standings table. Chosen to stay distinguishable from its neighbours; not
    -- an official brand asset, and not licensed as one.
    color           TEXT NOT NULL,
    sort_order      INTEGER NOT NULL DEFAULT 100,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_institutions_kind ON institutions(kind);

-- Autonomous universities, polytechnics, ITE colleges, arts institutions.
INSERT INTO institutions (slug, name, short_name, kind, color, sort_order) VALUES
    ('nus',      'National University of Singapore',            'NUS',    'university',  '#EF7C00', 10),
    ('ntu',      'Nanyang Technological University',            'NTU',    'university',  '#C8102E', 11),
    ('smu',      'Singapore Management University',             'SMU',    'university',  '#00539B', 12),
    ('sutd',     'Singapore University of Technology and Design','SUTD',  'university',  '#7A1FA2', 13),
    ('sit',      'Singapore Institute of Technology',           'SIT',    'university',  '#D6001C', 14),
    ('suss',     'Singapore University of Social Sciences',     'SUSS',   'university',  '#00A0AF', 15),
    ('np',       'Ngee Ann Polytechnic',                        'NP',     'polytechnic', '#005EB8', 20),
    ('nyp',      'Nanyang Polytechnic',                         'NYP',    'polytechnic', '#00843D', 21),
    ('rp',       'Republic Polytechnic',                        'RP',     'polytechnic', '#5B2D8E', 22),
    ('sp',       'Singapore Polytechnic',                       'SP',     'polytechnic', '#E03C31', 23),
    ('tp',       'Temasek Polytechnic',                         'TP',     'polytechnic', '#0091B3', 24),
    ('ite-c',    'ITE College Central',                         'ITE-C',  'ite',         '#F2A900', 30),
    ('ite-e',    'ITE College East',                            'ITE-E',  'ite',         '#8DB600', 31),
    ('ite-w',    'ITE College West',                            'ITE-W',  'ite',         '#00758F', 32),
    ('nafa',     'Nanyang Academy of Fine Arts',                'NAFA',   'arts',        '#B5236F', 40),
    ('lasalle',  'LASALLE College of the Arts',                 'LASALLE','arts',        '#E8541B', 41)
ON CONFLICT (slug) DO UPDATE
    SET name       = EXCLUDED.name,
        short_name = EXCLUDED.short_name,
        kind       = EXCLUDED.kind,
        color      = EXCLUDED.color,
        sort_order = EXCLUDED.sort_order;

-- ── The opt-in ───────────────────────────────────────────────────────────────

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id),
    ADD COLUMN IF NOT EXISTS institution_set_at TIMESTAMPTZ;

-- The school standings query filters on institution_id and groups by it, so the
-- partial index skips the majority of rows outside a school season.
CREATE INDEX IF NOT EXISTS idx_users_institution
    ON users(institution_id)
    WHERE institution_id IS NOT NULL;

-- ── Season kind ──────────────────────────────────────────────────────────────

ALTER TABLE seasons
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'standard',
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS entry_fee_cents INTEGER;

DO $$
BEGIN
    ALTER TABLE seasons ADD CONSTRAINT seasons_kind_check
        CHECK (kind IN ('standard','orientation'));
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_seasons_kind ON seasons(kind);

-- Backfill: everything that existed before this migration is a paid standard
-- season. NULL entry_fee_cents keeps meaning "use the configured default", so
-- old rows are left alone rather than frozen at today's price.

-- ── Referral attribution for the school push ─────────────────────────────────
--
-- A referral already knows who brought whom. What the orientation season needs
-- on top is which school the invite was sent on behalf of, because a runner can
-- bring in someone from a rival campus and that invite should score for the
-- inviter's school, not the invitee's. Nullable: referrals outside a school
-- season carry no institution.
ALTER TABLE referrals
    ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES institutions(id);

CREATE INDEX IF NOT EXISTS idx_referrals_institution
    ON referrals(institution_id)
    WHERE institution_id IS NOT NULL;
