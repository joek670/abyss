/**
 * api-static.js — the same `api` surface as api-server.js, with no server.
 *
 * Everything the Node backend did is done here instead:
 *
 *   /api/ocean/*     -> the shared physics module, running in the browser
 *   /api/species     -> data/species.json, filtered and ranked by the shared
 *                       search module
 *   /api/dives       -> localStorage
 *   /api/dive/stream -> a local simulation loop
 *
 * The physics and search imports are the SAME files the server runs, copied to
 * js/lib/ by the build. Nothing is reimplemented, so the static site does not
 * merely look like the served one — it computes identical numbers.
 *
 * The dive log is per-browser and per-device. That is a real difference from
 * the server mode and the interface says so rather than pretending otherwise.
 */
import {
  stateAt,
  profile as buildProfile,
  equivalences as buildEquivalences,
  landmarksAround,
  ZONES,
  CHALLENGER_DEEP,
  DEEPEST_FISH,
} from '../lib/ocean.js';
import { querySpecies } from '../lib/search.js';

export class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

const DIVES_KEY = 'abyss.dives.v1';

/* ------------------------------------------------------------------ *
 * Catalogue — loaded once from JSON
 * ------------------------------------------------------------------ */

let cataloguePromise = null;
let speciesPromise = null;
let catalogueCache = null;

async function loadCatalogue() {
  if (catalogueCache) return catalogueCache;
  if (!cataloguePromise) {
    cataloguePromise = fetch('./data/catalogue.json').then((r) => {
      if (!r.ok) throw new ApiError(`catalogue.json ${r.status}`);
      return r.json();
    });
  }
  catalogueCache = await cataloguePromise;
  return catalogueCache;
}

async function loadSpecies() {
  if (!speciesPromise) {
    speciesPromise = fetch('./data/species.json').then((r) => {
      if (!r.ok) throw new ApiError(`species.json ${r.status}`);
      return r.json();
    });
  }
  const data = await speciesPromise;
  return data.items ?? [];
}

function summarise(s) {
  return {
    depth: s.depth,
    zone: s.zone.name,
    pressureBar: round(s.pressureBar, 1),
    pressureAtm: round(s.pressureAtm, 0),
    temperature: round(s.temperature, 2),
    soundSpeed: round(s.soundSpeed, 1),
    lightPercent: round(s.light.bands.find((b) => b.key === 'blue').percent, 6),
    isDark: s.isDark,
  };
}

function round(v, dp) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/* ------------------------------------------------------------------ *
 * Dive log — localStorage
 * ------------------------------------------------------------------ */

function readDives() {
  try {
    const raw = localStorage.getItem(DIVES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeDives(list) {
  try {
    localStorage.setItem(DIVES_KEY, JSON.stringify(list));
  } catch (err) {
    // Private browsing and quota exhaustion both land here. Losing the log is
    // survivable; silently claiming it saved is not, so the caller is told.
    throw new ApiError('This browser will not store the dive log (private mode or storage full).');
  }
  return list;
}

function nextId(list) {
  return list.reduce((max, d) => Math.max(max, Number(d.id) || 0), 0) + 1;
}

/* ------------------------------------------------------------------ *
 * api
 * ------------------------------------------------------------------ */

export const api = {
  health: async () => ({
    status: 'ok',
    mode: 'static',
    uptimeSeconds: 0,
    database: null,
    species: (await loadSpecies()).length,
    node: 'browser',
    startedAt: null,
  }),

  catalogue: loadCatalogue,

  zones: async () => ({ zones: (await loadCatalogue()).zones }),

  species: async (params = {}) => {
    const rows = await loadSpecies();
    return { ...querySpecies(rows, { limit: 200, ...params }), query: params };
  },

  speciesOne: async (slug) => {
    const rows = await loadSpecies();
    const sp = rows.find((s) => s.slug === slug);
    if (!sp) throw new ApiError(`No species "${slug}"`, 404);

    // The drawer and detail page both want the neighbour strip and the
    // conditions across the animal's range. The server added those; here the
    // shared physics computes them, so the payload shape is identical.
    const related = rows
      .filter((s) => s.zone === sp.zone && s.slug !== slug)
      .sort((a, b) => Math.abs(a.depthMin - sp.depthMin) - Math.abs(b.depthMin - sp.depthMin))
      .slice(0, 4)
      .map((s) => ({
        slug: s.slug,
        common: s.common,
        scientific: s.scientific,
        accent: s.accent,
        depthMin: s.depthMin,
        depthMax: s.depthMax,
        bioluminescent: s.bioluminescent,
      }));

    return {
      ...sp,
      related,
      environment: {
        shallow: summarise(stateAt(sp.depthMin)),
        deep: summarise(stateAt(sp.depthMax)),
      },
    };
  },

  /* ── Ocean model — computed here, not fetched ──────────────────── */

  oceanAt: async (depth) => {
    const d = clampDepth(depth);
    const s = stateAt(d);
    const rows = await loadSpecies();
    const near = rows
      .filter((x) => x.depthMin <= d && x.depthMax >= d)
      .sort(
        (a, b) =>
          Math.abs((a.depthMin + a.depthMax) / 2 - d) - Math.abs((b.depthMin + b.depthMax) / 2 - d),
      )
      .slice(0, 6)
      .map((x) => ({
        slug: x.slug,
        common: x.common,
        scientific: x.scientific,
        accent: x.accent,
        depthMin: x.depthMin,
        depthMax: x.depthMax,
        bioluminescent: x.bioluminescent,
      }));

    return { ...s, equivalences: buildEquivalences(d), landmarks: landmarksAround(d), species: near };
  },

  profile: async (max = CHALLENGER_DEEP, step = 50) => {
    const rows = buildProfile({ max: clampDepth(max), step });
    return { max, step, count: rows.length, rows };
  },

  equivalences: async (depth) => ({ depth: clampDepth(depth), equivalences: buildEquivalences(clampDepth(depth)) }),

  landmarks: async (depth) => ({ depth: clampDepth(depth), ...landmarksAround(clampDepth(depth)) }),

  /* ── Dive log ──────────────────────────────────────────────────── */

  dives: async (params = {}) => {
    const limit = Number(params.limit) || 50;
    const offset = Number(params.offset) || 0;
    const all = readDives().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { total: all.length, items: all.slice(offset, offset + limit) };
  },

  createDive: async (dive) => {
    const label = String(dive.label ?? '').trim();
    if (!label) throw new ApiError('A dive needs a label', 400);
    const targetDepth = Number(dive.targetDepth);
    if (!Number.isFinite(targetDepth) || targetDepth < 0 || targetDepth > CHALLENGER_DEEP) {
      throw new ApiError(`targetDepth must be between 0 and ${CHALLENGER_DEEP}`, 400);
    }

    const s = stateAt(targetDepth);
    const list = readDives();
    const record = {
      id: nextId(list),
      label,
      targetDepth,
      reachedDepth: Number.isFinite(Number(dive.reachedDepth)) ? Number(dive.reachedDepth) : targetDepth,
      craft: String(dive.craft ?? 'unmanned lander').slice(0, 60),
      notes: String(dive.notes ?? '').slice(0, 2000),
      pressureBar: s.pressureBar,
      temperature: s.temperature,
      salinity: s.salinity,
      soundSpeed: s.soundSpeed,
      lightPercent: s.light.bands.find((b) => b.key === 'blue').percent,
      zone: s.zone.id,
      durationS: Math.round(Number(dive.durationS) || 0),
      createdAt: new Date().toISOString(),
    };
    list.push(record);
    writeDives(list);
    return { dive: record };
  },

  deleteDive: async (id) => {
    const list = readDives();
    const next = list.filter((d) => String(d.id) !== String(id));
    if (next.length === list.length) throw new ApiError(`No dive with id ${id}`, 404);
    writeDives(next);
    return { deleted: Number(id) };
  },

  clearDives: async () => {
    const n = readDives().length;
    writeDives([]);
    return { removed: n };
  },

  stats: async () => {
    const all = readDives();
    const depths = all.map((d) => Number(d.targetDepth) || 0);
    const rows = await loadSpecies();

    const byZone = new Map();
    for (const d of all) {
      const z = d.zone ?? 'unknown';
      const cur = byZone.get(z) ?? { zone: z, count: 0, deepest: 0 };
      cur.count += 1;
      cur.deepest = Math.max(cur.deepest, Number(d.targetDepth) || 0);
      byZone.set(z, cur);
    }

    return {
      dives: {
        dives: all.length,
        deepest: depths.length ? Math.max(...depths) : 0,
        shallowest: depths.length ? Math.min(...depths) : 0,
        meanDepth: depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0,
        totalSeconds: all.reduce((a, d) => a + (Number(d.durationS) || 0), 0),
        maxPressure: all.reduce((a, d) => Math.max(a, Number(d.pressureBar) || 0), 0),
        byZone: [...byZone.values()].sort((a, b) => b.deepest - a.deepest),
        recent: all.slice(0, 5),
      },
      catalogue: {
        species: rows.length,
        bioluminescent: rows.filter((s) => s.bioluminescent).length,
        shallowest: Math.min(...rows.map((s) => s.depthMin)),
        deepest: Math.max(...rows.map((s) => s.depthMax)),
        zones: ZONES.length,
        withPhoto: rows.filter((s) => s.image).length,
      },
      ocean: { deepest: CHALLENGER_DEEP, deepestFish: DEEPEST_FISH, meanDepth: 3688, zones: ZONES.length },
    };
  },
};

function clampDepth(d) {
  const n = Number(d);
  return Math.max(0, Math.min(CHALLENGER_DEEP, Number.isFinite(n) ? n : 0));
}

/* ------------------------------------------------------------------ *
 * Dive telemetry — the same descent the server streamed, run locally
 * ------------------------------------------------------------------ */

/**
 * Reproduces /api/dive/stream's contract without a stream.
 *
 * The server eased depth with a smoothstep over `duration` seconds and emitted
 * pauses at 10 Hz, then held station. This does the same thing on a timer, and
 * reports the identical frame shape so the console view needs no branch. The
 * only difference is the transport, and the console already labels the mission
 * clock as time-compressed.
 */
export function streamDive({
  depth,
  craft,
  duration = 30,
  timeScale = 240,
  onOpen,
  onTelemetry,
  onComplete,
  onError,
}) {
  const target = clampDepth(depth);
  const tickMs = 100;
  const startedAt = Date.now();
  const descentRate = target / Math.max(1, duration);

  let tick = 0;
  let currentDepth = 0;
  let phase = 'descending';
  let stationTicks = 0;
  let closed = false;

  onOpen?.({
    target,
    craft,
    timeScale,
    descentRate: Math.round(descentRate * 60),
    tickMs,
    note: `Mission clock runs ${timeScale}x faster than wall clock. Depth, pressure and temperature are computed live in your browser from the same ocean model the server uses.`,
  });

  const timer = setInterval(() => {
    if (closed) return;
    const elapsed = (Date.now() - startedAt) / 1000;
    tick += 1;

    if (phase === 'descending') {
      const p = Math.min(1, elapsed / duration);
      const eased = p * p * (3 - 2 * p);
      currentDepth = eased * target;
      if (p >= 1) {
        currentDepth = target;
        phase = 'station';
      }
    } else {
      stationTicks += 1;
      currentDepth = target + Math.sin(stationTicks / 9) * Math.max(0.4, target * 0.00012);
    }

    let s;
    try {
      s = stateAt(currentDepth);
    } catch (err) {
      clearInterval(timer);
      closed = true;
      onError?.(err instanceof Error ? err : new ApiError(String(err)));
      return;
    }
    const missionT = elapsed * timeScale;

    onTelemetry?.({
      seq: tick,
      phase,
      missionSeconds: missionT,
      wallSeconds: elapsed,
      depth: round(currentDepth, 2),
      progress: round(Math.min(1, currentDepth / Math.max(1, target)), 4),
      zone: s.zone,
      pressureBar: round(s.pressureBar, 3),
      pressureAtm: round(s.pressureAtm, 1),
      temperature: round(s.temperature, 3),
      salinity: round(s.salinity, 4),
      density: round(s.density, 3),
      soundSpeed: round(s.soundSpeed, 2),
      lightPercent: round(s.light.bands.find((b) => b.key === 'blue').percent, 8),
      parFraction: round(s.light.parFraction, 8),
      compression: round(s.compression, 3),
      isDark: s.isDark,
      craft,
    });

    if (phase === 'station') {
      if (stationTicks === 1) {
        onComplete?.({ depth: target, missionSeconds: missionT, ticks: tick });
      }
      if (stationTicks > 150) {
        clearInterval(timer);
        closed = true;
      }
    }
  }, tickMs);

  return {
    close() {
      closed = true;
      clearInterval(timer);
    },
    get readyState() {
      return closed ? 2 : 1;
    },
  };
}