# landing/ — the Runturfing website

Static files. No build step, no dependencies. Serve the directory as-is.

| File | What it is |
|---|---|
| `index.html` | Home. The general pitch: territory, influence, rank, seasons. Orientation is a teaser at the bottom. |
| `orientation.html` | The orientation season, served at `/orientation`. Scoring rule, the board, school links. |
| `school.html` | Per-school page behind `/join/<slug>`. Reads the slug off the path. Not named `join.html`: Workers static assets map `/join` onto `join.html` automatically, and that fires before `_redirects`, so `/join/nus` lost its slug. |
| `site.css` | Shared styles. Same tokens as the app (`Android/src/utils/theme.ts`). |
| `site.js` | The logo, and the two public API calls. |
| `_redirects` | Rewrites `/join/*` onto `school.html`. Workers static assets, Pages and Netlify all read this. |
| `wrangler.jsonc` | Assets-only Worker config. No `main`, so there is no script to cold-start. |
| `.assetsignore` | Keeps the config and these notes from being served as part of the site. |
| `splash.html` | The older dark-theme splash, kept for reference. Not linked from the site. |

## The API it talks to

Two endpoints, both unauthenticated (see `SKIP_PATHS` in
`Backend/api/middleware/auth_middleware.py`):

- `GET /v1/institutions` — the school list
- `GET /v1/institutions/standings` — the school table

`site.js` defaults `API_BASE` to the Railway deployment. To point it elsewhere,
set `window.RUNTURFING_API` before loading the script:

```html
<script>window.RUNTURFING_API = 'http://localhost:8000/v1';</script>
<script src="/site.js"></script>
```

The backend must allow the site's origin in `ALLOWED_ORIGINS` (`Backend/.env`),
or the browser will block both calls. Every page renders without them; the
tables fall back to a line of text rather than an empty box.

## Running it locally

```bash
python3 -m http.server 8080 --directory landing
```

`/join/<slug>` will 404 under `http.server`, which has no rewrite support. Use
`/school.html?school=nus` when testing locally; both forms work in `school.html`.

## Deploying

Cloudflare Workers, from this directory:

```bash
cd landing && npx wrangler deploy
```

Live at https://runturfing.herbert-ww.workers.dev. `_redirects` is read as
config rather than uploaded as a file.

Cloudflare Pages also works, with the repo connected: no build command, output
directory `landing`.

## Two gotchas worth knowing before editing

- **`.wrap` and shorthand `padding`.** Several elements are both a `.wrap` and
  something with its own vertical padding. Use `padding-block` on those. A
  `padding: X 0 Y` shorthand has the same specificity as `.wrap` and comes
  later, so it silently zeroes the horizontal padding and the copy runs to the
  screen edge on narrow viewports.
- **Rewrite targets are canonical paths.** `_redirects` points `/join/*` at
  `/school`, not `/school.html`. Workers canonicalises `.html` URLs with a
  redirect, and that redirect throws the slug away.

## The design

Dark ink ground, ember and teal accents, and mono microtype from the original
splash; square corners, structural borders and hard zero-blur offset shadows
from the app. The shadow colour is a per-theme token because a black offset on a
near-black page is invisible — on dark it is a lifted edge in `--line`, on light
it is the app's black.

## The logo

`site.js` redraws the mark from the same path data as
`Android/src/components/RunturfingLogo.tsx`. If the geometry changes in one,
change it in the other.
