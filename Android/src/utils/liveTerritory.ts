import './textDecoderShim';

/**
 * h3-js is loaded lazily behind a guard rather than imported at module scope.
 * It is an emscripten build, and when it threw on Hermes it killed the app on
 * launch before anything rendered — a cosmetic preview took down run recording
 * entirely. Now a failure here costs the preview and nothing else.
 */
type H3 = {
  cellToBoundary: (cell: string) => [number, number][];
  latLngToCell: (lat: number, lng: number, res: number) => string;
  polygonToCells: (ring: [number, number][], res: number) => string[];
  gridDisk: (cell: string, k: number) => string[];
  getHexagonEdgeLengthAvg: (res: number, unit: string) => number;
};

let h3: H3 | null = null;
let h3Failed = false;

function getH3(): H3 | null {
  if (h3 || h3Failed) return h3;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    h3 = require('h3-js') as H3;
    // Prove it actually works before trusting it — importing is not enough.
    h3.latLngToCell(1.3, 103.8, H3_RESOLUTION);
  } catch {
    h3 = null;
    h3Failed = true;
  }
  return h3;
}

/** False when the preview is unavailable on this device. */
export function livePreviewAvailable(): boolean {
  return getH3() !== null;
}

/**
 * On-device territory preview.
 *
 * The server is the only authority on what you own — it re-derives everything
 * from the uploaded polyline and applies its own gap, cap and enclosure rules.
 * This exists so the map reacts while you run instead of staying blank until
 * you stop, which is the difference between a game and a tracking report.
 *
 * Everything here is DISPLAY ONLY and is thrown away the moment the server's
 * answer arrives. If the phone paints a cell the server rejects, it vanishes on
 * reconcile — the client can be wrong, and it can also be lying, so nothing it
 * computes is ever trusted for scoring.
 *
 * The constants below mirror territory_scoring.py. If they drift, the preview
 * flickers on reconcile — which is cosmetic, not a scoring bug, but keep them
 * in step anyway.
 */

// MUST match settings.h3_resolution on the server. A mismatch means every
// previewed cell is rejected on reconcile and the paint vanishes.
export const H3_RESOLUTION = 10;

// Mirrors territory_scoring.MAX_SEGMENT_METERS: a jump this long is a recording
// gap, not a stride, and the straight line across it is a guess.
const MAX_SEGMENT_METERS = 150;
// Mirrors SUBDIVIDE_STEP_METERS: walk long segments so metres land in the cell
// they were actually run through.
const SUBDIVIDE_STEP_METERS = 10;

// Mirrors ScoringParams.closure_tolerance_m / min_loop_perimeter_m.
export const CLOSURE_TOLERANCE_M = 120;
export const MIN_LOOP_PERIMETER_M = 800;
// Mirrors max_enclosure_ratio / max_enclosure_cells.
const MAX_ENCLOSURE_RATIO = 4;
const MAX_ENCLOSURE_CELLS = 500;
// Mirrors max_enclosure_reach_m. How far inside the loop a claim reaches from
// the route. Without it a big ring took everything it circled, including the
// middle nobody went near; with it the interior is a lining, and a small lap
// still fills solid because its whole interior is within reach.
const MAX_ENCLOSURE_REACH_M = 300;

export type LatLng = { latitude: number; longitude: number };

export function metresBetween(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Cells crossed between two consecutive fixes, with metres apportioned.
 * Incremental by design: called once per accepted fix, never over the whole
 * track, so cost per fix stays constant however long the run gets.
 */
export function creditSegment(
  cells: Record<string, number>,
  from: LatLng,
  to: LatLng,
): void {
  const distance = metresBetween(from, to);
  if (distance < 1 || distance > MAX_SEGMENT_METERS) return;

  const lib = getH3();
  if (!lib) return;

  const start = lib.latLngToCell(from.latitude, from.longitude, H3_RESOLUTION);
  const end = lib.latLngToCell(to.latitude, to.longitude, H3_RESOLUTION);

  if (start === end) {
    cells[start] = (cells[start] ?? 0) + distance;
    return;
  }

  const steps = Math.max(2, Math.ceil(distance / SUBDIVIDE_STEP_METERS));
  const share = distance / steps;
  for (let i = 0; i < steps; i += 1) {
    const t = (i + 0.5) / steps;
    const cell = lib.latLngToCell(
      from.latitude + (to.latitude - from.latitude) * t,
      from.longitude + (to.longitude - from.longitude) * t,
      H3_RESOLUTION,
    );
    cells[cell] = (cells[cell] ?? 0) + share;
  }
}

/** Real hex outline for drawing, as map coordinates. */
export function boundaryOf(cell: string): LatLng[] {
  const lib = getH3();
  if (!lib) return [];
  try {
    return lib.cellToBoundary(cell).map(([latitude, longitude]) => ({ latitude, longitude }));
  } catch {
    return [];
  }
}

export type EnclosurePreview = {
  closed: boolean;
  cells: string[];
  /** Metres from the current position back to the start. */
  gapToStart: number;
  perimeter: number;
};

/**
 * Interior of a closed loop, previewed on device.
 *
 * Deliberately conservative relative to the server: it never claims more than
 * the caps allow, so the preview under-promises rather than showing ground that
 * will be taken away on reconcile.
 */
export function previewEnclosure(
  points: LatLng[],
  pathCells: Record<string, number>,
  perimeter: number,
): EnclosurePreview {
  const empty = { closed: false, cells: [], gapToStart: Infinity, perimeter };
  if (points.length < 8) return empty;

  const gapToStart = metresBetween(points[0], points[points.length - 1]);
  if (gapToStart > CLOSURE_TOLERANCE_M || perimeter < MIN_LOOP_PERIMETER_M) {
    return { ...empty, gapToStart };
  }

  const lib = getH3();
  if (!lib) return { ...empty, gapToStart };

  try {
    const ring = points.map((p) => [p.latitude, p.longitude] as [number, number]);
    // polygonToCells wants a closed ring.
    ring.push(ring[0]);
    let interior = lib.polygonToCells(ring, H3_RESOLUTION).filter((c) => !(c in pathCells));

    // Reach cap, mirroring _within_reach on the server. Measured in grid steps
    // rather than metres: one step is one cell width, and neighbour lookups are
    // exact on the grid the cells came from.
    const edge = lib.getHexagonEdgeLengthAvg(H3_RESOLUTION, 'm');
    const steps = Math.max(1, Math.ceil(MAX_ENCLOSURE_REACH_M / (edge * 2)));
    const reach = new Set<string>();
    for (const cell of Object.keys(pathCells)) {
      for (const near of lib.gridDisk(cell, steps)) reach.add(near);
    }
    interior = interior.filter((c) => reach.has(c));

    const allowed = Math.min(
      MAX_ENCLOSURE_CELLS,
      Math.floor(Object.keys(pathCells).length * MAX_ENCLOSURE_RATIO),
    );
    return {
      closed: true,
      cells: interior.slice(0, allowed),
      gapToStart,
      perimeter,
    };
  } catch {
    // A self-intersecting ring can defeat the simple polygon fill. The server
    // resolves those with shapely; here it just means no preview.
    return { ...empty, gapToStart };
  }
}
