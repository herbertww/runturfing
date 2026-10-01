#!/usr/bin/env python
"""
Runfluence – seed a rival runner so contention can be seen for real.

Creates an account and imports several backdated runs over the same ground, so
by the time you run there the cells are already held by someone else. Without
this you cannot see contested state on a single-phone test: contention needs two
people who have both put work into the same streets.

Runs go through the live /runs/import endpoint, so the rival's territory is
scored by exactly the same path a real runner's would be — no direct writes.

    python scripts/seed_rival.py --lat 1.3330 --lng 103.7280
    python scripts/seed_rival.py --name Mei --runs 4 --radius 500

Defaults sit on Jurong Lake.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.services.territory_scoring import encode_polyline  # noqa: E402

METERS_PER_DEG_LAT = 111_320.0


def call(api: str, path: str, data=None, token: str | None = None):
    req = urllib.request.Request(api + path, method="POST" if data is not None else "GET")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    body = json.dumps(data).encode() if data is not None else None
    try:
        with urllib.request.urlopen(req, body, timeout=45) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


def loop(lat: float, lng: float, radius_m: float, points: int = 900, bearing_offset: float = 0.0):
    """A closed lap, sampled at running density."""
    coords = []
    for i in range(points):
        theta = 2 * math.pi * i / points + bearing_offset
        coords.append((
            lat + radius_m * math.cos(theta) / METERS_PER_DEG_LAT,
            lng + radius_m * math.sin(theta) / (METERS_PER_DEG_LAT * math.cos(math.radians(lat))),
        ))
    coords.append(coords[0])
    return coords


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="https://api-production-872d.up.railway.app/v1")
    ap.add_argument("--lat", type=float, default=1.3330)
    ap.add_argument("--lng", type=float, default=103.7280)
    ap.add_argument("--radius", type=float, default=450.0)
    ap.add_argument("--name", default="Mei")
    ap.add_argument("--gender", default="female")
    ap.add_argument("--runs", type=int, default=4, help="backdated runs, one per day")
    args = ap.parse_args()

    tag = uuid.uuid4().hex[:5]
    email = f"rival-{tag}@runturfing.internal"
    password = "Rival-test-2026!"

    status, body = call(args.api, "/auth/register", {
        "email": email, "password": password, "display_name": args.name,
        "gender": args.gender, "date_of_birth": "1992-05-05",
    })
    token = body.get("access_token")
    if not token:
        print(f"register failed ({status}): {str(body)[:200]}")
        return 1
    print(f"rival '{args.name}' created  ({email})")

    route = loop(args.lat, args.lng, args.radius)
    poly = encode_polyline(route)
    distance = int(2 * math.pi * args.radius)

    # One run per day, oldest first, so unique_active_days accumulates the way
    # it would for someone who genuinely ran here all week.
    for day in range(args.runs, 0, -1):
        started = datetime.now(timezone.utc) - timedelta(days=day, hours=1)
        status, run = call(args.api, "/runs/import", {
            "source": "live_tracking",
            "started_at": started.isoformat(),
            "ended_at": (started + timedelta(minutes=28)).isoformat(),
            "distance_meters": distance,
            "duration_seconds": 1680,
            "encoded_polyline": poly,
        }, token)
        print(f"  day -{day}: {distance/1000:.2f} km -> HTTP {status}")
        if status >= 300:
            print(f"    {str(run)[:200]}")
            return 1

    # Read back what the rival now holds.
    import time
    time.sleep(6)
    d = 0.02
    status, vp = call(
        args.api,
        f"/territory/viewport?swLat={args.lat-d}&swLng={args.lng-d}"
        f"&neLat={args.lat+d}&neLng={args.lng+d}",
        token=token,
    )
    cells = vp.get("cells", []) if isinstance(vp, dict) else []
    states: dict[str, int] = {}
    for c in cells:
        states[c["state"]] = states.get(c["state"], 0) + 1

    print(f"\n{args.name} now holds {len(cells)} cells around ({args.lat}, {args.lng})")
    for state, n in sorted(states.items(), key=lambda kv: -kv[1]):
        print(f"  {state:>10}: {n}")
    print(f"\nRun the same ground and those cells become contested.")
    print(f"Rival login if you want to check the other side: {email} / {password}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
