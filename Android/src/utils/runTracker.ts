import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { creditSegment } from './liveTerritory';
import { RunCheckpoint, clearCheckpoint, saveCheckpoint } from './runCheckpoint';

/**
 * Run recording that keeps working with the screen off.
 *
 * The previous version used watchPositionAsync, which only delivers while the
 * app is in the foreground. Pocket the phone and fixes stop arriving; when you
 * next look at it, recording resumes and the route is drawn as one straight
 * line across everything you actually ran. It looks like a clean track, which
 * is worse than looking broken — the backend would happily claim every cell
 * along that line, including ground you never touched.
 *
 * So: a real background location task behind an Android foreground service,
 * plus explicit gap marking, so a hole in the data stays a hole.
 */

export const LOCATION_TASK = 'runfluence-location-tracking';

export type TrackPoint = {
  latitude: number;
  longitude: number;
  at: number;
  accuracy: number | null;
  /** True when the preceding stretch was not recorded (signal loss, OS throttling). */
  gapBefore?: boolean;
};

// Raw fixes are noisy: a stationary phone still reports movement, and urban
// canyons throw fixes tens of metres sideways.
const MAX_ACCURACY_M = 25;
const MIN_STEP_M = 2.5;
const MAX_SPEED_MPS = 12; // ~43 km/h — faster is a GPS jump, not a runner

// A break longer than this means we stopped hearing from the GPS. At a normal
// 1-2s fix interval this is a long silence, not a slow update.
const GAP_SECONDS = 25;
// Even inside the time budget, a jump this large cannot be a single stride.
const GAP_METERS = 150;

// A run that has not moved for this long is over — the phone is in a bag, or
// the runner forgot to stop. Long enough to sit out traffic lights, a water
// stop, stretching or a shoe change; short enough that a forgotten run does not
// hold GPS overnight.
export const DORMANCY_MS = 15 * 60 * 1000;

// Backstop for the case dormancy cannot see: finish the run, forget to stop,
// then drive home. The phone is moving, so nothing looks dormant, but the
// duration keeps growing. No run on foot lasts this long.
export const MAX_RUN_MS = 6 * 60 * 60 * 1000;

let points: TrackPoint[] = [];
let distanceM = 0;
let lastAccepted: TrackPoint | null = null;
let lastAccuracy: number | null = null;
let startedAt: number | null = null;
// Wall clock of the last fix that actually moved. Distinct from the last fix
// received: a stationary phone keeps producing fixes, and they must not keep
// the run alive.
let lastMovementAt: number | null = null;

// Cells claimed so far, accumulated one fix at a time so cost stays constant
// however long the run gets. Display only — the server re-derives everything
// from the uploaded polyline and its answer replaces this on reconcile.
let liveCells: Record<string, number> = {};

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTrack() {
  return { points, distanceM, accuracy: lastAccuracy, liveCells, startedAt, lastMovementAt };
}

export function resetTrack() {
  points = [];
  distanceM = 0;
  lastAccepted = null;
  lastAccuracy = null;
  startedAt = null;
  lastMovementAt = null;
  liveCells = {};
  void clearCheckpoint();
  notify();
}

/** Restore an in-progress run from disk after the process was killed. */
export function restoreTrack(cp: RunCheckpoint) {
  points = cp.points;
  distanceM = cp.distanceM;
  startedAt = cp.startedAt;
  lastMovementAt = cp.lastMovementAt;
  lastAccepted = cp.points.length ? cp.points[cp.points.length - 1] : null;
  liveCells = rebuildLiveCells(cp.points);
  notify();
}

export type StopVerdict =
  | { stop: false }
  | { stop: true; reason: 'dormant' | 'too_long' };

/**
 * Should this run be closed out without the user asking?
 *
 * Deliberately a pure question over timestamps, so it can be answered from a
 * checkpoint on a cold start exactly as it is answered mid-run. `now` is a
 * parameter for the same reason.
 */
export function stopVerdict(
  started: number | null,
  lastMovement: number | null,
  now: number = Date.now(),
): StopVerdict {
  if (started == null) return { stop: false };
  if (now - started > MAX_RUN_MS) return { stop: true, reason: 'too_long' };
  // No movement ever recorded falls back to the start: a run that never moved
  // is dormant from the moment it began.
  if (now - (lastMovement ?? started) > DORMANCY_MS) return { stop: true, reason: 'dormant' };
  return { stop: false };
}

/**
 * Drop the tail after the last real movement.
 *
 * Without this, auto-stopping after fifteen dormant minutes adds those fifteen
 * minutes to duration_seconds and the pace becomes a lie — and a run that sat
 * in a bag overnight would import as a twenty-hour walk. The run ends when it
 * stopped moving, not when we noticed.
 */
export function trimToLastMovement(track: TrackPoint[]): TrackPoint[] {
  if (track.length < 2) return track;

  let cut = track.length - 1;
  for (let i = track.length - 1; i > 0; i -= 1) {
    if (metresBetween(track[i - 1], track[i]) >= MIN_STEP_M) {
      cut = i;
      break;
    }
  }
  return track.slice(0, cut + 1);
}

/** Distance over a track, skipping segments marked as recording gaps. */
export function distanceOf(track: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < track.length; i += 1) {
    if (track[i].gapBefore) continue;
    total += metresBetween(track[i - 1], track[i]);
  }
  return total;
}

/** Rebuild the preview from a stored track, after an app restart. */
export function rebuildLiveCells(track: TrackPoint[]): Record<string, number> {
  const cells: Record<string, number> = {};
  for (let i = 0; i < track.length - 1; i += 1) {
    if (track[i + 1].gapBefore) continue;
    creditSegment(cells, track[i], track[i + 1]);
  }
  return cells;
}

function metresBetween(a: TrackPoint, b: TrackPoint): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Shared by the background task and any foreground fallback. */
export function ingest(raw: Array<Location.LocationObject>) {
  let changed = false;

  for (const loc of raw) {
    const accuracy = loc.coords.accuracy ?? null;
    lastAccuracy = accuracy;
    if (accuracy != null && accuracy > MAX_ACCURACY_M) continue;

    const point: TrackPoint = {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      at: loc.timestamp,
      accuracy,
    };

    if (!lastAccepted) {
      points = [...points, point];
      lastAccepted = point;
      // The first fix counts as movement: it is the run getting underway, and
      // treating it as dormant would start the clock already expired.
      lastMovementAt = Date.now();
      if (startedAt == null) startedAt = lastMovementAt;
      changed = true;
      continue;
    }

    const step = metresBetween(lastAccepted, point);
    const seconds = (point.at - lastAccepted.at) / 1000;

    if (step < MIN_STEP_M) continue;

    // A gap is recorded as a gap. The distance across it is not counted — we
    // have no idea what route was taken, so guessing a straight line would
    // both inflate the total and claim cells that were never run.
    if (seconds > GAP_SECONDS || step > GAP_METERS) {
      point.gapBefore = true;
      points = [...points, point];
      lastAccepted = point;
      changed = true;
      continue;
    }

    if (seconds > 0 && step / seconds > MAX_SPEED_MPS) continue;

    // Paint the ground as it is crossed. Gap segments are skipped above, so a
    // recording hole never claims the straight line across it.
    creditSegment(liveCells, lastAccepted, point);

    distanceM += step;
    points = [...points, point];
    lastAccepted = point;
    // Only an accepted step counts. A stationary phone still emits fixes, and
    // letting those refresh the clock would mean a run in a bag never goes
    // dormant — which is the whole failure this exists to prevent.
    lastMovementAt = Date.now();
    changed = true;
  }

  if (changed) {
    notify();
    // Mirrored to disk on a cadence so the run survives the process dying, and
    // so a cold start can tell how long ago it last moved.
    if (startedAt != null) {
      void saveCheckpoint({
        startedAt,
        lastMovementAt: lastMovementAt ?? startedAt,
        distanceM,
        points,
      });
    }
  }
}

// Defined at module scope so the task exists before the OS ever delivers to it.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  if (locations?.length) ingest(locations);
});

export async function startTracking(): Promise<{ ok: boolean; reason?: string }> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    return { ok: false, reason: 'Location permission is needed to record a run.' };
  }

  // Background permission is what keeps recording with the screen off. If it is
  // refused we still record, but only while the app is open — and we say so
  // rather than silently producing a route full of straight lines.
  const background = await Location.requestBackgroundPermissionsAsync();

  resetTrack();
  // Stamped before the first fix: a run that never gets a fix at all still
  // needs a start time, or the dormancy check has nothing to measure from.
  startedAt = Date.now();
  lastMovementAt = startedAt;

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 2,
    // iOS: tells CoreLocation this is a workout, which improves fix quality on
    // foot and stops the OS pausing updates at traffic lights.
    activityType: Location.ActivityType.Fitness,
    // Without this Android throttles or kills updates once the screen is off,
    // which is exactly the failure it is here to prevent.
    foregroundService: {
      notificationTitle: 'Runturfing is recording your run',
      notificationBody: 'Tap to return to the map.',
      notificationColor: '#FDC800',
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });

  return {
    ok: true,
    reason:
      background.status === 'granted'
        ? undefined
        : 'Recording will pause if you leave the app. Allow location "all the time" to track with the screen off.',
  };
}

export async function stopTracking(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // Already stopped, or the task never started.
  }
}

export async function isTracking(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

/** Contiguous stretches, split wherever recording dropped out. */
export function segments(track: TrackPoint[] = points): TrackPoint[][] {
  const out: TrackPoint[][] = [];
  let current: TrackPoint[] = [];
  for (const p of track) {
    if (p.gapBefore && current.length) {
      out.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length) out.push(current);
  return out;
}
