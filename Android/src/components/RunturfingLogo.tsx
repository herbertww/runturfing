import React from 'react';
import Svg, { Path, G, Ellipse } from 'react-native-svg';
import { NEO } from '../utils/theme';

/**
 * The mark is an H3 territory cell — the same hexagon the map draws when you
 * claim ground — struck by a single footfall, with the claim rippling outward
 * into the cells around it. Influence spreading from one runner to their
 * neighbours is the mechanic the name describes and the finding the intro
 * cites (Aral & Nicolaides, exercise contagion).
 *
 * `full`    — cell, footfall and both ripple rings. Needs ~64px and up.
 * `compact` — cell and footfall only, cropped tight. For the app icon, the tab
 *             bar, and anywhere the dashed rings would break up into specks.
 */
export type LogoVariant = 'full' | 'compact';

const CELL = 'M70,0 L35,60.6 L-35,60.6 L-70,0 L-35,-60.6 L35,-60.6 Z';
const RING_INNER = 'M108,0 L54,93.5 L-54,93.5 L-108,0 L-54,-93.5 L54,-93.5 Z';
const RING_OUTER = 'M145,0 L72.5,125.6 L-72.5,125.6 L-145,0 L-72.5,-125.6 L72.5,-125.6 Z';

// The foot is drawn toe-up and then rotated anticlockwise, so it strides into
// the top-left of the cell rather than standing square in it.
const FOOT_ROTATION = -30;
const FOOT_ORIGIN = { x: 1, y: 8 };

type Props = {
  size?: number;
  variant?: LogoVariant;
  cell?: string;
  foot?: string;
  ink?: string;
  /** Hard offset shadow, matching the 4px drop used across the UI. */
  shadow?: boolean;
};

export default function RunturfingLogo({
  size = 96,
  variant = 'full',
  cell = NEO.yellow,
  foot = NEO.blue,
  ink = NEO.ink,
  shadow = true,
}: Props) {
  const full = variant === 'full';
  const viewBox = full ? '-175 -170 350 340' : '-92 -88 184 176';

  return (
    <Svg width={size} height={size} viewBox={viewBox}>
      {full ? (
        <G fill="none" stroke={ink} strokeLinejoin="round" strokeLinecap="round">
          <Path d={RING_OUTER} strokeWidth={7} strokeDasharray="9 21" />
          <Path d={RING_INNER} strokeWidth={11} strokeDasharray="15 17" />
        </G>
      ) : null}

      {shadow ? <Path d={CELL} translate={[10, 10]} fill={NEO.black} /> : null}
      <Path d={CELL} fill={cell} stroke={ink} strokeWidth={13} strokeLinejoin="round" />

      <G
        rotation={FOOT_ROTATION}
        originX={FOOT_ORIGIN.x}
        originY={FOOT_ORIGIN.y}
        fill={foot}
        stroke={ink}
        strokeWidth={5}
      >
        {/* Forefoot and heel as separate pads, the footprint-in-sand
            pictogram. Roughly 3:1 long to wide — anything squatter stops
            reading as a foot and starts reading as two dots. */}
        <Ellipse cx={0} cy={-22} rx={16} ry={32} />
        <Ellipse cx={0} cy={38} rx={11} ry={14} />
      </G>
    </Svg>
  );
}
