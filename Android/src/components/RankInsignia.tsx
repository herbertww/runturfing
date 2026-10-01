import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, G, Path, Polygon, Rect } from 'react-native-svg';
import { NEO } from '../utils/theme';
import { RankTrack } from '../types';

/**
 * Rank insignia, drawn to the real SAF structure.
 *
 * Sources: MINDEF's rank insignia page and the SAF ranks article. The shapes
 * are simplified into the app's flat ink-and-slab language, but the *grammar*
 * is the SAF's, not invented:
 *
 *   enlisted        downward chevrons, 1-3. Recruits and privates wear none.
 *   specialist      three downward chevrons at 3SG, then upward chevrons added
 *                   above for seniority; the state crest sits between the two
 *                   groups at staff level (SSG, MSG).
 *   warrant         state crest over an arc, with chevrons; CWO adds a laurel.
 *   company officer bars, 1-3. Not pips — the SAF does not use the Commonwealth
 *                   pip, and drawing squares here was simply wrong.
 *   field officer   state crests, 1-3 ("crabs"). SLTC is two crests + laurels.
 *   general         stars, 1-4.
 *
 * The crest is NOT the Singapore state crest. Using a national coat of arms to
 * decorate a running app's vanity ladder misrepresents the app as having some
 * official standing, so the shield holds a runner instead — one per crest, which
 * makes the field ranks a count of them: Major one, Colonel three.
 *
 * TWO DRAWINGS, NOT ONE SCALED DOWN. A Chief Warrant Officer is a crest over
 * four chevrons over an arc, wrapped in laurels. At list size that is a smear,
 * so those drop to a single band glyph. Officer marks do not: one to four
 * elements in a row stay legible at 15px, and reducing them lost the count —
 * every company officer drew one bar and a Captain read as a First Lieutenant.
 *
 * EVERY MARK IS FITTED, NOT DROPPED INTO A FIXED FIELD. The drawings differ
 * wildly in how much of the field they cover — a Major's single crest is 50
 * units tall, a Master Sergeant's stack is 148 — so drawing them all into one
 * 150-unit field made the same chip render marks at three times each other's
 * size. Each mark now reports its ink bounds and is scaled to a common
 * perceived size before it is centred. The measure is the geometric mean of
 * the bounds, not the height: a chevron is wide and short, a crest is tall and
 * narrow, and matching either dimension alone leaves one of them looking twice
 * the other. FIT_G is set so the specialist chevron band lands exactly where it
 * already sat, since that size was the one that read correctly.
 *
 * TWO PAIRS SHARE A SHAPE, FAITHFULLY. Recruit and Private both wear no
 * insignia, and Corporal First Class and Third Sergeant are both three downward
 * chevrons — the SAF separates those by backing and colour, not by shape. The
 * abbreviation is always present and is what tells them apart here, which is
 * also why it is the accessible label and the mark is only reinforcement.
 */

interface Spec {
  /** Downward-pointing chevrons, drawn below the crest. */
  down?: number;
  /** Upward-pointing chevrons, drawn above the crest. */
  up?: number;
  /** The state crest, between the chevron groups. */
  crest?: boolean;
  /** State crests in a row — field officers. */
  crests?: number;
  /** Horizontal bars — company officers. */
  bars?: number;
  /** Stars in a row — generals. */
  stars?: number;
  /** The arc beneath a warrant officer's chevrons. */
  arc?: boolean;
  /** Flanking laurels — CWO and SLTC. */
  laurel?: boolean;
  /** A single upright stripe. Unused since the cadet rank was dropped; kept so
   *  an unknown code from the server still draws something. */
  stripe?: boolean;
  /** 3WO's chevron is thinner than the ranks above it. */
  thin?: boolean;
}

const SPECS: Record<string, Spec> = {
  // Enlisted. Recruits and privates wear no insignia, and inventing one for
  // them would be the most obvious tell that these were guessed.
  REC: {},
  PTE: {},
  LCP: { down: 1 },
  CPL: { down: 2 },
  CFC: { down: 3 },

  // Specialist. Three downward chevrons is the floor; seniority is added above
  // as upward chevrons, with the crest appearing between them at staff level.
  '3SG': { down: 3 },
  '2SG': { down: 3, up: 1 },
  '1SG': { down: 3, up: 2 },
  SSG: { down: 3, crest: true, up: 1 },
  MSG: { down: 3, crest: true, up: 2 },

  // Warrant. Crest above, arc below, chevrons between.
  '3WO': { crest: true, up: 1, arc: true, thin: true },
  '2WO': { crest: true, up: 1, arc: true },
  '1WO': { crest: true, up: 2, arc: true },
  MWO: { crest: true, up: 3, arc: true },
  SWO: { crest: true, up: 4, arc: true },
  CWO: { crest: true, up: 4, arc: true, laurel: true },

  // Commissioned. Bars count up with the rank, then crests, then stars. No
  // cadet rung: clearing the gate puts a runner on the ladder proper.
  '1LT': { bars: 1 },
  '2LT': { bars: 2 },
  CPT: { bars: 3 },
  MAJ: { crests: 1 },
  LTC: { crests: 2 },
  SLTC: { crests: 2, laurel: true },
  COL: { crests: 3 },
  BG: { stars: 1 },
  MG: { stars: 2 },
  LG: { stars: 3 },
  GEN: { stars: 4 },
};

// Marks are authored in a 100-wide, 150-tall space, then fitted into a square
// field. The authoring space only sets each mark's internal proportions now;
// how large it ends up is decided by the fit, not by how much of this space it
// happens to fill.
const MID_X = 50;
const MID_Y = 75;

// The square field every fitted mark is centred in.
const FIELD = 150;
const FIELD_MID = FIELD / 2;

// Fit limits, in field units. FIT_G is the target geometric mean of a mark's
// ink bounds — the perceived-size target. FIT_W and FIT_H are hard caps for
// marks too wide or tall to reach it, which is every long row: four stars and a
// single officer's bar run out of width before they run out of mass.
const FIT_W = 132;
const FIT_H = 132;
const FIT_G = 90;

const CHEV_RISE = 17;
const CHEV_THICK = 11;
const CHEV_H = CHEV_RISE + CHEV_THICK;
const CHEV_PITCH = 14;
const CREST_H = 36;
const CREST_W = 30;
const BAR_H = 11;
const BAR_PITCH = 17;
const ARC_H = 16;
const GAP = 7;

/** Chevron with its apex up, occupying [y, y + CHEV_H]. */
function upChevron(y: number, thick = CHEV_THICK): string {
  return [
    `8,${y + CHEV_RISE}`, `${MID_X},${y}`, `92,${y + CHEV_RISE}`,
    `92,${y + CHEV_RISE + thick}`, `${MID_X},${y + thick}`, `8,${y + CHEV_RISE + thick}`,
  ].join(' ');
}

/** Chevron with its apex down, occupying [y, y + CHEV_H]. */
function downChevron(y: number, thick = CHEV_THICK): string {
  return [
    `8,${y}`, `${MID_X},${y + CHEV_RISE}`, `92,${y}`,
    `92,${y + thick}`, `${MID_X},${y + CHEV_RISE + thick}`, `8,${y + thick}`,
  ].join(' ');
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Collects shapes and the bounds of the ink they lay down.
 *
 * Bounds are declared by the caller rather than measured, because react-native-svg
 * gives no way to measure a path and the shapes here all know their own extents.
 * Strokes count: an arc drawn at width 9 sticks out 4.5 past its path, and
 * leaving that out let the laurels clip against the field edge.
 */
function inkCollector() {
  const nodes: React.ReactNode[] = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;

  return {
    nodes,
    add(node: React.ReactNode, box: Box) {
      nodes.push(node);
      x0 = Math.min(x0, box.x);
      y0 = Math.min(y0, box.y);
      x1 = Math.max(x1, box.x + box.w);
      y1 = Math.max(y1, box.y + box.h);
    },
    box(): Box | null {
      if (!(x1 > x0 && y1 > y0)) return null;
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },
  };
}

/** Where a chevron's ink sits: full width, apex to trailing edge. */
function chevronBox(y: number, thick: number): Box {
  return { x: 8, y, w: 84, h: CHEV_RISE + thick };
}

/** Where a crest's ink sits. Height follows width — the shield is fixed 30:36. */
function crestBox(cx: number, cy: number, w: number): Box {
  const h = 36 * (w / 30);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * A five-pointed star's bounds are not its radius square: it is 1.902r across
 * the outer points and 1.809r from apex to the flat below.
 */
function starBox(cx: number, cy: number, r: number): Box {
  return { x: cx - 0.951 * r, y: cy - r, w: 1.902 * r, h: 1.809 * r };
}

function starPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.42;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + radius * Math.cos(a)).toFixed(2)},${(cy + radius * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

/**
 * The crest: a shield holding a runner.
 *
 * Deliberately NOT the Singapore state crest. Borrowing a national coat of arms
 * for a running app's vanity ladder is a real emblem used decoratively, and it
 * misrepresents the app as carrying some official standing. So the shield holds
 * the thing the ladder is actually about — someone running.
 *
 * One runner per crest, which means the field ranks read as a count of them:
 * Major is one, Lieutenant Colonel two, Colonel three.
 *
 * The figure is knocked out in the ground colour rather than outlined, because
 * a 1-unit outline disappears under 40px and the shield turns into a blob.
 * Everything is a thick round-capped stroke for the same reason.
 */
function Crest({
  cx, cy, w, figure, ground,
}: { cx: number; cy: number; w: number; figure: string; ground: string }) {
  const s = w / 30;
  const h = 36 * s;
  const halfW = w / 2;
  const top = cy - h / 2;
  const shoulder = top + h * 0.62;

  // Shield: flat shoulders, curved sides falling to a point.
  const shield =
    `M${cx - halfW},${top} L${cx + halfW},${top} L${cx + halfW},${shoulder} ` +
    `Q${cx + halfW},${cy + h * 0.42} ${cx},${cy + h / 2} ` +
    `Q${cx - halfW},${cy + h * 0.42} ${cx - halfW},${shoulder} Z`;

  // Runner, built around the shield's optical centre — slightly above the
  // geometric one, because the shield's point drags the eye down.
  const rx = cx - 0.5 * s;
  const ry = top + h * 0.42;
  const limb = 3.1 * s;

  return (
    <G>
      <Path d={shield} fill={figure} />
      {/* Head */}
      <Circle cx={rx + 1.5 * s} cy={ry - 7.5 * s} r={2.6 * s} fill={ground} />
      {/* Torso, leaning into the stride */}
      <Path
        d={`M${rx - 0.5 * s},${ry - 4.4 * s} L${rx + 1.6 * s},${ry + 0.6 * s}`}
        stroke={ground} strokeWidth={limb} strokeLinecap="round" fill="none"
      />
      {/* Leading leg forward, trailing leg back — the silhouette that reads as
          running rather than standing. */}
      <Path
        d={`M${rx + 1.6 * s},${ry + 0.6 * s} L${rx + 5.6 * s},${ry + 3.2 * s}`}
        stroke={ground} strokeWidth={limb} strokeLinecap="round" fill="none"
      />
      <Path
        d={`M${rx + 1.6 * s},${ry + 0.6 * s} L${rx - 3.6 * s},${ry + 4.4 * s}`}
        stroke={ground} strokeWidth={limb} strokeLinecap="round" fill="none"
      />
      {/* Arms, counter-swung */}
      <Path
        d={`M${rx + 0.4 * s},${ry - 3.2 * s} L${rx + 5.2 * s},${ry - 4.6 * s}`}
        stroke={ground} strokeWidth={limb * 0.85} strokeLinecap="round" fill="none"
      />
      <Path
        d={`M${rx + 0.4 * s},${ry - 3.2 * s} L${rx - 4.2 * s},${ry - 1.0 * s}`}
        stroke={ground} strokeWidth={limb * 0.85} strokeLinecap="round" fill="none"
      />
    </G>
  );
}

/** Flanking laurels. CWO and SLTC. */
function Laurel({ color }: { color: string }) {
  return (
    <G>
      <Path
        d={`M26,${MID_Y - 46} Q0,${MID_Y} 26,${MID_Y + 46}`}
        stroke={color}
        strokeWidth={7}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d={`M74,${MID_Y - 46} Q100,${MID_Y} 74,${MID_Y + 46}`}
        stroke={color}
        strokeWidth={7}
        fill="none"
        strokeLinecap="round"
      />
    </G>
  );
}

/** The full insignia, stacked. Returns its shapes and the bounds of their ink. */
function fullMark(spec: Spec, figure: string, ground: string) {
  const ink = inkCollector();

  if (spec.stripe) {
    ink.add(
      <Rect key="stripe" x={40} y={MID_Y - 45} width={20} height={90} fill={figure} />,
      { x: 40, y: MID_Y - 45, w: 20, h: 90 }
    );
  }

  if (spec.stars) {
    const n = spec.stars;
    const r = n <= 2 ? 24 : 13;
    const pitch = n <= 2 ? 52 : 26;
    const x0 = MID_X - ((n - 1) * pitch) / 2;
    for (let i = 0; i < n; i++) {
      const cx = x0 + i * pitch;
      ink.add(
        <Polygon key={`s${i}`} points={starPoints(cx, MID_Y, r)} fill={figure} />,
        starBox(cx, MID_Y, r)
      );
    }
  }

  if (spec.bars) {
    const n = spec.bars;
    const total = (n - 1) * BAR_PITCH + BAR_H;
    let y = MID_Y - total / 2;
    for (let i = 0; i < n; i++) {
      ink.add(
        <Rect key={`b${i}`} x={15} y={y + i * BAR_PITCH} width={70} height={BAR_H} fill={figure} />,
        { x: 15, y: y + i * BAR_PITCH, w: 70, h: BAR_H }
      );
    }
  }

  // Field officers: crests side by side, shrinking as they multiply so three
  // still fit the width without touching.
  if (spec.crests) {
    const n = spec.crests;
    const w = n === 1 ? 42 : n === 2 ? 34 : 28;
    const pitch = w + 4;
    const x0 = MID_X - ((n - 1) * pitch) / 2;
    for (let i = 0; i < n; i++) {
      const cx = x0 + i * pitch;
      ink.add(
        <Crest key={`c${i}`} cx={cx} cy={MID_Y} w={w} figure={figure} ground={ground} />,
        crestBox(cx, MID_Y, w)
      );
    }
  }

  // Specialist and warrant: up chevrons, crest, down chevrons, arc — measured
  // as one block and then centred, so every rank sits on the same midline.
  const hasStack = spec.up || spec.down || spec.crest || spec.arc;
  if (hasStack) {
    const up = spec.up ?? 0;
    const down = spec.down ?? 0;
    const thick = spec.thin ? 7 : CHEV_THICK;
    const upBlock = up > 0 ? (up - 1) * CHEV_PITCH + CHEV_RISE + thick : 0;
    const crestBlock = spec.crest ? CREST_H : 0;
    const downBlock = down > 0 ? (down - 1) * CHEV_PITCH + CHEV_H : 0;
    const arcBlock = spec.arc ? ARC_H : 0;
    const gaps = [upBlock, crestBlock, downBlock, arcBlock].filter(Boolean).length - 1;
    const total = upBlock + crestBlock + downBlock + arcBlock + Math.max(0, gaps) * GAP;

    let y = MID_Y - total / 2;

    for (let i = 0; i < up; i++) {
      const cy = y + i * CHEV_PITCH;
      ink.add(
        <Polygon key={`u${i}`} points={upChevron(cy, thick)} fill={figure} />,
        chevronBox(cy, thick)
      );
    }
    if (upBlock) y += upBlock + GAP;

    if (spec.crest) {
      ink.add(
        <Crest key="crest" cx={MID_X} cy={y + CREST_H / 2} w={CREST_W} figure={figure} ground={ground} />,
        crestBox(MID_X, y + CREST_H / 2, CREST_W)
      );
      y += CREST_H + GAP;
    }

    for (let i = 0; i < down; i++) {
      const cy = y + i * CHEV_PITCH;
      ink.add(
        <Polygon key={`d${i}`} points={downChevron(cy)} fill={figure} />,
        chevronBox(cy, CHEV_THICK)
      );
    }
    if (downBlock) y += downBlock + GAP;

    if (spec.arc) {
      // The quadratic's apex sits half way to its control point, and the stroke
      // adds 4.5 on every side.
      ink.add(
        <Path
          key="arc"
          d={`M12,${y} Q${MID_X},${y + ARC_H * 1.6} 88,${y}`}
          stroke={figure}
          strokeWidth={9}
          fill="none"
          strokeLinecap="round"
        />,
        { x: 7.5, y: y - 4.5, w: 85, h: ARC_H * 0.8 + 9 }
      );
    }
  }

  // Laurels bow inward, so their ink starts well short of the control points
  // they are drawn with.
  if (spec.laurel) {
    ink.add(<Laurel key="laurel" color={figure} />, {
      x: 9.5,
      y: MID_Y - 49.5,
      w: 81,
      h: 99,
    });
  }

  return { nodes: ink.nodes, box: ink.box() };
}

type Band = 'down' | 'up' | 'crest' | 'bar' | 'star' | null;

/**
 * Which band a rank sits in, for ranks whose full mark cannot survive list
 * size. Warrant and field officer both show a crest, but they never collide:
 * one sits on the ink slab and the other on the yellow one.
 *
 * Officer ranks are NOT reduced this way. Their marks are a countable one to
 * four elements in a row or column, which stay legible at 15px — and collapsing
 * them lost the count, so every company officer drew a single bar and a Captain
 * was indistinguishable from a First Lieutenant.
 */
function bandOf(spec: Spec): Band {
  if (spec.arc) return 'crest';
  if (spec.up) return 'up';
  if (spec.down) return 'down';
  return null;
}

/** True when the full mark is simple enough to draw at list size. */
function survivesSmall(spec: Spec): boolean {
  return Boolean(spec.bars || spec.stars || spec.crests || spec.stripe);
}

/**
 * The reduced glyph, with its bounds. The sizes written here only set each
 * glyph's proportions — the fit decides how big it is drawn, which is what
 * stopped the warrant crest from towering over the specialist chevron it sits
 * beside in the same list.
 */
function bandMark(band: Band, figure: string, ground: string) {
  switch (band) {
    case 'star':
      return {
        nodes: <Polygon points={starPoints(MID_X, MID_X, 46)} fill={figure} />,
        box: starBox(MID_X, MID_X, 46),
      };
    case 'crest':
      return {
        nodes: <Crest cx={MID_X} cy={MID_X} w={72} figure={figure} ground={ground} />,
        box: crestBox(MID_X, MID_X, 72),
      };
    case 'bar':
      return {
        nodes: <Rect x={4} y={38} width={92} height={24} fill={figure} />,
        box: { x: 4, y: 38, w: 92, h: 24 },
      };
    case 'up':
      return {
        nodes: <Polygon points={upChevron(28, 26)} fill={figure} />,
        box: chevronBox(28, 26),
      };
    case 'down':
      return {
        nodes: <Polygon points={downChevron(28, 26)} fill={figure} />,
        box: chevronBox(28, 26),
      };
    default:
      return { nodes: null, box: null };
  }
}

/**
 * How much to scale a mark, and where to put it, so every rank reads at one
 * size. The geometric mean is the perceived-size measure; the width and height
 * caps stop a long row of stars from running off the field trying to reach it.
 */
function fitTransform(box: Box): string {
  const k = Math.min(FIT_W / box.w, FIT_H / box.h, FIT_G / Math.sqrt(box.w * box.h));
  const tx = FIELD_MID - k * (box.x + box.w / 2);
  const ty = FIELD_MID - k * (box.y + box.h / 2);
  return `translate(${tx.toFixed(2)}, ${ty.toFixed(2)}) scale(${k.toFixed(4)})`;
}

const MARK_H = { sm: 15, md: 26, lg: 40 } as const;

export default function RankInsignia({
  code,
  track,
  stars = 0,
  size = 'md',
}: {
  code: string;
  track: RankTrack;
  /** Only used if `code` is one the ladder does not know, so a rank added on
   *  the server still draws something rather than nothing. */
  stars?: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  const officer = track === 'officer';
  const scale = size === 'lg' ? 1.35 : size === 'sm' ? 0.8 : 1;
  const spec = SPECS[code] ?? (stars > 0 ? { stars } : {});

  // Ink marks on the yellow officer slab, paper marks on the ink one. Both
  // pairings clear AA by a wide margin, which is what lets the mark carry
  // weight at list size — and the ground colour is what the crest knockouts
  // are punched in, so it has to be the real background.
  const ground = officer ? NEO.yellow : NEO.ink;
  const figure = officer ? NEO.ink : NEO.surface;

  // At list size the deep chevron stacks collapse to a band glyph, but the
  // officer marks keep their real count — losing it made every company officer
  // draw one bar.
  const full = size !== 'sm' || survivesSmall(spec);
  const mark = full ? fullMark(spec, figure, ground) : bandMark(bandOf(spec), figure, ground);
  const h = MARK_H[size];

  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: ground, paddingHorizontal: 7 * scale, paddingVertical: 4 * scale },
      ]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Rank ${code}`}
    >
      {mark.box && (
        <Svg width={h} height={h} viewBox={`0 0 ${FIELD} ${FIELD}`}>
          <G transform={fitTransform(mark.box)}>{mark.nodes}</G>
        </Svg>
      )}
      <Text style={[styles.code, { color: figure, fontSize: 13 * scale }]}>{code}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 2,
    borderColor: NEO.ink,
    alignSelf: 'flex-start',
  },
  code: { fontWeight: '900', letterSpacing: 1 },
});
