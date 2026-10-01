#!/usr/bin/env python
"""
Runfluence – end-to-end smoke test

Drives the exact path the phone takes: register, import a GPS run, wait for
territory processing, then read the map viewport and the profile back. Runs the
FastAPI app in-process against the real database, so it catches driver-level
faults (bind casts, type mismatches) that only appear against Postgres and
never show up in a unit test.

    python scripts/smoke_test.py              # in-process against DATABASE_URL
    python scripts/smoke_test.py --remote URL # against a deployed API

Exit code 0 means the phone will work.
"""

from __future__ import annotations

import argparse
import asyncio
import math
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

METERS_PER_DEG_LAT = 111_320.0
LAT, LNG = 51.5074, -0.1278


def loop_polyline(laps: int = 1, radius_m: float = 400.0, points: int = 600, close: bool = True) -> str:
    from api.services.territory_scoring import encode_polyline

    coords = []
    for i in range(points):
        theta = 2 * math.pi * laps * i / points
        coords.append((
            LAT + radius_m * math.cos(theta) / METERS_PER_DEG_LAT,
            LNG + radius_m * math.sin(theta) / (METERS_PER_DEG_LAT * math.cos(math.radians(LAT))),
        ))
    if close:
        coords.append(coords[0])
    return encode_polyline(coords)


def step(n: int, label: str, ok: bool, detail: str = "") -> bool:
    print(f"  [{n}] {'PASS' if ok else 'FAIL'}  {label}{'  ' + detail if detail else ''}")
    return ok


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--remote", help="Base URL of a deployed API, e.g. https://host")
    args = ap.parse_args()

    import httpx

    if args.remote:
        transport = None
        base = args.remote.rstrip("/")
        print(f"Smoke test against {base}\n")
    else:
        from api.main import app

        transport = httpx.ASGITransport(app=app)
        base = "http://test"
        print("Smoke test in-process against DATABASE_URL\n")

    failures = 0
    tag = uuid.uuid4().hex[:8]
    creds = {
        "email": f"smoke-{tag}@runturfing.internal",
        "password": "Smoke-test-2026!",
        "display_name": f"Smoke {tag}",
        "gender": "female",
        "date_of_birth": "1990-01-01",
    }

    async with httpx.AsyncClient(transport=transport, base_url=base, timeout=60) as client:
        r = await client.post("/v1/auth/register", json=creds)
        token = r.json().get("access_token") if r.status_code < 300 else None
        failures += not step(1, "register", bool(token), f"HTTP {r.status_code}")
        if not token:
            print(f"      {r.text[:200]}")
            return 1

        auth = {"Authorization": f"Bearer {token}"}
        now = datetime.now(timezone.utc)
        r = await client.post("/v1/runs/import", headers=auth, json={
            "source": "live_tracking",
            "started_at": (now - timedelta(minutes=20)).isoformat(),
            "ended_at": now.isoformat(),
            "distance_meters": 2513,
            "duration_seconds": 1200,
            "encoded_polyline": loop_polyline(),
        })
        run_id = r.json().get("id") if r.status_code < 300 else None
        failures += not step(2, "import run", bool(run_id), f"HTTP {r.status_code}")
        if not run_id:
            print(f"      {r.text[:300]}")
            return 1

        # Territory runs as a background task.
        cells = []
        for _ in range(15):
            await asyncio.sleep(2)
            r = await client.get(
                "/v1/territory/viewport", headers=auth,
                params={"swLat": LAT - 0.02, "swLng": LNG - 0.03,
                        "neLat": LAT + 0.02, "neLng": LNG + 0.03},
            )
            if r.status_code == 200 and r.json().get("cells"):
                cells = r.json()["cells"]
                break

        failures += not step(3, "territory cells produced", bool(cells), f"{len(cells)} cells")
        if cells:
            c = cells[0]
            has_boundary = isinstance(c.get("boundary"), list) and len(c["boundary"]) >= 6
            failures += not step(4, "cells carry real H3 boundaries", has_boundary,
                                 f"{len(c.get('boundary') or [])} vertices, state={c['state']}")
        else:
            failures += not step(4, "cells carry real H3 boundaries", False, "no cells to check")

        # Enclosure capture: a closed loop must claim more than the line it ran.
        from api.services.territory_scoring import (  # noqa: E402
            DEFAULT_PARAMS, coords_to_h3_cells, decode_polyline,
        )
        line_cells = len(coords_to_h3_cells(decode_polyline(loop_polyline()), DEFAULT_PARAMS))
        failures += not step(5, "closed loop claims its interior", len(cells) > line_cells,
                             f"{len(cells)} claimed vs {line_cells} on the line")

        r = await client.get("/v1/profiles/me", headers=auth)
        body = r.json() if r.status_code == 200 else {}
        runs = body.get("recentRuns", [])
        failures += not step(6, "profile shows the run", bool(runs),
                             f"HTTP {r.status_code}, {len(runs)} recent, "
                             f"{body.get('stats', {}).get('totalKm')} km total")

        r = await client.get("/v1/runs", headers=auth)
        listed = r.json().get("runs", []) if r.status_code == 200 else []
        failures += not step(7, "run list endpoint", bool(listed), f"HTTP {r.status_code}")

    print(f"\n{'GO — the phone will work' if not failures else f'NO-GO — {failures} step(s) failed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
