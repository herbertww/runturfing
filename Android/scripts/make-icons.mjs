// Renders the Runturfing launcher icons from the same geometry as
// src/components/RunturfingLogo.tsx, so the app icon and the in-app mark can
// never drift apart. Run with: node scripts/make-icons.mjs
//
// Uses the `compact` variant (cell + footfall, no ripple rings) because the
// dashed rings break into specks below ~48px, which is most of an icon's life.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

const INK = '#1C293C';
const YELLOW = '#FDC800';
const BLUE = '#2563EB';
const BLACK = '#111111';

const CELL = 'M70,0 L35,60.6 L-35,60.6 L-70,0 L-35,-60.6 L35,-60.6 Z';

/** @param {{bg?: string, pad: number}} opts */
function markSvg({ bg, pad }) {
  // viewBox is sized so `pad` controls how much room the mark leaves at the
  // edges. Android masks adaptive icons hard, so the foreground needs far more
  // padding than the legacy square icon.
  const half = 70 + pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${-half} ${-half} ${half * 2} ${half * 2}">
  ${bg ? `<rect x="${-half}" y="${-half}" width="${half * 2}" height="${half * 2}" fill="${bg}"/>` : ''}
  ${
    // On the ink ground the cell's ink border and hard shadow are both
    // invisible, and the shadow only skews where the mark looks centred. The
    // yellow silhouette carries it alone.
    bg === INK
      ? `<path d="${CELL}" fill="${YELLOW}"/>`
      : `<path d="${CELL}" transform="translate(9,9)" fill="${BLACK}"/>
  <path d="${CELL}" fill="${YELLOW}" stroke="${INK}" stroke-width="13" stroke-linejoin="round"/>`
  }
  <g transform="rotate(-30 0 8)" fill="${BLUE}" stroke="${INK}" stroke-width="5">
    <ellipse cx="0" cy="-22" rx="16" ry="32"/>
    <ellipse cx="0" cy="38" rx="11" ry="14"/>
  </g>
</svg>`;
}

const targets = [
  // Legacy/iOS icon: full bleed on ink, no transparency allowed.
  { file: 'icon.png', svg: markSvg({ bg: INK, pad: 26 }), flatten: INK },
  // Android adaptive foreground: transparent, heavily padded for the mask.
  { file: 'adaptive-icon.png', svg: markSvg({ pad: 78 }), flatten: null },
];

for (const { file, svg, flatten } of targets) {
  let img = sharp(Buffer.from(svg)).resize(1024, 1024);
  if (flatten) img = img.flatten({ background: flatten });
  await img.png().toFile(join(OUT, file));
  console.log(`wrote ${file}`);
}

// The launcher icon Android actually shows is baked per-density into
// android/.../mipmap-*, normally by `expo prebuild`. We cannot run prebuild
// here without regenerating AndroidManifest.xml and losing the hand-added Maps
// API key, so write those files directly instead. Sizes match what prebuild
// produced. Keep this in step with any change to the mark above.
const RES = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src', 'main', 'res');
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

const squareSvg = markSvg({ bg: INK, pad: 26 });
const foregroundSvg = markSvg({ pad: 78 });

for (const [density, size] of Object.entries(DENSITIES)) {
  const dir = join(RES, `mipmap-${density}`);

  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    await sharp(Buffer.from(squareSvg))
      .resize(size, size)
      .flatten({ background: INK })
      .webp({ quality: 95 })
      .toFile(join(dir, `${name}.webp`));
  }

  // Adaptive foregrounds are 108dp on a 48dp grid, so 2.25x the square size.
  const fg = Math.round(size * 2.25);
  await sharp(Buffer.from(foregroundSvg))
    .resize(fg, fg)
    .webp({ quality: 95, alphaQuality: 100 })
    .toFile(join(dir, 'ic_launcher_foreground.webp'));

  console.log(`wrote mipmap-${density} (${size}px, fg ${fg}px)`);
}
