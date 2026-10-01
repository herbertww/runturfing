// Renders the Runturfing launch screen from the same geometry as
// src/components/RunturfingLogo.tsx, over the riso ripple plate used behind
// the mark on the intro finale. Run with: node scripts/make-splash.mjs
//
// Two outputs:
//   assets/splash.png                    — what app.json points at (iOS, and
//                                          any EAS build that runs prebuild).
//   android/.../drawable-*/splashscreen_logo.png
//                                        — what a local Android build shows.
//                                          Normally written by `expo prebuild`,
//                                          which we cannot run without losing
//                                          the hand-added Maps API key. Same
//                                          reason make-icons.mjs writes mipmaps.
//
// Safe-area note: Android 12+ passes windowSplashScreenAnimatedIcon through a
// circular mask, so nothing may sit near the corners. Expo contains our image
// into 200dp on a 288dp canvas; the mask keeps a centred circle of the canvas.
// Everything below is kept inside SAFE_RADIUS of the 1024px master, which is
// well inside the tightest mask any OEM applies.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');

const PAPER = '#FBFBF9';
const INK = '#1C293C';
const YELLOW = '#FDC800';
const BLUE = '#2563EB';
const BLACK = '#111111';

const SIZE = 1024;
const SAFE_RADIUS = 390;

// Riso plate: the ripple print's outer dashed ring sits at ~0.42 of its own
// width from centre, so this width lands it around r=353 — inside the safe
// circle with room for the alpha ramp to finish before the mask bites.
const PLATE_WIDTH = 840;
const PLATE_FADE = 0.45; // fraction of PLATE_WIDTH where the plate is fully gone
const PLATE_INK = 0.38; // strongest alpha at the centre of the plate

// The `compact` mark — cell and footfall, no drawn rings. The print already
// carries a ripple, and stacking the drawn rings on top of it turned the
// centre into three concentric dashed outlines with no clear subject.
const LOGO_WIDTH = 460;

const CELL = 'M70,0 L35,60.6 L-35,60.6 L-70,0 L-35,-60.6 L35,-60.6 Z';

// Matches the `compact` variant: viewBox -92 -88 184 176.
const LOGO_HEIGHT = Math.round((LOGO_WIDTH * 176) / 184);
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" viewBox="-92 -88 184 176">
  <path d="${CELL}" transform="translate(10,10)" fill="${BLACK}"/>
  <path d="${CELL}" fill="${YELLOW}" stroke="${INK}" stroke-width="13" stroke-linejoin="round"/>
  <g transform="rotate(-30 0 8)" fill="${BLUE}" stroke="${INK}" stroke-width="5">
    <ellipse cx="0" cy="-22" rx="16" ry="32"/>
    <ellipse cx="0" cy="38" rx="11" ry="14"/>
  </g>
</svg>`;

// dest-in multiplies the plate's alpha by this mask, so the ramp and the
// overall knock-down happen in one pass. The plate carries its own cream
// paper, a shade warmer than our surface, and a hard square edge would show
// against it — the ramp is what keeps the print bleeding into the page.
const plateMaskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PLATE_WIDTH}" height="${PLATE_WIDTH}">
  <defs>
    <radialGradient id="ramp" cx="50%" cy="50%" r="${PLATE_FADE * 100}%">
      <stop offset="0" stop-color="#fff" stop-opacity="${PLATE_INK}"/>
      <stop offset="0.72" stop-color="#fff" stop-opacity="${PLATE_INK}"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${PLATE_WIDTH}" height="${PLATE_WIDTH}" fill="url(#ramp)"/>
</svg>`;

// Cell half-width plus half its stroke plus the hard shadow offset.
const markReach = (LOGO_WIDTH / 184) * (70 + 6.5 + 10);
const plateReach = (PLATE_WIDTH / 2) * PLATE_FADE;
if (Math.max(markReach, plateReach) > SAFE_RADIUS) {
  throw new Error(
    `content reaches ${Math.round(Math.max(markReach, plateReach))}px, past the ${SAFE_RADIUS}px safe radius`
  );
}

const plate = await sharp(join(ASSETS, 'texture-ripple.png'))
  .resize(PLATE_WIDTH, PLATE_WIDTH, { fit: 'cover' })
  .composite([{ input: Buffer.from(plateMaskSvg), blend: 'dest-in' }])
  .png()
  .toBuffer();

const logo = await sharp(Buffer.from(logoSvg)).png().toBuffer();

const centred = (w) => Math.round((SIZE - w) / 2);

const master = await sharp({
  create: { width: SIZE, height: SIZE, channels: 4, background: PAPER },
})
  .composite([
    { input: plate, left: centred(PLATE_WIDTH), top: centred(PLATE_WIDTH) },
    { input: logo, left: centred(LOGO_WIDTH), top: centred(LOGO_HEIGHT) },
  ])
  .png()
  .toBuffer();

await sharp(master).toFile(join(ASSETS, 'splash.png'));
console.log('wrote assets/splash.png');

// Per-density drawables, mirroring what @expo/prebuild-config produces: the
// image contained into 200dp, centred on a 288dp canvas of the splash
// background colour. Keep these numbers in step with app.json.
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const CANVAS_DP = 288;
const IMAGE_DP = 200;

for (const [density, multiplier] of Object.entries(DENSITIES)) {
  const canvas = Math.round(CANVAS_DP * multiplier);
  const image = Math.round(IMAGE_DP * multiplier);
  const foreground = await sharp(master).resize(image, image).png().toBuffer();

  await sharp({
    create: { width: canvas, height: canvas, channels: 4, background: PAPER },
  })
    .composite([
      {
        input: foreground,
        left: Math.round((canvas - image) / 2),
        top: Math.round((canvas - image) / 2),
      },
    ])
    .png()
    .toFile(join(RES, `drawable-${density}`, 'splashscreen_logo.png'));

  console.log(`wrote drawable-${density}/splashscreen_logo.png (${canvas}px canvas, ${image}px mark)`);
}
