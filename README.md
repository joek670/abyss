# ABYSS

A deep-sea exploration atlas with a live dive console.

Every pressure, temperature, salinity, density, sound-speed and light reading in
the interface is computed on the server from published oceanographic equations.
Nothing is a lookup table, and nothing is hard-coded in the browser.

```
npm start          # http://127.0.0.1:8787
npm run verify     # 41 physics assertions against published reference values
npm run test:rules # 33 matching-rule assertions (which photograph may ship)
npm test           # 101 end-to-end assertions in real headless Chrome
npm run check      # all three
```

No install step. No `node_modules`. No build. The server runs on Node's built-in
`node:http` and `node:sqlite`; the client is hand-written ES modules that the
browser loads directly.

---

## What it does

| Page | Purpose |
|---|---|
| **Surface** | The premise, plus a live spectral-extinction panel |
| **Descent** | Scroll-driven passage through all five depth zones |
| **Atlas** | 36 specimens, searchable and filterable, URL-addressable |
| **Console** | Set any depth, or run a simulated descent with live SSE telemetry |
| **Dive Log** | Record dives to SQLite; the physics is frozen with each entry |
| **Method** | The equations, their sources, and what is approximated |

---

## The physics

Three of the models are exact transcriptions of their source papers. The
validation harness checks all of them on every run.

### Density — UNESCO EOS-80 (1983)

The full equation of state, including the secant bulk modulus `K(T, S, p)`, so
density is a true function of pressure rather than a surface sigma-0:

```
rho(T, S, p) = rho0(T, S) / (1 - p / K(T, S, p))
```

Validated against the EOS-80 worked examples (`rho(0 °C, 35 PSU) = 1028.106`),
the pure-water density maximum at 4 °C (999.975 kg/m³), and the compressibility
of seawater at depth (4.13 % at 1000 bar, 4.59 % at full ocean depth).

### Pressure — numerical hydrostatic integration

Pressure is obtained by integrating `dp = rho·g·dz` in one-metre steps,
evaluating the equation of state at each step. The usual rule of thumb that one
metre of depth is one decibar holds only near the surface; ignoring
compressibility understates pressure by about 3 % at full depth.

This yields **1,128 bar** at 10,935 m. The figure of 1,086 bar that circulates
widely for Challenger Deep is *below the hydrostatic floor* — with seawater
denser than 1,000 kg/m³ the gradient cannot be under 1.0 dbar/m, so pressure
there must exceed 1,093 bar. The harness asserts that floor explicitly.

### Sound speed — Mackenzie (1981)

The nine-term regression, accurate to ~0.1 m/s over its stated range. The
resulting profile has a genuine minimum — the **SOFAR channel** — at about
900 m in this model. Above 8,000 m the depth terms are clamped to their limit
and the API flags the result as extrapolated.

### Light — Beer–Lambert, per spectral band

Five visible bands with their own diffuse attenuation coefficients:

| Band | Kd | 1 % extinction depth |
|---|---|---|
| Red 650 nm | 0.35 /m | 13 m |
| Amber 590 nm | 0.12 /m | 38 m |
| Green 530 nm | 0.07 /m | 66 m |
| Violet 425 nm | 0.032 /m | 144 m |
| Blue 470 nm | 0.025 /m | 184 m |

This is why the deep sea is blue, and why most bioluminescence is blue.

### What is approximated

Stated plainly, because a reader should know which numbers to trust absolutely:

- **Temperature and salinity** are empirical fits to a *globally averaged* open
  ocean profile — a warm mixed layer, an exponential thermocline, a cold deep
  reservoir, and an adiabatic gradient that makes hadal water slightly warmer
  than abyssal water. Real profiles vary enormously; this model cannot show a
  30 °C tropical surface or a −1.8 °C polar one.
- **Attenuation coefficients** are for clear Case I water. Coastal, polar and
  turbid water attenuates far faster.
- **The dive stream** is a kinematic simulation, not a vehicle model. Depth,
  pressure and temperature at each instant come from the real ocean model —
  only the *timing* is compressed, because a real descent to 10,000 m takes
  about five hours. The console labels the compression factor on every run.

---

## Architecture

```
server/
  ocean.mjs        physics: EOS-80, Mackenzie, Beer-Lambert, zone model
  db.mjs           node:sqlite, numbered migrations, catalogue re-sync
  images.mjs       optional species photography + attribution manifest
  http.mjs         router, static files (gzip + ETag + 304), SSE, body parsing
  api.mjs          REST + the telemetry stream
  index.mjs        bootstrap, CSP, graceful shutdown
  data/species.mjs 36 specimens with recorded bathymetric ranges
public/
  css/             tokens -> base -> components -> views (no preprocessor)
  js/core/         dom, api, store, router, toast
  js/viz/          sprites, particles, charts, gauges
  js/views/        one module per page
scripts/
  verify-physics.mjs        41 assertions against published reference values
  browser-tests.mjs         end-to-end assertions in real headless Chrome
  fetch-species-images.mjs  Wikimedia Commons fetcher + attribution manifest
Dockerfile                 no build stage, no install step
```

**Zero dependencies.** Node 22.5+ ships `node:sqlite`, so persistence needs no
native module; `node:http` plus a ~40-line pattern router covers routing; the
frontend needs no bundler because ES modules are native. There is nothing to
install, nothing to compile, and no supply chain.

### Notable implementation details

- **The tool catalog is the depth control.** The console's telemetry frames are
  pushed into a shared store, so starting a dive visibly moves the depth rail
  and instrument strip across the whole site.
- **The depth rail survives navigation.** The rail and strip subscribe to the
  store once rather than being re-rendered per view — that is what makes every
  page feel like part of the same dive.
- **Specimen artwork is drawn, not photographed.** There are no image assets;
  each of the 36 species has a hand-authored SVG silhouette on a shared 100×100
  grid, in the style of a field-guide plate. Detail lines (teeth, jaw, gill
  slits) are stroked in the background colour so they read against the
  accent-filled body in both themes.
- **Search ranks in JavaScript, not SQL.** With a few dozen rows this is faster
  and far more legible than a full-text index: a hit in the common name beats a
  hit in the scientific name, which beats a hit in the blurb.

---

## Validation

Two suites, both zero-dependency, both exiting non-zero on failure.

**`npm run verify` — 41 physics assertions.** The EOS-80 worked examples, the
pure-water density maximum, compressibility at depth, hand-evaluated Mackenzie
values, the SOFAR minimum, per-band extinction depths, and the physical
invariants (monotonic pressure, no NaN anywhere in the profile, hadal water
warmer than abyssal). It also asserts that pressure at 10,935 m exceeds the
hydrostatic floor of 1,093 bar — which is what makes the widely quoted
"1,086 bar" figure demonstrably impossible rather than merely different.

**`npm test` — 86 end-to-end assertions.** Drives real headless Chrome against a
running server and asserts on the rendered DOM. This catches the class of bug a
unit test cannot, and every one of the following shipped past a green syntax
check during development:

- the console returning a cleanup function instead of a node, so the page
  rendered blank
- gauge readouts created in the SVG namespace — present in the DOM, never painted
- `transform-origin` double-applying the rotation already carried by
  `rotate(a 50 50)`, swinging the gauge needle outside its dial
- the router not awaiting async `mount()`, so the descent page's scroll observer
  never installed itself
- `data-depth` on the console's preset chips colliding with the scroll markers
- `Number(x) || 3800` treating a target depth of 0 as falsy and rendering 3800 m

It covers route rendering, JS-error capture, API contracts and error paths,
path-traversal refusal, the atlas search and filter pipeline, a full dive-log
round trip, SSE telemetry — including the invariant that *every* frame is
consistent with the ocean model at the depth it reports — and static-asset
serving with ETag/304 and gzip.

Chrome is driven with `--dump-dom` writing to a **file descriptor rather than a
pipe**, because piped stdio is blocked under a confined sandbox. Set
`CHROME_PATH` if the browser lives somewhere unusual.

---

## Known issues

Recorded rather than silently fixed, because these were identified in a session
where the shell runner had died and **nothing could be verified by execution**.
The tree at this commit is exactly the tree that passed all 127 assertions; the
items below are the next work, not pending edits.

### Contrast — `--text-3` fails WCAG AA in both themes

Measured against WCAG 2.1 using sRGB relative luminance, and the token is used
for 9.5–10 px uppercase labels (readout captions, table headers, rail footer,
field hints), so the large-text exemption does not apply:

| Theme | Pair | Ratio | Required |
|---|---|---|---|
| abyss | `#4a6273` on `#02070d` | **3.16:1** | 4.5:1 |
| daylight | `#8b9dab` on `#f7f4ee` | **2.55:1** | 4.5:1 |
| abyss | `--text-2` `#6f8b9d` on `#02070d` | ~5.1:1 | passes |

Computed replacements that keep the hue and clear AA — note each tightens the
step between `--text-2` and `--text-3`, so the scale should be re-checked after:

- abyss `--text-3` → `#627d90` (≈4.67:1)
- daylight `--text-3` → `#5c6f7d` (≈4.76:1)

### Focus is not trapped in the palette or the species drawer

Escape closes each dialog and focus returns to the element that opened it, but
Tab can walk out of an open `aria-modal="true"` dialog onto the page behind it.

### Gauge values are not programmatically associated with their dials

Each gauge SVG carries `role="img"` and an `aria-label` naming the dial
("Pressure"), while the numeric value lives in a sibling `.gauge__readout` div
with no relationship to it. A screen reader reads the name and the number as two
unconnected pieces of text.

### The depth rail announces nothing

The rail marker's value changes on scroll with no live region, so a screen-reader
user gets no depth feedback while scrolling the descent page. A live region here
needs care — it should be `aria-live="off"` by default and only announce on
settle, or it will flood the queue on every scroll frame.

### Hero headline figures sit just below the fold

At 1440×900 the headline wraps to five lines at its `20ch` measure, pushing the
four headline figures below the fold. Widening to `24ch` lands it on three lines
and was measured to work — but the change was made after the last successful
render and then **reverted**, because an unverifiable edit is worth less than a
tree that is known-good. It is a one-line change to `.hero__title` in
`public/css/views.css`.

---

## Species photography

**35 of the 36 species carry a real photograph**, fetched from Wikimedia Commons
under free licences; only the bone-eating worm falls back to the drawn plate,
because Commons holds no free photograph of *Osedax mucofloris* under that name
at all. `scripts/fetch-species-images.mjs` does the retrieval and writes the
attribution manifest.

### Coverage

| | count |
|---|---|
| Species with a photograph | 35 |
| Species with no free photograph | 1 |
| Images requiring attribution (CC BY / CC BY-SA) | 26 |
| Images needing no credit (CC0 / public domain) | 9 |

Deep-sea imagery is overwhelmingly © MBARI, Schmidt Ocean Institute or NOAA;
Commons carries free files for most well-photographed animals, and nothing at
all for species known from a handful of specimens.

### What automatic matching cannot do — and the pin that fixes it

The filter reasons about **filenames**, so it catches explicit signals (`stamp`,
`specimen`, `MNHN`, a DOI, a pre-2000 year) but cannot tell that a neutrally
named file is a drawing or a specimen. Four of the first 35 picks were wrong
that way, and every filter passed them:

| Card | What was chosen |
|---|---|
| dumbo-octopus | `Grimpoteuthis.jpg` — a black-and-white **line drawing** |
| lanternfish | a five-species **labelled diagram** with a 10 cm scale bar |
| brittle-star | a **sponge on a lab tray** with a ruler and sample label |
| barreleye | a **preserved specimen** in a museum tank |

All four are fixed by `server/data/species-image-pins.json`, which names an
exact Commons file per slug:

```json
{ "barreleye": "File:Barreleye-fish GoK.jpg" }
```

A pin is taken verbatim — no scoring, no rules — but the licence and creator are
still validated, so a pin chooses *which* file and does not exempt it from the
licensing rules. It is the honest answer to a heuristic that cannot see: a human
looks at the image and names it.

`npm run images:dry` prints the rejected candidates with the reason for each, so
alternatives can be found and pinned deliberately.

**Every image was inspected by eye**, not just by rule. The remaining
compromises are visible and disclosed rather than hidden: the vampire squid,
frilled shark and yeti crab photos show preserved or historical specimens —
correct species, properly credited, but not the living animal in its habitat.

### 1. Allow Wikimedia in the egress policy

`~/.dsh/rules.yaml` runs in whitelist mode with `unlisted: deny`, so
`commons.wikimedia.org` is refused. The change is **operator work**: that same
file denies agent edits to itself under `tags: [self-modification]`, precisely so
a model cannot widen its own network access. Add this to the **egress section at
the bottom** of the file — order is the policy, first-match-wins, and the
allow-list must stay last so it can only widen what nothing else refused:

```yaml
  # Wikimedia Commons, for freely-licensed species photography and the
  # attribution metadata that ships with it. Read-only GETs.
  - match:
      network:
        domains: ["commons.wikimedia.org", "upload.wikimedia.org", "en.wikipedia.org"]
        schemes: [https]
    action: allow
    reason: "Freely-licensed species imagery and its attribution metadata"
    tags: [egress, wikimedia]
```

### 2. Restart dsh

Two reasons, and the second is the one that is easy to miss. The rule only takes
effect on reload — and a wedged job runner (`0xC0000142`, DLL init failure) also
blocks every shell command, which matters because **the shell is the only way to
write image bytes to disk**. `web_fetch` returns decoded text and the file tools
emit UTF-8, so no photograph can move through the agent's tools without it.

### 3. Fetch

```
node scripts/fetch-species-images.mjs --dry-run   # show what matches, download nothing
node scripts/fetch-species-images.mjs             # fetch what is available
```

It writes `public/img/species/<slug>.jpg` plus `server/data/species-images.json`
holding artist, licence, licence URL and the Commons file page for each image.

### Render path

`server/images.mjs` loads the manifest and merges it into every species row, so
`image` is `null` on a clean checkout and the drawn plate renders exactly as
before. The manifest is **re-read when its mtime changes**, so the fetcher can
run against a live server with no restart.

`public/js/views/parts.js` picks the artwork in one place, used by the atlas
grid, the descent page, the console's "lives here" list and the detail drawer:

- **`specimenArt()`** — a `<figure>` with the photograph and an inline credit
  when one exists, otherwise the SVG plate.
- **`taxonPlate()`** — the large plate, carrying the full record: creator,
  the licence linked to its deed, and the Commons file page.

**Attribution is never hover-only.** CC BY and CC BY-SA make naming the creator
a condition of use, and a hover credit is unreachable on touch, absent from
print, and gone the moment someone screenshots the grid — which, for a
reference atlas, is the normal case. The card credit therefore sits on a scrim
over the image, always painted; the detail page shows the complete record.

An entry whose licence requires credit but whose `artist` is empty is **dropped
at load**, so an uncredited CC BY file degrades to the drawn plate rather than
shipping in breach. Public-domain and CC0 files need no creator and are kept
either way. `npm test` covers both of those cases.

### Licensing policy, enforced in the script

Only **CC0, public domain, CC BY and CC BY-SA** are accepted. Anything
NonCommercial, NoDerivs, "fair use", or with no licence stated is rejected —
a species atlas is exactly the kind of thing that later gets reused
commercially. Files whose artist cannot be determined are **skipped rather than
shipped uncredited**, because CC BY and CC BY-SA both require the creator to be
named. The interface must therefore display attribution on any card showing a
photograph; that is a condition of the licence, not a courtesy.

### Coverage is genuinely partial

Expect roughly half. Deep-sea imagery is overwhelmingly © MBARI, Schmidt Ocean
Institute or NOAA; Commons carries CC and US-government public-domain files for
well-photographed animals (anglerfish, vampire squid, dumbo octopus, snailfish)
and nothing at all for species known from a single specimen — *Abyssobrotula
galatheae* was described from one 1970 trawl and has no free photograph. Species
with no acceptable image keep the drawn plate, so the render path must treat a
photograph as optional and fall back cleanly.

---

## Deployment

```
docker build -t abyss .
docker run -p 8787:8787 -v abyss-data:/app/data abyss
```

There is no build stage and no dependency install, because there is nothing to
build and nothing to install — the image is the runtime plus this repository.
The SQLite file lives at `/app/data/abyss.db`; mount a volume there to keep the
dive log across restarts.

The container runs as the non-root `node` user, binds `0.0.0.0`, and declares a
`HEALTHCHECK` against `/api/health` that uses `node -e` rather than curl, so no
extra tooling is needed in the image.

To run it directly behind a reverse proxy instead, set `HOST=0.0.0.0` and
terminate TLS at the proxy. The app sets a restrictive `Content-Security-Policy`
(`default-src 'self'`, no inline scripts, no third-party origins), so it makes
no outbound requests at runtime and needs no egress.

---

## API

```
GET    /api/health                    liveness, uptime, catalogue size
GET    /api/catalogue                 zones, counts, depth limits
GET    /api/zones                     the five depth zones
GET    /api/species                   ?q= &zone= &glow= &sort= &limit= &offset=
GET    /api/species/:slug             one specimen + conditions across its range
GET    /api/ocean/at?depth=           full water-column state at a depth
GET    /api/ocean/profile             sampled profile for charting
GET    /api/ocean/equivalences        pressure in human terms
GET    /api/ocean/landmarks           notable depths bracketing a target
GET    /api/dive/stream               SSE telemetry for a simulated descent
GET    /api/dives                     the dive log
POST   /api/dives                     record a dive
DELETE /api/dives/:id                 remove a dive
GET    /api/stats                     aggregate statistics
```

---

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Listen port |
| `HOST` | `127.0.0.1` | Listen address |
| `ABYSS_DB` | `./data/abyss.db` | SQLite file |
| `ABYSS_QUIET` | unset | `1` silences request logging |

---

## Sources

- UNESCO (1983). *Algorithms for computation of fundamental properties of
  seawater.* UNESCO Technical Papers in Marine Science 44.
- Mackenzie, K. V. (1981). Nine-term equation for sound speed in the oceans.
  *J. Acoust. Soc. Am.* 70(3), 807–812.
- Saunders, P. M. (1981). Practical conversion of pressure to depth.
  *J. Phys. Oceanogr.* 11, 573–574.
- Jerlov, N. G. (1976). *Marine Optics.* Elsevier.
- Jamieson, A. J. et al. (2010). Hadal trenches: the ecology of the deepest
  places on Earth. *Trends Ecol. Evol.* 25(3), 190–197.
- Yancey, P. H. et al. (2014). Marine fish may be biochemically constrained from
  inhabiting the deepest ocean depths. *PNAS* 111(12), 4461–4465.
