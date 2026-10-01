"""
Runfluence Backend – Territory Scoring (pure)

The scoring maths, with no database, no session and no settings import. Split
out of territory_service.py so that scripts/simulate_turf.py can exercise the
exact formulas the API uses without a Postgres connection or a .env file.

territory_service.py keeps the orchestration: reading and writing
user_cell_stats, emitting achievement events, updating run status. Nothing in
here touches IO.

Every tunable lives on ScoringParams rather than at module level, so a
simulation can sweep a parameter without monkeypatching the service.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from typing import Dict, List, Set, Tuple

# Segments below this are GPS jitter — a phone resting on a table still emits
# a metre or two of movement per sample.
JITTER_FLOOR_METERS = 1.0

# Long segments get walked in steps this size so meters land in the cell they
# were actually run through, not in whichever cell the segment started in.
SUBDIVIDE_STEP_METERS = 10.0

# A single stride between consecutive fixes cannot be this long. Anything above
# it is a recording gap (screen off, signal lost) or a spoofed jump, and the
# straight line between the two ends is a guess. Crediting cells along that
# guess would hand out ground nobody ran, so the segment is skipped entirely.
# Enforced server-side as well as on the device: the client cannot be trusted
# to be honest or up to date.
MAX_SEGMENT_METERS = 150.0


@dataclass(frozen=True)
class ScoringParams:
    """Defaults mirror api.config.Settings. Keep the two in step."""

    h3_resolution: int = 10
    score_per_meter: float = 0.1
    max_score_per_run: float = 30.0
    frequency_step: float = 0.25       # added per extra unique active day
    frequency_bonus_cap: float = 1.5   # ceiling on the frequency multiplier
    defense_bonus: float = 1.25        # multiplier when already holding the cell
    ownership_threshold: float = 25.0
    contested_delta: float = 8.0
    # Legacy uniform rate; kept for apply_decay callers and old sims. The live
    # model decays via decay_multiplier below, which is pressure-aware.
    daily_decay_rate: float = 0.97

    # -- decay model ---------------------------------------------------------
    # Design intent (2026-07-29): a run buys ~3 days of undisturbed holding.
    # After that, contested ground deteriorates in proportion to how often and
    # by how many people it is being run; uncontested ground barely moves
    # until two weeks, then needs upkeep. Nobody holds forever off one run
    # unless genuinely nobody else wants the ground.
    grace_days: int = 3               # no decay while the last run is this fresh
    uncontested_hold_days: int = 14   # after grace, quiet ground holds until here
    uncontested_hold_rate: float = 0.995   # near-flat drift inside the hold
    natural_decay_rate: float = 0.93       # past the hold: upkeep or lose it (~9.6d half-life)
    contested_attack_rate: float = 0.98    # per opposing run in the window
    contested_contender_rate: float = 0.95 # per distinct opponent
    contested_floor: float = 0.75          # hardest one night can hit (~2.4d half-life)
    pressure_window_days: int = 7          # how far back attacks count
    max_counted_attacks: int = 10
    max_counted_contenders: int = 5

    # Diminishing returns as a cell score approaches this ceiling: each run
    # banks gain * (1 - score/ceiling). Zero disables it, which is the shipped
    # behaviour — scores accumulate linearly and the leader's lead only grows.
    # Turned on, a challenger gains faster than the holder purely because the
    # holder is nearer the ceiling, so ground stays winnable without anyone
    # attacking anyone. Sweep it with scripts/simulate_turf.py --ceiling.
    score_ceiling: float = 0.0

    # -- enclosure capture ---------------------------------------------------
    # Running a line claims a line, which leaves the map as thin corridors with
    # dead space between them. Close a loop and you take the ground inside it:
    # the reward for committing to a full lap round the lake rather than an
    # out-and-back down one side.
    enclosure_enabled: bool = True
    # Start and finish must land within this of each other to count as closed.
    # Generous enough for "back to the same park gate", tight enough that an
    # out-and-back cannot pass by accident.
    closure_tolerance_m: float = 120.0
    # A loop must be a real lap. Below this it is a lap of a car park, or GPS
    # jitter at a standstill drawing a tiny circle.
    min_loop_perimeter_m: float = 800.0
    # Interior ground is worth less than ground actually run. You get the
    # territory, but holding it still rewards running through it.
    enclosure_score_share: float = 0.5
    # Ceiling on interior cells per run, as a multiple of the cells actually
    # run. Without it, one enormous perimeter swallows a whole town: area grows
    # with the square of the radius while the run only grows linearly.
    max_enclosure_ratio: float = 4.0
    # Absolute backstop regardless of ratio.
    max_enclosure_cells: int = 500
    # How far inside the loop a claim may reach from the path itself.
    #
    # The ratio and count caps limit how MUCH interior a run takes, but not
    # WHERE, so a 20 km ring round a town still handed over 8.5 km2 of ground —
    # including the middle, which the runner never went near. Nobody encircling
    # a district on its ring road has any claim on the town centre.
    #
    # With a reach cap the interior is a lining inside the loop rather than a
    # fill. A small lap is unaffected: an 800 m loop has a radius of 127 m, so
    # its whole interior is inside the reach and still fills solid. A large one
    # takes a band and leaves the core alone.
    max_enclosure_reach_m: float = 300.0

    # One-time bonus for an account whose social identity has been proven by
    # OAuth. Deliberately small and flat: it is an anti-fraud signal, not a
    # reward for having an audience. Reach is already rewarded by the
    # Runfluence referral multiplier, and stacking two advantages on the same
    # axis would let the same people run away with both turf and bounty.
    # Flat regardless of how many platforms are linked, so there is nothing to
    # farm by connecting more accounts.
    social_verified_bonus: float = 0.05

    @property
    def score_half_life_days(self) -> float:
        """Half-life of uncontested ground once past the hold period."""
        return math.log(0.5) / math.log(self.natural_decay_rate)

    def with_(self, **overrides) -> "ScoringParams":
        return replace(self, **overrides)


DEFAULT_PARAMS = ScoringParams()


def params_from_settings(settings) -> ScoringParams:
    """Build params from api.config.Settings, for the live service."""
    return ScoringParams(
        h3_resolution=settings.h3_resolution,
        ownership_threshold=settings.ownership_threshold,
        contested_delta=settings.contested_delta,
        daily_decay_rate=settings.daily_decay_rate,
        max_enclosure_reach_m=getattr(
            settings, "max_enclosure_reach_m", DEFAULT_PARAMS.max_enclosure_reach_m
        ),
    )


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def decode_polyline(encoded: str) -> List[Tuple[float, float]]:
    """Google encoded polyline -> list of (lat, lng)."""
    coords: List[Tuple[float, float]] = []
    index, lat, lng = 0, 0, 0
    while index < len(encoded):
        shift, result = 0, 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        lat += ~(result >> 1) if result & 1 else result >> 1

        shift, result = 0, 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        lng += ~(result >> 1) if result & 1 else result >> 1

        coords.append((lat / 1e5, lng / 1e5))
    return coords


def encode_polyline(coords: List[Tuple[float, float]]) -> str:
    """Inverse of decode_polyline. Used by the simulator to feed synthetic
    routes through the same entry point a real client uses."""

    def encode_value(value: int) -> str:
        value = ~(value << 1) if value < 0 else value << 1
        chunks = []
        while value >= 0x20:
            chunks.append(chr((0x20 | (value & 0x1F)) + 63))
            value >>= 5
        chunks.append(chr(value + 63))
        return "".join(chunks)

    out, prev_lat, prev_lng = [], 0, 0
    for lat, lng in coords:
        ilat, ilng = round(lat * 1e5), round(lng * 1e5)
        out.append(encode_value(ilat - prev_lat))
        out.append(encode_value(ilng - prev_lng))
        prev_lat, prev_lng = ilat, ilng
    return "".join(out)


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    )
    return 6_371_000 * 2 * math.asin(math.sqrt(a))


def coords_to_h3_cells(
    coords: List[Tuple[float, float]],
    params: ScoringParams = DEFAULT_PARAMS,
) -> Dict[str, float]:
    """
    Convert a GPS track to {h3_cell_id: meters_run_inside_that_cell}.

    Segments are subdivided when their endpoints fall in different cells, so a
    long straight leg credits every cell it crosses instead of dumping its whole
    length into the cell it happened to start in.
    """
    try:
        import h3
    except ImportError as exc:  # pragma: no cover - deployment guard
        # Deliberately fatal. The previous stub invented cell ids like
        # "stub_5142_-11" and wrote them to user_cell_stats, which silently
        # poisons real territory data and is far worse than a failed import.
        raise RuntimeError(
            "h3 is required for territory scoring; pip install 'h3>=4.0,<5'"
        ) from exc

    cells: Dict[str, float] = {}
    resolution = params.h3_resolution

    for i in range(len(coords) - 1):
        lat1, lng1 = coords[i]
        lat2, lng2 = coords[i + 1]
        segment_meters = haversine_meters(lat1, lng1, lat2, lng2)

        if segment_meters < JITTER_FLOOR_METERS:
            continue

        # A gap in the recording, not a run. See MAX_SEGMENT_METERS.
        if segment_meters > MAX_SEGMENT_METERS:
            continue

        start = h3.latlng_to_cell(lat1, lng1, resolution)
        end = h3.latlng_to_cell(lat2, lng2, resolution)

        if start == end:
            cells[start] = cells.get(start, 0.0) + segment_meters
            continue

        steps = max(2, math.ceil(segment_meters / SUBDIVIDE_STEP_METERS))
        share = segment_meters / steps
        for step in range(steps):
            t = (step + 0.5) / steps
            cell = h3.latlng_to_cell(lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t, resolution)
            cells[cell] = cells.get(cell, 0.0) + share

    return cells


@dataclass(frozen=True)
class Enclosure:
    """Result of testing a run for a closed loop."""

    closed: bool
    cells: Set[str]
    perimeter_m: float
    reason: str = ""


def enclosed_cells(
    coords: List[Tuple[float, float]],
    path_cells: Dict[str, float],
    params: ScoringParams = DEFAULT_PARAMS,
) -> Enclosure:
    """
    Cells enclosed by a run that finishes where it started.

    Territory is otherwise a set of lines, so a map of "conquered" ground reads
    as thin corridors with large dead pockets between them. Closing a loop
    claims what is inside it, which is what makes a full lap round the lake
    worth more than an out-and-back down one side.

    Guards, in order: enabled, enough points, start meets finish, the lap is
    long enough to be a lap, and the interior is capped relative to the effort
    — area grows with the square of the radius while the run grows linearly, so
    an uncapped rule lets one huge perimeter swallow a town.

    Returns only NEW cells: anything already on the path is excluded, because
    ground actually run is scored at full rate elsewhere.
    """
    if not params.enclosure_enabled:
        return Enclosure(False, set(), 0.0, "enclosure disabled")
    if len(coords) < 4:
        return Enclosure(False, set(), 0.0, "too few points")

    perimeter = sum(
        haversine_meters(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1])
        for i in range(len(coords) - 1)
    )

    gap = haversine_meters(coords[0][0], coords[0][1], coords[-1][0], coords[-1][1])
    if gap > params.closure_tolerance_m:
        return Enclosure(False, set(), perimeter, f"ends {gap:.0f}m apart, not a loop")
    if perimeter < params.min_loop_perimeter_m:
        return Enclosure(False, set(), perimeter, f"loop only {perimeter:.0f}m round")

    try:
        import h3
        from shapely.geometry import Polygon
    except ImportError as exc:  # pragma: no cover - deployment guard
        raise RuntimeError("enclosure capture needs h3 and shapely") from exc

    # buffer(0) resolves self-intersections, which are normal: people cross
    # their own path, run a figure of eight, or double back at a turnaround.
    ring = list(coords)
    if gap > 0:
        ring.append(coords[0])
    polygon = Polygon([(lng, lat) for lat, lng in ring])
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    if polygon.is_empty or polygon.area <= 0:
        return Enclosure(False, set(), perimeter, "loop encloses no area")

    # A figure of eight yields several rings; take them all.
    parts = list(getattr(polygon, "geoms", [polygon]))
    found: Set[str] = set()
    for part in parts:
        if part.is_empty:
            continue
        outer = [(lat, lng) for lng, lat in part.exterior.coords]
        holes = [[(lat, lng) for lng, lat in i.coords] for i in part.interiors]
        try:
            shape = h3.LatLngPoly(outer, *holes)
            found.update(h3.h3shape_to_cells(shape, params.h3_resolution))
        except Exception:
            # A degenerate ring is not worth failing the whole run over.
            continue

    interior = found - set(path_cells)
    if not interior:
        return Enclosure(True, set(), perimeter, "loop encloses no new cells")

    # Reach cap before the count caps. Trimming to a band first means the
    # ratio/count caps then apply to ground the runner was actually near,
    # rather than spending the whole allowance on the middle of the ring.
    interior, trimmed = _within_reach(interior, path_cells, params)
    if not interior:
        return Enclosure(True, set(), perimeter, "loop too wide to reach its interior")

    allowed = min(
        params.max_enclosure_cells,
        int(len(path_cells) * params.max_enclosure_ratio),
    )
    if len(interior) > allowed:
        # Keep the cells nearest the centre: the core of what was ringed, rather
        # than an arbitrary slice of the edge.
        centre_lat = sum(c[0] for c in coords) / len(coords)
        centre_lng = sum(c[1] for c in coords) / len(coords)
        ranked = sorted(
            interior,
            key=lambda c: haversine_meters(*cell_centroid(c), centre_lat, centre_lng),
        )
        interior = set(ranked[:allowed])
        return Enclosure(True, interior, perimeter, f"capped to {allowed} cells")

    if trimmed:
        return Enclosure(
            True, interior, perimeter,
            f"{trimmed} interior cells beyond {params.max_enclosure_reach_m:.0f}m of the route",
        )
    return Enclosure(True, interior, perimeter, "")


def _within_reach(
    interior: Set[str],
    path_cells: Dict[str, float],
    params: ScoringParams,
) -> Tuple[Set[str], int]:
    """
    Keep only interior cells within reach of the route, and report how many
    were dropped.

    Measured in grid steps rather than metres: h3 neighbour lookups are cheap
    and exact on the same grid the cells came from, where a per-cell haversine
    against every path coordinate is neither. One grid step is one cell width,
    so the reach converts directly.
    """
    if params.max_enclosure_reach_m <= 0:
        return interior, 0

    import h3

    edge = h3.average_hexagon_edge_length(params.h3_resolution, unit="m")
    steps = max(1, math.ceil(params.max_enclosure_reach_m / (edge * 2)))

    reach: Set[str] = set()
    for cell in path_cells:
        reach.update(h3.grid_disk(cell, steps))

    kept = interior & reach
    return kept, len(interior) - len(kept)


def cell_centroid(cell_id: str) -> Tuple[float, float]:
    """(lat, lng) centre of an H3 cell."""
    import h3

    return h3.cell_to_latlng(cell_id)


def cell_neighbours(cell_id: str, radius: int = 1) -> Set[str]:
    """Cells within `radius` steps, the cell itself excluded."""
    import h3

    ring = set(h3.grid_disk(cell_id, radius))
    ring.discard(cell_id)
    return ring


def leader_density(
    owner_by_cell: Dict[str, str], cell_id: str, radius: int = 1
) -> float:
    """
    How much of the ground around a cell is held by the same person, 0..1.

    A hex has six neighbours, so a leader who holds all six scores 1.0 and one
    holding an isolated cell scores 0. Cells outside the requested viewport are
    simply absent from `owner_by_cell` and count against the density — a
    stronghold that runs off the edge of the screen reads as weaker there, which
    is the honest answer for what the map can actually see.
    """
    owner = owner_by_cell.get(cell_id)
    if not owner:
        return 0.0
    ring = cell_neighbours(cell_id, radius)
    if not ring:
        return 0.0
    same = sum(1 for n in ring if owner_by_cell.get(n) == owner)
    return same / len(ring)


def cell_boundary(cell_id: str) -> List[Tuple[float, float]]:
    """The cell's real hex outline as (lat, lng) pairs, for the client to draw
    verbatim. The app used to approximate this with a fixed-radius hexagon,
    which was ~4x too small for r9 and did not tile."""
    import h3

    return [(lat, lng) for lat, lng in h3.cell_to_boundary(cell_id)]


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def compute_run_score(
    meters: float,
    unique_days: int,
    is_defending: bool,
    params: ScoringParams = DEFAULT_PARAMS,
    current_score: float = 0.0,
    social_verified: bool = False,
) -> float:
    """
    Score a single run's pass through a single cell.

    `social_verified` is true when the runner has proven ownership of at least
    one social account via OAuth. Flat regardless of how many are linked.
    """
    base = min(meters * params.score_per_meter, params.max_score_per_run)
    freq_mult = min(1.0 + (unique_days - 1) * params.frequency_step, params.frequency_bonus_cap)
    defense_mult = params.defense_bonus if is_defending else 1.0
    verified_mult = 1.0 + params.social_verified_bonus if social_verified else 1.0
    gain = base * freq_mult * defense_mult * verified_mult

    if params.score_ceiling > 0:
        gain *= max(0.0, 1.0 - current_score / params.score_ceiling)

    return gain


def apply_decay(
    current_score: float,
    days_since_last: float,
    params: ScoringParams = DEFAULT_PARAMS,
) -> float:
    """Legacy uniform decay. The live model uses decay_multiplier."""
    if days_since_last <= 0:
        return current_score
    return current_score * (params.daily_decay_rate ** days_since_last)


def decay_multiplier(
    days_since_last: float,
    attacks: int,
    contenders: int,
    params: ScoringParams = DEFAULT_PARAMS,
) -> float:
    """
    One night's decay multiplier for one holder's stake in one cell.

    `attacks` is how many opposing runs crossed the cell inside the pressure
    window; `contenders` is how many distinct people made them. The holder's
    own runs never count — running your own street is upkeep, not an attack.

    Grace first: a run buys grace_days of complete immunity. Then pressure
    decay if anyone is contesting, scaled by both frequency and headcount and
    floored so a pile-on cannot zero someone overnight. Quiet ground drifts at
    the hold rate until uncontested_hold_days, then decays for real.
    """
    if days_since_last <= params.grace_days:
        return 1.0

    if attacks > 0:
        mult = (
            params.contested_attack_rate ** min(attacks, params.max_counted_attacks)
            * params.contested_contender_rate ** min(contenders, params.max_counted_contenders)
        )
        return max(params.contested_floor, mult)

    if days_since_last <= params.uncontested_hold_days:
        return params.uncontested_hold_rate

    return params.natural_decay_rate


def determine_cell_state(
    user_score: float,
    top_score: float,
    second_score: float,
    unique_days: int,
    prev_state: str,
    params: ScoringParams = DEFAULT_PARAMS,
) -> str:
    """Achievement state for one user in one cell."""
    if user_score < 1.0:
        return "neutral"
    if user_score < 5.0:
        return "visited"
    if user_score < params.ownership_threshold:
        return "familiar" if unique_days >= 3 else "visited"

    if user_score == top_score:
        if second_score > 0 and (user_score - second_score) < params.contested_delta:
            return "contested"
        if prev_state in ("claimed", "defended") and unique_days >= 5:
            return "defended"
        if prev_state == "decaying":
            return "reclaimed"
        return "claimed"

    if prev_state in ("claimed", "defended", "reclaimed"):
        return "decaying"
    return "familiar"


def state_transition_event(prev: str, new: str) -> str | None:
    return {
        ("visited", "claimed"): "cell_claimed",
        ("familiar", "claimed"): "cell_claimed",
        ("claimed", "defended"): "cell_defended",
        ("decaying", "claimed"): "corridor_reclaimed",
        ("decaying", "reclaimed"): "corridor_reclaimed",
    }.get((prev, new))
