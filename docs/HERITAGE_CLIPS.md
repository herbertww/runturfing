# Heritage Clips — Midjourney Prompt Spec

Eight short clips on why walking and running are not optional for a human body:
the anatomy is derived, it is roughly two million years old, and it was selected
for covering ground. Intended for the onboarding intro, the Interior Research
screen, and social.

Every claim below traces to `docs/WALKING_SCIENCE.md`. Do not add a claim to a
caption that is not in that file. On-screen copy follows the writing rules in
`CLAUDE.md` — plain, concrete, no rhetorical escalation.

---

## 1. Production settings

Midjourney makes stills, then animates them. Each shot below has an **image
prompt** and an **animate prompt**. Clips land at ~5s and extend to ~20s.

**Format.** `--ar 9:16` is primary — the intro sequence is a phone screen.
Re-render hero shots at `--ar 16:9` for the landing page rather than cropping.

**House suffix.** Append to every image prompt so the set cuts together:

```
--ar 9:16 --v 7 --style raw --stylize 150 --quality 2
```

`--style raw` matters. Midjourney's default aesthetic pushes toward glossy
fantasy illustration, which turns a scientific claim into concept art.

**Style lock.** Render shot 1, keep the URL, then pass `--sref <url>` on every
later prompt. Without it the set drifts in palette and grade across eight
renders and stops reading as one piece.

**Character lock.** Shots 4–6 follow the same runner. Use `--cref <url>` from
shot 4 with `--cw 60` — enough to hold the face and build, loose enough to let
wardrobe and lighting change across two million years.

**Palette.** The app is warm paper, ink, and a single yellow. Ask for dust,
low sun, and desaturated greens; keep saturated colour for the app UI so the
footage never competes with the map.

---

## 2. What Midjourney gets wrong here, and how to steer

This is the part worth reading before generating anything. The default "early
human" output is a Victorian cartoon and it contradicts the science the clips
exist to convey.

| Model default | Why it is wrong | Prompt correction |
|---|---|---|
| Hunched, knuckle-dragging posture | *Homo erectus* was fully upright; the whole thesis is efficient bipedalism | "fully upright posture, long stride, tall carriage" |
| Heavy body hair | Hair loss and ~2–4 million sweat glands are the cooling adaptation | "smooth skin sheened with sweat, minimal body hair" |
| Club, spear thrust, snarling aggression | Persistence hunting is patient, not violent | "calm focused expression, steady jog, no weapons raised" |
| Bulky powerlifter build | Endurance build is lean and long-limbed | "lean wiry build, long legs, low body fat" |
| Cave, torches, mammoths, snow | Wrong biome and epoch | "East African savanna, dry grass, acacia, heat haze" |

Add to any prompt showing a figure:

```
--no fur, hunched posture, knuckle-walking, club, spear thrust, cave, snow, mammoth, muscular bodybuilder
```

**Anatomy shots will be wrong.** Midjourney does not do accurate medical
illustration. Shots 2 and 3 are mood, not diagrams. If you want a real Achilles
or arch figure, commission it or license from the Ker/Kelly papers — do not let
a generated image stand in for anatomy the app then cites a source for.

---

## 3. Shot list

### Shot 1 — Deep time
*Establishes the age of the claim. No figure yet.*

**Image**
```
East African savanna at first light two million years ago, wide empty grassland
under a pale enormous sky, acacia silhouettes, dust suspended in low golden
light, distant escarpment, no people, cinematic wide shot, shot on 35mm, muted
ochre and dry olive palette, natural grain --ar 9:16 --v 7 --style raw
--stylize 150 --quality 2
```

**Animate** — `slow push in, dust drifting left to right, grass moving in a light wind, no camera shake`

**Caption** — Two million years ago, the body you have now was being shaped for this.

---

### Shot 2 — The spring
*The foot as a mechanism. Mood, not anatomy.*

**Image**
```
Extreme close up of a bare human foot mid-stride striking dry cracked earth,
arch under load, dust bursting from the impact, side lighting raking across
skin, shallow depth of field, macro detail, warm dust and deep shadow, shot on
85mm --ar 9:16 --v 7 --style raw --stylize 150 --quality 2
```

**Animate** — `foot compresses and springs off, dust plume rises slowly, single stride, slow motion`

**Caption** — The arch and the Achilles store energy and give it back. Roughly a
third of the work returns for free.

> Source: Ker et al., Nature 1987; Kelly et al., Sci Rep 2016. Both are
> approximate and condition-dependent — say "roughly", never a hard percentage.

---

### Shot 3 — Cooling while moving
*The trait that separates us from what we chase.*

**Image**
```
Close up of a lean runner's shoulder and neck, skin sheened with sweat catching
low sun, heat shimmer distorting the air behind, dry savanna bokeh, smooth skin,
no body hair, cinematic backlight, dust motes, shot on 85mm --ar 9:16 --v 7
--style raw --stylize 150 --quality 2 --no fur, hunched posture
```

**Animate** — `sweat bead runs down, heat haze ripples, subject breathing steadily, slight slow motion`

**Caption** — Two to four million sweat glands. We cool down without stopping.

---

### Shot 4 — The pursuit begins
*First full figure. This is the `--cref` anchor for shots 5 and 6.*

**Image**
```
Lean long-limbed early human running at a steady jog across open savanna,
fully upright posture, long stride, smooth skin, minimal body hair, calm
focused expression, midday heat haze, dry grass, tracking side view, cinematic
wide, muted ochre palette, shot on 35mm, natural grain --ar 9:16 --v 7
--style raw --stylize 150 --quality 2
--no fur, hunched posture, knuckle-walking, club, spear thrust, cave, snow,
muscular bodybuilder
```

**Animate** — `steady tracking shot alongside the runner, consistent unhurried pace, heat haze shimmering, grass passing in foreground`

**Caption** — Persistence hunting. Not speed, distance.

---

### Shot 5 — The prey stops
*The mechanism made visible.*

**Image**
```
An antelope halted in dry grass, flanks heaving, mouth open panting, heat haze,
distant lone human figure small on the horizon behind it, late afternoon light,
long lens compression, cinematic, muted ochre and olive --ar 9:16 --v 7
--style raw --stylize 150 --quality 2
```

**Animate** — `antelope's flanks heaving, distant figure slowly growing closer, heat haze, almost static frame`

**Caption** — It has to stop to pant. We do not.

---

### Shot 6 — Match cut across time
*The single most important shot. Same stride, two million years apart.*

Render as two stills with the same framing and animate each, then cut on the
foot strike. Ask for identical composition explicitly.

**Image A**
```
Silhouette of an early human running, side profile, mid-stride, backlit by low
sun, dust, savanna horizon line at lower third, high contrast, minimal detail,
graphic composition --ar 9:16 --v 7 --style raw --stylize 150 --quality 2
```

**Image B**
```
Silhouette of a modern runner in contemporary running kit, side profile,
mid-stride, identical pose and framing, backlit by low sun, city skyline horizon
line at lower third, high contrast, minimal detail, graphic composition
--ar 9:16 --v 7 --style raw --stylize 150 --quality 2
```

**Animate both** — `single stride in slow motion, silhouette crossing frame left to right`

**Caption** — The stride did not change. The ground did.

---

### Shot 7 — Modern continuity
*Lands the argument in the user's actual life.*

**Image**
```
Runner on an empty city path at dawn, low warm sun raking between buildings,
long shadow ahead, breath visible, wet pavement, calm expression, cinematic
tracking side view, shot on 35mm, muted palette with one warm highlight,
natural grain --ar 9:16 --v 7 --style raw --stylize 150 --quality 2
```

**Animate** — `tracking alongside at steady pace, shadow sweeping, light flaring between buildings`

**Caption** — Same body. Same requirement.

---

### Shot 8 — Ground claimed
*Hands off to the product. The only shot that touches the app's own language.*

**Image**
```
Overhead top down view of a single running shoe striking wet city pavement,
concentric ripple spreading outward from the impact across the ground, dark
asphalt, warm reflected light, high contrast, graphic minimal composition,
shot on 50mm --ar 9:16 --v 7 --style raw --stylize 150 --quality 2
```

**Animate** — `ripple expanding outward from the footfall, slow motion, camera locked overhead`

**Caption** — Every run leaves ground behind it.

> The ripple echoes the logo — an H3 cell struck by a footfall, influence
> spreading outward. Composite the hexagon in afterwards rather than asking
> Midjourney for it; it will not produce a clean tiling hex grid.

---

## 4. Assembly

**Order.** 1 → 2 → 3 → 4 → 5 → 6A/6B → 7 → 8. Roughly 45 seconds at 5s a clip,
or 20 seconds cut tight for social.

**Cut points.** Shots 2, 6 and 8 all land on a foot strike. Cut on the impact
frame and the whole piece keeps one rhythm.

**Audio.** Footfall and breath only, with wind under the savanna shots. No
music bed under the caption cards — the copy carries the claim and a score
makes it feel like an advert for a supplement.

**Captions.** White on ink slabs, matching the app. One claim per card, source
in small type beneath. Anything without a source in `WALKING_SCIENCE.md` does
not get a card.

---

## 5. Honest limits

- **These are illustrations, not evidence.** A generated *Homo erectus* is an
  artist's impression with no anatomical authority. Fine as mood behind a cited
  claim; not fine as the thing being cited.
- **Reconstructions carry assumptions.** Skin tone, hair, build and posture in
  any early-human render are interpretive. Keep figures backlit or in silhouette
  where possible — shots 4 and 6 are written that way on purpose, and it dodges
  a fidelity argument entirely.
- **Persistence hunting is a hypothesis**, well-supported and widely cited, not
  settled fact. "Consistent with" is the honest phrasing; the captions above
  stay on the anatomy, which is not in dispute.
- **Commercial use** needs a paid Midjourney plan. Check current terms before
  anything ships in the App Store listing.
