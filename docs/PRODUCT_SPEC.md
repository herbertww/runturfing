# Runturfing — Product Spec

> The vision and the *why*. For how to work in the repo (stack, build, env rules) see `CLAUDE.md`.
> This is reference material — read it when designing or changing a feature, not every session.

## Positioning

Runturfing is a social running app built on exercise psychology and social research. It stacks motivational levers to sustain a walking or running habit: group-based competition and social connection, with the coordination friction stripped out by the phone in your pocket.

That last clause is the wedge. Running clubs have always worked, and they have always been limited by the need to get people to one place at one time. Async participation keeps the social pull and drops the scheduling cost. The evidence base for every claim we make about group running lives in [`WALKING_SCIENCE.md`](WALKING_SCIENCE.md) (Tier 5 covers the social findings).

## North Star

Runturfing is a social running app whose single job is to **make keeping a running habit psychologically easier than breaking it.** Every screen, notification, and mechanic exists to hand the user one more reason to lace up today.

We are not competing on tracking accuracy, training plans, or pace analytics — dozens of apps do that. We compete on **motivation density**: the sheer number of overlapping social and psychological reasons a user feels pulled to run. The product thesis is that motivation compounds when several independent levers all point the same direction at once.

**Platforms:** iPhone-first (native SwiftUI), with full Android parity (Expo/React Native). A user must be able to compete in the same seasons and leaderboards regardless of platform.

## The Five Motivation Levers

The whole product is the deliberate stacking of these five levers. Each is independent — a user demotivated on one is likely still hooked by another — and they reinforce each other.

### 1. Social relatability
Running feels less like a solo chore when peers like you are visibly doing it too.
- Async group chat tied to your season group; lightweight reactions, not pressure.
- See runs/territory from people in your demographic and area, not anonymous elites.
- "People like me are running" framing — relatability over aspiration.

### 2. Impressing your season group
A small, fixed, recurring audience you don't want to let down.
- **2-week seasons, groups of 6.** Small enough that your effort is *seen* and your absence is *noticed*.
- Your group sees your contribution to shared standing — social accountability without shame.
- The group is temporary, so there's always a fresh start and a clear finish line.

### 3. Intergroup competitive psychology
Us-vs-them is a stronger, more durable motivator than individual ranking alone.
- Your group competes against other groups — you run partly *for the team*.
- A laggard hurts the group; a strong runner is celebrated by 5 teammates. This converts individual effort into a social obligation people honor.
- Intergroup framing recruits in-group loyalty, the strongest social-psych lever we have.

### 4. Territory: loss-aversion on owned land
Loss aversion is ~2× stronger than equivalent gain — so we let users *acquire* visible map territory and feel its slow loss.
- Run the same corridors/loops/neighborhoods repeatedly → gain visible, owned map cells (H3 grid).
- Territory **decays** if not defended (nightly decay job) → the threat of losing ground you earned is a daily pull to run.
- Contested cells create rivalry at the street level. Watching your map shrink is a sharper motivator than watching it fail to grow.

### 5. Leaderboard standing
A persistent, public scoreboard for those driven by status and progress.
- **Perpetual leaderboard** (career-long) for long-term status.
- **Seasonal leaderboards** for fresh, attainable competition every 2 weeks.
- Multiple scopes (local / group / global) so everyone is near *some* top.

## How the Levers Stack

The design intent is that on any given day at least one lever is firing:
- Habit fading? → territory decay warning (lever 4) + group chat nudge (lever 1).
- Feeling individually unmotivated? → your group needs you this season (levers 2, 3).
- Doing well? → climbing the leaderboard rewards it (lever 5), teammates celebrate (lever 2).

**Design rule:** a feature earns its place only if it strengthens at least one lever. If it doesn't, it's a distraction from the north star and should be cut.

## Supporting Systems (means, not ends)

These exist to power the levers above, not as features in themselves:
- **Seasons engine** — forms groups of 6, runs the 2-week cycle, enters runners automatically on their first run inside the window, manages the payout pool (Stripe).
- **Territory engine** — H3 grid ownership, corridor matching, nightly decay, contested-cell resolution.
- **Leaderboard materialization** — hourly rollups of perpetual + seasonal standings.
- **Run ingestion** — HealthKit (iOS) / Health Connect (Android) imports + live GPS tracking.
- **Auth & identity** — Apple Sign In (iOS), Google Sign In (Android), shared JWT session.
- **Payments** — Stripe rundating bounties and season payout pool. Entry is free; the pool is funded by bounties alone, and each bounty splits half to the platform and half to the pool.
- **Notifications** — the delivery mechanism that surfaces lever events at the right moment (APNs / Expo push).

## Lever → Code Map

Use this when auditing whether a motivation lever is actually implemented vs. stubbed. **Status is unverified — to be filled in during the refactor audit.**

| Lever | Primary code surfaces | Status |
|---|---|---|
| 1. Social relatability | `Backend/api/routes/chat.py`, Android `app/(tabs)/chat.tsx` | _audit_ |
| 2. Impress season group | `Backend/api/routes/seasons.py` (groups of 6), season group UI | _audit_ |
| 3. Intergroup competition | `seasons.py` (group-vs-group scoring), `leaderboard.py` group scope | _audit_ |
| 4. Territory loss-aversion | `Backend/api/routes/territory.py`, `Backend/api/jobs/` (nightly decay), iOS `MKOverlay` map | _audit_ |
| 5. Leaderboard standing | `Backend/api/routes/leaderboard.py`, hourly materialization job | _audit_ |
| Delivery (cross-cutting) | push-token registration, APNs/Expo push | _audit_ |

## Success Criteria

The product is working if it moves **habit-retention** metrics, not vanity metrics:
- **Primary:** % of users who complete ≥3 runs/week for ≥2 consecutive seasons (habit formed).
- **Secondary:** season-over-season re-entry rate; runs-per-user-per-week; territory defended vs. lost.
- **Leading indicators:** notification → run conversion; group-chat participation; territory-decay-warning → run within 24h.

## Open Questions

- Payout pool: does real money strengthen or distort the motivation loop? Validate before going live. Settled for entry itself — entry is free, so the question is only about the bounty-funded pool.
- How is a user's season group composed (skill, geography, demographic) to maximize relatability *and* fair competition?
- Decay rate tuning: aggressive enough to create urgency, gentle enough not to feel punishing.
- Cross-platform fairness: HealthKit vs. Health Connect data fidelity differences must not advantage one platform.


## Territory: enclosure capture

Running a line claims a line. On its own that leaves the map as thin corridors
with dead pockets between them, and it makes an out-and-back down one side of a
park worth the same as a full lap round it.

**Close the loop and you take the ground inside it.**

| Rule | Value | Why |
|---|---|---|
| Closure tolerance | start and finish within **120 m** | "Back to the same park gate", without an out-and-back qualifying by accident |
| Minimum lap | **800 m** perimeter | Below this it is a car park, or GPS jitter drawing a circle at a standstill |
| Interior value | **50%** of a run-through | You get the territory; holding it still rewards running the ground |
| Cap | **4x** the cells actually run, hard ceiling **250** | Area grows with the square of the radius while the run grows linearly — uncapped, one huge perimeter swallows a town |
| Over the cap | keeps the cells nearest the loop's centre | The core of what was ringed, not an arbitrary edge slice |

Self-intersecting routes are fine: a figure of eight yields several rings and
every one of them counts. Cells already on the path are excluded, since ground
actually run scores at full rate through the normal path.

Measured on a 5 km lap (800 m radius): **17 cells on the line, 10 enclosed, 27
total** — a 59% bonus for committing to the full circuit. The same 5 km as an
out-and-back claims 6 cells and encloses nothing.

Tunables live on `ScoringParams` in `Backend/api/services/territory_scoring.py`
and are exercised offline by `scripts/simulate_turf.py`.
