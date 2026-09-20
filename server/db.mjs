/**
 * db.mjs — persistence for ABYSS, on Node's built-in SQLite driver.
 *
 * Node 22.5+ ships `node:sqlite`, so the whole application has no third-party
 * runtime dependencies: no ORM, no native module to compile, no install step.
 *
 * Schema changes are handled by numbered migrations tracked in SQLite's own
 * `user_version` pragma. Adding a migration means appending to MIGRATIONS;
 * never editing one that has already shipped.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIES } from './data/species.mjs';
import { ZONES } from './ocean.mjs';
import { imageFor, imageStats } from './images.mjs';
import { querySpecies } from './data/search.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const DB_PATH = process.env.ABYSS_DB ?? join(ROOT, 'data', 'abyss.db');

/* ------------------------------------------------------------------ *
 * Migrations
 * ------------------------------------------------------------------ */

const MIGRATIONS = [
  // 1 — the catalogue
  `
  CREATE TABLE zones (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    alias     TEXT NOT NULL,
    depth_min INTEGER NOT NULL,
    depth_max INTEGER NOT NULL,
    accent    TEXT NOT NULL,
    summary   TEXT NOT NULL
  );

  CREATE TABLE species (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    slug           TEXT NOT NULL UNIQUE,
    common         TEXT NOT NULL,
    scientific     TEXT NOT NULL,
    family         TEXT,
    grp            TEXT,
    zone           TEXT NOT NULL REFERENCES zones(id),
    depth_min      INTEGER NOT NULL,
    depth_max      INTEGER NOT NULL,
    size_cm        REAL,
    mass_kg        REAL,
    bioluminescent INTEGER NOT NULL DEFAULT 0,
    iucn           TEXT,
    diet           TEXT,
    sprite         TEXT NOT NULL,
    accent         TEXT NOT NULL,
    blurb          TEXT NOT NULL,
    facts          TEXT NOT NULL
  );

  CREATE INDEX idx_species_zone  ON species(zone);
  CREATE INDEX idx_species_depth ON species(depth_min, depth_max);
  CREATE INDEX idx_species_glow  ON species(bioluminescent);
  `,

  // 2 — the dive log
  `
  CREATE TABLE dives (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    label          TEXT NOT NULL,
    target_depth   REAL NOT NULL,
    reached_depth  REAL,
    craft          TEXT NOT NULL DEFAULT 'unmanned lander',
    notes          TEXT NOT NULL DEFAULT '',
    -- physics snapshot, frozen at the moment the dive was recorded so the log
    -- stays historically accurate even if the ocean model is later revised
    pressure_bar   REAL NOT NULL,
    temperature_c  REAL NOT NULL,
    salinity_psu   REAL NOT NULL,
    sound_speed    REAL NOT NULL,
    light_percent  REAL NOT NULL,
    zone_id        TEXT NOT NULL,
    duration_s     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
  );

  CREATE INDEX idx_dives_created ON dives(created_at DESC);
  CREATE INDEX idx_dives_depth   ON dives(target_depth DESC);

  CREATE TABLE telemetry (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    dive_id      INTEGER NOT NULL REFERENCES dives(id) ON DELETE CASCADE,
    t_offset_s   REAL NOT NULL,
    depth        REAL NOT NULL,
    pressure_bar REAL NOT NULL,
    temperature_c REAL NOT NULL,
    sound_speed  REAL NOT NULL
  );

  CREATE INDEX idx_telemetry_dive ON telemetry(dive_id, t_offset_s);
  `,

  // 3 — bookkeeping
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

/* ------------------------------------------------------------------ *
 * Open + migrate
 * ------------------------------------------------------------------ */

export function openDatabase(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');

  const current = db.prepare('PRAGMA user_version').get().user_version ?? 0;

  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${v + 1} failed: ${err.message}`);
    }
  }

  return db;
}

/* ------------------------------------------------------------------ *
 * Seeding
 * ------------------------------------------------------------------ */

/**
 * The catalogue is treated as reference data, not user data: it is re-synced
 * from source on every boot so that editing species.mjs is enough to change
 * what the site serves. Dive logs are never touched by this.
 */
export function seed(db) {
  const upsertZone = db.prepare(`
    INSERT INTO zones (id, name, alias, depth_min, depth_max, accent, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, alias=excluded.alias, depth_min=excluded.depth_min,
      depth_max=excluded.depth_max, accent=excluded.accent, summary=excluded.summary
  `);
  const upsertSpecies = db.prepare(`
    INSERT INTO species (
      slug, common, scientific, family, grp, zone, depth_min, depth_max,
      size_cm, mass_kg, bioluminescent, iucn, diet, sprite, accent, blurb, facts
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      common=excluded.common, scientific=excluded.scientific, family=excluded.family,
      grp=excluded.grp, zone=excluded.zone, depth_min=excluded.depth_min,
      depth_max=excluded.depth_max, size_cm=excluded.size_cm, mass_kg=excluded.mass_kg,
      bioluminescent=excluded.bioluminescent, iucn=excluded.iucn, diet=excluded.diet,
      sprite=excluded.sprite, accent=excluded.accent, blurb=excluded.blurb,
      facts=excluded.facts
  `);

  db.exec('BEGIN');
  try {
    for (const z of ZONES) {
      upsertZone.run(z.id, z.name, z.alias, z.min, z.max, z.accent, z.summary);
    }
    for (const s of SPECIES) {
      upsertSpecies.run(
        s.slug,
        s.common,
        s.scientific,
        s.family ?? null,
        s.group ?? null,
        s.zone,
        s.depthMin,
        s.depthMax,
        s.sizeCm ?? null,
        s.massKg ?? null,
        s.bioluminescent ? 1 : 0,
        s.iucn ?? null,
        s.diet ?? null,
        s.sprite,
        s.accent,
        s.blurb,
        JSON.stringify(s.facts ?? []),
      );
    }
    // Drop any species removed from the source file.
    const keep = SPECIES.map((s) => s.slug);
    const placeholders = keep.map(() => '?').join(',');
    db.prepare(`DELETE FROM species WHERE slug NOT IN (${placeholders})`).run(...keep);

    db.prepare(
      `INSERT INTO meta (key, value) VALUES ('seeded_at', ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    ).run(new Date().toISOString());

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* ------------------------------------------------------------------ *
 * Row mapping
 * ------------------------------------------------------------------ */

function toSpecies(row) {
  if (!row) return null;
  return {
    slug: row.slug,
    common: row.common,
    scientific: row.scientific,
    family: row.family,
    group: row.grp,
    zone: row.zone,
    depthMin: row.depth_min,
    depthMax: row.depth_max,
    sizeCm: row.size_cm,
    massKg: row.mass_kg,
    bioluminescent: !!row.bioluminescent,
    iucn: row.iucn,
    diet: row.diet,
    sprite: row.sprite,
    accent: row.accent,
    blurb: row.blurb,
    facts: safeJson(row.facts, []),
    // Optional photography. Null on a clean checkout — the fetcher needs
    // network access — and the client falls back to the drawn plate. Merged
    // here rather than stored in SQLite because the manifest is regenerated
    // wholesale by the fetcher and must never fight the catalogue re-sync.
    image: imageFor(row.slug),
  };
}

function toDive(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    targetDepth: row.target_depth,
    reachedDepth: row.reached_depth,
    craft: row.craft,
    notes: row.notes,
    pressureBar: row.pressure_bar,
    temperature: row.temperature_c,
    salinity: row.salinity_psu,
    soundSpeed: row.sound_speed,
    lightPercent: row.light_percent,
    zone: row.zone_id,
    durationS: row.duration_s,
    createdAt: row.created_at,
  };
}

function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

export function listZones(db) {
  const rows = db
    .prepare(
      `SELECT z.*, COUNT(s.id) AS species_count
       FROM zones z LEFT JOIN species s ON s.zone = z.id
       GROUP BY z.id ORDER BY z.depth_min`,
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    alias: r.alias,
    min: r.depth_min,
    max: r.depth_max,
    accent: r.accent,
    summary: r.summary,
    speciesCount: r.species_count,
  }));
}

/**
 * Search the catalogue.
 *
 * Filtering happens in SQL because it is cheap and keeps the row set small;
 * ranking is delegated to the shared module so the server and the static export
 * cannot disagree about which result is the best match.
 */
export function searchSpecies(db, opts = {}) {
  const { zone = '', glow = '' } = opts;
  const where = [];
  const params = [];

  if (zone) {
    where.push('zone = ?');
    params.push(zone);
  }
  if (glow === 'true' || glow === '1') where.push('bioluminescent = 1');
  if (glow === 'false' || glow === '0') where.push('bioluminescent = 0');

  const sql = `SELECT * FROM species ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const rows = db.prepare(sql).all(...params).map(toSpecies);
  return querySpecies(rows, opts);
}

export function getSpecies(db, slug) {
  const row = db.prepare('SELECT * FROM species WHERE slug = ?').get(slug);
  if (!row) return null;
  const species = toSpecies(row);
  // Neighbours in the same zone, for the "related" strip on the detail page.
  species.related = db
    .prepare(
      `SELECT slug, common, scientific, accent, depth_min, depth_max, bioluminescent
       FROM species WHERE zone = ? AND slug != ?
       ORDER BY ABS(depth_min - ?) LIMIT 4`,
    )
    .all(species.zone, slug, species.depthMin)
    .map((r) => ({
      slug: r.slug,
      common: r.common,
      scientific: r.scientific,
      accent: r.accent,
      depthMin: r.depth_min,
      depthMax: r.depth_max,
      bioluminescent: !!r.bioluminescent,
    }));
  return species;
}

/** Species whose recorded range includes a given depth. */
export function speciesAtDepth(db, depth, limit = 8) {
  return db
    .prepare(
      `SELECT * FROM species WHERE depth_min <= ? AND depth_max >= ?
       ORDER BY ABS(((depth_min + depth_max) / 2.0) - ?) LIMIT ?`,
    )
    .all(depth, depth, depth, limit)
    .map(toSpecies);
}

export function createDive(db, dive) {
  const info = db
    .prepare(
      `INSERT INTO dives (
         label, target_depth, reached_depth, craft, notes,
         pressure_bar, temperature_c, salinity_psu, sound_speed, light_percent,
         zone_id, duration_s, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      dive.label,
      dive.targetDepth,
      dive.reachedDepth ?? null,
      dive.craft,
      dive.notes ?? '',
      dive.pressureBar,
      dive.temperature,
      dive.salinity,
      dive.soundSpeed,
      dive.lightPercent,
      dive.zone,
      dive.durationS ?? 0,
      new Date().toISOString(),
    );
  return getDive(db, Number(info.lastInsertRowid));
}

export function getDive(db, id) {
  return toDive(db.prepare('SELECT * FROM dives WHERE id = ?').get(id));
}

export function listDives(db, { limit = 50, offset = 0 } = {}) {
  const total = db.prepare('SELECT COUNT(*) AS n FROM dives').get().n;
  const items = db
    .prepare('SELECT * FROM dives ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
    .all(limit, offset)
    .map(toDive);
  return { total, items };
}

export function deleteDive(db, id) {
  const info = db.prepare('DELETE FROM dives WHERE id = ?').run(id);
  return info.changes > 0;
}

export function clearDives(db) {
  const info = db.prepare('DELETE FROM dives').run();
  return info.changes;
}

export function diveStats(db) {
  const agg = db
    .prepare(
      `SELECT COUNT(*) AS dives,
              MAX(target_depth) AS deepest,
              MIN(target_depth) AS shallowest,
              AVG(target_depth) AS mean_depth,
              SUM(duration_s) AS total_seconds,
              MAX(pressure_bar) AS max_pressure
       FROM dives`,
    )
    .get();

  const byZone = db
    .prepare(
      `SELECT zone_id, COUNT(*) AS n, MAX(target_depth) AS deepest
       FROM dives GROUP BY zone_id ORDER BY deepest DESC`,
    )
    .all()
    .map((r) => ({ zone: r.zone_id, count: r.n, deepest: r.deepest }));

  const recent = db
    .prepare('SELECT * FROM dives ORDER BY created_at DESC LIMIT 5')
    .all()
    .map(toDive);

  return {
    dives: agg.dives ?? 0,
    deepest: agg.deepest ?? 0,
    shallowest: agg.shallowest ?? 0,
    meanDepth: agg.mean_depth ?? 0,
    totalSeconds: agg.total_seconds ?? 0,
    maxPressure: agg.max_pressure ?? 0,
    byZone,
    recent,
  };
}

export function catalogueStats(db) {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS n,
              SUM(bioluminescent) AS glow,
              MIN(depth_min) AS shallowest,
              MAX(depth_max) AS deepest
       FROM species`,
    )
    .get();
  return {
    species: totals.n,
    bioluminescent: totals.glow,
    shallowest: totals.shallowest,
    deepest: totals.deepest,
    zones: db.prepare('SELECT COUNT(*) AS n FROM zones').get().n,
    // How many specimens currently have a photograph rather than a plate.
    // Zero on a clean checkout; the fetcher fills this in.
    withPhoto: imageStats().withPhoto,
  };
}

export { toSpecies, toDive };
