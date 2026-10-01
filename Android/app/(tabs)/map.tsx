import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Animated, ScrollView, AppState, Platform,
} from 'react-native';
import MapView, { Marker, Polygon, Polyline, Region, PROVIDER_GOOGLE } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { showMessage } from 'react-native-flash-message';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTerritoryStore, cellFill, CELL_COLORS, CELL_STROKE_COLORS } from '../../src/stores/territoryStore';
import { profileApi, runsApi } from '../../src/services/apiClient';
import { encodePolyline } from '../../src/utils/polyline';
import {
  PendingRun,
  clearPendingRun,
  loadPendingRun,
  savePendingRun,
} from '../../src/utils/pendingRun';
import {
  TrackPoint,
  distanceOf,
  getTrack,
  isTracking as taskIsTracking,
  rebuildLiveCells,
  resetTrack,
  restoreTrack,
  segments,
  startTracking,
  stopTracking,
  stopVerdict,
  subscribe as subscribeToTrack,
  trimToLastMovement,
} from '../../src/utils/runTracker';
import { clearCheckpoint, loadCheckpoint } from '../../src/utils/runCheckpoint';
import {
  CLOSURE_TOLERANCE_M,
  MIN_LOOP_PERIMETER_M,
  boundaryOf,
  metresBetween as liveMetres,
  previewEnclosure,
} from '../../src/utils/liveTerritory';
import { COLORS, SPACING, RADIUS, SHADOWS } from '../../src/utils/theme';
import { applyChallenge, DEMO_CENTRE } from '../../src/utils/demoTerritory';
import CellHolderPin from '../../src/components/CellHolderPin';
import RunShareSheet from '../../src/components/RunShareSheet';
import { RunShareData } from '../../src/utils/runShare';
import { useAuthStore } from '../../src/stores/authStore';
import { TerritoryCell, ZoneSummary } from '../../src/types';

// The server sends each cell's real H3 boundary (computed with h3-py, the
// same library that scored it), so the map draws exactly the ground the run
// claimed. The fallback approximation only exists for cells from an older
// backend without `boundary` — it is ~4x too small for r9 and doesn't tile.
function h3ToPolygon(cell: TerritoryCell): Array<{ latitude: number; longitude: number }> {
  if (cell.boundary && cell.boundary.length >= 3) {
    return cell.boundary.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
  }
  const R = 0.00045;
  const angles = [0, 60, 120, 180, 240, 300].map((a) => (a * Math.PI) / 180);
  return angles.map((a) => ({
    latitude: cell.lat + R * Math.cos(a),
    longitude: cell.lng + R * Math.sin(a) * 1.4,
  }));
}

// Printed-map palette: paper ground, white roads outlined in ink, no POI or
// transit clutter, so the territory polygons are the only saturated thing here.
const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#F3F1EA' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#1C293C' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FBFBF9' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#D8D4C8' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#FDC800' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1C293C' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#BFD9E8' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#E8EDE0' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

/** Metres between two coordinates. */
function metresBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

// GPS filtering. Raw fixes are noisy: a phone standing still still reports
// movement, and urban canyons throw fixes tens of metres sideways. Without
// these gates the drawn route frays, which is worst when you double back,
// because outward and return noise cross over each other.
const MAX_ACCURACY_M = 25; // discard fixes the device itself rates worse than this
const MIN_STEP_M = 2.5; // below this it is jitter, not movement
const MAX_SPEED_MPS = 12; // ~43 km/h: anything faster is a GPS jump, not a runner

// Below either of these the backend rejects the import anyway, and a stray tap
// on the record button should not turn into a saved run.
const MIN_SAVE_METERS = 50;
const MIN_SAVE_SECONDS = 30;

// Holder pins. An r10 cell is ~152 m across (76 m edge, 17,102 m2), so at a
// latitudeDelta above this it draws under ~20px and the pins collide — the pin
// is worth nothing there, and paying for hundreds of markers to render it is
// worth less. The budget is the frame-rate ceiling: Android Maps degrades badly
// with custom-view markers well before the ~500 cells a dense area produces.
const PIN_MAX_DELTA = 0.025;
const PIN_BUDGET = 120;

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const queryClient = useQueryClient();
  const {
    cells: storeCells, zones, userStats, isLoading, fetchViewport, clearCells,
    demoMode, toggleDemo,
  } = useTerritoryStore();
  const [isTracking, setIsTracking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [trackingPoints, setTrackingPoints] = useState<TrackPoint[]>([]);
  const [selectedZone, setSelectedZone] = useState<ZoneSummary | null>(null);
  const [selectedCell, setSelectedCell] = useState<TerritoryCell | null>(null);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Live run stats. Distance accumulates from accepted fixes only, so it is not
  // inflated by the jitter the filters above reject.
  const [distanceM, setDistanceM] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedS, setElapsedS] = useState(0);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const lastRegionRef = useRef<Region | null>(null);
  const [region, setRegion] = useState<Region | null>(null);

  // A finished run that has not reached the backend, restored from disk on
  // mount so it survives closing the app.
  const [pending, setPending] = useState<PendingRun | null>(null);
  const retryingRef = useRef(false);
  // The tracker's own clocks, mirrored so the dormancy check can read them
  // without re-subscribing.
  const trackTimesRef = useRef<{ startedAt: number | null; lastMovementAt: number | null }>({
    startedAt: null,
    lastMovementAt: null,
  });
  const autoStoppingRef = useRef(false);

  // Provisional ground, computed on the phone as it is crossed. Replaced by the
  // server's answer on reconcile; the server never trusts any of it.
  const [liveCells, setLiveCells] = useState<Record<string, number>>({});
  const [enclosure, setEnclosure] = useState<string[]>([]);
  const [gapToStart, setGapToStart] = useState(Infinity);

  // The finish card. Held as a frozen snapshot rather than read live, because
  // finishing a run clears trackingPoints and liveCells on the way out.
  const [shareData, setShareData] = useState<RunShareData | null>(null);
  const authUser = useAuthStore((st) => st.user);
  // Already in the cache for anyone who has opened Profile, so this is usually
  // a read rather than a request. The card degrades to no rank if it is absent.
  const { data: meProfile } = useQuery({
    queryKey: ['profile-me'],
    queryFn: () => profileApi.getMe().then((r) => r.data),
    staleTime: 60_000,
  });

  // The tracker owns the GPS subscription and keeps running with the screen
  // off, so this screen only mirrors its state.
  useEffect(() => {
    const unsubscribe = subscribeToTrack(() => {
      const t = getTrack();
      setTrackingPoints(t.points);
      setDistanceM(t.distanceM);
      setGpsAccuracy(t.accuracy);
      setLiveCells({ ...t.liveCells });
      trackTimesRef.current = { startedAt: t.startedAt, lastMovementAt: t.lastMovementAt };
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isTracking || startedAt == null) return;
    const id = setInterval(() => setElapsedS(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [isTracking, startedAt]);

  // Restore an unsent run and try again — on open, and every time the app comes
  // back to the foreground, which is the closest thing to a "you're online
  // again" signal without adding a connectivity library.
  useEffect(() => {
    const attempt = async () => {
      if (retryingRef.current || isTracking) return;
      retryingRef.current = true;
      try {
        const stored = await loadPendingRun();
        if (!stored) return;
        setPending(stored);
        const restored = (stored.points ?? []) as TrackPoint[];
        setTrackingPoints(restored);
        setDistanceM(stored.distance_meters);
        // Keep the claim visible while it waits to upload.
        setLiveCells(rebuildLiveCells(restored));
        await uploadRun(stored);
      } finally {
        retryingRef.current = false;
      }
    };

    attempt();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') attempt();
    });
    return () => sub.remove();
    // Deliberately mount-only: re-running this on every render would fight the
    // upload it just started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Reconcile with the OS on mount, and again whenever the app comes forward.
   *
   * The location task outlives the process; this screen's `isTracking` does
   * not. After a restart the button said "start" while GPS was still running,
   * so a forgotten run recorded for twenty hours with no way to stop it from
   * the UI. Android is the authority on whether the task is registered, so ask
   * it — and if the run has gone dormant meanwhile, close it out from the
   * checkpoint rather than resuming a run that ended hours ago.
   */
  const reconcileWithTask = useCallback(async () => {
    if (autoStoppingRef.current) return;

    const running = await taskIsTracking();
    if (!running) return;

    const cp = await loadCheckpoint();
    const started = cp?.startedAt ?? trackTimesRef.current.startedAt;
    const moved = cp?.lastMovementAt ?? trackTimesRef.current.lastMovementAt;
    const verdict = stopVerdict(started ?? null, moved ?? null);

    if (verdict.stop) {
      autoStoppingRef.current = true;
      try {
        // Restore first: after a process death the track exists only on disk,
        // and finishing without it would throw the run away.
        if (cp) restoreTrack(cp);
        await stopTracking();
        setIsTracking(false);
        await finishRun({
          auto: verdict.reason,
          track: cp?.points ?? trackingPoints,
          startedAtMs: started ?? undefined,
        });
      } finally {
        autoStoppingRef.current = false;
      }
      return;
    }

    // Still a live run the UI has lost track of — adopt it rather than
    // stranding it.
    if (cp) restoreTrack(cp);
    setIsTracking(true);
    setStartedAt(started ?? Date.now());
  }, [trackingPoints]);

  useEffect(() => {
    reconcileWithTask();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcileWithTask();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dormancy while the app is open and recording. The resume path above covers
  // the process-death case; this covers the phone sitting on a table with the
  // app in front of you.
  useEffect(() => {
    if (!isTracking) return;
    const id = setInterval(() => {
      const { startedAt: began, lastMovementAt: moved } = trackTimesRef.current;
      const verdict = stopVerdict(began, moved);
      if (!verdict.stop || autoStoppingRef.current) return;
      autoStoppingRef.current = true;
      (async () => {
        try {
          await stopTracking();
          setIsTracking(false);
          // Read the track from the tracker, not from this closure: the
          // interval was created when recording started and its captured
          // trackingPoints are however stale that render was.
          const live = getTrack();
          await finishRun({
            auto: verdict.reason,
            track: live.points,
            startedAtMs: began ?? undefined,
          });
        } finally {
          autoStoppingRef.current = false;
        }
      })();
    }, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTracking]);

  // Loop preview. polygonToCells is far heavier than a per-fix cell lookup, so
  // it only runs once the loop could plausibly close: near the start, and long
  // enough to qualify. Recomputed every 10 fixes rather than every fix.
  useEffect(() => {
    if (!isTracking || trackingPoints.length < 8) {
      if (enclosure.length) setEnclosure([]);
      return;
    }
    const gap = liveMetres(trackingPoints[0], trackingPoints[trackingPoints.length - 1]);
    setGapToStart(gap);
    if (gap > CLOSURE_TOLERANCE_M || distanceM < MIN_LOOP_PERIMETER_M) {
      if (enclosure.length) setEnclosure([]);
      return;
    }
    if (trackingPoints.length % 10 !== 0) return;
    const preview = previewEnclosure(trackingPoints, liveCells, distanceM);
    setEnclosure(preview.cells);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingPoints, isTracking, distanceM]);

  // Pulse animation for tracking indicator
  useEffect(() => {
    if (isTracking) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isTracking]);

  const onRegionChangeComplete = useCallback(
    (region: Region) => {
      lastRegionRef.current = region;
      // Held in state as well as the ref: the holder pins are gated on zoom, so
      // they have to re-evaluate when the region changes, and a ref will not
      // trigger that.
      setRegion(region);
      // The cell card describes one specific hex. Once the map has moved, that
      // hex may not even be on screen, so the card is describing something the
      // user can no longer see. Tapping a cell does not move the map, so this
      // never fires on the gesture that opened it.
      setSelectedCell(null);
      const swLat = region.latitude - region.latitudeDelta / 2;
      const neLat = region.latitude + region.latitudeDelta / 2;
      const swLng = region.longitude - region.longitudeDelta / 2;
      const neLng = region.longitude + region.longitudeDelta / 2;
      fetchViewport(swLat, swLng, neLat, neLng);
    },
    [fetchViewport]
  );

  const centerOnUser = async (animated = true) => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    // Last-known returns immediately and is usually within a block or two, so
    // the map lands on the right city before the GPS fix resolves. Without it
    // the first paint sits on initialRegion, which is a different continent for
    // most users.
    const cached = await Location.getLastKnownPositionAsync();
    if (cached) {
      const coord = { latitude: cached.coords.latitude, longitude: cached.coords.longitude };
      setUserLocation(coord);
      mapRef.current?.animateToRegion(
        { ...coord, latitudeDelta: 0.02, longitudeDelta: 0.02 },
        animated ? 400 : 0
      );
    }

    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const coord = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
    setUserLocation(coord);
    mapRef.current?.animateToRegion({ ...coord, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 600);
  };

  /**
   * Upload a finished run. The route is written to disk first and only removed
   * once the backend has it, so nothing depends on this screen staying mounted
   * or on there being a connection at the moment you stop.
   */
  const uploadRun = async (run: PendingRun) => {
    setIsSaving(true);
    try {
      await runsApi.importRun({
        source: run.source,
        started_at: run.started_at,
        ended_at: run.ended_at,
        distance_meters: run.distance_meters,
        duration_seconds: run.duration_seconds,
        encoded_polyline: run.encoded_polyline,
      });

      await clearPendingRun();
      setPending(null);
      setStartedAt(null);

      // Reconcile: the server has now scored the run, so the provisional paint
      // is retired and the authoritative cells arrive via the refetch below.
      // Anything the phone claimed that the server rejected disappears here.
      setLiveCells({});
      setEnclosure([]);
      resetTrack();

      showMessage({
        message: `Run saved — ${(run.distance_meters / 1000).toFixed(2)} km`,
        description: 'Territory updates once it finishes processing.',
        type: 'success',
      });

      queryClient.invalidateQueries({ queryKey: ['profile-me'] });

      // Territory is computed in a background task, so the cells for this run
      // are not there yet. Drop the viewport cache and re-read shortly.
      setTimeout(() => {
        clearCells();
        const region = lastRegionRef.current;
        if (region) {
          fetchViewport(
            region.latitude - region.latitudeDelta / 2,
            region.longitude - region.longitudeDelta / 2,
            region.latitude + region.latitudeDelta / 2,
            region.longitude + region.longitudeDelta / 2
          );
        }
      }, 4000);

      return true;
    } catch {
      showMessage({
        message: 'Run saved on your phone.',
        description: 'Could not reach the server. It uploads by itself once you are back online.',
        type: 'warning',
        duration: 4000,
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Close out a run: trim, persist, then try to send.
   *
   * `auto` runs come from the dormancy or duration backstop rather than the
   * user's finger. They are trimmed to the last real movement, so fifteen
   * dormant minutes never reach duration_seconds and wreck the pace — the run
   * ended when it stopped moving, not when we noticed.
   */
  const finishRun = async (opts?: { auto?: 'dormant' | 'too_long'; track?: TrackPoint[]; startedAtMs?: number }) => {
    const raw = opts?.track ?? trackingPoints;
    const begin = opts?.startedAtMs ?? startedAt ?? trackTimesRef.current.startedAt;
    const track = opts?.auto ? trimToLastMovement(raw) : raw;

    const metres = opts?.auto ? distanceOf(track) : distanceM;
    const endedAt = track.length ? track[track.length - 1].at : Date.now();
    const seconds = begin ? Math.max(0, Math.floor((endedAt - begin) / 1000)) : 0;

    await clearCheckpoint();

    if (track.length < 2 || metres < MIN_SAVE_METERS || seconds < MIN_SAVE_SECONDS) {
      // An accidental start and a pocketed phone should leave nothing behind.
      showMessage({
        message: opts?.auto ? 'Recording stopped — nothing to save.' : 'Run was too short to save.',
        type: 'warning',
      });
      resetTrack();
      setTrackingPoints([]);
      setStartedAt(null);
      setLiveCells({});
      return;
    }

    const run: PendingRun = {
      source: 'live_tracking',
      started_at: new Date(begin as number).toISOString(),
      ended_at: new Date(endedAt).toISOString(),
      distance_meters: Math.round(metres),
      duration_seconds: seconds,
      encoded_polyline: encodePolyline(
        track.map((p) => ({ lat: p.latitude, lng: p.longitude }))
      ),
      points: track,
      savedAt: Date.now(),
    };

    if (opts?.auto) {
      // The foreground-service notification is the only other signal, and it is
      // invisible if the user has notifications off — which is exactly how a run
      // records for twenty hours unnoticed. Say it in the app as well.
      showMessage({
        message:
          opts.auto === 'dormant'
            ? 'Run auto-saved after 15 minutes without movement.'
            : 'Run auto-saved — recording had been open over 6 hours.',
        description: `${(run.distance_meters / 1000).toFixed(2)} km kept. The idle time was trimmed off.`,
        type: 'info',
        duration: 6000,
      });
    }

    // Disk first, upload second. A crash or a killed app between the two loses
    // nothing, and the retry survives the screen unmounting.
    await savePendingRun(run);
    setPending(run);

    // The card is built from the phone's own preview, not from the server's
    // scoring, so it can be shown the moment the run ends and with no signal.
    // The two can disagree at the margin — the server re-derives everything and
    // may reject a node the phone painted — which is why the sheet is offered
    // at the finish and the profile's numbers stay the authority.
    //
    // Auto-saved runs skip it. Those fire from the dormancy and duration
    // backstops, so nobody is holding the phone to see the sheet, and putting a
    // modal in front of a screen the user returns to hours later is a trap.
    if (!opts?.auto) {
      const nodeIds = Object.keys(liveCells);
      setShareData({
        distanceMeters: run.distance_meters,
        durationSeconds: run.duration_seconds,
        nodesConquered: nodeIds.length,
        nodeIds,
        route: track.map((pt) => ({ latitude: pt.latitude, longitude: pt.longitude })),
        endedAt,
        runnerName: meProfile?.user.displayName ?? authUser?.displayName ?? 'Runner',
        rank: meProfile?.rank
          ? {
              code: meProfile.rank.code,
              name: meProfile.rank.name,
              track: meProfile.rank.track,
              stars: meProfile.rank.stars,
            }
          : undefined,
      });
    }

    await uploadRun(run);
  };

  const toggleTracking = async () => {
    if (isSaving) return;

    if (isTracking) {
      await stopTracking();
      setIsTracking(false);
      // The route stays on screen after stopping so the run can be looked at.
      await finishRun();
      return;
    }

    // Retry the stored run rather than starting a new one over the top of it.
    if (pending) {
      await uploadRun(pending);
      return;
    }

    const { ok, reason } = await startTracking();
    if (!ok) {
      showMessage({ message: reason ?? 'Could not start recording.', type: 'warning' });
      return;
    }
    if (reason) {
      // Background permission refused: recording still works, but only while
      // the app is open. Say so rather than letting it fail silently.
      showMessage({ message: reason, type: 'warning', duration: 5000 });
    }

    setTrackingPoints([]);
    setDistanceM(0);
    setElapsedS(0);
    setStartedAt(Date.now());
    setIsTracking(true);
  };

  // In demo mode the run in progress is scored against the simulated city on
  // the phone, so a challenge resolves live: metres inside a cell become score,
  // and the cell flips the moment you pass its leader. Outside demo mode this
  // passes the store's cells straight through — the server is the only
  // authority on real ground.
  const { cells, taken, contesting } = React.useMemo(() => {
    if (!demoMode) return { cells: storeCells, taken: 0, contesting: 0 };
    return applyChallenge(storeCells, liveCells);
  }, [demoMode, storeCells, liveCells]);

  /**
   * Holder pins — the face of whoever holds each cell.
   *
   * Two hard limits decide this list, both about frame rate rather than taste.
   * An r10 cell is ~130 m across, so below a certain zoom the pins overlap into
   * a smear and say nothing; and Android Maps will not carry a custom-view
   * marker per cell when there are several hundred on screen. So: only when
   * zoomed in past PIN_MAX_DELTA, only cells actually in view, and never more
   * than PIN_BUDGET — nearest the centre of the screen first, which is where
   * the user is looking.
   */
  const holderPins = React.useMemo(() => {
    if (!region || region.latitudeDelta > PIN_MAX_DELTA) return [];

    const halfLat = region.latitudeDelta / 2;
    const halfLng = region.longitudeDelta / 2;

    return cells
      .filter(
        (c) =>
          Math.abs(c.lat - region.latitude) <= halfLat &&
          Math.abs(c.lng - region.longitude) <= halfLng
      )
      .map((c) => ({
        cell: c,
        d: (c.lat - region.latitude) ** 2 + (c.lng - region.longitude) ** 2,
      }))
      .sort((a, b) => a.d - b.d)
      .slice(0, PIN_BUDGET)
      .map((x) => x.cell);
  }, [cells, region]);

  const paceLabel = (() => {
    if (distanceM < 30 || elapsedS < 5) return '—';
    const secPerKm = elapsedS / (distanceM / 1000);
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  })();

  const clock = `${Math.floor(elapsedS / 60)}:${String(elapsedS % 60).padStart(2, '0')}`;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        // Google provider needs the Google Maps iOS SDK and its own key; Apple
        // Maps ships free with the OS. customMapStyle is a Google-only prop, so
        // iOS keeps the default look — the printed-map palette is Android-only
        // until we decide the Google iOS SDK is worth its key.
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        customMapStyle={Platform.OS === 'android' ? MAP_STYLE : undefined}
        showsUserLocation
        showsMyLocationButton={false}
        // Lifts Google's logo and the legal link clear of the legend now that
        // the legend sits on the bottom edge. Also keeps the camera centred on
        // the visible strip rather than behind the legend.
        mapPadding={{ top: 0, right: 0, bottom: 44, left: 0 }}
        // Only ever visible for the moment before onMapReady recentres on the
        // device, and if location permission is refused.
        initialRegion={{
          latitude: 1.3521,
          longitude: 103.8198,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }}
        onMapReady={() => centerOnUser(false)}
        onRegionChangeComplete={onRegionChangeComplete}
      >
        {/* Territory cells. A rival's cell that you have also run is outlined
            in your colour so your effort is visible before you overtake them —
            otherwise contested ground looks identical to ground you have never
            set foot on.

            Fill strength follows leaderDensity: how much of the ring around a
            cell the same leader also holds. Clusters paint dense, isolated
            cells stay faint, so who leads an area reads as one heavy patch
            rather than a scattering of equally-coloured tiles. */}
        {cells.map((cell) => {
          const contesting = !cell.isYours && (cell.yourScore ?? 0) > 0;
          const density = cell.leaderDensity ?? 0;
          return (
            <Polygon
              key={cell.h3Index}
              coordinates={h3ToPolygon(cell)}
              fillColor={cellFill(cell.state, density)}
              strokeColor={contesting ? COLORS.warning : CELL_STROKE_COLORS[cell.state]}
              // A cell at the heart of somebody's ground gets a heavier outline
              // as well as a heavier fill, which is what holds the shape of the
              // patch together when zoomed out.
              strokeWidth={contesting ? 3 : density >= 0.66 ? 2 : 1}
              lineDashPattern={contesting ? [5, 3] : undefined}
              tappable
              onPress={() => setSelectedCell(cell)}
            />
          );
        })}

        {/* Who holds each cell, on the cell. Zoom-gated and budgeted — see
            PIN_MAX_DELTA and PIN_BUDGET. tracksViewChanges is off so each pin
            rasterises once instead of on every frame of a pan, which is the
            difference between this being usable and unusable. */}
        {holderPins.map((cell) => (
          <Marker
            key={`pin-${cell.h3Index}`}
            coordinate={{ latitude: cell.lat, longitude: cell.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            onPress={() => setSelectedCell(cell)}
          >
            <CellHolderPin
              avatarUrl={cell.ownerAvatarUrl}
              displayName={cell.ownerDisplayName}
              userId={cell.ownerUserId}
              isYours={cell.isYours}
            />
          </Marker>
        ))}

        {/* One badge at the densest point of each leader's patch, naming who
            holds it. Labelling every cell would bury the map under a badge on
            every runner's commute. */}
        {cells
          .filter((c) => c.isStrongholdCore)
          .map((cell) => (
            <Marker
              key={`hold-${cell.h3Index}`}
              coordinate={{ latitude: cell.lat, longitude: cell.lng }}
              onPress={() => setSelectedCell(cell)}
              tracksViewChanges={false}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={[styles.holdBadge, cell.isYours && styles.holdBadgeMine]}>
                <Ionicons
                  name="flag"
                  size={11}
                  color={cell.isYours ? COLORS.textPrimary : '#fff'}
                />
                <Text
                  style={[styles.holdText, cell.isYours && styles.holdTextMine]}
                  numberOfLines={1}
                >
                  {cell.isYours ? 'YOUR HOLD' : (cell.ownerDisplayName ?? '').toUpperCase()}
                </Text>
                <Text
                  style={[styles.holdCount, cell.isYours && styles.holdTextMine]}
                >
                  {cell.strongholdSize}
                </Text>
              </View>
            </Marker>
          ))}

        {/* Live tracking route */}
        {/* Provisional ground, painted by the phone as it is crossed. Dashed
            and unsaturated on purpose: it must not look like owned territory,
            because the server has not scored it yet and may reject some of it. */}
        {Object.keys(liveCells).map((id) => (
          <Polygon
            key={`live-${id}`}
            coordinates={boundaryOf(id)}
            fillColor="rgba(253,200,0,0.35)"
            strokeColor="#1C293C"
            strokeWidth={2}
            lineDashPattern={[6, 4]}
          />
        ))}

        {/* Interior of a loop that has closed. Stronger than the line cells:
            it is the payoff for committing to the lap. */}
        {enclosure.map((id) => (
          <Polygon
            key={`encl-${id}`}
            coordinates={boundaryOf(id)}
            fillColor="rgba(22,163,74,0.30)"
            strokeColor="#16A34A"
            strokeWidth={2}
            lineDashPattern={[6, 4]}
          />
        ))}

        {/* One polyline per contiguous stretch. Drawing a single line through
            a recording gap would invent a route that was never run. */}
        {segments(trackingPoints)
          .filter((seg) => seg.length > 1)
          .map((seg, i) => (
            <Polyline
              key={`seg-${i}`}
              coordinates={seg}
              strokeColor={COLORS.primary}
              strokeWidth={4}
              lineCap="round"
              lineJoin="round"
            />
          ))}
      </MapView>

      {/* Simulated territory must never be mistaken for real ground, least of
          all by someone being shown the app for the first time. */}
      {demoMode && (
        <View style={styles.demoBadge} pointerEvents="none">
          <Ionicons name="flask" size={13} color={COLORS.textPrimary} />
          <Text style={styles.demoText}>
            DEMO TERRITORY
            {isTracking ? ` · ${taken} TAKEN · ${contesting} CONTESTED` : ''}
          </Text>
        </View>
      )}

      {/* Loading indicator */}
      {isLoading && (
        <View style={styles.loadingBadge}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading territory...</Text>
        </View>
      )}

      {/* Top stats bar */}
      {userStats && (
        <SafeAreaView edges={['top']} style={styles.statsBar}>
          <View style={styles.statsRow}>
            {[
              { label: 'Cells', value: userStats.claimedCells, color: COLORS.claimed },
              { label: 'Contested', value: userStats.contestedCells, color: COLORS.contested },
              { label: 'Total km', value: (userStats.totalMeters / 1000).toFixed(1), color: COLORS.success },
            ].map((s, i) => (
              <View key={i} style={styles.statItem}>
                <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </SafeAreaView>
      )}

      {/* Live run readout. Without this the only sign a run is being recorded
          is the line on the map, which tells you nothing about how far you
          have gone or how fast. */}
      {isTracking && (
        <SafeAreaView edges={['top']} style={styles.runHud} pointerEvents="none">
          <View style={styles.runCard}>
            <View style={styles.runRow}>
              <View style={styles.runItem}>
                <Text style={styles.runValue}>{(distanceM / 1000).toFixed(2)}</Text>
                <Text style={styles.runLabel}>KM</Text>
              </View>
              <View style={styles.runDivider} />
              <View style={styles.runItem}>
                <Text style={styles.runValue}>{clock}</Text>
                <Text style={styles.runLabel}>TIME</Text>
              </View>
              <View style={styles.runDivider} />
              <View style={styles.runItem}>
                <Text style={styles.runValue}>{paceLabel}</Text>
                <Text style={styles.runLabel}>MIN/KM</Text>
              </View>
            </View>

            <View style={styles.claimRow}>
              <Text style={styles.claimText}>
                {Object.keys(liveCells).length} CELLS
                {enclosure.length ? `  +${enclosure.length} ENCLOSED` : ''}
              </Text>
              {enclosure.length > 0 ? (
                <Text style={styles.loopClosed}>LOOP CLOSED</Text>
              ) : distanceM >= MIN_LOOP_PERIMETER_M && gapToStart < 400 ? (
                <Text style={styles.loopHint}>
                  {Math.round(gapToStart)}m TO CLOSE THE LOOP
                </Text>
              ) : null}
            </View>

            <View style={styles.gpsRow}>
              <View
                style={[
                  styles.gpsDot,
                  {
                    backgroundColor:
                      gpsAccuracy == null
                        ? COLORS.textMuted
                        : gpsAccuracy <= 10
                        ? COLORS.success
                        : gpsAccuracy <= MAX_ACCURACY_M
                        ? COLORS.warning
                        : COLORS.error,
                  },
                ]}
              />
              <Text style={styles.gpsText}>
                {gpsAccuracy == null
                  ? 'WAITING FOR GPS'
                  : gpsAccuracy <= MAX_ACCURACY_M
                  ? `GPS ±${Math.round(gpsAccuracy)}M · ${trackingPoints.length} PTS`
                  : `WEAK SIGNAL ±${Math.round(gpsAccuracy)}M`}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      )}

      {/* An unsent run must never be invisible — without this the only clue was
          a toast that had already gone. */}
      {pending && !isTracking && (
        <TouchableOpacity
          style={styles.pendingBanner}
          onPress={() => uploadRun(pending)}
          disabled={isSaving}
          activeOpacity={0.85}
        >
          <Ionicons name="cloud-offline" size={18} color={COLORS.textPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.pendingTitle}>
              {(pending.distance_meters / 1000).toFixed(2)} km waiting to upload
            </Text>
            <Text style={styles.pendingSub}>
              {isSaving ? 'Uploading…' : 'Saved on your phone. Tap to retry now.'}
            </Text>
          </View>
          {isSaving ? (
            <ActivityIndicator size="small" color={COLORS.textPrimary} />
          ) : (
            <Ionicons name="refresh" size={18} color={COLORS.textPrimary} />
          )}
        </TouchableOpacity>
      )}

      {/* Map controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlButton} onPress={() => centerOnUser()}>
          <Ionicons name="locate" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>

        <Animated.View style={{ transform: [{ scale: isTracking ? pulseAnim : 1 }] }}>
          <TouchableOpacity
            style={[styles.trackButton, isTracking && styles.trackButtonActive]}
            onPress={toggleTracking}
            disabled={isSaving}
            accessibilityLabel={
              isTracking ? 'Stop and save run' : pending ? 'Retry saving run' : 'Start run'
            }
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons
                name={isTracking ? 'stop' : pending ? 'cloud-upload' : 'play'}
                size={28}
                color="#fff"
              />
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* This button was a no-op. It now carries the demo city — the one
            thing worth toggling from the map without leaving it. */}
        <TouchableOpacity
          style={[styles.controlButton, demoMode && styles.controlButtonOn]}
          onPress={() => {
            toggleDemo();
            if (!demoMode) {
              mapRef.current?.animateToRegion(
                { latitude: DEMO_CENTRE.lat, longitude: DEMO_CENTRE.lng, latitudeDelta: 0.022, longitudeDelta: 0.022 },
                700
              );
            }
          }}
          accessibilityLabel={demoMode ? 'Turn off demo territory' : 'Show demo territory'}
        >
          <Ionicons name="layers-outline" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* Zone summary card */}
      {zones.length > 0 && (
        <View style={styles.zoneCard}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {zones.slice(0, 5).map((zone) => (
              <TouchableOpacity
                key={zone.id}
                style={[styles.zoneChip, selectedZone?.id === zone.id && styles.zoneChipActive]}
                onPress={() => setSelectedZone(zone === selectedZone ? null : zone)}
              >
                <View style={[styles.zoneDot, { backgroundColor: CELL_COLORS[zone.state] }]} />
                <Text style={styles.zoneChipText}>{zone.name}</Text>
                <Text style={styles.zoneChipCount}>{zone.cellCount}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Who holds the tapped cell, and how far off taking it you are. */}
      {selectedCell && (
        <TouchableOpacity style={styles.cellCard} onPress={() => setSelectedCell(null)} activeOpacity={0.9}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cellOwner}>
              {selectedCell.isYours ? 'YOURS' : `HELD BY ${(selectedCell.ownerDisplayName ?? '?').toUpperCase()}`}
            </Text>
            <Text style={styles.cellMeta}>
              {selectedCell.state} · leader {Math.round(selectedCell.score)} pts
              {!selectedCell.isYours && (selectedCell.yourScore ?? 0) > 0
                ? ` · you ${Math.round(selectedCell.yourScore ?? 0)}, ${Math.round(selectedCell.pointsBehind ?? 0)} behind`
                : !selectedCell.isYours
                ? ' · you have not run here'
                : ''}
            </Text>
            {(selectedCell.strongholdSize ?? 0) > 1 && (
              <Text style={styles.cellMeta}>
                {selectedCell.strongholdSize} cells nearby under the same leader ·{' '}
                {Math.round((selectedCell.leaderDensity ?? 0) * 100)}% of the ring
              </Text>
            )}
          </View>
          <Ionicons name="close" size={18} color={COLORS.textPrimary} />
        </TouchableOpacity>
      )}

      {/* Territory legend */}
      <View style={styles.legend}>
        {(['claimed', 'defended', 'contested', 'decaying'] as const).map((state) => (
          <View key={state} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: CELL_COLORS[state] }]} />
            <Text style={styles.legendText}>{state}</Text>
          </View>
        ))}
      </View>

      {/* The finish card. Mounted last so it sits over the map and the legend. */}
      <RunShareSheet
        visible={shareData !== null}
        data={shareData}
        onClose={() => setShareData(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  // Sits above the controls, below the run HUD: an unsent run is important but
  // must not cover the live readout mid-run.
  pendingBanner: {
    position: 'absolute',
    left: SPACING.lg,
    right: SPACING.lg,
    bottom: 200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.warning,
    borderWidth: 3,
    borderColor: COLORS.textPrimary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    boxShadow: '4px 4px 0px #111111',
  },
  pendingTitle: { fontSize: 14, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: 0.3 },
  pendingSub: { fontSize: 12, fontWeight: '600', color: COLORS.textPrimary, opacity: 0.85 },
  loadingBadge: {
    position: 'absolute',
    top: 100,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgCard + 'EE',
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
    ...SHADOWS.card,
  },
  loadingText: { fontSize: 13, color: COLORS.textSecondary },
  runHud: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.md,
  },
  runCard: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 3,
    borderColor: COLORS.border,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    ...SHADOWS.card,
  },
  runRow: { flexDirection: 'row', alignItems: 'center' },
  runItem: { flex: 1, alignItems: 'center' },
  runValue: {
    fontSize: 26,
    fontWeight: '900',
    color: COLORS.textPrimary,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  runLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  runDivider: { width: 2, height: 34, backgroundColor: COLORS.border },
  claimRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: SPACING.xs, paddingTop: SPACING.xs,
    borderTopWidth: 2, borderTopColor: COLORS.border,
  },
  claimText: { fontSize: 12, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: 1 },
  loopClosed: { fontSize: 11, fontWeight: '900', color: COLORS.success, letterSpacing: 1 },
  loopHint: { fontSize: 11, fontWeight: '800', color: COLORS.warning, letterSpacing: 0.6 },
  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.sm,
    paddingTop: SPACING.xs,
    borderTopWidth: 2,
    borderTopColor: COLORS.border,
  },
  gpsDot: { width: 10, height: 10, borderWidth: 2, borderColor: COLORS.border },
  gpsText: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: COLORS.textSecondary },
  statsBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgCard + 'EE',
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 2,
    borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  statValue: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  controls: {
    position: 'absolute',
    right: SPACING.md,
    bottom: 180,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.bgCard + 'EE',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  trackButton: {
    width: 64,
    height: 64,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.modal,
  },
  controlButtonOn: { backgroundColor: COLORS.tabActive },
  trackButtonActive: { backgroundColor: COLORS.error },
  // Below the stats bar, above everything else. Deliberately loud.
  demoBadge: {
    position: 'absolute',
    top: 108,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.tabActive,
    borderWidth: 2,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    boxShadow: '3px 3px 0px #111111',
  },
  demoText: { fontSize: 11, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: 0.8 },
  zoneCard: {
    position: 'absolute',
    bottom: 120,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.md,
  },
  zoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgCard + 'EE',
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginRight: SPACING.sm,
    borderWidth: 2,
    borderColor: COLORS.border,
    gap: SPACING.xs,
  },
  zoneChipActive: { borderColor: COLORS.primary },
  zoneDot: { width: 8, height: 8, borderRadius: 4 },
  zoneChipText: { fontSize: 13, fontWeight: '600', color: COLORS.textPrimary },
  zoneChipCount: {
    fontSize: 11,
    color: COLORS.textMuted,
    backgroundColor: COLORS.bgElevated,
    borderRadius: RADIUS.full,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  cellCard: {
    position: 'absolute', left: SPACING.lg, right: SPACING.lg, bottom: 150,
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    backgroundColor: COLORS.bgCard, borderWidth: 3, borderColor: COLORS.border,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    boxShadow: '4px 4px 0px #111111',
  },
  holdBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 150,
    backgroundColor: COLORS.textPrimary,
    borderWidth: 2,
    borderColor: COLORS.textPrimary,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  holdBadgeMine: { backgroundColor: COLORS.tabActive },
  holdText: { fontSize: 10, fontWeight: '900', color: '#fff', letterSpacing: 0.6, flexShrink: 1 },
  holdTextMine: { color: COLORS.textPrimary },
  holdCount: {
    fontSize: 10,
    fontWeight: '900',
    color: '#fff',
    opacity: 0.75,
  },
  cellOwner: { fontSize: 13, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: 0.8 },
  cellMeta: { fontSize: 11, color: COLORS.textSecondary, marginTop: 1 },
  // Sits against the tab bar. The map carries a matching bottom mapPadding so
  // Google's attribution is lifted above it — covering that logo breaks the
  // Maps terms, and it is drawn by the SDK where we cannot move it directly.
  legend: {
    position: 'absolute',
    bottom: SPACING.sm,
    left: SPACING.md,
    flexDirection: 'row',
    gap: SPACING.sm,
    backgroundColor: COLORS.bgCard + 'CC',
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 10, color: COLORS.textSecondary },
});
