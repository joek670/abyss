/**
 * console.js — the dive console.
 *
 * Two modes share one layout. In *target* mode the depth is set by the slider
 * and the panels show what the ocean is like there. In *live* mode an
 * EventSource drives a descent, and the whole chrome — rail, strip, gauges,
 * chart — follows the simulated vehicle down.
 *
 * Telemetry frames are pushed into the shared store via `setOcean`, so a dive
 * started here visibly moves the depth rail and instrument strip everywhere
 * else on the site. That is the point: the console is not a widget, it is the
 * site's depth control.
 *
 * `render()` is pure markup; `mount()` wires behaviour and returns a teardown
 * function, which the router calls before the next view mounts.
 */
import { h, num, percent, clamp, debounce } from '../core/dom.js';
import { api, streamDive, STATIC_MODE } from '../core/api.js';
import { on, setDepth, setOcean, CHALLENGER_DEEP } from '../core/store.js';
import { createGauge } from '../viz/gauges.js';
import { createProfileChart } from '../viz/charts.js';
import { openSpeciesDrawer, closeDrawer } from './parts.js';
import { sprite } from '../viz/sprites.js';
import { notifyError, toast } from '../core/toast.js';

const PRESETS = [
  { depth: 100, label: '100 m', note: 'Recreational scuba limit' },
  { depth: 1000, label: '1,000 m', note: 'Sunlight ends' },
  { depth: 3800, label: '3,800 m', note: 'RMS Titanic' },
  { depth: 6000, label: '6,000 m', note: 'Hadal boundary' },
  { depth: 8336, label: '8,336 m', note: 'Deepest fish filmed' },
  { depth: 10935, label: '10,935 m', note: 'Challenger Deep' },
];

const CRAFT = [
  'DSV Limiting Factor',
  'ROV Jason II',
  'ROV Victor 6000',
  'Kaikō ROV',
  'Trieste',
  'unmanned lander',
  'free-diving mammal',
];

const LANDMARKS = [
  { depth: 40, name: 'Recreational scuba limit', note: 'PADI / NOAA' },
  { depth: 332, name: 'Deepest scuba dive', note: 'Ahmed Gabr, 2014' },
  { depth: 535, name: 'Deepest penguin dive', note: 'Emperor penguin' },
  { depth: 1000, name: 'Bathypelagic begins', note: 'no sunlight left' },
  { depth: 2250, name: 'Sperm whale hunt', note: 'typical depth' },
  { depth: 2992, name: 'Deepest mammal dive', note: "Cuvier's beaked whale" },
  { depth: 3682, name: 'Mean ocean depth', note: 'NOAA/WHOI estimate, 2010' },
  { depth: 3800, name: 'RMS Titanic', note: 'North Atlantic' },
  { depth: 6000, name: 'Hadal boundary', note: 'trenches only' },
  { depth: 8336, name: 'Deepest fish filmed', note: 'Izu-Ogasawara, 2022' },
  { depth: 10935, name: 'Challenger Deep', note: 'the floor' },
];

/**
 * Read the target depth from the URL.
 *
 * NOT `Number(raw) || 3800` — that treats a legitimate depth of 0 as falsy and
 * silently substitutes the default, so `#/console?depth=0` rendered 3800 m.
 * Zero is the surface and is a perfectly valid target.
 */
function parseDepth(raw, fallback = 3800) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return clamp(Math.round(n), 0, CHALLENGER_DEEP);
}

export const consoleView = {
  title: () => 'Dive Console',

  async render(ctx) {
    const initial = parseDepth(ctx.query.get('depth'));
    const page = h('div.page.page--wide');

    page.append(
      h(
        'header',
        { style: { marginBottom: 'var(--s-5)' } },
        h('span.eyebrow', null, 'Instrument panel'),
        h(
          'h1',
          {
            style: {
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--t-4)',
              fontWeight: '400',
              letterSpacing: 'var(--tr-tight)',
              marginTop: 'var(--s-2)',
            },
          },
          'Dive Console',
        ),
        h(
          'p.lede',
          { style: { marginTop: 'var(--s-3)' } },
          'Set a depth to read the water column, or run a descent and watch the ' +
            'instruments follow it down. Pressure, temperature, salinity, density and sound ' +
            'speed are recomputed at every metre — ' +
            (STATIC_MODE
              ? 'in your browser, by the same physics module the server runs.'
              : 'by the server.'),
        ),
      ),
    );

    /* ── Controls column ────────────────────────────────────────────── */

    const controls = h(
      'div.console__controls',
      null,
      h(
        'div.panel',
        null,
        h('div.panel__head', null, h('span.panel__title', null, 'Target depth')),
        h(
          'div.panel__body.stack.stack-5',
          null,
          h(
            'div.depth-input',
            null,
            h('input', {
              id: 'depth-number',
              type: 'number',
              min: '0',
              max: String(CHALLENGER_DEEP),
              step: '1',
              value: String(initial),
              'aria-label': 'Target depth in metres',
            }),
            h('span', null, 'm'),
          ),
          h('input.range', {
            id: 'depth-slider',
            type: 'range',
            min: '0',
            max: String(CHALLENGER_DEEP),
            step: '1',
            value: String(initial),
            'aria-label': 'Target depth',
            style: { '--range-fill': `${(initial / CHALLENGER_DEEP) * 100}%` },
          }),
          h(
            'div.presets',
            null,
            ...PRESETS.map((p) =>
              // NOTE: `data-preset`, not `data-depth`. The shell's scroll
              // observer selects `[data-depth]` to drive the depth rail, and
              // these chips live inside the view, so a `data-depth` here would
              // be picked up as a scroll marker and yank the rail to 100 m.
              h('button.chip', { type: 'button', dataset: { preset: String(p.depth) }, title: p.note }, p.label),
            ),
          ),
          h(
            'div.field',
            null,
            h('label.field__label', { for: 'craft-select' }, 'Vehicle'),
            h(
              'select.select',
              { id: 'craft-select' },
              ...CRAFT.map((c) => h('option', { value: c }, c)),
            ),
          ),
          h(
            'div',
            null,
            h('button.btn.btn--primary', { type: 'button', id: 'dive-btn', style: { width: '100%' } }, 'Run the descent'),
            h(
              'div.mission',
              { id: 'mission', hidden: true },
              h('div.mission__bar', null, h('div.mission__fill', { id: 'mission-fill' })),
              h(
                'div.mission__meta',
                null,
                h('span', { id: 'mission-elapsed' }, '00:00'),
                h('span', { id: 'mission-depth' }, '0 m'),
                h('span', { id: 'mission-left' }, '—'),
              ),
            ),
          ),
        ),
      ),
      h(
        'div.panel',
        null,
        h('div.panel__head', null, h('span.panel__title', null, 'Landmarks')),
        h('div.panel__body', null, h('div.ladder', { id: 'ladder' })),
      ),
    );

    /* ── Stage column ───────────────────────────────────────────────── */

    const stage = h(
      'div.console__stage',
      null,

      h(
        'div.panel',
        { id: 'live-panel', hidden: true },
        h(
          'div.panel__head',
          null,
          h('span.panel__title', null, 'Live telemetry'),
          h('span.badge.badge--live', null, 'streaming'),
        ),
        h('div.panel__body', null, h('div.live', { id: 'live-grid' })),
      ),

      h(
        'div.panel',
        null,
        h(
          'div.panel__head',
          null,
          h('span.panel__title', null, 'Water column'),
          h('span.badge', { id: 'zone-badge' }, '—'),
        ),
        h('div.panel__body', null, h('div.gauges', { id: 'gauges' })),
      ),

      h(
        'div.panel',
        null,
        h(
          'div.panel__head',
          null,
          h('span.panel__title', null, 'Profile — 0 to 10,935 m'),
          h('span.tiny.dim', null, 'hover to read any depth'),
        ),
        h(
          'div.panel__body',
          { style: { padding: 0 } },
          h(
            'div.chart-wrap',
            null,
            h('canvas', {
              id: 'profile-chart',
              'aria-label': 'Depth profile of temperature, sound speed and density',
            }),
          ),
        ),
        h(
          'div.chart-legend',
          null,
          h('span', { style: { color: '#ff8f6b' } }, h('i'), 'Temperature'),
          h('span', { style: { color: '#4fe3d0' } }, h('i'), 'Sound speed'),
          h('span', { style: { color: '#8fa8ff' } }, h('i'), 'Density'),
        ),
      ),

      h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
            gap: 'var(--s-5)',
            alignItems: 'start',
          },
        },
        h(
          'div.panel',
          null,
          h('div.panel__head', null, h('span.panel__title', null, 'What that pressure means')),
          h('div.panel__body', null, h('div.equiv', { id: 'equiv' })),
        ),
        h(
          'div.panel',
          null,
          h(
            'div.panel__head',
            null,
            h('span.panel__title', null, 'Recorded at this depth'),
            h('span.tiny.dim', null, 'tap for detail'),
          ),
          h('div.panel__body', null, h('div', { id: 'fauna' })),
        ),
      ),
    );

    page.append(h('div.console', null, controls, stage));
    return page;
  },

  async mount(ctx, node) {
    const initial = parseDepth(ctx.query.get('depth'));

    const depthNumber = node.querySelector('#depth-number');
    const slider = node.querySelector('#depth-slider');
    const craftSelect = node.querySelector('#craft-select');
    const diveBtn = node.querySelector('#dive-btn');
    const missionPanel = node.querySelector('#mission');
    const missionFill = node.querySelector('#mission-fill');
    const missionElapsed = node.querySelector('#mission-elapsed');
    const missionDepth = node.querySelector('#mission-depth');
    const missionLeft = node.querySelector('#mission-left');
    const livePanel = node.querySelector('#live-panel');
    const liveGrid = node.querySelector('#live-grid');
    const gaugesHost = node.querySelector('#gauges');
    const zoneBadge = node.querySelector('#zone-badge');
    const equivHost = node.querySelector('#equiv');
    const ladderHost = node.querySelector('#ladder');
    const faunaHost = node.querySelector('#fauna');
    const canvas = node.querySelector('#profile-chart');

    /* ── Gauges ─────────────────────────────────────────────────────── */

    const gaugePressure = createGauge({
      label: 'Pressure', unit: 'bar', min: 0, max: 1200,
      colour: 'var(--accent)', format: (v) => num(v, v < 100 ? 1 : 0),
    });
    const gaugeTemp = createGauge({
      label: 'Temperature', unit: '°C', min: 0, max: 30,
      colour: '#ff8f6b', format: (v) => num(v, 1),
    });
    const gaugeSound = createGauge({
      label: 'Sound speed', unit: 'm/s', min: 1440, max: 1620,
      colour: '#8fa8ff', format: (v) => num(v, 0),
    });
    const gaugeLight = createGauge({
      label: 'Blue light', unit: '% of surface', min: 1e-9, max: 100, log: true,
      colour: 'var(--lure)', format: (v) => percent(v, 2),
    });
    gaugesHost.append(gaugePressure.el, gaugeTemp.el, gaugeSound.el, gaugeLight.el);

    /* ── Chart ──────────────────────────────────────────────────────── */

    let chart = null;

    /* ── State ──────────────────────────────────────────────────────── */

    let stream = null;
    let currentDepth = initial;
    let diveStart = 0;
    let diveDuration = 30;
    let lastFrame = null;

    /* ── Depth control ──────────────────────────────────────────────── */

    const syncUrl = debounce((d) => {
      const next = new URLSearchParams(location.hash.split('?')[1] ?? '');
      next.set('depth', String(d));
      history.replaceState(null, '', `#/console?${next}`);
    }, 400);

    function commit(value, { fromSlider = false } = {}) {
      const d = clamp(Math.round(Number(value) || 0), 0, CHALLENGER_DEEP);
      currentDepth = d;
      if (!fromSlider) slider.value = String(d);
      depthNumber.value = String(d);
      slider.style.setProperty('--range-fill', `${(d / CHALLENGER_DEEP) * 100}%`);
      setDepth(d, 'console');
      chart?.setDepth(d);
      syncUrl(d);
    }

    slider.addEventListener('input', () => commit(slider.value, { fromSlider: true }));
    depthNumber.addEventListener('change', () => commit(depthNumber.value));
    depthNumber.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit(depthNumber.value);
    });

    for (const chip of node.querySelectorAll('.presets .chip')) {
      chip.addEventListener('click', () => commit(chip.dataset.preset));
    }

    /* ── Dive stream ────────────────────────────────────────────────── */

    diveBtn.addEventListener('click', () => (stream ? stopDive() : startDive()));

    function startDive() {
      // Allow a dive to the surface: only fall back when the field is empty or
      // unparseable, never merely because the value is 0.
      const typed = depthNumber.value;
      const parsed = typed === '' ? NaN : Number(typed);
      const target = Number.isFinite(parsed)
        ? clamp(Math.round(parsed), 0, CHALLENGER_DEEP)
        : currentDepth;
      diveDuration = target > 6000 ? 42 : target > 1500 ? 32 : 22;
      diveStart = performance.now();
      lastFrame = null;

      livePanel.hidden = false;
      missionPanel.hidden = false;
      diveBtn.textContent = 'Abort dive';
      diveBtn.classList.remove('btn--primary');

      stream = streamDive({
        depth: target,
        craft: craftSelect.value,
        duration: diveDuration,
        timeScale: Math.round(target / 4),
        onOpen: (info) =>
          toast(`Descending to ${num(target)} m at ${num(info.descentRate)} m per mission-minute.`, {
            title: 'Dive started',
            duration: 3200,
          }),
        onTelemetry: (t) => {
          lastFrame = t;
          setOcean(telemetryToOcean(t), { depth: t.depth, source: 'telemetry' });
          paintLive(t);
          paintMission(t, target);
        },
        onComplete: () => {
          toast(`Station keeping at ${num(target)} m.`, { title: 'Dive complete', tone: 'ok' });
          stopDive();
        },
        onError: () => stopDive(),
      });
    }

    function stopDive() {
      stream?.close();
      stream = null;
      diveBtn.textContent = 'Run the descent';
      diveBtn.classList.add('btn--primary');
      missionPanel.hidden = true;
      missionFill.style.width = '0%';
      // Hand the depth back to the slider so the console stays coherent.
      if (lastFrame) commit(lastFrame.depth);
    }

    function paintLive(t) {
      const cells = [
        ['Depth', `${num(t.depth, 1)} m`],
        ['Pressure', `${num(t.pressureBar, 1)} bar`],
        ['Atmospheres', num(t.pressureAtm, 0)],
        ['Temperature', `${num(t.temperature, 2)} °C`],
        ['Salinity', `${num(t.salinity, 2)} PSU`],
        ['Density', num(t.density, 2)],
        ['Sound speed', `${num(t.soundSpeed, 1)} m/s`],
        ['Compression', `${num(t.compression, 2)} %`],
        ['Zone', t.zone.name],
        ['Vehicle', t.craft],
      ];
      liveGrid.replaceChildren(
        ...cells.map(([k, v]) =>
          h('div.live__cell', null, h('div.live__k', null, k), h('div.live__v', null, v)),
        ),
      );
    }

    function paintMission(t, target) {
      missionFill.style.width = `${(t.progress * 100).toFixed(1)}%`;
      missionDepth.textContent = `${num(t.depth, 0)} / ${num(target, 0)} m`;
      missionElapsed.textContent = `mission ${clock(t.missionSeconds)}`;
      missionLeft.textContent =
        t.phase === 'station'
          ? 'on station'
          : `${Math.round((1 - t.progress) * 100)} % to go`;
    }

    /* ── React to the shared depth state ────────────────────────────── */

    const offOcean = on('ocean', (o) => {
      if (!o) return;
      gaugePressure.set(o.pressureBar);
      gaugeTemp.set(o.temperature);
      gaugeSound.set(o.soundSpeed);
      const blue = o.light?.bands?.find((b) => b.key === 'blue');
      gaugeLight.set(blue ? blue.percent : 0);

      if (zoneBadge) {
        zoneBadge.textContent = `${o.zone.name} · ${o.zone.alias}`;
        // The deep-zone accents are very dark (#0b2a3d for hadal) and would be
        // unreadable as text on the panel. Keep the hue but lift it toward the
        // foreground so every zone stays legible.
        zoneBadge.style.color = `color-mix(in oklab, ${o.zone.accent} 55%, var(--text-0))`;
        zoneBadge.style.borderColor = `color-mix(in oklab, ${o.zone.accent} 45%, transparent)`;
      }
      paintEquivalences(equivHost, o);
      paintLadder(ladderHost, o.depth);
      if (o.species) paintFauna(faunaHost, o.species);
    });

    /* ── Initial load ───────────────────────────────────────────────── */

    paintLadder(ladderHost, initial);

    const [profileRes, oceanRes] = await Promise.allSettled([
      api.profile(CHALLENGER_DEEP, 50),
      api.oceanAt(initial),
    ]);

    if (profileRes.status === 'fulfilled' && canvas) {
      chart = createProfileChart(canvas, { rows: profileRes.value.rows, maxDepth: CHALLENGER_DEEP });
      chart.setDepth(initial);
    }

    if (oceanRes.status === 'fulfilled') {
      setOcean(oceanRes.value, { depth: initial, source: 'console' });
    } else {
      notifyError(oceanRes.reason ?? new Error('Could not read the water column'));
    }

    /* ── Teardown ───────────────────────────────────────────────────── */

    return () => {
      offOcean();
      stream?.close();
      stream = null;
      chart?.destroy();
      chart = null;
      gaugePressure.destroy();
      gaugeTemp.destroy();
      gaugeSound.destroy();
      gaugeLight.destroy();
      closeDrawer();
    };
  },
};

/* ------------------------------------------------------------------ *
 * Painting helpers
 * ------------------------------------------------------------------ */

function paintEquivalences(host, o) {
  if (!host) return;
  const e = o.equivalences ?? {};
  const psi = o.pressurePsi ?? (o.pressureBar * 1e5) / 6894.757293168;
  const kgcm2 = e.kgPerCm2 ?? (o.pressureBar * 1e5) / 98066.5;
  const viewport = e.viewportForceNewtons ?? o.pressureBar * 1e5 * Math.PI * 0.05 ** 2;

  const rows = [
    ['Pressure', `${num(o.pressureBar, 1)} bar`],
    ['In atmospheres', `${num(o.pressureAtm, 0)} atm`],
    ['Pounds per square inch', `${num(psi, 0)} psi`],
    ['Kilograms per cm²', `${num(kgcm2, 0)} kg/cm²`],
    ['Force on a 10 cm viewport', `${num(viewport / 1000, 0)} kN`],
    ['Water compression', `${num(o.compression ?? 0, 2)} % denser than at the surface`],
    ['Sound speed', `${num(o.soundSpeed, 1)} m/s`],
    ['Density', `${num(o.density, 2)} kg/m³`],
  ];

  host.replaceChildren(
    ...rows.map(([k, v]) =>
      h('div.equiv__row', null, h('span.equiv__label', null, k), h('span.equiv__value', null, v)),
    ),
  );
}

function paintLadder(host, depth) {
  if (!host) return;

  // The current landmark is the deepest one we have passed.
  let currentIdx = -1;
  LANDMARKS.forEach((r, i) => {
    if (depth >= r.depth) currentIdx = i;
  });

  host.replaceChildren(
    ...LANDMARKS.map((r, i) =>
      h(
        `div.ladder__row${i < currentIdx ? '.is-passed' : ''}${i === currentIdx ? '.is-current' : ''}`,
        null,
        h('span.ladder__d', null, `${num(r.depth)} m`),
        h('span.ladder__name', null, r.name),
        h('span.ladder__note', null, r.note),
      ),
    ),
  );
}

function paintFauna(host, species) {
  if (!host) return;
  if (!species.length) {
    host.replaceChildren(
      h('p.muted.small', null, 'No catalogued specimen has a recorded range covering this depth.'),
    );
    return;
  }
  host.replaceChildren(
    ...species.map((sp) =>
      h(
        'button',
        {
          type: 'button',
          class: 'row',
          style: {
            width: '100%',
            gap: 'var(--s-3)',
            padding: 'var(--s-2)',
            borderRadius: 'var(--r-2)',
            border: '1px solid transparent',
            textAlign: 'left',
            flexWrap: 'nowrap',
          },
          onclick: () => openSpeciesDrawer(sp.slug),
        },
        h(
          'span',
          { style: { flex: 'none', width: '34px', height: '34px', color: sp.accent } },
          sprite(sp.sprite, { size: 34 }),
        ),
        h(
          'span.grow',
          null,
          h('span', { style: { display: 'block', fontSize: 'var(--t--1)', fontWeight: '500' } }, sp.common),
          h('span.tiny.dim', { style: { display: 'block' } }, `${num(sp.depthMin)}–${num(sp.depthMax)} m`),
        ),
        sp.bioluminescent ? h('span.chip.chip--glow.tiny', null, 'glow') : null,
      ),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Telemetry -> ocean shape
 * ------------------------------------------------------------------ */

/**
 * A telemetry frame carries a subset of the full ocean state. Re-shape it into
 * the same object /api/ocean/at returns so every consumer can treat the two
 * interchangeably.
 */
function telemetryToOcean(t) {
  return {
    depth: t.depth,
    zone: t.zone,
    temperature: t.temperature,
    salinity: t.salinity,
    density: t.density,
    compression: t.compression,
    pressureBar: t.pressureBar,
    pressureAtm: t.pressureAtm,
    pressurePsi: (t.pressureBar * 1e5) / 6894.757293168,
    soundSpeed: t.soundSpeed,
    isDark: t.isDark,
    light: { bands: [{ key: 'blue', percent: t.lightPercent }] },
    equivalences: {
      kgPerCm2: (t.pressureBar * 1e5) / 98066.5,
      viewportForceNewtons: t.pressureBar * 1e5 * Math.PI * 0.05 ** 2,
    },
  };
}

function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh > 0
    ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
