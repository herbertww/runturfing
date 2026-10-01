import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, Circle, Rect, RadialGradient, Stop, Mask } from 'react-native-svg';

/**
 * A halftone dot screen — the print artifact neubrutalism inherits from riso
 * and newsprint. Dots are a tiled SVG pattern (one node, tiled on the GPU)
 * masked by a radial gradient, so density falls off the way real tonal
 * screening does instead of reading as a flat grid of dots.
 *
 * Sits behind content and is deliberately quiet: the mark and the headline are
 * meant to carry each slide, and a full-strength screen would fight both.
 */
type Props = {
  /** Must be unique per mounted instance — SVG def ids collide otherwise. */
  id: string;
  color: string;
  /** Dot grid pitch in px. Larger reads coarser and more newsprint-like. */
  pitch?: number;
  /** Dot radius as a fraction of pitch. Above ~0.42 the dots start to touch. */
  weight?: number;
  opacity?: number;
  /** Where the screen is densest, as a fraction of the field. */
  originX?: string;
  originY?: string;
};

export default function HalftoneField({
  id,
  color,
  pitch = 13,
  weight = 0.3,
  opacity = 0.5,
  originX = '78%',
  originY = '24%',
}: Props) {
  const dotId = `dots-${id}`;
  const fadeId = `fade-${id}`;
  const maskId = `mask-${id}`;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" opacity={opacity}>
        <Defs>
          <Pattern id={dotId} width={pitch} height={pitch} patternUnits="userSpaceOnUse">
            <Circle cx={pitch / 2} cy={pitch / 2} r={pitch * weight} fill={color} />
          </Pattern>

          <RadialGradient id={fadeId} cx={originX} cy={originY} r="72%">
            <Stop offset="0" stopColor="#fff" stopOpacity="1" />
            <Stop offset="0.55" stopColor="#fff" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#fff" stopOpacity="0" />
          </RadialGradient>

          <Mask id={maskId}>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${fadeId})`} />
          </Mask>
        </Defs>

        <Rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill={`url(#${dotId})`}
          mask={`url(#${maskId})`}
        />
      </Svg>
    </View>
  );
}
