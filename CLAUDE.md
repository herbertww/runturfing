# CLAUDE.md — Runturfing

Guidance for Claude Code working in this repo. (Global env-management rules also apply — see `~/.claude/CLAUDE.md`.)

## What This Is

**Runturfing** — an iPhone-first social running app. Core mechanic is **territory & influence**: runners gain visible map control by repeatedly running the same corridors/loops/neighborhoods. Built around intergroup competition, 2-week seasonal groups of 6, async group chat, a season payout pool, and a perpetual leaderboard. Entering a season is free, and running while one is open enters you automatically.

**Repo:** https://github.com/herbertww/runfluence (repo and EAS slug still carry the old name; the app, docs and copy are Runturfing)

**"Runfluence"** now names one thing only: the referral mechanic in the season tab, where bringing paid entrants in weights your share of the pool. It is not the product name.

**Product vision & motivation mechanics:** see `docs/PRODUCT_SPEC.md` (the five motivation levers the whole app is built to stack).

## Stack

| Layer | Tech |
|---|---|
| Mobile app | React Native / Expo (SDK 53), one codebase for Android and iOS (`Android/` — the folder name predates the iOS decision). iOS builds via EAS; the old native SwiftUI scaffold was deleted 2026-07-31, never having left scaffold state. |
| Backend | FastAPI (Python 3.11), Uvicorn, async SQLAlchemy |
| Database | PostgreSQL on Railway (same project as the API). No PostGIS, no pg_cron — territory is H3 text ids + plain lat/lng columns; jobs are Python cron scripts. `002_rls_policies.sql` is Supabase-only and intentionally not applied. |
| Spatial | Uber H3 grid (`h3-py`) for territory cells |
| Auth | Apple Sign In + JWT |
| Payments | Stripe (rundating bounties + payouts). Season entry is free — see `docs/RUNDATING.md`. |
| Jobs | Nightly territory decay + hourly leaderboard materialization (`Backend/api/jobs/`) |

## Structure

```
Android/                    Expo React Native app — builds BOTH Android and iOS
Android/app/research.tsx    "Interior Research" — the research library, reached from Profile
Android/src/data/research.ts  One source of truth for every claim the app makes
Backend/                    FastAPI backend (async SQLAlchemy)
Backend/api/jobs/           Nightly decay + hourly leaderboard jobs
Backend/api/services/rank_service.py  SAF rank ladder (pure; no DB)
Backend/scripts/            simulate_turf.py — offline turf simulator (no DB)
Backend/migrations/         Postgres SQL schemas + RLS policies
landing/                    The website. Static files, no build step — see landing/README.md
docs/                       SETUP.md, ADMIN.md, TESTFLIGHT.md, WALKING_SCIENCE.md
```

## Three mechanics worth knowing before touching them

- **Rank** (`api/services/rank_service.py`). Two Singapore Armed Forces ladders. Commissioned officer ranks are earned by distance and pace *compounding*; specialist and warrant ranks by regularity alone. A runner holds one track, never both, and clearing the officer gate (50 km at 8 km/h) takes priority because that ladder is the one reaching the starred generals.
- **Influence** (`leaderboard_daily.influence_*`). Cell ownership is winner-takes-all, so second place across a whole neighbourhood scores nothing. Influence counts cells a runner has *any* live score in, and the leaderboard sorts on its 30-day moving average.
- **Schools** (`institutions`, `seasons.kind`). A runner opts into one Singapore tertiary institution and their turf counts for it as well as for them. The orientation season ranks schools by **total** turf held, never by an average: dividing by runners would mean each new entrant could only drag a school down, and one strong runner alone would be unbeatable. The pick freezes once the season goes active. See `docs/ORIENTATION_SEASON.md`.
- **Leader density** (`territory_scoring.leader_density`). Per cell, the share of its ring held by the same leader. The map scales fill opacity by it, so a stronghold paints as one dense region instead of scattered tiles.

## Environment Variables — two `.env` files

`.env` and `Backend/.env` are gitignored (the bare `.env` pattern also covers `Android/.env`). I manage both per the global rules.

**`Backend/.env`** (server secrets — template: `Backend/.env.example`):
`DATABASE_URL` · `JWT_SECRET` · `JWT_ALGORITHM` · `JWT_EXPIRE_MINUTES` · `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `APPLE_TEAM_ID` · `APPLE_CLIENT_ID` · `APPLE_KEY_ID` · `APPLE_PRIVATE_KEY_PATH` · `ENVIRONMENT` · `ALLOWED_ORIGINS`

**`Android/.env`** (Expo — *public* keys only, `EXPO_PUBLIC_*`; template: `Android/.env.example`):
`EXPO_PUBLIC_API_BASE_URL` · `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` · `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` · `EAS_PROJECT_ID`

⚠️ Anything prefixed `EXPO_PUBLIC_` is **bundled into the client app and is not secret** — never put a Stripe *secret* key or DB URL there. Server secrets live only in `Backend/.env`.

## Build & Run

- **Backend:** `cd Backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt`, then `uvicorn api.main:app --reload` (verify entrypoint).
- **Android:** `cd Android && npm install && npx expo start`.
- **iOS:** `cd Android && eas build --platform ios` (cloud build, no Mac needed; requires the Apple Developer membership).
- Docs: `docs/SETUP.md`, `FIRST_RUN.md`, `ANDROID_BUILD.md`, `docs/TESTFLIGHT.md`.

## Hard Rules

- Do NOT commit `.env` (either one) or print full secret values.
- Do NOT put secrets in `Android/.env` / any `EXPO_PUBLIC_*` var — those ship to the client.
- Do NOT hardcode secrets in source — read from the env loader.

## Writing Rules (all prose: app copy, landing pages, docs, chat, commits)

Applies to everything written for this project, not just marketing copy.

**Banned constructions** — these are the recognizable AI tics:
- Rule-of-three sentence fragments. ("No meetups. No coordinating. Never solo.")
- The escalation pivot: "didn't just X, it Y" / "isn't just about X — it's about Y".
- X-not-Y framing as a rhetorical move ("evolved behavior, not weakness").
- Mirrored antithesis ("Skip a day and five people feel it. Show up and five people see it.").
- Opening throat-clearing: "Here's the thing", "Let's be clear", "In today's world".
- Vocabulary: delve, tapestry, testament to, landscape, realm, seamless, elevate, unlock, harness, robust, leverage (as a verb).

**Limits**
- Max one em-dash per paragraph. Prefer a period or a comma.
- Max one sentence fragment per section, and only for genuine emphasis.
- Don't bold the lead-in of every paragraph. Bold carries meaning; if everything is bold, nothing is.
- Vary sentence length. Three medium declaratives in a row reads as generated.

**The actual fix:** slop appears when reaching for rhythm instead of content. A specific number, source, or mechanism crowds it out. Prefer "runners who felt included posted faster 5K times" over "the group changes everything."

**Voice:** plain, direct, concrete. Say what a thing does. Name it the way a user would. No hype adjectives — the evidence in `docs/WALKING_SCIENCE.md` is the persuasion.
