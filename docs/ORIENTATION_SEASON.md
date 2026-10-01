# The inaugural orientation season

Singapore's tertiary institutions, run against each other, for two weeks, free
to enter. It is the app's first season and it exists to get students onto the
map during the window when campus group chats are at their most active.

## What it is

A runner opts into one institution. Their turf keeps belonging to them, and it
also counts toward the crest they declared. Sixteen schools are on the board:
six autonomous universities, five polytechnics, the three ITE colleges, NAFA and
LASALLE.

## Scoring

A school's position is **total turf held by its members**.

```
score = sum(season_territory of members)     # total km breaks ties
```

Runner counts are shown beside the score and take no part in it.

### Why not an average

Dividing by active runners was the first design, on the reasoning that it stops
a large campus winning on headcount. It breaks in the other direction. A school
that fields one strong runner and nobody else posts an average nothing can
touch, and every further entrant can only pull it down. That turns inviting a
schoolmate into an act of self-harm, in the one season whose whole purpose is to
travel through orientation group chats.

Totalling gives the property the season needs: an extra runner never hurts, so
the invite is always worth sending. The cost is real and accepted. Larger
campuses have an advantage, and a season that rewards mobilisation is the point.

If the spread between the largest and smallest institutions turns out to make
the table dead on arrival, the fix is divisions (universities, polytechnics,
ITE, arts already exist as `institutions.kind`), not a divisor.

The table is computed live from the most recent `leaderboard_daily` snapshot
(`Backend/api/services/institution_service.py`). There is no separate
materialization job, because the query is one grouped scan over users.

## What is different from a standard season

| | Standard | Orientation |
|---|---|---|
| Entry fee | 0 | 0 |
| Payout pool | Half of each rundating bounty, settled at the end | None |
| Entry status on join | `pending`, settled immediately | `pending`, settled immediately |
| Scoreboard | Groups of 6, perpetual leaderboard | School table |

`seasons.kind` is `'orientation'`. The season screen keys off it and swaps the
pool card for the school table. Everything else on that screen (the countdown,
the activity threshold, the Runfluence card) is unchanged.

Entry costs nothing in either kind. `seasons.entry_fee_cents` still exists —
migration 010 moved it onto the season row so two live seasons could be priced
differently — but migration 011 set it to 0 everywhere and defaulted it to 0,
and no code reads it to decide a price any more. It survives only so old rows
that genuinely charged keep saying what they charged.

Neither kind waits on Stripe to become a real entry, and neither needs anyone
to press Join: `SeasonService.auto_enter_for_run` enters a runner on the first
run dated inside the season window.

## The school lock

A runner can switch schools freely until they are entered in an orientation
season that has gone `active`. After that, `PUT /v1/institutions/me` returns
409. Without the lock, someone could take ground under one crest for a
fortnight and move the whole holding to a rival on the final evening.

The rule lives in the route rather than in a constraint, because it depends on
season state rather than on anything in the `users` row.

## Sharing

The season is designed to be spread through group chats that already exist,
not through a new social graph.

- The season screen's share sheet writes copy naming the school and its current
  position, and appends the sender's referral code.
- Links are `https://runturfing.com/join/<slug>`. The page shows that school's
  standing and the live table with its row marked.
- `referrals.institution_id` records which school an invite was sent on behalf
  of. A runner who brings in someone from a rival campus scores the invite for
  their own school, not the invitee's.

Referral bonuses themselves are unchanged and still only apply to paid seasons.
An orientation referral has no cash value, by design: there is nothing to pay
out, so there is nothing to farm.

## Running it

Apply the migration, then create the season:

```bash
cd Backend && python scripts/seed_orientation_season.py --starts 2026-08-17 --dry-run
```

Drop `--dry-run` to write it. The script refuses if an orientation season
already exists, takes the next free season number, and creates the row in
`forming`. Flip `status` to `active` on the start date.

The endpoints, in `Backend/api/routes/institutions.py`:

| Route | Auth | Purpose |
|---|---|---|
| `GET /v1/institutions` | public | The pickable list |
| `GET /v1/institutions/standings` | public | The school table |
| `GET /v1/institutions/me` | required | Your school and your contribution |
| `PUT /v1/institutions/me` | required | Opt in, switch, or clear |

The two public ones are in the auth middleware's `SKIP_PATHS`. They have to be:
the marketing site reads them with no account, and the standings are the thing a
student screenshots into a group chat before anyone has installed anything.

## App surfaces

- **Onboarding** gains a school step after account creation and before
  permissions. Skipping is a first-class outcome; Runturfing is not a
  students-only app and a blocking gate would turn away everyone who has left.
- **Profile** carries a school row that opens `app/school.tsx`. It renders in
  both states, so someone who skipped onboarding can still find it.
- **Season** shows the school table, the runner's own contribution, and the
  invite button, in place of the pool card.

## Colours

`institutions.color` is a display colour for the map fill and the table row. The
values were chosen to stay distinguishable from their neighbours. They are not
official institutional marks, no institution has endorsed the app, and the site
says so on both pages that show them.
