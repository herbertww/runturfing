# Runturfing Admin & Moderation Guide

This document outlines the administrative processes, moderation tools, and background jobs required to operate Runturfing.

## Background Jobs

The territory engine and leaderboards rely on scheduled background jobs. In production, these should be configured using `cron` or a task scheduler (like Celery, AWS EventBridge, or pg_cron).

### Nightly Decay Job
**Schedule:** Daily at 03:00 UTC
**Command:** `python -m api.jobs.nightly_decay`
**Purpose:** Applies the exponential decay formula to all user cell scores. Cells that fall below the threshold transition to a `decaying` or `neutral` state.

### Leaderboard Materialization
**Schedule:** Hourly
**Command:** `python -m api.jobs.leaderboard_materialize`
**Purpose:** Precomputes the all-time, 90-day, and seasonal leaderboards. This prevents expensive aggregations on every API request.

## Season Management

Seasons run in 2-week cycles. The platform administrator must manually trigger group formation and payout calculation to ensure quality control.

### 1. Group Formation (Locking)
When a season is ready to begin:
```bash
curl -X POST https://api.runturfing.app/seasons/{season_id}/lock \
     -H "Authorization: Bearer ADMIN_TOKEN"
```
This triggers the algorithm in `SeasonService.form_groups()`, which pairs users based on city, activity band, and preference bids.

### 2. Payout Calculation
When a season ends:
The backend logic calculates payouts for eligible users (women who linked socials and met the activity threshold).
*Note: Payouts are queued in the `payouts` table. Actual Stripe transfers should be initiated by a separate secure financial worker after fraud review.*

## Moderation & Anti-Cheat

### Reviewing Fraud Flags
Users can report suspicious runs, and the `AntiCheatService` automatically flags runs with unrealistic pace or GPS teleportation.
1. Query the `fraud_flags` table for `status = 'open'`.
2. Review the associated run polyline and pace.
3. If confirmed cheating, ban the user:
   ```sql
   UPDATE users SET is_banned = TRUE WHERE id = 'user_id';
   ```
4. Resolve the flag:
   ```sql
   UPDATE fraud_flags SET status = 'resolved' WHERE id = 'flag_id';
   ```

### Content Moderation
User profiles, chat messages, and group names are subject to community guidelines.
- Chat threads can be reviewed via the `chat_messages` table.
- Abusive users should be banned, which immediately removes them from leaderboards and season payouts.
