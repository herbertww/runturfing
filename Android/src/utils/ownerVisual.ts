import { NEO } from './theme';

/**
 * A stable colour and letter per cell holder.
 *
 * The map colours cells by achievement state, which answers "how contested is
 * this ground" but never "whose is it". Two rivals holding adjacent blocks look
 * identical. This gives each holder a fixed identity so a patch reads as a
 * person, and it is derived from the user id rather than assigned in order, so
 * someone keeps their colour between sessions and between devices.
 *
 * Hues are picked to separate on the warm paper map. Ink is reserved for you.
 */
const PALETTE = [
  NEO.violet,
  NEO.green,
  NEO.blue,
  NEO.red,
  NEO.amber,
  '#0E7490', // teal
  '#BE185D', // magenta
  '#4338CA', // indigo
];

/** FNV-1a. Small, stable, and does not clump on sequential ids. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface OwnerVisual {
  color: string;
  initial: string;
}

export function ownerVisual(userId?: string, displayName?: string): OwnerVisual {
  const id = userId ?? '';
  const name = (displayName ?? '').trim();
  return {
    color: PALETTE[hash(id) % PALETTE.length],
    // A letter is legible at 18px where an avatar is not, and it needs no
    // network fetch — which matters when the whole point is a map that paints
    // with no signal.
    initial: name ? name.charAt(0).toUpperCase() : '?',
  };
}
