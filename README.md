# Runturfing

Runturfing is a social running app built on exercise psychology and social research. It stacks motivational levers to sustain a walking or running habit: group-based competition and social connection, with the coordination friction stripped out by the phone in your pocket.

The core mechanic is territory and influence. Runners gain visible map control by repeatedly running the same corridors, loops, and neighborhoods. Around that sit intergroup competition, seasonal group formation, asynchronous group messaging, and a perpetual leaderboard.

**Why run with others?** The short version: runners who feel part of a group post faster times at no extra perceived effort, hold out longer when a team depends on them, and run more when the people around them run. The evidence for each claim, with primary sources, is in [The Science of Walking](docs/WALKING_SCIENCE.md).

## Features
- **HealthKit Integration**: Imports workouts and GPS route data.
- **Territory Map**: Visualizes owned, contested, and decaying territory cells.
- **Incremental Scoring Engine**: Rewards repeated loops, defense, and frequency.
- **Seasonal Competition**: 2-week seasons with groups of 6.
- **Season Pool**: Payouts to eligible users who meet the activity threshold.
- **Group Chat**: Asynchronous messaging with automated territory event alerts.
- **Perpetual Leaderboard**: All-time and 90-day rankings.
- **Privacy & Safety**: Age gate, location fuzzing near home, and reporting tools.

## Repository Structure
- `iOS/`: Native iOS app (SwiftUI, MapKit, HealthKit).
- `Backend/`: FastAPI Python backend with async SQLAlchemy.
- `Backend/migrations/`: Postgres SQL schemas and RLS policies.
- `Backend/api/jobs/`: Nightly decay and hourly leaderboard materialization jobs.

## Architecture
- **App**: Native iOS 16+ using SwiftUI and Swift Concurrency.
- **Map**: MapKit with `MKOverlay` for territory visualization.
- **Backend**: FastAPI (Python 3.11) with Uvicorn.
- **Database**: PostgreSQL 15+ with PostGIS and pg_cron (Supabase recommended).
- **Spatial Indexing**: Uber's H3 grid system (`h3-py`) for territory cells.
- **Auth**: Apple Sign In + JWT.
- **Payments**: Stripe for entry fees and payouts.

## Documentation
- [Setup Guide](docs/SETUP.md)
- [Admin & Moderation Guide](docs/ADMIN.md)
- [TestFlight Build Instructions](docs/TESTFLIGHT.md)
