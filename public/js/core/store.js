/**
 * store.js — shared application state.
 *
 * Deliberately tiny: an object, a listener set, and a `setDepth` that
 * coalesces bursts of scroll events into one network request. The depth is the
 * one piece of state that several independent components care about (the rail,
 * the instrument strip, the console), so it lives here rather than being
 * threaded through props.
 */
import { api } from './api.js';
import { debounce } from './dom.js';

const CHALLENGER_DEEP = 10935;

const listeners = new Map();

export const state = {
  /** Current depth of interest, in metres. */
  depth: 0,
  /** Latest /api/ocean/at payload for `depth`, or null while loading. */
  ocean: null,
  /** Zone list from the server. */
  zones: [],
  /** Catalogue summary. */
  catalogue: null,
  /** 'abyss' | 'daylight' */
  theme: 'abyss',
  /** Where the depth value is coming from, so the strip can label it. */
  depthSource: 'scroll', // 'scroll' | 'console' | 'telemetry'
  /** True while the dive stream is live. */
  streaming: false,
};

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  for (const fn of listeners.get(event) ?? []) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`listener for "${event}" threw`, err);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Depth
 * ------------------------------------------------------------------ */

const fetchOcean = debounce(async (depth) => {
  const requested = depth;
  try {
    const data = await api.oceanAt(Math.round(depth));
    // Discard a stale response if the depth moved on while this was in flight.
    if (Math.abs(state.depth - requested) > 1) return;
    state.ocean = data;
    emit('ocean', data);
  } catch (err) {
    if (err.name !== 'AbortError') console.warn('ocean lookup failed', err.message);
  }
}, 90);

/**
 * Set the current depth.
 *
 * `source` matters for the UI: a depth driven by the dive stream is live and
 * gets a pulsing badge, a depth driven by scroll is a reading, and a depth
 * typed into the console is a target.
 */
export function setDepth(depth, source = 'scroll') {
  const clamped = Math.max(0, Math.min(CHALLENGER_DEEP, Number(depth) || 0));
  if (source === 'telemetry' || state.depthSource !== 'telemetry') {
    state.depthSource = source;
  }
  if (Math.abs(clamped - state.depth) < 0.5 && state.ocean) {
    state.depth = clamped;
    emit('depth', clamped);
    return;
  }
  state.depth = clamped;
  emit('depth', clamped);
  fetchOcean(clamped);
}

/** Set the ocean reading directly, bypassing the fetch (used by the stream). */
export function setOcean(data, { depth, source = 'telemetry' } = {}) {
  if (Number.isFinite(depth)) state.depth = depth;
  state.depthSource = source;
  state.ocean = data;
  emit('depth', state.depth);
  emit('ocean', data);
}

/* ------------------------------------------------------------------ *
 * Bootstrap data
 * ------------------------------------------------------------------ */

let bootstrapPromise = null;

/** Load zones + catalogue once, and cache them for the session. */
export function bootstrap() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    const data = await api.catalogue();
    state.zones = data.zones ?? [];
    state.catalogue = data.stats ?? null;
    emit('zones', state.zones);
    return data;
  })().catch((err) => {
    bootstrapPromise = null;
    throw err;
  });
  return bootstrapPromise;
}

/* ------------------------------------------------------------------ *
 * Theme
 * ------------------------------------------------------------------ */

const THEME_KEY = 'abyss.theme';

export function initTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch {
    /* storage disabled — fall back to the OS preference */
  }
  const prefersLight =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
  setTheme(stored ?? (prefersLight ? 'daylight' : 'abyss'), { persist: false });
}

export function setTheme(theme, { persist = true } = {}) {
  state.theme = theme === 'daylight' ? 'daylight' : 'abyss';
  document.documentElement.dataset.theme = state.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', state.theme === 'daylight' ? '#f7f4ee' : '#02060b');
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, state.theme);
    } catch {
      /* ignore */
    }
  }
  emit('theme', state.theme);
}

export function toggleTheme() {
  setTheme(state.theme === 'abyss' ? 'daylight' : 'abyss');
}

/* ------------------------------------------------------------------ *
 * Zone helpers
 * ------------------------------------------------------------------ */

/** Zone object containing a depth, from cached zones (falls back to a stub). */
export function zoneAt(depth) {
  return (
    state.zones.find((z) => depth >= z.min && depth < z.max) ??
    state.zones[state.zones.length - 1] ?? {
      id: 'epipelagic',
      name: 'Epipelagic',
      alias: 'The Sunlight Zone',
      min: 0,
      max: 200,
      accent: '#6fd8ea',
    }
  );
}

export { CHALLENGER_DEEP };
