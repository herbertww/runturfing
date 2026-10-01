-- =============================================================================
-- 008 — Enclosure capture event
--
-- Closing a loop claims the ground inside it, which is a distinct achievement
-- from claiming a single cell: it is the payoff for committing to a full lap
-- instead of an out-and-back, and it deserves its own event so the chat and
-- the profile can call it out.
-- =============================================================================

ALTER TABLE achievement_events DROP CONSTRAINT IF EXISTS achievement_events_event_type_check;
ALTER TABLE achievement_events ADD CONSTRAINT achievement_events_event_type_check
    CHECK (event_type IN (
        'first_visit', 'loop_multi_day', 'cell_claimed', 'cell_defended',
        'corridor_reclaimed', 'group_zone_held', 'milestone_unlocked',
        'enclosure_claimed'));
