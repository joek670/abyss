/**
 * api.mjs — the HTTP API.
 *
 * Every route is a pure function of the database and the ocean model; there is
 * no hidden state in the server beyond the SQLite file. That is what makes the
 * dive log the only mutable resource in the application.
 */
import {
  stateAt,
  profile,
  equivalences,
  landmarksAround,
  ZONES,
  CHALLENGER_DEEP,
  DEEPEST_FISH,
  REFERENCE_DEPTHS,
} from './ocean.mjs';
import {
  listZones,
  searchSpecies,
  getSpecies,
  speciesAtDepth,
  createDive,
  listDives,
  deleteDive,
  clearDives,
  diveStats,
  catalogueStats,
} from './db.mjs';
import { sendJson, sendError, readJson, openEventStream, createRouter } from './http.mjs';

const STARTED_AT = Date.now();

/** Clamp a query parameter to a number inside a range, with a default. */
function num(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function buildRouter(db) {
  const r = createRouter();

  /* ── Health ─────────────────────────────────────────────────────── */

  r.get('/api/health', (ctx) => {
    const probe = db.prepare('SELECT COUNT(*) AS n FROM species').get();
    sendJson(ctx.res, 200, {
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      database: 'connected',
      species: probe.n,
      node: process.version,
      startedAt: new Date(STARTED_AT).toISOString(),
    });
  });

  /* ── Catalogue ──────────────────────────────────────────────────── */

  r.get('/api/catalogue', (ctx) => {
    sendJson(ctx.res, 200, {
      zones: listZones(db),
      stats: catalogueStats(db),
      limits: {
        deepest: CHALLENGER_DEEP,
        deepestFish: DEEPEST_FISH,
        meanOceanDepth: 3688,
      },
    });
  });

  r.get('/api/zones', (ctx) => {
    sendJson(ctx.res, 200, { zones: listZones(db) });
  });

  r.get('/api/species', (ctx) => {
    const q = ctx.query.get('q') ?? '';
    const zone = ctx.query.get('zone') ?? '';
    const glow = ctx.query.get('glow') ?? '';
    const sort = ctx.query.get('sort') ?? 'depth';
    const limit = num(ctx.query.get('limit'), 100, 1, 200);
    const offset = num(ctx.query.get('offset'), 0, 0, 10000);

    if (zone && !ZONES.some((z) => z.id === zone)) {
      return sendError(ctx.res, 400, `Unknown zone "${zone}"`, {
        valid: ZONES.map((z) => z.id),
      });
    }

    const result = searchSpecies(db, { q, zone, glow, sort, limit, offset });
    sendJson(ctx.res, 200, { ...result, query: { q, zone, glow, sort, limit, offset } });
  });

  r.get('/api/species/:slug', (ctx) => {
    const species = getSpecies(db, ctx.params.slug);
    if (!species) return sendError(ctx.res, 404, `No species "${ctx.params.slug}"`);
    // Attach the water column conditions across its recorded range.
    const atShallow = stateAt(species.depthMin);
    const atDeep = stateAt(species.depthMax);
    sendJson(ctx.res, 200, {
      ...species,
      environment: {
        shallow: summarise(atShallow),
        deep: summarise(atDeep),
      },
    });
  });

  /* ── Ocean model ────────────────────────────────────────────────── */

  r.get('/api/ocean/at', (ctx) => {
    const depth = num(ctx.query.get('depth'), 0, 0, CHALLENGER_DEEP);
    const state = stateAt(depth);
    const found = speciesAtDepth(db, depth, 6);
    sendJson(ctx.res, 200, {
      ...state,
      equivalences: equivalences(depth),
      landmarks: landmarksAround(depth),
      species: found.map((s) => ({
        slug: s.slug,
        common: s.common,
        scientific: s.scientific,
        accent: s.accent,
        depthMin: s.depthMin,
        depthMax: s.depthMax,
        bioluminescent: s.bioluminescent,
      })),
    });
  });

  r.get('/api/ocean/profile', (ctx) => {
    const max = num(ctx.query.get('max'), CHALLENGER_DEEP, 100, CHALLENGER_DEEP);
    const step = num(ctx.query.get('step'), 50, 5, 1000);
    const rows = profile({ max, step });
    sendJson(
      ctx.res,
      200,
      { max, step, count: rows.length, rows },
      { 'Cache-Control': 'public, max-age=3600' },
    );
  });

  r.get('/api/ocean/equivalences', (ctx) => {
    const depth = num(ctx.query.get('depth'), 0, 0, CHALLENGER_DEEP);
    sendJson(ctx.res, 200, { depth, equivalences: equivalences(depth) });
  });

  r.get('/api/ocean/landmarks', (ctx) => {
    const depth = num(ctx.query.get('depth'), 0, 0, CHALLENGER_DEEP);
    sendJson(ctx.res, 200, { depth, ...landmarksAround(depth), references: REFERENCE_DEPTHS });
  });

  /* ── Live dive telemetry (SSE) ──────────────────────────────────── */

  /**
   * Stream a descent as Server-Sent Events.
   *
   * The simulation is honest about what it is: a kinematic descent profile run
   * against the real ocean model at whatever depth it has currently reached.
   * The depth/pressure/temperature it reports are the same numbers
   * /api/ocean/at would return for that depth — only the *timing* is
   * compressed, by `timeScale`, because a real descent to 10 000 m takes five
   * hours and nobody is going to watch that.
   */
  r.get('/api/dive/stream', (ctx) => {
    const target = num(ctx.query.get('depth'), 3800, 1, CHALLENGER_DEEP);
    const craft = (ctx.query.get('craft') ?? 'DSV Limiting Factor').slice(0, 60);
    const durationS = num(ctx.query.get('duration'), 30, 5, 300);
    const timeScale = num(ctx.query.get('timeScale'), 240, 1, 10000);

    const stream = openEventStream(ctx.req, ctx.res);
    const tickMs = 100;
    const descentRate = target / durationS; // m per wall-clock second
    const startedAt = Date.now();
    let tick = 0;
    let depth = 0;
    let phase = 'descending';
    let stationTicks = 0;

    stream.send('open', {
      target,
      craft,
      timeScale,
      descentRate: Math.round(descentRate * 60), // m per simulated minute
      tickMs,
      note: `Mission clock runs ${timeScale}x faster than wall clock. Depth, pressure and temperature are computed live from the ocean model.`,
    });

    const timer = setInterval(() => {
      if (stream.closed) return clearInterval(timer);
      const elapsed = (Date.now() - startedAt) / 1000;
      tick++;

      if (phase === 'descending') {
        // Ease in and out of the descent so the profile is not a straight ramp.
        const p = Math.min(1, elapsed / durationS);
        const eased = p * p * (3 - 2 * p); // smoothstep
        depth = eased * target;
        if (p >= 1) {
          depth = target;
          phase = 'station';
        }
      } else {
        // Station keeping: hold depth with a little instrument noise so the
        // console looks alive rather than frozen.
        stationTicks++;
        depth = target + Math.sin(stationTicks / 9) * Math.max(0.4, target * 0.00012);
      }

      const s = stateAt(depth);
      const missionT = elapsed * timeScale;

      const ok = stream.send('telemetry', {
        seq: tick,
        phase,
        missionSeconds: missionT,
        wallSeconds: elapsed,
        depth: round(depth, 2),
        progress: round(Math.min(1, depth / target), 4),
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
      if (!ok) clearInterval(timer);

      if (phase === 'station') {
        // Announce completion the moment the vehicle is on station. Waiting
        // until the stream is about to close would leave a client that is
        // watching for `complete` hanging for the whole station-keeping window.
        if (stationTicks === 1) {
          stream.send('complete', { depth: target, missionSeconds: missionT, ticks: tick });
        }
        // Keep reporting station data for a bounded window, then close.
        if (stationTicks > 150) {
          clearInterval(timer);
          stream.close();
        }
      }
    }, tickMs);
    timer.unref?.();

    ctx.req.on('close', () => clearInterval(timer));
  });

  /* ── Dive log ───────────────────────────────────────────────────── */

  r.get('/api/dives', (ctx) => {
    const limit = num(ctx.query.get('limit'), 50, 1, 200);
    const offset = num(ctx.query.get('offset'), 0, 0, 10000);
    sendJson(ctx.res, 200, listDives(db, { limit, offset }));
  });

  r.post('/api/dives', async (ctx) => {
    const body = ctx.body ?? {};
    const label = String(body.label ?? '').trim();
    if (!label) return sendError(ctx.res, 400, 'A dive needs a label');
    if (label.length > 120) return sendError(ctx.res, 400, 'Label must be 120 characters or fewer');

    const targetDepth = Number(body.targetDepth);
    if (!Number.isFinite(targetDepth) || targetDepth < 0 || targetDepth > CHALLENGER_DEEP) {
      return sendError(ctx.res, 400, `targetDepth must be between 0 and ${CHALLENGER_DEEP}`);
    }

    const craft = String(body.craft ?? 'unmanned lander').trim().slice(0, 60) || 'unmanned lander';
    const notes = String(body.notes ?? '').slice(0, 2000);
    const durationS = num(body.durationS, 0, 0, 60 * 60 * 24 * 30);

    const s = stateAt(targetDepth);
    const dive = createDive(db, {
      label,
      targetDepth,
      reachedDepth: Number.isFinite(Number(body.reachedDepth))
        ? Number(body.reachedDepth)
        : targetDepth,
      craft,
      notes,
      pressureBar: s.pressureBar,
      temperature: s.temperature,
      salinity: s.salinity,
      soundSpeed: s.soundSpeed,
      lightPercent: s.light.bands.find((b) => b.key === 'blue').percent,
      zone: s.zone.id,
      durationS: Math.round(durationS),
    });

    sendJson(ctx.res, 201, { dive }, { Location: `/api/dives/${dive.id}` });
  });

  r.delete('/api/dives/:id', (ctx) => {
    const id = Number(ctx.params.id);
    if (!Number.isInteger(id)) return sendError(ctx.res, 400, 'Dive id must be an integer');
    if (!deleteDive(db, id)) return sendError(ctx.res, 404, `No dive with id ${id}`);
    sendJson(ctx.res, 200, { deleted: id });
  });

  r.post('/api/dives/clear', (ctx) => {
    const removed = clearDives(db);
    sendJson(ctx.res, 200, { removed });
  });

  r.get('/api/stats', (ctx) => {
    sendJson(ctx.res, 200, {
      dives: diveStats(db),
      catalogue: catalogueStats(db),
      ocean: {
        deepest: CHALLENGER_DEEP,
        deepestFish: DEEPEST_FISH,
        meanDepth: 3688,
        zones: ZONES.length,
      },
    });
  });

  return r;
}

/* ------------------------------------------------------------------ */

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
