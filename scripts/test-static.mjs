/**
 * test-static.mjs — does dist/ work with no backend?
 *
 * The static build is a separate artifact from the one the other suites test,
 * and "it looked fine in a screenshot" is not verification. This drives real
 * headless Chrome against dist/ served by scripts/serve-static.mjs, which has
 * no /api routes at all — so any hidden dependency on the server surfaces as a
 * failed assertion rather than as a broken page after deploying.
 *
 * The decisive assertion is the last one: the numbers the BROWSER computes must
 * equal the numbers the SERVER computed. That is what "the same physics module
 * runs in both" has to mean, and it is the claim the write-up makes.
 *
 *   node scripts/test-static.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DIST = join(ROOT, 'dist');

const PORT = Number(process.env.ABYSS_STATIC_PORT ?? 8901);

/**
 * Served from a SUBDIRECTORY, because that is how GitHub Pages serves a project
 * site: https://joek670.github.io/abyss/ rather than the domain root.
 *
 * The first deployment was tested at the domain root, passed every assertion,
 * and was still broken when published — every asset path in the app was
 * root-absolute, so /css/tokens.css resolved outside the site. Serving under a
 * base is what reproduces that locally; without it the suite is testing a
 * URL shape GitHub Pages never uses.
 */
const SITE_BASE = '/abyss';
const BASE = `http://127.0.0.1:${PORT}${SITE_BASE}`;

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`[\x1b[32m  ok  \x1b[0m] ${name}`);
  } else {
    failures.push(name);
    console.log(`[\x1b[31m FAIL \x1b[0m] ${name}${detail ? `\n         ${detail}` : ''}`);
  }
}

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));

const workDir = mkdtempSync(join(tmpdir(), 'abyss-static-'));

function loadDom(path, { width = 1440, height = 1000, budget = 15000 } = {}) {
  const outFile = join(workDir, `d-${Math.random().toString(36).slice(2)}.html`);
  const errFile = join(workDir, `e-${Math.random().toString(36).slice(2)}.log`);
  const outFd = openSync(outFile, 'w');
  const errFd = openSync(errFile, 'w');

  spawnSync(
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
  for (const f of [outFile, errFile]) {
    try {
      rmSync(f, { force: true });
    } catch {
      /* best effort */
    }
  }
  return { dom, stderr };
}

const text = (dom) => dom.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const has = (dom, s) => text(dom).includes(String(s).toLowerCase());

async function waitFor(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  if (!CHROME) {
    console.error('No Chrome/Edge found. Set CHROME_PATH.');
    process.exit(2);
  }

  console.log('\n\x1b[36mABYSS static build — backend-free verification\x1b[0m');
  console.log(`  dist     ${DIST}`);
  console.log(`  chrome   ${CHROME}\n`);

  /* A. The build produced what it promised. */
  const required = [
    'index.html',
    'data/species.json',
    'data/catalogue.json',
    'js/lib/ocean.js',
    'js/lib/search.js',
    'js/core/mode.js',
    '.nojekyll',
  ];
  const missing = required.filter((f) => !existsSync(join(DIST, f)));
  check('dist contains every required file', missing.length === 0, `missing: ${missing.join(', ')}`);

  // Regression guard for the phone-layout bug class. `repeat(auto-fit,
  // minmax(300px, 1fr))` cannot produce a track narrower than 300px, so on a
  // viewport below that the grid pushes past the screen and .panel's
  // overflow:hidden silently cuts the content off — which is how the dive
  // console shipped with its pressure readings clipped mid-number. Wrapping
  // the floor in min(..., 100%) keeps the multi-column intent and lets the
  // track collapse. Source-level because the failure is a layout one that
  // --dump-dom cannot see.
  const gridSources = [
    ...['base.css', 'components.css', 'views.css'].map((f) => ['public/css/' + f, join(ROOT, 'public', 'css', f)]),
    ...['about.js', 'atlas.js', 'console.js', 'home.js', 'log.js', 'post.js', 'species.js'].map((f) => [
      'public/js/views/' + f,
      join(ROOT, 'public', 'js', 'views', f),
    ]),
  ].filter(([, abs]) => existsSync(abs));
  const rigidTracks = [];
  for (const [label, abs] of gridSources) {
    const src = readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/repeat\(\s*auto-(?:fit|fill)\s*,\s*minmax\(\s*(\d+)px/g)) {
      rigidTracks.push(`${label}: minmax(${m[1]}px, ...)`);
    }
  }
  check(
    'auto-fit grid tracks can collapse below their floor',
    rigidTracks.length === 0,
    `use minmax(min(Npx, 100%), 1fr) — ${rigidTracks.join('; ')}`,
  );

  const mode = existsSync(join(DIST, 'js', 'core', 'mode.js'))
    ? readFileSync(join(DIST, 'js', 'core', 'mode.js'), 'utf8')
    : '';
  check('the build declares static mode', mode.includes('STATIC_MODE = true'));

  const repoMode = readFileSync(join(ROOT, 'public', 'js', 'core', 'mode.js'), 'utf8');
  check(
    'the repository copy still declares server mode',
    repoMode.includes('STATIC_MODE = false'),
    'dist must be the only place static mode is switched on',
  );

  const species = JSON.parse(readFileSync(join(DIST, 'data', 'species.json'), 'utf8'));
  check('species.json carries the catalogue', species.items?.length === 36, `${species.items?.length} items`);
  check(
    'species.json carries photographs and credits',
    species.items.filter((s) => s.image?.artist).length >= 30,
    `${species.items.filter((s) => s.image?.artist).length} with a credited image`,
  );

  /* B. Serve it with no backend. */
  const server = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', join(ROOT, 'scripts', 'serve-static.mjs'), `--port=${PORT}`, `--base=${SITE_BASE}`],
    { cwd: ROOT, stdio: 'ignore' },
  );

  if (!(await waitFor(`${BASE}/index.html`))) {
    console.error('  static preview server did not start');
    server.kill();
    process.exit(1);
  }

  try {
    /* C. There is genuinely no API — even under the base. */
    const apiProbe = await fetch(`${BASE}/api/health`);
    check(
      'no API is served under the site base',
      apiProbe.status === 404,
      `expected 404, got ${apiProbe.status}`,
    );

    const dataProbe = await fetch(`${BASE}/data/species.json`);
    check(
      'the catalogue is served as a plain file from the base',
      dataProbe.ok && dataProbe.headers.get('content-type')?.includes('json'),
    );

    /* C2. Root-absolute asset paths are the bug that broke the first deploy:
     * /css/tokens.css under /abyss/ resolves outside the site. Assert that the
     * document references its assets relatively. */
    const indexHtml = await (await fetch(`${BASE}/`)).text();
    const absoluteRefs = (indexHtml.match(/(?:src|href)="\/(?!\/)/g) ?? []).length;
    check(
      'index.html references assets relatively, not root-absolute',
      absoluteRefs === 0,
      `${absoluteRefs} root-absolute reference(s) — these 404 under a subdirectory`,
    );
    check('index.html references the stylesheet relatively', indexHtml.includes('href="css/tokens.css"'));

    /* D. Every route renders with no server behind it. */
    const routes = [
      { path: '/#/', must: ['The ocean is', 'Begin the descent'] },
      { path: '/#/atlas', must: ['The Atlas', 'Blue Shark', '36 specimens'] },
      { path: '/#/console?depth=10935', must: ['Dive Console', 'TARGET DEPTH'] },
      { path: '/#/post', must: ['How ABYSS was built', 'The numbers are the point', '1,086 bar'] },
      { path: '/#/atlas/dumbo-octopus', must: ['Dumbo Octopus', 'NOAA Okeanos Explorer'] },
      { path: '/#/about', must: ['UNESCO EOS-80', 'Mackenzie (1981)'] },
      { path: '/#/log', must: ['Dive Log'] },
    ];

    for (const route of routes) {
      const { dom, stderr } = loadDom(route.path);
      const body = text(dom);
      const missingText = route.must.filter((m) => !body.includes(m.toLowerCase()));
      const crashed = dom.includes('could not be rendered') || dom.includes('View returned no content');
      const errs = stderr
        .split('\n')
        .filter(
          (l) =>
            /Uncaught|SyntaxError|TypeError|ReferenceError|Failed to load resource/i.test(l) &&
            !/favicon/i.test(l),
        );

      check(
        `${route.path} renders`,
        !crashed && missingText.length === 0,
        crashed ? 'error view shown' : `missing: ${missingText.join(' | ')}`,
      );
      check(`${route.path} logs no JS errors`, errs.length === 0, errs.slice(0, 2).join('\n         '));
    }

    /* E. The claim the write-up makes: the browser computes the SERVER's numbers.
     *    These expected strings were produced by the Node physics engine; if the
     *    shared module ever stops being shared, this fails. */
    const deep = loadDom('/#/console?depth=10935');
    check(
      'browser-computed pressure at 10,935 m matches the server',
      has(deep.dom, '1,128.0 bar'),
      'expected 1,128.0 bar — the server value for Challenger Deep',
    );
    check('browser-computed temperature matches the server', has(deep.dom, '2.28 °c'));
    check('browser-computed sound speed matches the server', has(deep.dom, '1,599.0 m/s'));
    check('browser-computed compression matches the server', has(deep.dom, '4.59 %'));

    const surface = loadDom('/#/console?depth=0');
    check('the surface reads zero gauge pressure in the browser', has(surface.dom, '0.00 bar'));

    const profile = loadDom('/#/console');
    check('the profile panel is present and computed', has(profile.dom, 'PROFILE'));
    // The chart's axis labels and legend are painted onto the canvas with
    // ctx.fillText, so they are NOT in the DOM and no DOM assertion can see
    // them. Assert the canvas is there and that the surrounding readouts —
    // which do live in the DOM — carry values only the physics engine can
    // produce.
    check(
      'the profile canvas is rendered',
      profile.dom.includes('id="profile-chart"'),
      'expected the canvas element',
    );
    check(
      'surrounding readouts carry locally computed values',
      has(profile.dom, '1,522.0 m/s') || has(profile.dom, '1,535.4 m/s'),
      'expected a browser-computed sound speed at the default depth',
    );
  } finally {
    server.kill();
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  console.log(`\n${'─'.repeat(64)}`);
  if (!failures.length) console.log(`\x1b[32mALL PASSED\x1b[0m — ${passed} assertions\n`);
  else {
    console.log(`\x1b[31m${failures.length} FAILED\x1b[0m of ${passed + failures.length}\n`);
    for (const f of failures) console.log(`  \x1b[31m✗\x1b[0m ${f}`);
    console.log('');
  }
  process.exit(failures.length ? 1 : 0);
}

main();