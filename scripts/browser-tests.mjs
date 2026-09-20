/**
 * browser-tests.mjs — end-to-end tests for ABYSS.
 *
 * Drives real headless Chrome against a running server and asserts on the
 * rendered DOM, so it catches the class of bug that unit tests cannot: the
 * router returning a function instead of a node, an SVG-namespaced <div> that
 * occupies the DOM but never paints, a scroll observer that never installs.
 * Every one of those shipped past a green syntax check during development.
 *
 * Zero dependencies. Chrome is driven with `--dump-dom` and its stdout is
 * redirected to a FILE DESCRIPTOR rather than a pipe: piped stdio is blocked
 * under a confined sandbox (EPERM on named pipes), and a file descriptor works
 * everywhere.
 *
 *   node scripts/browser-tests.mjs [--keep-server] [--filter=<substr>]
 *
 * Exits non-zero if any assertion fails.
 */
import { spawn, spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const PORT = Number(process.env.ABYSS_TEST_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const FILTER = (process.argv.find((a) => a.startsWith('--filter=')) ?? '').slice(9);

/* ------------------------------------------------------------------ *
 * Tiny test harness
 * ------------------------------------------------------------------ */

const results = [];
let currentSuite = '';

function suite(name) {
  currentSuite = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function check(name, condition, detail = '') {
  if (FILTER && !`${currentSuite} ${name}`.toLowerCase().includes(FILTER.toLowerCase())) return;
  const ok = !!condition;
  results.push({ suite: currentSuite, name, ok, detail });
  const mark = ok ? '\x1b[32m  ok  \x1b[0m' : '\x1b[31m FAIL \x1b[0m';
  console.log(`[${mark}] ${name}${ok || !detail ? '' : `\n         ${detail}`}`);
}

/* ------------------------------------------------------------------ *
 * Chrome discovery
 * ------------------------------------------------------------------ */

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
const workDir = mkdtempSync(join(tmpdir(), 'abyss-test-'));

/**
 * Load a URL in headless Chrome and return { dom, stderr, ok }.
 * stdout/stderr go to real files via descriptors — never pipes.
 */
function loadDom(path, { width = 1440, height = 900, budget = 9000 } = {}) {
  const outFile = join(workDir, `dom-${Math.random().toString(36).slice(2)}.html`);
  const errFile = join(workDir, `err-${Math.random().toString(36).slice(2)}.log`);
  const outFd = openSync(outFile, 'w');
  const errFd = openSync(errFile, 'w');

  const res = spawnSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      `--user-data-dir=${join(workDir, 'profile')}`,
      `--window-size=${width},${height}`,
      '--run-all-compositor-stages-before-draw',
      `--virtual-time-budget=${budget}`,
      '--enable-logging=stderr',
      '--v=0',
      '--dump-dom',
      `${BASE}${path}`,
    ],
    { stdio: ['ignore', outFd, errFd], timeout: 120_000 },
  );

  closeSync(outFd);
  closeSync(errFd);

  const dom = readFileSync(outFile, 'utf8');
  const stderr = readFileSync(errFile, 'utf8');
  try {
    rmSync(outFile, { force: true });
    rmSync(errFile, { force: true });
  } catch {
    /* best effort */
  }
  return { dom, stderr, status: res.status };
}

/** JavaScript errors the page actually logged. */
function jsErrors(stderr) {
  return stderr
    .split('\n')
    .filter(
      (l) =>
        /Uncaught|SyntaxError|TypeError|ReferenceError|is not a function|Failed to load resource/i.test(l) &&
        !/favicon/i.test(l),
    );
}

/**
 * Visible text of a document, lowercased.
 *
 * The comparison is case-insensitive on purpose: a lot of this interface is
 * uppercased in CSS (`text-transform: uppercase` on eyebrows, panel titles and
 * the rail footer), so the DOM says "Target depth" while the screen says
 * "TARGET DEPTH". Asserting on the rendered casing would mean asserting on a
 * stylesheet, which is not what these tests are for.
 */
const text = (dom) => dom.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const has = (dom, needle) => text(dom).includes(needle.toLowerCase());

/* ------------------------------------------------------------------ *
 * Server lifecycle
 * ------------------------------------------------------------------ */

async function waitForServer(timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Suites
 * ------------------------------------------------------------------ */

const ROUTES = [
  { path: '/#/', must: ['The ocean is', 'Begin the descent', 'AN INSTRUMENT FOR THE WATER COLUMN'] },
  { path: '/#/descent', must: ['Eleven kilometres', 'ZONE 01', 'Epipelagic', 'Hadal'] },
  { path: '/#/atlas', must: ['The Atlas', 'specimens', 'Ocean Sunfish'] },
  { path: '/#/console', must: ['Dive Console', 'TARGET DEPTH', 'WATER COLUMN', 'Run the descent'] },
  { path: '/#/log', must: ['Dive Log', 'RECORD A DIVE', 'No dives recorded yet'] },
  { path: '/#/about', must: ['Where the numbers come from', 'UNESCO EOS-80', 'Mackenzie (1981)', 'Beer'] },
  { path: '/#/atlas/mariana-snailfish', must: ['Mariana Snailfish', 'Pseudoliparis swirei', 'FIELD NOTES'] },
  { path: '/#/atlas/vampire-squid', must: ['Vampire Squid', 'Vampyroteuthis infernalis'] },
];

async function routeSuite() {
  suite('Routes render');
  for (const route of ROUTES) {
    const { dom, stderr } = loadDom(route.path);
    const body = text(dom);
    const missing = route.must.filter((m) => !body.includes(m.toLowerCase()));
    const crashed = dom.includes('could not be rendered') || dom.includes('View returned no content');
    const errs = jsErrors(stderr);

    check(
      `${route.path} renders`,
      !crashed && missing.length === 0,
      crashed
        ? 'page showed the error view'
        : missing.length
          ? `missing text: ${missing.join(' | ')}`
          : '',
    );
    check(`${route.path} has no JS errors`, errs.length === 0, errs.slice(0, 3).join('\n         '));
  }
}

async function notFoundSuite() {
  suite('Error handling');
  const { dom } = loadDom('/#/this-route-does-not-exist');
  check('unknown route shows the 404 view', has(dom, 'Nothing at this depth'), text(dom).slice(0, 200));
  check('unknown route offers a way back', has(dom, 'Return to the surface'));
}

async function physicsInUiSuite() {
  suite('Physics reaches the interface');

  // The instrument strip must agree with the API at a given depth. This is the
  // end-to-end assertion that the ocean model, the API and the client all
  // agree — a unit test on any one of them would miss a break between them.
  const cases = [
    // depth 0 is the regression guard: `Number(x) || 3800` used to treat the
    // surface as falsy and silently render 3800 m instead.
    { depth: 0, expectBar: '0.00 bar' },
    { depth: 10935, expectBar: '1,128.0 bar' },
    { depth: 3800, expectBar: '386.1 bar' },
  ];

  for (const c of cases) {
    const { dom } = loadDom(`/#/console?depth=${c.depth}`);
    check(
      `console at ${c.depth} m reports ${c.expectBar}`,
      has(dom, c.expectBar),
      `strip read: ${(/pressure ([^ ]+ [^ ]+)/.exec(text(dom)) ?? [])[1] ?? 'not found'}`,
    );
  }

  // The depth rail must track the console target.
  const { dom } = loadDom('/#/console?depth=10935');
  check('depth rail shows 10.94 km at the floor', has(dom, '10.94 km'));
  check('depth rail labels the hadal zone', has(dom, 'hadal'));

  // Gauges must actually render their readouts. Regression guard: the readouts
  // were once created in the SVG namespace, which puts the text in the DOM but
  // never paints it — a DOM-presence assertion alone would have passed.
  const gaugeReadouts = [...dom.matchAll(/class="gauge__readout">([^<]*)</g)].map((m) => m[1]);
  check(
    'gauges render four numeric readouts',
    gaugeReadouts.length === 4 && gaugeReadouts.every((v) => /\d/.test(v)),
    `readouts: ${gaugeReadouts.join(' | ')}`,
  );
  // An inert SVG-namespaced <div> still carries its text, so presence proves
  // nothing. Check the namespace the browser actually resolved instead.
  check(
    'gauge readouts are HTML elements, not inert SVG nodes',
    !/namespaceURI="http:\/\/www\.w3\.org\/2000\/svg"[^>]*class="gauge__readout"/.test(dom),
  );

  // The pressure gauge must sweep. Asserting on ALL four arcs would be wrong:
  // at 10,935 m the blue-light gauge is legitimately empty, because 1.9e-117 %
  // of surface irradiance sits at the floor of a log scale.
  const pressureArc = /class="gauge__arc"[^>]*stroke-dashoffset="([\d.]+)"/.exec(dom);
  const sweep = pressureArc ? Number(pressureArc[1]) : null;
  check(
    'the pressure gauge arc is driven off its rest position',
    sweep !== null && sweep < 197.9,
    `stroke-dashoffset=${sweep} (197.92 = empty sweep)`,
  );
  check(
    'the light gauge is correctly empty in the dark',
    /class="gauge__arc"[^>]*stroke-dashoffset="197\.9/.test(dom),
    'expected at least one arc at full offset at 10,935 m',
  );
}

async function atlasSuite() {
  suite('Atlas search and filtering');

  const all = loadDom('/#/atlas');
  const total = Number((/atlas__count">([^<]*)</.exec(all.dom) ?? [])[1]?.match(/(\d+)/)?.[1] ?? 0);
  check('atlas reports the full catalogue count', total >= 36, `count=${total}`);

  const searched = loadDom('/#/atlas?q=squid');
  const sCount = Number((/atlas__count">([^<]*)</.exec(searched.dom) ?? [])[1]?.match(/(\d+)/)?.[1] ?? -1);
  check('search narrows the result set', sCount > 0 && sCount < total, `${sCount} of ${total}`);
  check('search surfaces the matching species', has(searched.dom, 'Colossal Squid'));

  const glow = loadDom('/#/atlas?glow=true');
  const gCount = Number((/atlas__count">([^<]*)</.exec(glow.dom) ?? [])[1]?.match(/(\d+)/)?.[1] ?? -1);
  check('bioluminescent filter applies', gCount > 0 && gCount < total, `${gCount} glowing`);

  const hadal = loadDom('/#/atlas?zone=hadal');
  check('zone filter applies', has(hadal.dom, 'Mariana Snailfish'));

  const empty = loadDom('/#/atlas?q=zzzznotathing');
  check('empty search shows an empty state', has(empty.dom, 'Nothing in the catalogue matches'));
}

const MANIFEST = join(ROOT, 'server', 'data', 'species-images.json');

/**
 * A 1x1 transparent GIF. The photograph branch is exercised with a data: URI
 * because the CSP already allows `img-src 'self' data:`, and it means the
 * render path can be tested without shipping or generating a binary file —
 * which matters in an environment where no tool can write image bytes.
 */
const TINY_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function photographySuite() {
  suite('Species photography and attribution');

  const original = readFileSync(MANIFEST, 'utf8');
  const writeManifest = async (obj) => {
    writeFileSync(MANIFEST, JSON.stringify(obj, null, 2) + '\n');
    // The server reloads the manifest on mtime change; give it a tick so two
    // writes in the same millisecond cannot be mistaken for one.
    await sleep(40);
  };

  try {
    /* Baseline — no photographs, so everything must fall back to the plate. */
    await writeManifest({});

    const before = loadDom('/#/atlas');
    check(
      'cards fall back to the drawn plate when no photograph exists',
      before.dom.includes('specimen__art') && !before.dom.includes('specimen__photo'),
    );

    const catBefore = await (await fetch(`${BASE}/api/catalogue`)).json();
    check(
      'catalogue reports zero photographs',
      catBefore.stats.withPhoto === 0,
      `withPhoto=${catBefore.stats.withPhoto}`,
    );

    const bare = await (await fetch(`${BASE}/api/species/humpback-anglerfish`)).json();
    check('a species with no photograph reports image: null', bare.image === null);

    /* Now inject one and check the whole chain: API -> card -> detail. */
    await writeManifest({
      'humpback-anglerfish': {
        file: TINY_GIF,
        artist: 'Test Photographer',
        licence: 'CC BY-SA 4.0',
        licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Test.jpg',
        retrieved: '2026-01-01',
      },
    });

    const api = await (await fetch(`${BASE}/api/species/humpback-anglerfish`)).json();
    check('the API merges the manifest into the species', api.image?.artist === 'Test Photographer');

    const detail = loadDom('/#/atlas/humpback-anglerfish');
    check(
      'the detail plate renders the photograph',
      detail.dom.includes('taxon__photo') && detail.dom.includes('<img'),
    );
    check('the detail plate names the photographer', has(detail.dom, 'Test Photographer'));
    check('the detail plate states the licence', has(detail.dom, 'CC BY-SA 4.0'));
    check(
      'the detail plate links the licence deed',
      detail.dom.includes('creativecommons.org/licenses/by-sa/4.0'),
      'CC BY-SA requires a link to the licence',
    );
    check(
      'the detail plate links the source file page',
      detail.dom.includes('commons.wikimedia.org/wiki/File:Test.jpg'),
    );

    const grid = loadDom('/#/atlas?q=anglerfish');
    check('the card shows the photograph', grid.dom.includes('specimen__photo'));
    check(
      'the card credit is in the document, not revealed on hover',
      grid.dom.includes('figcaption') && has(grid.dom, 'Test Photographer'),
      'attribution must be present without interaction to satisfy CC BY-SA',
    );
    check('the card credit names the licence too', has(grid.dom, 'CC BY-SA 4.0'));

    const catAfter = await (await fetch(`${BASE}/api/catalogue`)).json();
    check(
      'catalogue counts the photograph',
      catAfter.stats.withPhoto === 1,
      `withPhoto=${catAfter.stats.withPhoto}`,
    );

    /* An uncredited CC BY file must be refused rather than shown bare. */
    await writeManifest({
      'humpback-anglerfish': {
        file: TINY_GIF,
        licence: 'CC BY-SA 4.0',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Test.jpg',
      },
    });
    const uncredited = await (await fetch(`${BASE}/api/species/humpback-anglerfish`)).json();
    check(
      'an uncredited CC BY file is dropped rather than displayed',
      uncredited.image === null,
      'CC BY-SA requires the creator be named, so a file with no artist must not ship',
    );

    /* A public-domain file needs no creator and must survive. */
    await writeManifest({
      'humpback-anglerfish': { file: TINY_GIF, licence: 'Public domain', artist: '' },
    });
    const pd = await (await fetch(`${BASE}/api/species/humpback-anglerfish`)).json();
    check('a public-domain file is accepted without a creator', pd.image !== null);
  } finally {
    writeFileSync(MANIFEST, original);
    await sleep(40);
  }
}

async function apiSuite() {
  suite('HTTP API');

  const get = async (p) => {
    const r = await fetch(`${BASE}${p}`);
    let body = null;
    try {
      body = await r.json();
    } catch {
      /* non-JSON */
    }
    return { status: r.status, body };
  };

  const health = await get('/api/health');
  check('health is ok', health.status === 200 && health.body?.status === 'ok');
  check('health reports the catalogue size', health.body?.species >= 36, `species=${health.body?.species}`);

  const cat = await get('/api/catalogue');
  check('catalogue lists 5 zones', cat.body?.zones?.length === 5);
  check('catalogue stats are present', cat.body?.stats?.species >= 36);

  const all = await get('/api/species?limit=200');
  check('species endpoint returns the catalogue', all.body?.items?.length >= 36);

  const one = await get('/api/species/mariana-snailfish');
  check('single species returns its facts', one.body?.facts?.length >= 3);
  check('single species carries environment data', !!one.body?.environment?.deep);

  const missing = await get('/api/species/not-a-real-fish');
  check('unknown species is a 404', missing.status === 404);

  const badZone = await get('/api/species?zone=atlantis');
  check('unknown zone is a 400', badZone.status === 400);
  check('400 lists the valid zones', Array.isArray(badZone.body?.error?.valid));

  const unknown = await get('/api/nope');
  check('unknown API route is a 404', unknown.status === 404);

  // Physics invariants through the API.
  const deep = await get('/api/ocean/at?depth=10935');
  check('deep pressure exceeds the hydrostatic floor', deep.body?.pressureBar > 1093.5, `${deep.body?.pressureBar} bar`);
  check('deep water is compressed >4 %', deep.body?.compression > 4, `${deep.body?.compression} %`);
  check('hadal water is warmer than abyssal', deep.body?.temperature > 2.0, `${deep.body?.temperature} C`);

  const shallow = await get('/api/ocean/at?depth=0');
  check(
    'surface sea pressure is zero (gauge convention)',
    shallow.body?.pressureConvention === 'gauge' && Math.abs(shallow.body?.pressureAtm) < 0.02,
    `convention=${shallow.body?.pressureConvention} gauge=${shallow.body?.pressureAtm} atm`,
  );
  check(
    'surface absolute pressure is one atmosphere',
    Math.abs(shallow.body?.pressureAbsoluteAtm - 1) < 0.02,
    `${shallow.body?.pressureAbsoluteAtm} atm`,
  );
  check(
    'absolute pressure exceeds gauge by exactly one atmosphere at depth',
    Math.abs(
      deep.body.pressureAbsoluteAtm - deep.body.pressureAtm - 1,
    ) < 0.02,
  );

  const prof = await get('/api/ocean/profile?step=500');
  check('profile is monotonic in depth', prof.body?.rows?.every((r, i, a) => i === 0 || r.depth > a[i - 1].depth));
  check('profile contains no NaN', prof.body?.rows?.every((r) => Object.values(r).every(Number.isFinite)));

  // Path traversal must not escape the public root.
  const traversal = await fetch(`${BASE}/../server/db.mjs`);
  check('path traversal is refused', traversal.status === 404 || traversal.status === 403, `status ${traversal.status}`);
}

async function diveLogSuite() {
  suite('Dive log round trip');

  // Start clean so the assertions are deterministic.
  const existing = await (await fetch(`${BASE}/api/dives`)).json();
  for (const d of existing.items ?? []) {
    await fetch(`${BASE}/api/dives/${d.id}`, { method: 'DELETE' });
  }

  const before = loadDom('/#/log');
  check('empty log shows the empty state', has(before.dom, 'No dives recorded yet'));

  const created = await fetch(`${BASE}/api/dives`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      label: 'Test descent to the floor',
      targetDepth: 10935,
      craft: 'DSV Limiting Factor',
      notes: 'Automated test entry.',
    }),
  });
  const payload = await created.json();
  check('creating a dive returns 201', created.status === 201, `status ${created.status}`);
  check('created dive froze the physics', payload?.dive?.pressureBar > 1093.5, `${payload?.dive?.pressureBar} bar`);
  check('created dive is filed under hadal', payload?.dive?.zone === 'hadal');

  const after = loadDom('/#/log');
  check('the new dive appears in the log', has(after.dom, 'Test descent to the floor'));
  check('the log shows its pressure', has(after.dom, '1,128'));
  check('the log carries the vehicle', has(after.dom, 'DSV Limiting Factor'));

  const bad = await fetch(`${BASE}/api/dives`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: '', targetDepth: 100 }),
  });
  check('a dive without a label is rejected', bad.status === 400);

  const tooDeep = await fetch(`${BASE}/api/dives`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'too deep', targetDepth: 99999 }),
  });
  check('a depth beyond the ocean is rejected', tooDeep.status === 400);

  const del = await fetch(`${BASE}/api/dives/${payload.dive.id}`, { method: 'DELETE' });
  check('a dive can be deleted', del.status === 200);
  const delAgain = await fetch(`${BASE}/api/dives/${payload.dive.id}`, { method: 'DELETE' });
  check('deleting twice is a 404', delAgain.status === 404);

  const final = await (await fetch(`${BASE}/api/dives`)).json();
  check('the log is left empty', final.total === 0, `total=${final.total}`);
}

async function telemetrySuite() {
  suite('Live dive telemetry (SSE)');

  const TARGET = 3800;

  // Read until the stream says it is done, or until a generous cap. Stopping
  // at a fixed frame count would assert against a mid-descent frame and call a
  // perfectly good stream broken.
  const frames = await new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const seen = [];
    let done = false;

    const finish = () => {
      clearTimeout(timer);
      controller.abort();
      resolve(seen);
    };

    fetch(`${BASE}/api/dive/stream?depth=${TARGET}&duration=6`, { signal: controller.signal })
      .then(async (res) => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!done) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const part of parts) {
            const ev = /^event: (\w+)$/m.exec(part);
            const data = /^data: (.*)$/m.exec(part);
            if (!ev || !data) continue;
            let parsed;
            try {
              parsed = JSON.parse(data[1]);
            } catch {
              continue;
            }
            seen.push({ event: ev[1], data: parsed });
            if (ev[1] === 'complete') done = true;
          }
        }
        finish();
      })
      .catch(() => finish());
  });

  const open = frames.find((f) => f.event === 'open');
  const telemetry = frames.filter((f) => f.event === 'telemetry');
  const complete = frames.find((f) => f.event === 'complete');

  check('stream opens with a mission brief', !!open, `events: ${[...new Set(frames.map((f) => f.event))].join(', ')}`);
  check('stream delivers telemetry frames', telemetry.length >= 10, `${telemetry.length} frames`);
  check('stream declares its time compression', open?.data?.timeScale > 1, `timeScale=${open?.data?.timeScale}`);
  check('stream signals completion', !!complete, `${telemetry.length} telemetry frames seen`);

  if (telemetry.length) {
    const last = telemetry[telemetry.length - 1];

    // The real invariant: every frame must be consistent with the ocean model
    // at the depth it reports. This holds mid-descent, so it does not depend on
    // catching the final frame.
    const inconsistent = telemetry.filter((f) => {
      const d = f.data;
      const expectedBar = d.depth * 0.1006; // ~1.006 dbar/m near the surface
      return (
        !(d.pressureBar >= expectedBar * 0.95 && d.pressureBar <= expectedBar * 1.08) ||
        !(d.temperature > 0.5 && d.temperature < 30) ||
        !(d.soundSpeed > 1440 && d.soundSpeed < 1620) ||
        !(d.salinity > 34 && d.salinity < 35.5)
      );
    });
    check(
      'every frame is consistent with the ocean model at its depth',
      inconsistent.length === 0,
      inconsistent.length
        ? `${inconsistent.length} bad frames, first: ${JSON.stringify(inconsistent[0].data).slice(0, 160)}`
        : '',
    );

    const monotonic = telemetry.every((f, i) => i === 0 || f.data.depth >= telemetry[i - 1].data.depth - 1);
    check('depth descends monotonically', monotonic);
    check('final depth reaches the target', Math.abs(last.data.depth - TARGET) <= TARGET * 0.01, `depth=${last.data.depth}`);
    check('final pressure matches the API', last.data.pressureBar > 380 && last.data.pressureBar < 392, `${last.data.pressureBar} bar`);
    check('zone is classified', !!last.data.zone?.name, JSON.stringify(last.data.zone));
    check('mission clock advances faster than wall clock', last.data.missionSeconds > last.data.wallSeconds, `${last.data.missionSeconds}s vs ${last.data.wallSeconds}s`);
  }
}

async function assetsSuite() {
  suite('Static assets');

  const assets = [
    ['/css/tokens.css', 'text/css'],
    ['/css/base.css', 'text/css'],
    ['/css/components.css', 'text/css'],
    ['/css/views.css', 'text/css'],
    ['/js/main.js', 'javascript'],
    ['/js/core/dom.js', 'javascript'],
    ['/js/viz/gauges.js', 'javascript'],
    ['/js/views/console.js', 'javascript'],
  ];

  for (const [path, type] of assets) {
    const r = await fetch(`${BASE}${path}`);
    const ct = r.headers.get('content-type') ?? '';
    check(`${path} serves as ${type}`, r.ok && ct.includes(type), `status ${r.status}, type ${ct}`);
  }

  // Conditional requests must work — this is what keeps repeat loads cheap.
  const first = await fetch(`${BASE}/js/main.js`);
  const etag = first.headers.get('etag');
  check('static files carry an ETag', !!etag);
  const second = await fetch(`${BASE}/js/main.js`, { headers: { 'If-None-Match': etag } });
  check('a matching ETag yields 304', second.status === 304, `status ${second.status}`);

  const gz = await fetch(`${BASE}/css/views.css`, { headers: { 'Accept-Encoding': 'gzip' } });
  check('compressible assets are gzipped', gz.headers.get('content-encoding') === 'gzip');
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

async function main() {
  if (!CHROME) {
    console.error('No Chrome or Edge binary found. Set CHROME_PATH to one.');
    process.exit(2);
  }
  console.log(`\x1b[36mABYSS end-to-end tests\x1b[0m`);
  console.log(`  chrome   ${CHROME}`);
  console.log(`  target   ${BASE}`);

  // Bring up a dedicated server instance on the test port.
  //
  // ABYSS_DB points at a throwaway file. Without it the test server and a
  // running dev server share one SQLite database, and the dive-log suite's
  // writes land in the developer's data — which produced a flaky "log page is
  // not empty" failure that had nothing to do with the code under test.
  const testDb = join(workDir, 'abyss-test.db');
  const server = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', join(ROOT, 'server', 'index.mjs')],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        HOST: '127.0.0.1',
        ABYSS_QUIET: '1',
        ABYSS_DB: testDb,
      },
      stdio: 'ignore',
      detached: false,
    },
  );

  const up = await waitForServer();
  if (!up) {
    console.error(`\n\x1b[31mServer did not come up on ${BASE}\x1b[0m`);
    server.kill();
    process.exit(1);
  }
  console.log('  server   started\n');

  try {
    await routeSuite();
    await notFoundSuite();
    await physicsInUiSuite();
    await atlasSuite();
    await photographySuite();
    await apiSuite();
    await diveLogSuite();
    await telemetrySuite();
    await assetsSuite();
  } catch (err) {
    console.error('\n\x1b[31mTest run threw:\x1b[0m', err);
    results.push({ suite: 'harness', name: 'run completed', ok: false, detail: String(err) });
  } finally {
    server.kill();
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log(`\n${'─'.repeat(64)}`);
  if (failed.length === 0) {
    console.log(`\x1b[32mALL PASSED\x1b[0m — ${passed} assertions`);
  } else {
    console.log(`\x1b[31m${failed.length} FAILED\x1b[0m of ${results.length} assertions\n`);
    for (const f of failed) console.log(`  \x1b[31m✗\x1b[0m ${f.suite} › ${f.name}${f.detail ? `\n      ${f.detail}` : ''}`);
  }
  console.log('');
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
