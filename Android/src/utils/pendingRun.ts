import * as FileSystem from 'expo-file-system';

/**
 * A finished run held on disk until the backend accepts it.
 *
 * Runs happen outdoors, which is exactly where this phone has no connection.
 * Keeping the recorded route only in component state meant a failed upload
 * survived until the screen unmounted and no further — closing the app, or
 * Android reclaiming it while the screen was off, silently destroyed the run.
 *
 * The file is written the moment recording stops, before the upload is even
 * attempted, so a crash mid-upload loses nothing either.
 */

export type PendingRun = {
  source: 'live_tracking';
  started_at: string;
  ended_at: string;
  distance_meters: number;
  duration_seconds: number;
  encoded_polyline: string;
  /** Kept for the map to redraw the route after a restart. */
  points: Array<{ latitude: number; longitude: number }>;
  /** Local ms timestamp, for "recorded 2 hours ago" and for giving up on stale runs. */
  savedAt: number;
};

// documentDirectory is backed up and survives app updates, unlike cacheDirectory
// which Android may clear under storage pressure.
const FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}pending-run.json`
  : null;

/** A run older than this is almost certainly abandoned rather than pending. */
export const PENDING_RUN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function savePendingRun(run: PendingRun): Promise<void> {
  if (!FILE) return;
  try {
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify(run));
  } catch {
    // Nothing useful to do — the caller still has it in memory for this session.
  }
}

export async function loadPendingRun(): Promise<PendingRun | null> {
  if (!FILE) return null;
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return null;

    const run = JSON.parse(await FileSystem.readAsStringAsync(FILE)) as PendingRun;

    // Guard against a half-written or hand-edited file rather than trusting it.
    if (!run?.encoded_polyline || !run?.started_at || !run?.distance_meters) {
      await clearPendingRun();
      return null;
    }
    if (Date.now() - (run.savedAt ?? 0) > PENDING_RUN_MAX_AGE_MS) {
      await clearPendingRun();
      return null;
    }
    return run;
  } catch {
    return null;
  }
}

export async function clearPendingRun(): Promise<void> {
  if (!FILE) return;
  try {
    await FileSystem.deleteAsync(FILE, { idempotent: true });
  } catch {
    // Already gone, or unreadable — either way there is nothing to clean up.
  }
}
