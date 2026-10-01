import './textDecoderShim';
import { H3_RESOLUTION } from './liveTerritory';
import { CellState, LeaderboardEntry, Rank, TerritoryCell } from '../types';

/**
 * Simulated territory, for demoing the app to people standing in front of you.
 *
 * NOTHING HERE TOUCHES THE SERVER. These cells are generated on the phone and
 * live only in memory, so the demo works with no signal, cannot be confused for
 * a real claim by the scoring job, and leaves no fake runners in the database to
 * clean out of the leaderboard afterwards. The map draws a DEMO badge whenever
 * it is on, because showing invented territory to a stranger without saying so
 * is the kind of thing that gets remembered.
 *
 * The generator is deterministic — same seed, same city every launch — so a
 * demo can be rehearsed and a bug in it can be reproduced.
 *
 * Cells are real H3 r10, the same resolution the tracker and the server use, so
 * running through one during a demo behaves exactly as it would against live
 * territory: 76 m edge, ~152 m across, a few seconds of running to cross.
 */

type H3 = {
  latLngToCell: (lat: number, lng: number, res: number) => string;
  cellToLatLng: (cell: string) => [number, number];
  cellToBoundary: (cell: string) => [number, number][];
  gridDisk: (cell: string, k: number) => string[];
};

let h3: H3 | null = null;
let failed = false;

function getH3(): H3 | null {
  if (h3 || failed) return h3;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    h3 = require('h3-js') as H3;
    h3.latLngToCell(1.3, 103.8, H3_RESOLUTION);
  } catch {
    h3 = null;
    failed = true;
  }
  return h3;
}

/** Jurong Lake Gardens. The demo is built around here on request. */
export const DEMO_CENTRE = { lat: 1.3391, lng: 103.7267 };

export interface DemoRunner {
  userId: string;
  name: string;
  rankCode: string;
  rankTrack: 'officer' | 'specialist';
  /** Offset from the centre in metres, east and north. */
  east: number;
  north: number;
  /** gridDisk radius — how much ground they hold. */
  spread: number;
  /** Typical cell score. Higher is harder to take off them. */
  strength: number;
  state: CellState;
}

// Ten rivals across every rank band — enlisted, specialist, warrant, company
// officer, field officer, general — so the whole ladder is visible in the demo
// without anyone having to log a run first.
//
// Anchors sit on a wide ring rather than clustered near the centre. The first
// cut packed them within ~640 m and half of every patch landed on top of
// another: 511 discs collapsed to 265 drawn cells. Spreading them out keeps the
// contested borders, which are the interesting part, without paying for cells
// that are then thrown away.
export const DEMO_RUNNERS: DemoRunner[] = [
  { userId: 'demo-1',  name: 'Wei Ming', rankCode: 'LTC', rankTrack: 'officer',    east:  -820, north:   420, spread: 5, strength: 78, state: 'defended'  },
  { userId: 'demo-2',  name: 'Siti',     rankCode: 'MSG', rankTrack: 'specialist', east:   720, north:   560, spread: 5, strength: 64, state: 'claimed'   },
  { userId: 'demo-3',  name: 'Hafiz',    rankCode: 'CPT', rankTrack: 'officer',    east:   980, north:  -320, spread: 5, strength: 52, state: 'claimed'   },
  { userId: 'demo-4',  name: 'Priya',    rankCode: '1WO', rankTrack: 'specialist', east:  -640, north:  -700, spread: 5, strength: 45, state: 'decaying'  },
  { userId: 'demo-5',  name: 'Jun Kai',  rankCode: 'BG',  rankTrack: 'officer',    east:    60, north:  1020, spread: 6, strength: 96, state: 'defended'  },
  { userId: 'demo-6',  name: 'Mei Ling', rankCode: 'SSG', rankTrack: 'specialist', east:  -220, north: -1040, spread: 5, strength: 38, state: 'contested' },
  { userId: 'demo-7',  name: 'Arun',     rankCode: '2WO', rankTrack: 'specialist', east: -1120, north:  -140, spread: 4, strength: 58, state: 'defended'  },
  { userId: 'demo-8',  name: 'Chloe',    rankCode: 'MAJ', rankTrack: 'officer',    east:  1180, north:   180, spread: 4, strength: 71, state: 'claimed'   },
  { userId: 'demo-9',  name: 'Ridwan',   rankCode: 'CFC', rankTrack: 'specialist', east:   480, north:  -880, spread: 4, strength: 29, state: 'contested' },
  { userId: 'demo-10', name: 'Yi Xuan',  rankCode: 'MG',  rankTrack: 'officer',    east:  -480, north:   880, spread: 4, strength: 88, state: 'defended'  },
];

export const DEMO_ME = { userId: 'demo-me', name: 'You', rankCode: 'CPT', rankTrack: 'officer' as const };

/** Deterministic PRNG, so the same demo comes up every time. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Metres east/north of a lat-lng, good enough at city scale. */
function offset(lat: number, lng: number, east: number, north: number) {
  const dLat = north / 111_320;
  const dLng = east / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

interface Claim {
  owner: DemoRunner | typeof DEMO_ME;
  score: number;
  state: CellState;
  /** Your own score in this cell, before any live challenge. */
  yourScore: number;
}

/**
 * Build the demo city.
 *
 * Each runner gets a disk of cells centred on their anchor. Where disks overlap
 * the higher score wins the cell, which is what produces the ragged contested
 * borders between patches — the interesting part of the picture, and the part a
 * uniform grid of claims would not show.
 */
export function buildDemoCells(): TerritoryCell[] {
  const lib = getH3();
  if (!lib) return [];

  const rand = mulberry32(0x51ce9);
  const claims = new Map<string, Claim>();

  const place = (
    owner: DemoRunner | typeof DEMO_ME,
    east: number,
    north: number,
    spread: number,
    strength: number,
    state: CellState,
  ) => {
    const c = offset(DEMO_CENTRE.lat, DEMO_CENTRE.lng, east, north);
    const anchor = lib.latLngToCell(c.lat, c.lng, H3_RESOLUTION);

    // gridDisk is cumulative, so walking k outward and skipping cells already
    // seen gives each cell its ring distance in one pass. Asking for the ring
    // of every cell separately meant a gridDisk call per cell per ring.
    const seen = new Set<string>();
    for (let ring = 0; ring <= spread; ring += 1) {
      for (const cell of lib.gridDisk(anchor, ring)) {
        if (seen.has(cell)) continue;
        seen.add(cell);

        // Score falls off from the anchor, so the middle of a patch is
        // genuinely harder to take than its edge. Without this every cell in a
        // territory costs the same and the map has no texture.
        const falloff = 1 - (ring / (spread + 1)) * 0.72;
        const score = Math.max(6, strength * falloff * (0.78 + rand() * 0.44));

        const existing = claims.get(cell);
        if (!existing || score > existing.score) {
          claims.set(cell, { owner, score, state, yourScore: existing?.yourScore ?? 0 });
        }
      }
    }
  };

  for (const r of DEMO_RUNNERS) {
    place(r, r.east, r.north, r.spread, r.strength, r.state);
  }

  // Your own holding, near the centre so it is always on screen, and something
  // to defend rather than only ground to take.
  place(DEMO_ME, 200, 80, 3, 88, 'defended');

  // A contested corridor: cells where you are already close behind the leader.
  // This is what makes a live challenge legible in a two-minute demo — the
  // person watching can see the gap, then watch you close it on foot.
  for (const [cell, claim] of claims) {
    if (claim.owner.userId === DEMO_ME.userId) continue;
    const roll = rand();
    if (roll < 0.28) {
      // Within a short run of taking it.
      claim.yourScore = claim.score * (0.55 + rand() * 0.35);
    } else if (roll < 0.45) {
      claim.yourScore = claim.score * (0.1 + rand() * 0.25);
    }
  }

  return finalise(lib, claims);
}

/**
 * Turn claims into the TerritoryCell shape the map already draws, computing
 * leaderDensity and strongholds exactly the way the backend does so the demo
 * exercises the real rendering path rather than a parallel one.
 */
function finalise(lib: H3, claims: Map<string, Claim>): TerritoryCell[] {
  const ownerOf = new Map<string, string>();
  for (const [cell, claim] of claims) ownerOf.set(cell, claim.owner.userId);

  const cells: TerritoryCell[] = [];
  for (const [cell, claim] of claims) {
    const [lat, lng] = lib.cellToLatLng(cell);
    const ring = lib.gridDisk(cell, 1).filter((n) => n !== cell);
    const same = ring.filter((n) => ownerOf.get(n) === claim.owner.userId).length;
    const near = lib.gridDisk(cell, 2).filter((n) => n !== cell);
    const strongholdSize =
      1 + near.filter((n) => ownerOf.get(n) === claim.owner.userId).length;

    const isYours = claim.owner.userId === DEMO_ME.userId;
    cells.push({
      h3Index: cell,
      lat,
      lng,
      boundary: lib.cellToBoundary(cell),
      state: claim.state,
      score: Math.round(claim.score * 10) / 10,
      ownerUserId: claim.owner.userId,
      ownerDisplayName: claim.owner.name,
      lifetimeMeters: Math.round(claim.score * 42),
      thirtyDayMeters: Math.round(claim.score * 18),
      uniqueActiveDays: Math.max(1, Math.round(claim.score / 9)),
      lastSeen: new Date().toISOString(),
      isContested: claim.state === 'contested',
      yourScore: Math.round(claim.yourScore * 10) / 10,
      yourState: claim.yourScore > 0 ? 'visited' : 'neutral',
      isYours,
      pointsBehind: isYours ? 0 : Math.max(0, Math.round((claim.score - claim.yourScore) * 10) / 10),
      leaderDensity: Math.round((same / ring.length) * 1000) / 1000,
      strongholdSize,
      isStrongholdCore: false,
    });
  }

  // One badge per owner, at the densest point of their patch.
  const peak = new Map<string, TerritoryCell>();
  for (const c of cells) {
    const best = peak.get(c.ownerUserId as string);
    if (!best || (c.strongholdSize ?? 0) > (best.strongholdSize ?? 0)) {
      peak.set(c.ownerUserId as string, c);
    }
  }
  for (const c of peak.values()) {
    if ((c.strongholdSize ?? 0) >= 5) c.isStrongholdCore = true;
  }

  return cells;
}

// Metres run inside a cell, converted to score. Crossing an r10 cell end to end
// is ~152 m, so a single pass is worth about 15 points and a mid-strength cell
// takes a few passes — which is the behaviour worth demonstrating.
const METRES_PER_POINT = 10;

export interface ChallengeResult {
  cells: TerritoryCell[];
  /** Cells flipped to you by the current run. */
  taken: number;
  /** Cells you are inside and still behind on. */
  contesting: number;
}

/**
 * Apply a live run against the demo city.
 *
 * `liveCells` is the tracker's metres-per-cell map for the run in progress. This
 * converts those metres into score, adds them to whatever you already had, and
 * flips the cell when you pass the leader. It is the same winner-takes-all rule
 * the server applies, run on the phone so a demo can show contention happening
 * rather than describing it.
 */
export function applyChallenge(
  base: TerritoryCell[],
  liveCells: Record<string, number>,
): ChallengeResult {
  let taken = 0;
  let contesting = 0;

  const cells = base.map((cell) => {
    const metres = liveCells[cell.h3Index];
    if (!metres || cell.isYours) return cell;

    const gained = metres / METRES_PER_POINT;
    const yourScore = (cell.yourScore ?? 0) + gained;

    if (yourScore >= cell.score) {
      taken += 1;
      return {
        ...cell,
        isYours: true,
        ownerUserId: DEMO_ME.userId,
        ownerDisplayName: DEMO_ME.name,
        // Taken this run, not held: the state says so until the next decay.
        state: 'claimed' as CellState,
        score: Math.round(yourScore * 10) / 10,
        yourScore: Math.round(yourScore * 10) / 10,
        yourState: 'claimed' as CellState,
        pointsBehind: 0,
      };
    }

    contesting += 1;
    return {
      ...cell,
      yourScore: Math.round(yourScore * 10) / 10,
      yourState: 'visited' as CellState,
      pointsBehind: Math.round((cell.score - yourScore) * 10) / 10,
    };
  });

  return { cells, taken, contesting };
}

/**
 * The demo city's leaderboard, sorted on influence — the moving average of
 * cells a runner scores in, which is the metric the real board leads with.
 */
export function demoLeaderboard(cells: TerritoryCell[]): LeaderboardEntry[] {
  const roster = [
    ...DEMO_RUNNERS.map((r) => ({
      userId: r.userId, name: r.name, rankCode: r.rankCode, rankTrack: r.rankTrack,
    })),
    { userId: DEMO_ME.userId, name: DEMO_ME.name, rankCode: DEMO_ME.rankCode, rankTrack: DEMO_ME.rankTrack },
  ];

  return roster
    .map((r) => {
      const led = cells.filter((c) => c.ownerUserId === r.userId).length;
      // Influence counts every cell they score in, not just the ones they lead.
      // For the rivals that is their led cells plus the ground they are second
      // on, which the generator expressed as your yourScore against them.
      const influence = r.userId === DEMO_ME.userId
        ? cells.filter((c) => c.isYours || (c.yourScore ?? 0) > 0).length
        : Math.round(led * 1.45);
      return { ...r, led, influence };
    })
    .sort((a, b) => b.influence - a.influence)
    .map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      displayName: r.name,
      city: 'Jurong',
      value: r.influence,
      unit: 'cells (30d avg)',
      delta: [0, 2, -1, 1, 0, -2, 3][i % 7],
      isCurrentUser: r.userId === DEMO_ME.userId,
      rankTrack: r.rankTrack,
      rankCode: r.rankCode,
      influenceMa30: r.influence,
      cellsLed: r.led,
    }));
}

// Mirrors Backend/api/routes/leaderboard.py's METRICS table (unit + decimals
// per key) so the placeholder board reads like a real one. Multiplier just
// scales each runner's demo `strength` (29-96) into a plausible range per
// metric — there is no real data behind these numbers.
const FALLBACK_METRIC_CONFIG: Record<string, { unit: string; decimals: number; multiplier: number }> = {
  alltime_mileage: { unit: 'km', decimals: 1, multiplier: 4.2 },
  mileage_90d: { unit: 'km', decimals: 1, multiplier: 1.1 },
  territory_held: { unit: 'cells', decimals: 0, multiplier: 1.0 },
  streak: { unit: 'days', decimals: 0, multiplier: 0.35 },
  influence_ma: { unit: 'cells (30d avg)', decimals: 1, multiplier: 0.9 },
  cells_led: { unit: 'cells led', decimals: 0, multiplier: 0.8 },
  rank: { unit: 'rank pts', decimals: 0, multiplier: 12 },
  season_mileage: { unit: 'km', decimals: 1, multiplier: 0.6 },
  territory_control: { unit: 'cells', decimals: 0, multiplier: 0.5 },
  defense_consistency: { unit: '%', decimals: 0, multiplier: 1.05 },
  threshold_progress: { unit: 'active days', decimals: 0, multiplier: 0.3 },
};

/**
 * Placeholder board for the real (non-demo) leaderboard tab, shown while
 * `leaderboard_daily` is empty — that table only fills once the hourly
 * materializer (Backend/api/jobs/leaderboard_materialize.py) has run at least
 * once, which is a Railway cron job, not something the API triggers itself.
 * Reuses the demo roster so the tab shows plausible names and numbers instead
 * of "No data yet" while that job is unset up. Swap out once the real board
 * reliably has rows.
 */
export function fallbackLeaderboard(metric: string): LeaderboardEntry[] {
  const cfg = FALLBACK_METRIC_CONFIG[metric] ?? { unit: '', decimals: 0, multiplier: 1 };
  const roster = [
    ...DEMO_RUNNERS.map((r) => ({
      userId: r.userId, name: r.name, rankCode: r.rankCode, rankTrack: r.rankTrack, strength: r.strength,
    })),
    { userId: DEMO_ME.userId, name: DEMO_ME.name, rankCode: DEMO_ME.rankCode, rankTrack: DEMO_ME.rankTrack, strength: 74 },
  ];

  return roster
    .map((r) => ({ ...r, value: r.strength * cfg.multiplier }))
    .sort((a, b) => b.value - a.value)
    .map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      displayName: r.name,
      city: 'Jurong',
      value: cfg.decimals ? Math.round(r.value * 10) / 10 : Math.round(r.value),
      unit: cfg.unit,
      delta: [0, 1, -1, 2, 0, -2, 1][i % 7],
      isCurrentUser: r.userId === DEMO_ME.userId,
      rankTrack: r.rankTrack,
      rankCode: r.rankCode,
      influenceMa30: metric === 'influence_ma'
        ? (cfg.decimals ? Math.round(r.value * 10) / 10 : Math.round(r.value))
        : undefined,
      cellsLed: metric === 'cells_led' ? Math.round(r.value) : undefined,
    }));
}

/** A plausible rank and influence for the demo account's profile. */
export function demoProfile(cells: TerritoryCell[]) {
  const led = cells.filter((c) => c.isYours).length;
  const influence = cells.filter((c) => c.isYours || (c.yourScore ?? 0) > 0).length;
  const rank: Rank = {
    track: 'officer',
    code: 'CPT',
    name: 'Captain',
    // Third rung now the cadet rank is gone: 1LT, 2LT, CPT.
    index: 2,
    stars: 0,
    points: 812,
    nextCode: 'MAJ',
    nextName: 'Major',
    pointsToNext: 288,
    progress: 0.34,
    officerEligible: true,
  };
  const series = Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10),
    cells: Math.max(0, Math.round(influence * (0.55 + 0.45 * (i / 13)) + ((i * 7) % 5) - 2)),
  }));
  return {
    rank,
    influence: {
      cellsNow: influence,
      cellsAtLastSnapshot: influence,
      movingAverage7: Math.round(influence * 0.92 * 10) / 10,
      movingAverage30: Math.round(influence * 0.81 * 10) / 10,
      cellsLed: led,
      series,
    },
  };
}

/** Stats bar figures for the demo city. */
export function demoUserStats(cells: TerritoryCell[]) {
  const mine = cells.filter((c) => c.isYours);
  return {
    totalCells: cells.filter((c) => (c.yourScore ?? 0) > 0 || c.isYours).length,
    claimedCells: mine.length,
    contestedCells: cells.filter((c) => !c.isYours && (c.yourScore ?? 0) > 0).length,
    totalMeters: mine.reduce((sum, c) => sum + c.lifetimeMeters, 0),
  };
}
