import { Platform, Linking } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import type { RankTrack } from '../types';

/**
 * Run sharing — the finish card and the three ways out of the app.
 *
 * How Strava does it, since that is what this copies: the card is not a
 * screenshot. An off-screen view holding the route and the stats is rasterised
 * on the device, and the resulting file is handed to the OS share sheet
 * (UIActivityViewController on iOS, ACTION_SEND on Android). Nothing is
 * uploaded and nothing is rendered on a server, which is why their card appears
 * the instant a run ends and works with no signal.
 *
 * The Instagram Stories path is the one exception. Instagram accepts a
 * pre-placed story through the `instagram-stories://share` URL scheme, with the
 * image passed on the iOS pasteboard under the UTI
 * `com.instagram.sharedSticker.backgroundImage`. Writing a custom pasteboard
 * UTI needs native code, which this app does not have, so `shareToStories`
 * below saves the card to the camera roll and opens the Stories composer on it
 * instead — one extra tap for the user. If a native pasteboard module is ever
 * added, only that function changes.
 */

/** Everything the card draws. Assembled at the moment a run is finished. */
export interface RunShareData {
  /** Metres covered, as saved. */
  distanceMeters: number;
  /** Seconds elapsed, already trimmed of dormant time. */
  durationSeconds: number;
  /** Nodes this run put a live score into. */
  nodesConquered: number;
  /** The route, in order. */
  route: { latitude: number; longitude: number }[];
  /** H3 ids of the nodes conquered, drawn under the route. */
  nodeIds: string[];
  /** When the run ended. */
  endedAt: number;
  runnerName: string;
  rank?: { code: string; name: string; track: RankTrack; stars: number };
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatDistance(metres: number): string {
  return (metres / 1000).toFixed(2);
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Minutes per kilometre. Dashes rather than a wild number on a trivial run. */
export function formatPace(metres: number, seconds: number): string {
  if (metres < 100 || seconds < 10) return '—';
  const secPerKm = seconds / (metres / 1000);
  if (!isFinite(secPerKm) || secPerKm > 3600) return '—';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  // 9:60 is not a pace. Carry it.
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatCardDate(ms: number): string {
  return new Date(ms)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
}

// ── Capture ──────────────────────────────────────────────────────────────────

/** The story format every network crops to. The card is laid out at this ratio. */
export const CARD_ASPECT = 1080 / 1920;

/**
 * Rasterise the off-screen card to a PNG on disk and return its file:// uri.
 *
 * The card renders at a small logical size so it can sit off-screen without
 * costing a full-resolution layout; `width`/`height` here are the OUTPUT pixels,
 * so the file lands at 1080×1920 whatever the device's own density is.
 */
export async function captureCard(ref: React.RefObject<any>): Promise<string> {
  return captureRef(ref, {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
    width: 1080,
    height: 1920,
  });
}

// ── The three ways out ───────────────────────────────────────────────────────

/** The OS share sheet. Every installed app, one code path. */
export async function shareCard(uri: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle: 'Share your run',
  });
  return true;
}

export type SaveResult = 'saved' | 'denied' | 'failed';

/** Camera roll. Also the first half of the Stories path. */
export async function saveCardToPhotos(uri: string): Promise<SaveResult> {
  try {
    const { granted } = await MediaLibrary.requestPermissionsAsync(
      // Only ever writes. Asking for the whole library to save one file is the
      // kind of permission prompt people decline, and rightly.
      true,
      ['photo']
    );
    if (!granted) return 'denied';
    await MediaLibrary.saveToLibraryAsync(uri);
    return 'saved';
  } catch {
    return 'failed';
  }
}

export type StoriesResult = 'opened' | 'no_instagram' | 'denied' | 'failed';

/**
 * Save the card, then open Instagram's story composer on it.
 *
 * See the note at the top of this file: without a native pasteboard module the
 * image cannot be handed to Instagram directly, so the user picks it from their
 * camera roll in the composer. Returns 'no_instagram' when the app is not
 * installed, which the caller should fall back to the share sheet on.
 */
export async function shareToStories(uri: string): Promise<StoriesResult> {
  const scheme = 'instagram-stories://share';
  let can = false;
  try {
    can = await Linking.canOpenURL(scheme);
  } catch {
    can = false;
  }
  // canOpenURL on Android is governed by the manifest queries element rather
  // than by what is installed, so a false there is not proof of absence.
  if (!can && Platform.OS === 'ios') return 'no_instagram';

  const saved = await saveCardToPhotos(uri);
  if (saved === 'denied') return 'denied';
  if (saved === 'failed') return 'failed';

  try {
    await Linking.openURL(scheme);
    return 'opened';
  } catch {
    return 'no_instagram';
  }
}
