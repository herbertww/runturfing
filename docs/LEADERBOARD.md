# Leaderboards

Three boards. Two of them rank runners, one ranks groups. The distinction is the
thing people get wrong about this screen, including the copy on the landing page
before this document existed.

| Board | Tab label | Ranks | Field |
|---|---|---|---|
| `perpetual` | All-Time | runners | everyone, all time |
| `seasonal` | Season | runners | everyone who entered the active season |
| `groups` | Groups | groups of six | every group in the active season |

## The season board is open

A runner's season standing is their position among **every runner who entered
the season**, not their position among the five they were matched with. Entering
a season does not put you in a private board of six. It puts you on the open
board with everyone else, and it also puts you in a group.

This matters for what the number means. A runner who finishes 3rd of 6 in their
group but 40th of 900 in the season has one standing, and it is 40th. The group
placing is not a rank, it is where you sit inside your own group.

The **My group** scope on the individual boards narrows the same open board to
your six. It is a lens, not a separate competition: the rank numbers renumber
1–6 so you can see the order inside the group, and the board you are actually
competing on is **Everyone**. The screen says so in a line under the tabs,
because the assumption goes the other way by default.

`scope=friends` is the old name for that filter. There is no friends graph and
never was — the endpoint still answers `friends` because shipped clients send
it, and it resolves to the same season-group join.

## The Groups board is the intergroup competition

This is the board the season is built around, and the one the research in
`docs/WALKING_SCIENCE.md` is about: intergroup competition sustains running
motivation in a way individual competition does not. Groups of six are ranked
against **other groups**, on the group's season total.

**Totals, never averages.** Every group is six runners, so a total is already
comparable, and an average would mean a group's sixth runner could only drag it
down while a group carried by one runner would be unbeatable. Same reasoning as
the institution standings in `docs/ORIENTATION_SEASON.md`.

The one exception is **Defense**, which is already a rate per runner. Summing
six rates produces a number with no meaning, so that metric averages.

Member counts are counted from `season_entries`, not assumed to be six. A group
part-way through matching has fewer, and printing "6 runners" over four of them
makes the whole board look invented.

## Endpoints

```
GET /leaderboard?type=perpetual|seasonal&metric=&scope=global|city|group&seasonId=
GET /leaderboard/groups?metric=season_mileage|territory_control|defense_consistency&seasonId=
```

Both rank the whole filtered field before the page is cut, so rank numbers are
absolute. The caller's own row (or own group) is appended below the page when it
fell outside it — a runner sitting 400th should not open the board to no row of
their own.

Both read `leaderboard_daily`, materialized hourly by
`Backend/api/jobs/leaderboard_materialize.py`. Until that job has run once the
tables are empty and the app falls back to sample rows with a banner saying so.

`seasonId` is optional on both and defaults to the season with
`status = 'active'`.

## Source

- `Backend/api/routes/leaderboard.py` — both endpoints, and the metric tables.
- `Android/app/(tabs)/leaderboard.tsx` — the three tabs.
- `Android/src/types/index.ts` — `LeaderboardBoard`, `GroupStanding`.
