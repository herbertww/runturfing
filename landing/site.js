/* =============================================================================
   Runturfing — shared site script.

   Two jobs: draw the mark, and pull the live school table off the public API.
   Both pages use it. No framework, no build step; this is served as static
   files and the only dynamic thing on it is one GET.
   ========================================================================== */

// Point this at the deployed API. /v1/institutions and /v1/institutions/standings
// are unauthenticated (Backend/api/middleware/auth_middleware.py SKIP_PATHS),
// which is what lets a page with no login read the table.
const API_BASE = window.RUNTURFING_API || 'https://runfluence-production.up.railway.app/v1';

/* ── The school list ────────────────────────────────────────────────────────
   Mirrors the seed in Backend/migrations/010_institutions_orientation_season.sql.
   The API is still the source of truth and wins whenever it answers; this is the
   fallback so a page can render its own headline without a network round trip.
   Names, slugs and colours are fixed data. No standings are kept here, because
   those are live numbers and a stale copy of them would be a lie. */

const SCHOOLS = [
  { slug: 'nus',     shortName: 'NUS',     name: 'National University of Singapore',             color: '#EF7C00' },
  { slug: 'ntu',     shortName: 'NTU',     name: 'Nanyang Technological University',             color: '#C8102E' },
  { slug: 'smu',     shortName: 'SMU',     name: 'Singapore Management University',              color: '#00539B' },
  { slug: 'sutd',    shortName: 'SUTD',    name: 'Singapore University of Technology and Design',color: '#7A1FA2' },
  { slug: 'sit',     shortName: 'SIT',     name: 'Singapore Institute of Technology',            color: '#D6001C' },
  { slug: 'suss',    shortName: 'SUSS',    name: 'Singapore University of Social Sciences',      color: '#00A0AF' },
  { slug: 'np',      shortName: 'NP',      name: 'Ngee Ann Polytechnic',                         color: '#005EB8' },
  { slug: 'nyp',     shortName: 'NYP',     name: 'Nanyang Polytechnic',                          color: '#00843D' },
  { slug: 'rp',      shortName: 'RP',      name: 'Republic Polytechnic',                         color: '#5B2D8E' },
  { slug: 'sp',      shortName: 'SP',      name: 'Singapore Polytechnic',                        color: '#E03C31' },
  { slug: 'tp',      shortName: 'TP',      name: 'Temasek Polytechnic',                          color: '#0091B3' },
  { slug: 'ite-c',   shortName: 'ITE-C',   name: 'ITE College Central',                          color: '#F2A900' },
  { slug: 'ite-e',   shortName: 'ITE-E',   name: 'ITE College East',                             color: '#8DB600' },
  { slug: 'ite-w',   shortName: 'ITE-W',   name: 'ITE College West',                             color: '#00758F' },
  { slug: 'nafa',    shortName: 'NAFA',    name: 'Nanyang Academy of Fine Arts',                 color: '#B5236F' },
  { slug: 'lasalle', shortName: 'LASALLE', name: 'LASALLE College of the Arts',                  color: '#E8541B' },
];

/** The live list when the API answers, the built-in one when it does not. */
async function loadSchools() {
  try {
    const res = await fetch(`${API_BASE}/institutions`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    const list = await res.json();
    return list.length ? list : SCHOOLS;
  } catch {
    return SCHOOLS;
  }
}

/* ── The mark ───────────────────────────────────────────────────────────────
   An H3 territory cell struck by a footfall, with the claim rippling into the
   cells around it. Same geometry as Android/src/components/RunturfingLogo.tsx;
   if one changes, change both. */

const CELL = 'M70,0 L35,60.6 L-35,60.6 L-70,0 L-35,-60.6 L35,-60.6 Z';
const RING_INNER = 'M108,0 L54,93.5 L-54,93.5 L-108,0 L-54,-93.5 L54,-93.5 Z';
const RING_OUTER = 'M145,0 L72.5,125.6 L-72.5,125.6 L-145,0 L-72.5,-125.6 L72.5,-125.6 Z';

function logoSvg({ variant = 'full', shadow = true } = {}) {
  const full = variant === 'full';
  const viewBox = full ? '-175 -170 350 340' : '-92 -88 184 176';
  const rings = full
    ? `<g fill="none" stroke="#1C293C" stroke-linejoin="round" stroke-linecap="round">
         <path d="${RING_OUTER}" stroke-width="7" stroke-dasharray="9 21"/>
         <path d="${RING_INNER}" stroke-width="11" stroke-dasharray="15 17"/>
       </g>`
    : '';
  // The mark carries fixed ink, not the theme's, because it is a logo: it has
  // to survive on a yellow button and on a dark band without being restyled.
  return `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Runturfing">
    ${rings}
    ${shadow ? `<path d="${CELL}" transform="translate(10,10)" fill="#111111"/>` : ''}
    <path d="${CELL}" fill="#FDC800" stroke="#1C293C" stroke-width="13" stroke-linejoin="round"/>
    <g transform="rotate(-30 1 8)" fill="#2563EB" stroke="#1C293C" stroke-width="5">
      <ellipse cx="0" cy="-22" rx="16" ry="32"/>
      <ellipse cx="0" cy="38" rx="11" ry="14"/>
    </g>
  </svg>`;
}

function mountLogos() {
  document.querySelectorAll('[data-logo]').forEach((el) => {
    el.innerHTML = logoSvg({ variant: el.dataset.logo || 'full', shadow: el.dataset.shadow !== 'false' });
  });
}

/* ── The hero field ─────────────────────────────────────────────────────────
   A tiled H3 grid behind the hero copy, with a scatter of held cells. Pure
   decoration, injected rather than written into the markup so the pages stay
   readable, and aria-hidden so it is never announced. The vignette in the CSS
   fades it out before it reaches the type. */

function heroFieldSvg() {
  const W = 1440, H = 720, R = 34;
  const dx = R * 1.5, dy = R * Math.sqrt(3) / 2;
  const hex = (cx, cy) => {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i);
      pts.push(`${(cx + R * Math.cos(a)).toFixed(1)},${(cy + R * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  };

  const outline = [];
  const filled = [];
  for (let col = 0; col * dx < W + R; col++) {
    for (let row = 0; row * (dy * 2) < H + R; row++) {
      const cx = col * dx;
      const cy = row * dy * 2 + (col % 2 ? dy : 0);
      // Deterministic scatter. A hash rather than Math.random, so the field is
      // identical on every load and does not shimmer between page views.
      const h = (col * 73856093) ^ (row * 19349663);
      const held = (h >>> 0) % 11;
      if (held === 0) filled.push(`<polygon points="${hex(cx, cy)}" fill="var(--ember)" opacity="0.22"/>`);
      else if (held === 1) filled.push(`<polygon points="${hex(cx, cy)}" fill="var(--teal)" opacity="0.16"/>`);
      outline.push(`<polygon points="${hex(cx, cy)}"/>`);
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"
               xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <g fill="none" stroke="var(--line)" stroke-width="1">${outline.join('')}</g>
    <g>${filled.join('')}</g>
  </svg>`;
}

// More than one now: the hero and the mechanic band both bleed the same field.
function mountHeroField() {
  const svg = heroFieldSvg();
  document.querySelectorAll('.hero-field').forEach((el) => { el.innerHTML = svg; });
}

/* ── Standings ────────────────────────────────────────────────────────────── */

function ordinal(n) {
  const m = n % 100;
  if (m >= 11 && m <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

async function fetchStandings() {
  const res = await fetch(`${API_BASE}/institutions/standings`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`standings ${res.status}`);
  const body = await res.json();
  return body.standings || [];
}

/**
 * Render the table into `mount`. `highlight` is a slug whose row gets marked,
 * used on the per-school join page.
 *
 * A school with no runners yet still renders, at the bottom with zeroes. The
 * empty rows are the point before launch: a student seeing their own school on
 * nought is the reason they send the link on.
 */
function renderStandings(mount, rows, highlight) {
  if (!rows.length) {
    mount.innerHTML = '<p class="table-status">No schools have entered yet.</p>';
    return;
  }

  const body = rows.map((s) => `
    <tr class="${s.slug === highlight ? 'is-you' : ''}">
      <td class="rank">${s.rank}</td>
      <td>
        <span class="swatch" style="background:${s.color}"></span>
        <span class="school-name">${s.shortName}</span>
      </td>
      <td class="num">${s.turfCells.toLocaleString()}</td>
      <td class="num">${s.activeRunners.toLocaleString()}</td>
      <td class="num">${Math.round(s.totalKm).toLocaleString()}</td>
    </tr>`).join('');

  mount.innerHTML = `
    <div class="scroll-x">
      <table class="standings">
        <thead>
          <tr>
            <th></th><th>School</th>
            <th class="num">Cells held</th>
            <th class="num">Runners</th>
            <th class="num">km</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="table-note">
      Ranked on total ground held, with distance breaking ties. Runner counts sit
      beside the score and take no part in it, so an extra entrant can never cost
      a school a place.
    </p>`;
}

async function mountStandings(selector, { highlight, limit } = {}) {
  const mount = document.querySelector(selector);
  if (!mount) return;
  mount.innerHTML = '<p class="table-status">Loading the school table…</p>';
  try {
    let rows = await fetchStandings();
    if (limit) rows = rows.slice(0, limit);
    renderStandings(mount, rows, highlight);
  } catch {
    // The API being unreachable must not leave a spinner running forever. Say
    // what happened and leave the rest of the page intact.
    mount.innerHTML =
      '<p class="table-status">The school table is not reachable right now. It goes live when the season opens.</p>';
  }
}

/* ── Institution list, for the school chips ───────────────────────────────── */

async function mountSchoolChips(selector) {
  const mount = document.querySelector(selector);
  if (!mount) return;
  const list = await loadSchools();
  mount.innerHTML = list.map((i) => `
    <a class="chip" href="/join/${i.slug}">
      <span class="dot" style="background:${i.color}"></span>${i.shortName}
    </a>`).join('');
}

/* ── Research carousel ────────────────────────────────────────────────────── */

/**
 * The track scrolls natively, so swipe, trackpad and keyboard all work with
 * this script absent. What it adds is auto-advance, dots and arrows.
 *
 * Auto-advance stops permanently the first time someone drives it themselves.
 * A carousel that keeps pulling itself along after the reader has taken hold
 * of it is worse than one that never moved, and it is the reason most people
 * say they hate carousels.
 */
function mountCarousel(root) {
  const track = root.querySelector('[data-carousel-track]');
  const dotWrap = root.querySelector('[data-carousel-dots]');
  const cards = track ? Array.from(track.children) : [];
  if (!track || cards.length < 2) return;

  const stillMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let index = 0;
  let timer = null;
  let live = !stillMotion;

  // Cards are a fixed width, so one step is card plus gap. Measured rather
  // than assumed, because the width is a clamp() and moves with the viewport.
  const step = () =>
    cards[1].getBoundingClientRect().left - cards[0].getBoundingClientRect().left;

  const dots = cards.map((_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'carousel-dot';
    b.setAttribute('aria-label', `Finding ${i + 1} of ${cards.length}`);
    b.addEventListener('click', () => { stop(); go(i); });
    dotWrap && dotWrap.appendChild(b);
    return b;
  });

  function paint() {
    dots.forEach((d, i) =>
      d.setAttribute('aria-current', i === index ? 'true' : 'false'));
  }

  function go(i) {
    index = (i + cards.length) % cards.length;
    track.scrollTo({ left: index * step(), behavior: 'smooth' });
    paint();
  }

  function stop() {
    live = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  function start() {
    if (!live || timer) return;
    timer = setInterval(() => go(index + 1), 4600);
  }

  // Any real input is a handover. Scroll is deliberately not in this list:
  // the auto-advance scrolls the track itself and would cancel itself out.
  ['pointerdown', 'touchstart', 'wheel', 'keydown'].forEach((ev) =>
    track.addEventListener(ev, stop, { passive: true, once: true }));

  root.querySelector('[data-carousel-prev]')
    ?.addEventListener('click', () => { stop(); go(index - 1); });
  root.querySelector('[data-carousel-next]')
    ?.addEventListener('click', () => { stop(); go(index + 1); });

  // Keep the index honest when the reader scrolls the track by hand.
  let settle;
  track.addEventListener('scroll', () => {
    clearTimeout(settle);
    settle = setTimeout(() => {
      const s = step();
      if (s > 0) { index = Math.round(track.scrollLeft / s); paint(); }
    }, 90);
  }, { passive: true });

  // Only run while it is on screen. Advancing a carousel nobody is looking at
  // burns battery and puts the reader back at slide 7 when they return.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      ([e]) => (e.isIntersecting ? start() : (timer && clearInterval(timer), timer = null)),
      { threshold: 0.35 }
    ).observe(root);
  } else {
    start();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (timer) { clearInterval(timer); timer = null; } }
    else start();
  });

  paint();
}

document.addEventListener('DOMContentLoaded', () => {
  mountLogos();
  mountHeroField();
  document.querySelectorAll('[data-carousel]').forEach(mountCarousel);
  document.documentElement.dataset.jsReady = 'true';
});
