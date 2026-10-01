#!/usr/bin/env python
"""
Runfluence – Turf ownership simulator

Runs synthetic runners over synthetic routes through the real scoring functions
in api/services/territory_scoring.py, with no database and no .env. The point is
to see what the game actually feels like — how many runs to claim a corridor,
how long it survives a holiday, and what happens when two people run the same
street — without waiting two weeks and six phones to find out.

The ledger below mirrors TerritoryService.process_run and the nightly decay job
step for step. If you change scoring, change it in territory_scoring.py and this
picks it up.

Usage:
    python scripts/simulate_turf.py solo
    python scripts/simulate_turf.py duel
    python scripts/simulate_turf.py duel --challenger-volume 2.0
    python scripts/simulate_turf.py flip
    python scripts/simulate_turf.py solo --decay 0.93 --threshold 40
    python scripts/simulate_turf.py export --html turf_replay.html

Requires: pip install 'h3>=4.0,<5'
"""

from __future__ import annotations

import argparse
import math
import sys
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Dict, List, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.services.territory_scoring import (  # noqa: E402
    ScoringParams,
    compute_run_score,
    coords_to_h3_cells,
    decay_multiplier,
    determine_cell_state,
)

OWNING_STATES = ("claimed", "defended", "reclaimed", "contested")


# ---------------------------------------------------------------------------
# Route generation
# ---------------------------------------------------------------------------

METERS_PER_DEG_LAT = 111_320.0


def _offset(lat: float, lng: float, north_m: float, east_m: float) -> Tuple[float, float]:
    return (
        lat + north_m / METERS_PER_DEG_LAT,
        lng + east_m / (METERS_PER_DEG_LAT * math.cos(math.radians(lat))),
    )


def loop_route(
    lat: float,
    lng: float,
    radius_m: float = 800.0,
    laps: float = 1.0,
    sample_m: float = 3.0,
) -> List[Tuple[float, float]]:
    """A circular loop, sampled the way a phone samples: every few metres."""
    circumference = 2 * math.pi * radius_m * laps
    steps = max(8, int(circumference / sample_m))
    points = []
    for i in range(steps + 1):
        theta = 2 * math.pi * laps * (i / steps)
        points.append(_offset(lat, lng, radius_m * math.cos(theta), radius_m * math.sin(theta)))
    return points


def corridor_route(
    lat: float,
    lng: float,
    length_m: float = 2500.0,
    bearing_deg: float = 45.0,
    out_and_back: bool = True,
    sample_m: float = 3.0,
) -> List[Tuple[float, float]]:
    """A straight there-and-back, the shape most people's weekday run really is."""
    steps = max(8, int(length_m / sample_m))
    rad = math.radians(bearing_deg)
    out = [
        _offset(lat, lng, length_m * (i / steps) * math.cos(rad), length_m * (i / steps) * math.sin(rad))
        for i in range(steps + 1)
    ]
    return out + list(reversed(out)) if out_and_back else out


def path_through(
    waypoints: List[Tuple[float, float]],
    sample_m: float = 3.0,
) -> List[Tuple[float, float]]:
    """Walk a list of waypoints at GPS sampling density."""
    from api.services.territory_scoring import haversine_meters

    out: List[Tuple[float, float]] = []
    for a, b in zip(waypoints, waypoints[1:]):
        distance = haversine_meters(a[0], a[1], b[0], b[1])
        steps = max(1, int(distance / sample_m))
        for i in range(steps):
            t = i / steps
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    out.append(waypoints[-1])
    return out


def bearing_point(
    lat: float, lng: float, distance_m: float, bearing_deg: float
) -> Tuple[float, float]:
    rad = math.radians(bearing_deg)
    return _offset(lat, lng, distance_m * math.cos(rad), distance_m * math.sin(rad))


def route_length_m(coords: List[Tuple[float, float]]) -> float:
    from api.services.territory_scoring import haversine_meters

    return sum(
        haversine_meters(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1])
        for i in range(len(coords) - 1)
    )


# ---------------------------------------------------------------------------
# In-memory ledger — mirrors user_cell_stats
# ---------------------------------------------------------------------------

@dataclass
class CellStat:
    lifetime_meters: float = 0.0
    unique_days: int = 0
    last_seen: date | None = None
    score: float = 0.0
    state: str = "neutral"


@dataclass
class World:
    params: ScoringParams
    stats: Dict[Tuple[str, str], CellStat] = field(default_factory=dict)
    events: List[Tuple[date, str, str, str]] = field(default_factory=list)
    # Mirror of run_cells: which user crossed which cell on which day. The
    # nightly decay reads it to price contest pressure.
    run_log: Dict[str, List[Tuple[date, str]]] = field(default_factory=dict)

    def cell_scores(self, cell: str) -> List[float]:
        return sorted(
            (s.score for (_, c), s in self.stats.items() if c == cell),
            reverse=True,
        )

    def owner(self, cell: str) -> str | None:
        best, best_score = None, 0.0
        for (user, c), s in self.stats.items():
            if c == cell and s.score >= self.params.ownership_threshold and s.score > best_score:
                best, best_score = user, s.score
        return best

    def owned_cells(self, user: str) -> List[str]:
        return [c for (u, c), s in self.stats.items() if u == user and s.state in OWNING_STATES]

    def total_score(self, user: str) -> float:
        return sum(s.score for (u, _), s in self.stats.items() if u == user)

    # -- write path: mirrors TerritoryService.process_run --------------------

    def record_run(self, user: str, cell_meters: Dict[str, float], day: date) -> None:
        for cell in cell_meters:
            self.run_log.setdefault(cell, []).append((day, user))
        for cell, meters in cell_meters.items():
            key = (user, cell)
            stat = self.stats.get(key)

            if stat is None:
                score = compute_run_score(meters, 1, False, self.params)
                self.stats[key] = CellStat(
                    lifetime_meters=meters,
                    unique_days=1,
                    last_seen=day,
                    score=score,
                    state="visited",
                )
                continue

            prev_state = stat.state
            if stat.last_seen is None or stat.last_seen < day:
                stat.unique_days += 1

            is_defending = prev_state in ("claimed", "defended")
            stat.score += compute_run_score(
                meters, stat.unique_days, is_defending, self.params, stat.score
            )
            stat.lifetime_meters += meters
            stat.last_seen = day

            # The service reads the top two scores after writing its own row,
            # so the runner's fresh score is in the comparison. Same here.
            scores = self.cell_scores(cell)
            top = scores[0] if scores else 0.0
            second = scores[1] if len(scores) > 1 else 0.0

            stat.state = determine_cell_state(
                stat.score, top, second, stat.unique_days, prev_state, self.params
            )
            if stat.state != prev_state:
                self.events.append((day, user, cell, f"{prev_state} -> {stat.state}"))

    # -- nightly job ---------------------------------------------------------

    def nightly_decay(self, day: date) -> None:
        window = timedelta(days=self.params.pressure_window_days)
        for (user, cell), stat in self.stats.items():
            if stat.last_seen is None or stat.score <= 0:
                continue
            days_since = (day - stat.last_seen).days
            # Opposing runs only: the holder's own passes are upkeep.
            recent = [
                u for d, u in self.run_log.get(cell, ())
                if u != user and day - window < d <= day
            ]
            mult = decay_multiplier(days_since, len(recent), len(set(recent)), self.params)
            if mult >= 1.0:
                continue
            prev_state = stat.state
            stat.score *= mult
            if stat.score < 1:
                stat.state = "neutral"
            elif prev_state in ("claimed", "defended", "reclaimed") and stat.score < self.params.ownership_threshold:
                stat.state = "decaying"
            if stat.state != prev_state:
                self.events.append((day, user, cell, f"{prev_state} -> {stat.state} (decay)"))


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

def _header(title: str) -> None:
    print(f"\n{title}")
    print("=" * len(title))


def _params_line(p: ScoringParams) -> None:
    print(
        f"h3 r{p.h3_resolution} | threshold {p.ownership_threshold:g} | "
        f"grace {p.grace_days}d, hold to {p.uncontested_hold_days}d, then {p.natural_decay_rate:g}/day | "
        f"contested x{p.contested_attack_rate:g}/run x{p.contested_contender_rate:g}/rival (floor {p.contested_floor:g}) | "
        f"cap {p.max_score_per_run:g}/run/cell | freq x{p.frequency_bonus_cap:g} | "
        f"defense x{p.defense_bonus:g}"
    )


def scenario_solo(p: ScoringParams, args) -> None:
    """One runner, one loop, every day for two weeks, then nothing."""
    route = loop_route(args.lat, args.lng, radius_m=args.radius)
    cells = coords_to_h3_cells(route, p)

    _header("Solo: 14 days on the same loop, then 21 days off")
    _params_line(p)
    print(f"route {route_length_m(route)/1000:.2f} km, touches {len(cells)} cells")
    print(f"meters per cell: min {min(cells.values()):.0f}, "
          f"median {sorted(cells.values())[len(cells)//2]:.0f}, max {max(cells.values()):.0f}")

    world = World(p)
    day = date(2026, 1, 1)
    print(f"\n{'day':>4}  {'runs':>4}  {'score/cell':>10}  {'owned':>5}  states")
    for n in range(35):
        running = n < 14
        if running:
            world.record_run("ana", cells, day)
        sample = world.stats[("ana", sorted(cells)[0])]
        owned = len(world.owned_cells("ana"))
        counts: Dict[str, int] = {}
        for (u, _), s in world.stats.items():
            if u == "ana":
                counts[s.state] = counts.get(s.state, 0) + 1
        if n < 16 or n % 4 == 0:
            summary = " ".join(f"{k}:{v}" for k, v in sorted(counts.items()))
            print(f"{n+1:>4}  {'yes' if running else 'no':>4}  {sample.score:>10.1f}  {owned:>5}  {summary}")
        day += timedelta(days=1)
        world.nightly_decay(day)


def scenario_duel(p: ScoringParams, args) -> None:
    """Two runners on the identical route, one with a head start."""
    route = loop_route(args.lat, args.lng, radius_m=args.radius)
    cells = coords_to_h3_cells(route, p)
    probe = sorted(cells)[len(cells) // 2]

    # The challenger runs the same street, at a volume multiple of the holder's.
    challenger_cells = {c: m * args.challenger_volume for c, m in cells.items()}

    _header(
        f"Duel: identical route. Holder starts day 1, challenger day {args.head_start + 1} "
        f"at {args.challenger_volume:g}x volume"
    )
    _params_line(p)
    print(f"probe cell {probe}: holder runs {cells[probe]:.0f} m through it, "
          f"challenger {challenger_cells[probe]:.0f} m")

    world = World(p)
    day = date(2026, 1, 1)
    print(f"\n{'day':>4}  {'holder':>8}  {'challenger':>11}  {'owner':>11}  {'holder state':>13}  {'chal. state':>12}")
    flipped_on = None
    for n in range(args.days):
        world.record_run("holder", cells, day)
        if n >= args.head_start:
            world.record_run("challenger", challenger_cells, day)

        h = world.stats.get(("holder", probe), CellStat())
        c = world.stats.get(("challenger", probe), CellStat())
        owner = world.owner(probe) or "none"
        if owner == "challenger" and flipped_on is None:
            flipped_on = n + 1
        print(f"{n+1:>4}  {h.score:>8.1f}  {c.score:>11.1f}  {owner:>11}  {h.state:>13}  {c.state:>12}")
        day += timedelta(days=1)
        world.nightly_decay(day)

    print()
    if flipped_on:
        print(f"Challenger took the cell on day {flipped_on}, "
              f"{flipped_on - args.head_start} days after starting.")
    else:
        print(f"Challenger never took the cell in {args.days} days at "
              f"{args.challenger_volume:g}x the holder's volume.")


def scenario_flip(p: ScoringParams, args) -> None:
    """How much harder does a challenger have to work, as the holder digs in?"""
    route = loop_route(args.lat, args.lng, radius_m=args.radius)
    cells = coords_to_h3_cells(route, p)
    probe = sorted(cells)[len(cells) // 2]

    _header("Flip cost: days for a challenger to take a cell off an entrenched holder")
    _params_line(p)
    print("Both run daily. Holder has a head start; challenger runs a volume multiple.\n")

    print(f"{'head start':>10} | " + " | ".join(f"{v:>4.1f}x" for v in args.volumes))
    print("-" * (12 + 8 * len(args.volumes)))

    for head_start in args.head_starts:
        row = []
        for volume in args.volumes:
            world = World(p)
            day = date(2026, 1, 1)
            challenger_cells = {c: m * volume for c, m in cells.items()}
            took = None
            for n in range(args.days):
                world.record_run("holder", cells, day)
                if n >= head_start:
                    world.record_run("challenger", challenger_cells, day)
                if world.owner(probe) == "challenger":
                    took = n + 1 - head_start
                    break
                day += timedelta(days=1)
                world.nightly_decay(day)
            row.append(f"{took:>4}d" if took else "never")
        print(f"{head_start:>10} | " + " | ".join(f"{v:>5}" for v in row))

    print(f"\n'never' means not inside {args.days} days of daily running by both.")


def scenario_export(p: ScoringParams, args) -> None:
    """
    Dump a day-by-day timeline as JSON for the visual replay.

    The two routes share a stem and then branch, which is what "we run the same
    street" actually looks like on a map: contested ground in the middle,
    uncontested ground at each end. Two separate loops barely intersect, and one
    identical route renders as a single blob changing colour.

    Both models get the same routes and the same schedule, so the replay can cut
    between them and the only thing that varies is the scoring.
    """
    import json

    import h3

    # Out along a shared corridor, then a fork, then back the same way.
    fork = bearing_point(args.lat, args.lng, args.shared_m, 45)
    holder_end = bearing_point(fork[0], fork[1], args.branch_m, 10)
    challenger_end = bearing_point(fork[0], fork[1], args.branch_m, 80)

    holder_route = path_through([(args.lat, args.lng), fork, holder_end, fork, (args.lat, args.lng)])
    challenger_route = path_through(
        [(args.lat, args.lng), fork, challenger_end, fork, (args.lat, args.lng)]
    )

    holder_cells = coords_to_h3_cells(holder_route, p)
    challenger_cells = {
        c: m * args.challenger_volume
        for c, m in coords_to_h3_cells(challenger_route, p).items()
    }

    models = {
        "today": ("Shipped model", p),
        "proposed": (
            "Cap 100 + ceiling 600",
            p.with_(max_score_per_run=100.0, score_ceiling=600.0),
        ),
    }

    out = {
        "meta": {
            "days": args.days,
            "headStart": args.head_start,
            "challengerVolume": args.challenger_volume,
            "runners": ["holder", "challenger"],
            "sharedCells": sorted(set(holder_cells) & set(challenger_cells)),
        },
        "cells": {},
        "routes": {
            "holder": [[round(a, 6), round(b, 6)] for a, b in holder_route[::20]],
            "challenger": [[round(a, 6), round(b, 6)] for a, b in challenger_route[::20]],
        },
        "models": {},
    }

    for cell in set(holder_cells) | set(challenger_cells):
        out["cells"][cell] = [
            [round(lat, 6), round(lng, 6)] for lat, lng in h3.cell_to_boundary(cell)
        ]

    for key, (label, mp) in models.items():
        world = World(mp)
        day = date(2026, 1, 1)
        frames = []

        for n in range(args.days):
            world.record_run("holder", holder_cells, day)
            if n >= args.head_start:
                world.record_run("challenger", challenger_cells, day)

            frame = {"day": n + 1, "cells": {}}
            for cell in out["cells"]:
                entry = {}
                for runner in ("holder", "challenger"):
                    stat = world.stats.get((runner, cell))
                    if stat and stat.score > 0:
                        entry[runner] = {
                            "score": round(stat.score, 1),
                            "state": stat.state,
                        }
                if entry:
                    frame["cells"][cell] = {
                        "owner": world.owner(cell),
                        "runners": entry,
                    }
            frames.append(frame)

            day += timedelta(days=1)
            world.nightly_decay(day)

        out["models"][key] = {
            "label": label,
            "params": {
                "ownershipThreshold": mp.ownership_threshold,
                "contestedDelta": mp.contested_delta,
                "dailyDecayRate": mp.daily_decay_rate,
                "maxScorePerRun": mp.max_score_per_run,
                "defenseBonus": mp.defense_bonus,
                "scoreCeiling": mp.score_ceiling,
                "halfLifeDays": round(mp.score_half_life_days, 1),
                "graceDays": mp.grace_days,
                "uncontestedHoldDays": mp.uncontested_hold_days,
                "naturalDecayRate": mp.natural_decay_rate,
                "contestedFloor": mp.contested_floor,
            },
            "frames": frames,
        }

    payload = json.dumps(out)
    Path(args.out).write_text(payload, encoding="utf-8")
    print(f"wrote {args.out}")
    print(f"{len(out['cells'])} cells, {args.days} days, {len(out['models'])} models")
    print(f"{len(out['meta']['sharedCells'])} cells are run by both")

    if args.html:
        template = Path(__file__).resolve().parent / "turf_replay_template.html"
        page = template.read_text(encoding="utf-8").replace("/*__TURF_DATA__*/ null", payload)
        if "__TURF_DATA__" in page:
            raise RuntimeError(f"{template.name} is missing its data placeholder")
        Path(args.html).write_text(page, encoding="utf-8")
        print(f"wrote {args.html} - open it in a browser to scrub the timeline")


# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scenario", choices=["solo", "duel", "flip", "export"])
    ap.add_argument("--lat", type=float, default=51.5074, help="route centre latitude")
    ap.add_argument("--lng", type=float, default=-0.1278, help="route centre longitude")
    ap.add_argument("--radius", type=float, default=800.0, help="loop radius in metres")
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--head-start", type=int, default=7, help="days the holder runs alone (duel)")
    ap.add_argument("--challenger-volume", type=float, default=1.0, help="challenger metres / holder metres")
    ap.add_argument("--head-starts", type=int, nargs="+", default=[0, 3, 7, 14], help="flip scenario rows")
    ap.add_argument("--volumes", type=float, nargs="+", default=[1.0, 1.5, 2.0, 3.0], help="flip scenario columns")

    ap.add_argument("--resolution", type=int, help="override h3 resolution")
    ap.add_argument("--threshold", type=float, help="override ownership threshold")
    ap.add_argument("--decay", type=float, help="override daily decay rate")
    ap.add_argument("--defense", type=float, help="override defense bonus")
    ap.add_argument("--freq-cap", type=float, help="override frequency multiplier cap")
    ap.add_argument("--max-per-run", type=float, help="override per-run per-cell score cap")
    ap.add_argument("--contested-delta", type=float, help="override contested delta")
    ap.add_argument("--ceiling", type=float, help="soft cap on per-cell score (0 = off)")
    ap.add_argument("--shared-m", type=float, default=1400.0, help="export: length of the corridor both runners use")
    ap.add_argument("--branch-m", type=float, default=1100.0, help="export: length of each runner's own branch")
    ap.add_argument("--out", default="turf_timeline.json", help="export: JSON output path")
    ap.add_argument("--html", help="export: also write a standalone replay page here")
    args = ap.parse_args()

    overrides = {
        k: v
        for k, v in {
            "h3_resolution": args.resolution,
            "ownership_threshold": args.threshold,
            "daily_decay_rate": args.decay,
            "defense_bonus": args.defense,
            "frequency_bonus_cap": args.freq_cap,
            "max_score_per_run": args.max_per_run,
            "contested_delta": args.contested_delta,
            "score_ceiling": args.ceiling,
        }.items()
        if v is not None
    }
    params = ScoringParams(**overrides)

    {
        "solo": scenario_solo,
        "duel": scenario_duel,
        "flip": scenario_flip,
        "export": scenario_export,
    }[args.scenario](params, args)


if __name__ == "__main__":
    main()
