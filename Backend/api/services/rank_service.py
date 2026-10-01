"""
Runturfing – Vanity rank ladder (Singapore Armed Forces infantry progression)

Pure functions over run aggregates. No database, no I/O, so the thresholds can
be exercised directly and the leaderboard job and the profile route both get the
same answer from the same inputs.

Two tracks, and a runner is only ever on one of them:

  * COMMISSIONED (Officer Cadet -> General). Earned by distance and speed
    compounding into each other, not summing. A runner who covers a lot of
    ground slowly and a runner who covers little ground fast both stall; the
    ladder moves for someone doing both, which is what the star ranks are meant
    to read as.

  * SPECIALIST / WARRANT (Recruit -> Chief Warrant Officer). Earned by turning
    up. Active days, streak length and weeks that held three or more run days.
    Distance and pace do not enter it at all.

Commissioning takes priority. Once a runner clears the officer gate they are an
officer, however good their attendance is, because the officer ladder is the one
that reaches the starred ranks and holding both would make the star meaningless.
A runner who stops clearing the gate (their rolling pace falls away, say) drops
back to the specialist ladder at whatever rung their regularity has earned.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Optional


# --- Ladders -----------------------------------------------------------------
# (code, full name, stars). Order is the progression; index into the list is the
# rank_index stored on the snapshot.

SPECIALIST_LADDER: list[tuple[str, str, int]] = [
    ("REC",  "Recruit", 0),
    ("PTE",  "Private", 0),
    ("LCP",  "Lance Corporal", 0),
    ("CPL",  "Corporal", 0),
    ("CFC",  "Corporal First Class", 0),
    ("3SG",  "Third Sergeant", 0),
    ("2SG",  "Second Sergeant", 0),
    ("1SG",  "First Sergeant", 0),
    ("SSG",  "Staff Sergeant", 0),
    ("MSG",  "Master Sergeant", 0),
    ("3WO",  "Third Warrant Officer", 0),
    ("2WO",  "Second Warrant Officer", 0),
    ("1WO",  "First Warrant Officer", 0),
    ("MWO",  "Master Warrant Officer", 0),
    ("SWO",  "Senior Warrant Officer", 0),
    ("CWO",  "Chief Warrant Officer", 0),
]

OFFICER_LADDER: list[tuple[str, str, int]] = [
    # Bars count up with the rank: one, two, three. Clearing the officer gate
    # lands a runner straight on the ladder — there is no cadet rung, because
    # there is nothing here to be a cadet of.
    ("1LT",  "First Lieutenant", 0),
    ("2LT",  "Second Lieutenant", 0),
    ("CPT",  "Captain", 0),
    ("MAJ",  "Major", 0),
    ("LTC",  "Lieutenant Colonel", 0),
    ("SLTC", "Senior Lieutenant Colonel", 0),
    ("COL",  "Colonel", 0),
    ("BG",   "Brigadier-General", 1),
    ("MG",   "Major-General", 2),
    ("LG",   "Lieutenant-General", 3),
    ("GEN",  "General", 4),
]

# Points needed to hold each rung. Same length as its ladder, first entry always
# zero so arriving on a track always lands somewhere.
#
# The specialist ceiling is set against what the inputs can actually reach: 90
# active days, a streak in the hundreds and 52 consistent weeks caps out near
# 1,030 points. Thresholds beyond that would leave Chief Warrant Officer as a
# rung nobody can hold, which is worse than no rung at all.
SPECIALIST_THRESHOLDS = [0, 6, 15, 30, 55, 90, 135, 190, 260, 340, 440, 550, 670, 790, 900, 1000]

# The officer ladder has no such ceiling — distance keeps accumulating — so the
# spacing widens instead, and General is meant to take years. Eleven rungs since
# the cadet rank was dropped; the old first step is gone rather than the top, so
# General still costs the same 9,000.
OFFICER_THRESHOLDS    = [0, 260, 450, 720, 1100, 1600, 2300, 3300, 4700, 6600, 9000]


# --- Officer gate ------------------------------------------------------------
# Both floors must be cleared. The distance floor stops a single fast 3 km from
# commissioning anyone; the pace floor is what makes the track about speed
# rather than accumulation.

MIN_OFFICER_KM = 50.0
MIN_OFFICER_SPEED_KMH = 8.0          # 7:30 min/km

# Pace is scored relative to this, so a runner at the gate scores 1.0x and the
# compound reduces to plain distance. Above it, distance is amplified.
BASE_SPEED_KMH = 8.0
SPEED_EXPONENT = 1.5

# Without a ceiling a GPS glitch or a bike ride imported as a run would put
# somebody on four stars. The floor keeps the number defined for slow runners
# who are on the officer track by distance alone.
SPEED_FACTOR_MIN = 0.4
SPEED_FACTOR_MAX = 2.5

# Regularity weights. A streak is worth more per day than a scattered active day
# because holding one is strictly harder, and a week that held three run days is
# the unit the season threshold already uses.
POINTS_PER_ACTIVE_DAY = 1.0
POINTS_PER_STREAK_DAY = 2.0
POINTS_PER_CONSISTENT_WEEK = 4.0


@dataclass(frozen=True)
class RankInputs:
    """Everything the ladder reads. All figures are lifetime unless named."""
    total_km: float = 0.0
    # Distance over moving time across every run that was not flagged. Not a
    # best-effort pace: the officer track is about how fast you habitually are.
    avg_speed_kmh: float = 0.0
    active_days_90: int = 0
    longest_streak: int = 0
    # Weeks in the last year that held three or more distinct run days.
    consistent_weeks: int = 0


@dataclass(frozen=True)
class Rank:
    track: str              # 'officer' | 'specialist'
    code: str
    name: str
    index: int
    stars: int
    points: float
    next_code: Optional[str]
    next_name: Optional[str]
    points_to_next: Optional[float]
    progress: float         # 0..1 through the current rung
    # What the other track would have given, so the app can explain why a
    # regular runner is a Master Sergeant and not a Major.
    officer_eligible: bool

    def to_dict(self) -> dict:
        d = asdict(self)
        return {
            "track": d["track"],
            "code": d["code"],
            "name": d["name"],
            "index": d["index"],
            "stars": d["stars"],
            "points": round(d["points"], 1),
            "nextCode": d["next_code"],
            "nextName": d["next_name"],
            "pointsToNext": (
                round(d["points_to_next"], 1) if d["points_to_next"] is not None else None
            ),
            "progress": round(d["progress"], 3),
            "officerEligible": d["officer_eligible"],
        }


def speed_factor(avg_speed_kmh: float) -> float:
    """How much each kilometre is worth on the officer track."""
    if avg_speed_kmh <= 0:
        return SPEED_FACTOR_MIN
    raw = (avg_speed_kmh / BASE_SPEED_KMH) ** SPEED_EXPONENT
    return max(SPEED_FACTOR_MIN, min(SPEED_FACTOR_MAX, raw))


def officer_points(inputs: RankInputs) -> float:
    """Distance and speed compounded. Neither alone moves this far."""
    return max(0.0, inputs.total_km) * speed_factor(inputs.avg_speed_kmh)


def specialist_points(inputs: RankInputs) -> float:
    """Turning up, measured three ways."""
    return (
        max(0, inputs.active_days_90) * POINTS_PER_ACTIVE_DAY
        + max(0, inputs.longest_streak) * POINTS_PER_STREAK_DAY
        + max(0, inputs.consistent_weeks) * POINTS_PER_CONSISTENT_WEEK
    )


def is_officer_eligible(inputs: RankInputs) -> bool:
    return (
        inputs.total_km >= MIN_OFFICER_KM
        and inputs.avg_speed_kmh >= MIN_OFFICER_SPEED_KMH
    )


def _place(points: float, ladder: list, thresholds: list) -> tuple[int, float]:
    """Highest rung whose threshold is met, and progress toward the next one."""
    index = 0
    for i, needed in enumerate(thresholds):
        if points >= needed:
            index = i
        else:
            break

    if index >= len(ladder) - 1:
        return index, 1.0

    floor = thresholds[index]
    ceiling = thresholds[index + 1]
    span = ceiling - floor
    progress = 0.0 if span <= 0 else (points - floor) / span
    return index, max(0.0, min(1.0, progress))


def compute_rank(inputs: RankInputs) -> Rank:
    """The one rank a runner holds."""
    eligible = is_officer_eligible(inputs)

    if eligible:
        ladder, thresholds = OFFICER_LADDER, OFFICER_THRESHOLDS
        track, points = "officer", officer_points(inputs)
    else:
        ladder, thresholds = SPECIALIST_LADDER, SPECIALIST_THRESHOLDS
        track, points = "specialist", specialist_points(inputs)

    index, progress = _place(points, ladder, thresholds)
    code, name, stars = ladder[index]

    at_top = index >= len(ladder) - 1
    next_code, next_name, to_next = None, None, None
    if not at_top:
        next_code, next_name, _ = ladder[index + 1]
        to_next = max(0.0, thresholds[index + 1] - points)

    return Rank(
        track=track,
        code=code,
        name=name,
        index=index,
        stars=stars,
        points=points,
        next_code=next_code,
        next_name=next_name,
        points_to_next=to_next,
        progress=progress,
        officer_eligible=eligible,
    )


def ladder_payload() -> dict:
    """Both ladders, for a client that wants to draw the whole progression."""
    return {
        "officer": [
            {"code": c, "name": n, "stars": s, "points": p}
            for (c, n, s), p in zip(OFFICER_LADDER, OFFICER_THRESHOLDS)
        ],
        "specialist": [
            {"code": c, "name": n, "stars": s, "points": p}
            for (c, n, s), p in zip(SPECIALIST_LADDER, SPECIALIST_THRESHOLDS)
        ],
        "gate": {
            "minKm": MIN_OFFICER_KM,
            "minSpeedKmh": MIN_OFFICER_SPEED_KMH,
        },
    }
