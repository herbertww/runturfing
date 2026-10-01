import React, { forwardRef, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Polygon, Circle, G } from 'react-native-svg';
import { NEO } from '../utils/theme';
import { boundaryOf } from '../utils/liveTerritory';
import RunturfingLogo from './RunturfingLogo';
import RankInsignia from './RankInsignia';
import {
  RunShareData,
  formatDistance,
  formatDuration,
  formatPace,
  formatCardDate,
} from '../utils/runShare';

/**
 * The finish card, laid out at 360x640 and rasterised to 1080x1920.
 *
 * Everything is in card units so the whole thing scales as one object: the
 * capture pass hands react-native-view-shot the output size and the layout does
 * not change with the device. Nothing here reads from a store or a query — the
 * card is handed a frozen snapshot of the run, because it is captured after the
 * screen behind it has already reset its live state.
 */

export const CARD_W = 360;
export const CARD_H = 640;

const MAP_W = CARD_W - 48;
const MAP_H = 232;

// ── Route plotting ───────────────────────────────────────────────────────────

/**
 * Fit the route and its nodes into the map panel.
 *
 * Longitude is scaled by cos(latitude) before fitting. Skipping that draws a
 * Singapore route about 11% too wide, which is small enough to look like a
 * sloppy drawing rather than a bug, and turns every east-west run into a
 * stretched smear.
 */
function fitToBox(
  points: { latitude: number; longitude: number }[],
  box: { w: number; h: number; pad: number }
) {
  if (points.length === 0) return null;
  const latRef = (points.reduce((s, p) => s + p.latitude, 0) / points.length) * (Math.PI / 180);
  const kx = Math.cos(latRef) || 1;

  const xs = points.map((p) => p.longitude * kx);
  const ys = points.map((p) => -p.latitude);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const innerW = box.w - box.pad * 2;
  const innerH = box.h - box.pad * 2;
  // A there-and-back run has near-zero width. Guard the divisor or it plots to
  // Infinity and the panel comes out blank.
  const spanX = Math.max(maxX - minX, 1e-9);
  const spanY = Math.max(maxY - minY, 1e-9);
  const scale = Math.min(innerW / spanX, innerH / spanY);

  const offX = box.pad + (innerW - spanX * scale) / 2;
  const offY = box.pad + (innerH - spanY * scale) / 2;

  return (p: { latitude: number; longitude: number }) => ({
    x: offX + (p.longitude * kx - minX) * scale,
    y: offY + (-p.latitude - minY) * scale,
  });
}

function RouteMap({ route, nodeIds }: { route: RunShareData['route']; nodeIds: string[] }) {
  const drawn = useMemo(() => {
    // The hexes are part of what has to fit: a node clipped at the panel edge
    // reads as a rendering fault, so both go into the same extent.
    const hexes = nodeIds
      .map((id) => {
        try {
          return boundaryOf(id);
        } catch {
          return [];
        }
      })
      .filter((b) => b.length > 2);

    const all = [...route, ...hexes.flat()];
    const project = fitToBox(all, { w: MAP_W, h: MAP_H, pad: 16 });
    if (!project) return null;

    const asPoints = (pts: { latitude: number; longitude: number }[]) =>
      pts.map(project).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    return {
      hexes: hexes.map(asPoints),
      line: asPoints(route),
      start: route.length ? project(route[0]) : null,
      end: route.length ? project(route[route.length - 1]) : null,
    };
  }, [route, nodeIds]);

  return (
    <View style={styles.mapPanel}>
      <Svg width={MAP_W} height={MAP_H}>
        {drawn && (
          <G>
            {drawn.hexes.map((pts, i) => (
              <Polygon
                key={i}
                points={pts}
                fill={NEO.violet}
                fillOpacity={0.22}
                stroke={NEO.violet}
                strokeOpacity={0.55}
                strokeWidth={1}
              />
            ))}
            <Polyline
              points={drawn.line}
              fill="none"
              stroke={NEO.ink}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {drawn.start && (
              <Circle
                cx={drawn.start.x}
                cy={drawn.start.y}
                r={5}
                fill={NEO.white}
                stroke={NEO.ink}
                strokeWidth={2.5}
              />
            )}
            {drawn.end && (
              <Circle
                cx={drawn.end.x}
                cy={drawn.end.y}
                r={5.5}
                fill={NEO.yellow}
                stroke={NEO.ink}
                strokeWidth={2.5}
              />
            )}
          </G>
        )}
      </Svg>
    </View>
  );
}

// ── The card ─────────────────────────────────────────────────────────────────

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const RunShareCard = forwardRef<View, { data: RunShareData }>(function RunShareCard({ data }, ref) {
  const nodes = data.nodesConquered;

  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <View style={styles.head}>
        <View style={styles.brand}>
          <RunturfingLogo size={26} variant="compact" />
          <Text style={styles.brandWord}>RUNTURFING</Text>
        </View>
        <Text style={styles.date}>{formatCardDate(data.endedAt)}</Text>
      </View>

      <RouteMap route={data.route} nodeIds={data.nodeIds} />

      {/* The headline number. This is the one figure no other running app can
          print, so it gets the yellow slab and everything else gets a row. */}
      <View style={styles.nodeSlab}>
        <Text style={styles.nodeNumber}>{nodes}</Text>
        <Text style={styles.nodeLabel}>
          {nodes === 1 ? 'NODE CONQUERED' : 'NODES CONQUERED'}
        </Text>
      </View>

      <View style={styles.statRow}>
        <Stat value={formatDistance(data.distanceMeters)} label="KM" />
        <View style={styles.statDivider} />
        <Stat value={formatDuration(data.durationSeconds)} label="TIME" />
        <View style={styles.statDivider} />
        <Stat value={formatPace(data.distanceMeters, data.durationSeconds)} label="MIN/KM" />
      </View>

      <View style={styles.foot}>
        {data.rank ? (
          <>
            <RankInsignia
              code={data.rank.code}
              track={data.rank.track}
              stars={data.rank.stars}
              size="md"
            />
            <View style={styles.footText}>
              <Text style={styles.footName} numberOfLines={1}>{data.runnerName}</Text>
              <Text style={styles.footRank} numberOfLines={1}>{data.rank.name}</Text>
            </View>
          </>
        ) : (
          <View style={styles.footText}>
            <Text style={styles.footName} numberOfLines={1}>{data.runnerName}</Text>
            <Text style={styles.footRank}>UNRANKED</Text>
          </View>
        )}
      </View>
    </View>
  );
});

export default RunShareCard;

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: NEO.ink,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 22,
    justifyContent: 'space-between',
  },

  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandWord: {
    color: NEO.white,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.6,
  },
  date: {
    color: NEO.white,
    opacity: 0.6,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },

  mapPanel: {
    width: MAP_W,
    height: MAP_H,
    backgroundColor: NEO.surface,
    borderWidth: NEO.borderWidth,
    borderColor: NEO.black,
    ...NEO.shadowLg(NEO.yellow),
    overflow: 'hidden',
  },

  nodeSlab: {
    backgroundColor: NEO.yellow,
    borderWidth: NEO.borderWidth,
    borderColor: NEO.black,
    ...NEO.shadow(NEO.black),
    paddingVertical: 12,
    alignItems: 'center',
  },
  nodeNumber: {
    color: NEO.ink,
    fontSize: 62,
    lineHeight: 66,
    fontWeight: '900',
    letterSpacing: -2,
  },
  nodeLabel: {
    color: NEO.ink,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2.2,
    marginTop: 2,
  },

  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: NEO.surface,
    borderWidth: NEO.borderWidth,
    borderColor: NEO.black,
    ...NEO.shadow(NEO.black),
    paddingVertical: 12,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: {
    color: NEO.ink,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  statLabel: {
    color: NEO.ink,
    opacity: 0.62,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.6,
    marginTop: 3,
  },
  statDivider: { width: 2, alignSelf: 'stretch', backgroundColor: NEO.ink, opacity: 0.18 },

  foot: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  footText: { flex: 1 },
  footName: {
    color: NEO.white,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  footRank: {
    color: NEO.yellow,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.8,
    marginTop: 2,
    textTransform: 'uppercase',
  },
});
