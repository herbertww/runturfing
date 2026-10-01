# AGENTS.md — Runturfing

Guidance for Codex working in this repo. (Global env-management rules also apply — see `~/.Codex/AGENTS.md`.)

## What This Is

**Runturfing** — an iPhone-first social running app. Core mechanic is **territory & influence**: runners gain visible map control by repeatedly running the same corridors/loops/neighborhoods. Built around intergroup competition, 2-week seasonal groups of 6, async group chat, a season payout pool, and a perpetual leaderboard.

**Repo:** https://github.com/herbertww/runfluence

**Product vision & motivation mechanics:** see `docs/PRODUCT_SPEC.md` (the five motivation levers the whole app is built to stack).

## Stack

| Layer | Tech |
|---|---|
| iOS app | Native iOS 16+, SwiftUI, Swift Concurrency, MapKit (`MKOverlay` territory), HealthKit (workouts + GPS) |
| Android app | React Native / Expo (SDK 53) |
| Backend | FastAPI (Python 3.11), Uvicorn, async SQLAlchemy |
| Database | PostgreSQL 15+ with PostGIS + pg_cron (Supabase recommended) |
| Spatial | Uber H3 grid (`h3-py`) for territory cells |
| Auth | Apple Sign In + JWT |
| Payments | Stripe (entry fees + payouts) |
| Jobs | Nightly territory decay + hourly leaderboard materialization (`Backend/api/jobs/`) |

## Structure

```
iOS/                  Native iOS app (SwiftUI, MapKit, HealthKit)
Android/              Expo React Native app
Backend/              FastAPI backend (async SQLAlchemy)
Backend/api/jobs/     Nightly decay + hourly leaderboard jobs
Backend/migrations/   Postgres SQL schemas + RLS policies
docs/                 SETUP.md, ADMIN.md, TESTFLIGHT.md
```

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
- **iOS:** open the Xcode project under `iOS/`.
- Docs: `docs/SETUP.md`, `FIRST_RUN.md`, `ANDROID_BUILD.md`, `docs/TESTFLIGHT.md`.

## Hard Rules

- Do NOT commit `.env` (either one) or print full secret values.
- Do NOT put secrets in `Android/.env` / any `EXPO_PUBLIC_*` var — those ship to the client.
- Do NOT hardcode secrets in source — read from the env loader.
