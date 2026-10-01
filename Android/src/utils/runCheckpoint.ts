import * as FileSystem from 'expo-file-system';
import { TrackPoint } from './runTracker';

/**
 * A run in progress, mirrored to disk.
 *
 * The location task survives the app process being killed; the JavaScript that
 * was watching it does not. That asymmetry is how a run recorded GPS for
 * twenty hours with the map showing a "start" button: the process restarted,
 * React state reset to "not recording", and nothing was left that knew a run
 * was open or when it had last moved.
 *
 * So the facts needed to close a run out are kept on disk, not in memory:
 * the track so far, and when it last actually moved. Anything that can decide
 * to finish the run — the app coming back to the foreground, the next fix
 * arriving — can then do so from a cold start.
 *
 * This is separate from pending-run.json, which holds a FINISHED run waiting to
 * upload. This one holds an UNFINISHED run. A run moves from here to there.
 */

export type RunCheckpoint = {
  startedAt: number;
  /** Timestamp of the last fix that actually moved. The dormancy clock. */
  lastMovementAt: number;
  distanceM: number;
  points: TrackPoint[];
};

const FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}run-checkpoint.json`
  : null;

// Writing on every fix would mean a file write per second for the length of a
// run. Writing rarely risks losing the tail. Ten seconds is far below the
// dormancy threshold, so the worst case is a few seconds of track.
export const CHECKPOINT_INTERVAL_MS = 10_000;

let lastWrite = 0;

export async function saveCheckpoint(cp: RunCheckpoint, force = false): Promise<void> {
  if (!FILE) return;
  const now = Date.now();
  if (!force && now - lastWrite < CHECKPOINT_INTERVAL_MS) return;
  lastWrite = now;
  try {
    await FileSystem.writeAsStringAsync(FILE, JSON.stringify(cp));
  } catch {
    // The run continues in memory; the next write will catch up.
  }
}

export async function loadCheckpoint(): Promise<RunCheckpoint | null> {
  if (!FILE) return null;
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return null;
    const cp = JSON.parse(await FileSystem.readAsStringAsync(FILE)) as RunCheckpoint;
    // A half-written or hand-edited file is worse than none.
    if (!cp?.startedAt || !Array.isArray(cp.points)) {
      await clearCheckpoint();
      return null;
    }
    return cp;
  } catch {
    return null;
  }
}

export async function clearCheckpoint(): Promise<void> {
  lastWrite = 0;
  if (!FILE) return;
  try {
    await FileSystem.deleteAsync(FILE, { idempotent: true });
  } catch {
    // Already gone.
  }
}
