/**
 * shell.js — the persistent chrome.
 *
 * The depth rail and the instrument strip are always on screen, so they
 * subscribe to the store once and update themselves, rather than being
 * re-rendered by each view. This is also why the depth rail survives
 * navigation: it is the one element that makes every page feel like part of
 * the same dive.
 */
import { $, h, num, percent, clamp, rafThrottle } from './core/dom.js';
import { state, on, bootstrap, zoneAt, CHALLENGER_DEEP, setDepth, toggleTheme } from './core/store.js';

/* ------------------------------------------------------------------ *
 * Depth rail
 * ------------------------------------------------------------------ */

function initRail() {
  const zonesHost = $('#rail-zones');
  const marker = $('#rail-marker');
  const valueEl = $('#rail-value');
  const zoneEl = $('#rail-zone');

  let zoneEls = new Map();
  let lastDepth = -1;

  function buildZones(zones) {
    if (!zonesHost) return;
    zonesHost.replaceChildren();
    zoneEls = new Map();
    for (const z of zones) {
      const top = (z.min / CHALLENGER_DEEP) * 100;
      const height = ((z.max - z.min) / CHALLENGER_DEEP) * 100;
      const el = h('div.rail__zone', {
        style: {
          top: `${top}%`,
          height: `${Math.max(0.6, height)}%`,
          '--zone-accent': z.accent,
        },
        title: `${z.name} · ${num(z.min)}–${num(z.max)} m`,
      });
      zonesHost.appendChild(el);
      zoneEls.set(z.id, el);
    }
  }

  function paint(depth) {
    if (Math.abs(depth - lastDepth) < 0.4) return;
    lastDepth = depth;

    const t = clamp(depth / CHALLENGER_DEEP, 0, 1);
    if (marker) marker.style.top = `${t * 100}%`;
    if (valueEl) valueEl.textContent = depth >= 1000 ? `${(depth / 1000).toFixed(2)} km` : `${Math.round(depth)} m`;

    const zone = zoneAt(depth);
    if (zoneEl) zoneEl.textContent = zone.name;
    for (const [id, el] of zoneEls) el.classList.toggle('is-active', id === zone.id);
  }

  on('zones', buildZones);
  on('depth', paint);
  if (state.zones.length) buildZones(state.zones);
  paint(state.depth);

  return { paint };
}

/* ------------------------------------------------------------------ *
 * Instrument strip
 * ------------------------------------------------------------------ */

function initStrip() {
  const els = {
    depth: $('#strip-depth'),
    zone: $('#strip-zone'),
    dot: $('#strip-dot'),
    pressure: $('#r-pressure'),
    temp: $('#r-temp'),
    sal: $('#r-sal'),
    sound: $('#r-sound'),
    density: $('#r-density'),
    light: $('#r-light'),
    source: $('#strip-source'),
  };

  let previous = {};

  /** Flash a readout when its value changes materially, so motion is legible. */
  function set(el, key, text, changed) {
    if (!el) return;
    el.textContent = text;
    if (changed) {
      el.classList.add('is-flash');
      clearTimeout(el._flashTimer);
      el._flashTimer = setTimeout(() => el.classList.remove('is-flash'), 420);
    }
  }

  function paintDepth(depth) {
    if (els.depth) {
      els.depth.replaceChildren(
        document.createTextNode(num(Math.round(depth))),
        h('small', null, 'm'),
      );
    }
    const zone = zoneAt(depth);
    if (els.zone) els.zone.textContent = zone.alias ?? zone.name;
    if (els.dot) els.dot.style.background = zone.accent ?? 'var(--accent)';
  }

  function paintOcean(o) {
    if (!o) return;
    const changed = (key, v, eps) =>
      previous[key] === undefined || Math.abs(previous[key] - v) > eps;

    set(els.pressure, 'p', `${num(o.pressureBar, o.pressureBar < 10 ? 2 : 1)} bar`, changed('p', o.pressureBar, 0.05));
    set(els.temp, 't', `${num(o.temperature, 2)} °C`, changed('t', o.temperature, 0.01));
    set(els.sal, 's', `${num(o.salinity, 2)} PSU`, changed('s', o.salinity, 0.01));
    set(els.sound, 'c', `${num(o.soundSpeed, 1)} m/s`, changed('c', o.soundSpeed, 0.1));
    set(els.density, 'd', `${num(o.density, 1)}`, changed('d', o.density, 0.1));

    const blue = o.light?.bands?.find((b) => b.key === 'blue');
    set(els.light, 'l', blue ? percent(blue.percent, 2) : '—', changed('l', blue?.percent ?? 0, 0.001));

    previous = { p: o.pressureBar, t: o.temperature, s: o.salinity, c: o.soundSpeed, d: o.density, l: blue?.percent };

    if (els.source) {
      const live = state.depthSource === 'telemetry';
      els.source.textContent = live ? 'live' : state.depthSource === 'console' ? 'target' : 'model';
      els.source.className = `badge${live ? ' badge--live' : ''}`;
    }
  }

  on('depth', paintDepth);
  on('ocean', paintOcean);

  paintDepth(state.depth);
  if (state.ocean) paintOcean(state.ocean);
}

/* ------------------------------------------------------------------ *
 * Header behaviour
 * ------------------------------------------------------------------ */

function initHeader() {
  const toggle = $('#theme-toggle');
  toggle?.addEventListener('click', () => toggleTheme());

  // Shrink the topbar once the reader has scrolled past the hero.
  const topbar = $('#topbar');
  const onScroll = rafThrottle(() => {
    topbar?.classList.toggle('is-condensed', window.scrollY > 40);
  });
  window.addEventListener('scroll', onScroll, { passive: true });
}

/* ------------------------------------------------------------------ *
 * Scroll → depth
 * ------------------------------------------------------------------ */

/**
 * On pages that carry a descent narrative, the scroll position drives the
 * depth reading. Elements marked `data-depth` declare the depth they
 * represent; the observer picks the one nearest the middle of the viewport.
 */
export function initScrollDepth(root = document) {
  const markers = Array.from(root.querySelectorAll('[data-depth]'));
  if (!markers.length) return () => {};

  const update = () => {
    const mid = window.innerHeight * 0.5;
    let best = null;
    let bestDist = Infinity;
    for (const el of markers) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const centre = rect.top + rect.height / 2;
      const dist = Math.abs(centre - mid);
      if (dist < bestDist) {
        bestDist = dist;
        best = el;
      }
    }
    if (!best) return;
    const d = Number(best.dataset.depth);
    if (Number.isFinite(d)) setDepth(d, 'scroll');
  };

  // Coalesce scroll bursts to one update per frame, but never let the guard
  // wedge: `run` clears the flag before doing any work, so the rAF path and the
  // timeout fallback cannot deadlock each other, and a thrown error cannot
  // leave the observer permanently disabled. update() is idempotent, so a
  // double invocation is harmless.
  let ticking = false;
  const run = () => {
    ticking = false;
    try {
      update();
    } catch (err) {
      console.error('scroll depth update failed', err);
    }
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(run);
    // Safety net for environments where rAF is throttled or suspended.
    setTimeout(run, 200);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  document.addEventListener('scroll', onScroll, { passive: true });
  update();

  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    document.removeEventListener('scroll', onScroll);
  };
}

/**
 * Map total document scroll to a 0..1 progress value, and publish it as the
 * `--depth-progress` custom property so the background gradient can react
 * without any JavaScript touching the DOM per frame.
 */
export function initDepthProgress() {
  const root = document.documentElement;
  const update = rafThrottle(() => {
    const scrollable = document.body.scrollHeight - window.innerHeight;
    const t = scrollable > 8 ? clamp(window.scrollY / scrollable, 0, 1) : 0;
    root.style.setProperty('--depth-progress', t.toFixed(4));
  });
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
  return () => {
    window.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
  };
}

/* ------------------------------------------------------------------ *
 * Reveal on scroll
 * ------------------------------------------------------------------ */

export function initReveal(root = document) {
  const items = Array.from(root.querySelectorAll('.reveal'));
  if (!items.length) return;

  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
  );

  items.forEach((el) => io.observe(el));
  // Anything already on screen at mount should appear immediately.
  requestAnimationFrame(() => items.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight) el.classList.add('is-visible');
  }));
}

/* ------------------------------------------------------------------ *
 * Init
 * ------------------------------------------------------------------ */

export function initShell() {
  initHeader();
  initRail();
  initStrip();
  initDepthProgress();

  // Warm the catalogue so the rail has zones to draw.
  bootstrap().catch((err) => console.warn('catalogue bootstrap failed:', err.message));

  // Prime the water-column readout at the surface. Without this the strip sits
  // empty on any page that does not set its own depth (the atlas, the log, the
  // method page), because nothing has asked the server for an ocean state yet.
  if (!state.ocean) setDepth(state.depth, 'scroll');
}

export { bootstrap };
