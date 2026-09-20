/**
 * images.mjs — species photography and its attribution.
 *
 * Photographs are OPTIONAL. `scripts/fetch-species-images.mjs` writes
 * server/data/species-images.json; if that file is absent — which it is on a
 * clean checkout, because the fetcher needs network access the sandbox does not
 * grant — every species simply has no image and the interface falls back to the
 * drawn plate. Nothing here is required for the site to work.
 *
 * The manifest is re-read when its mtime changes, so the fetcher can be run
 * against a live server without restarting it.
 *
 * ATTRIBUTION IS A LICENCE CONDITION, NOT DECORATION. The fetcher accepts only
 * CC0, public domain, CC BY and CC BY-SA. The first two need no credit; the
 * latter two require the creator to be identified and the licence linked, so
 * `creditLine()` and the client renderers exist to satisfy that obligation. An
 * entry missing its artist is treated as unusable rather than shown uncredited.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MANIFEST_PATH =
  process.env.ABYSS_IMAGES ?? join(HERE, 'data', 'species-images.json');

/** Licences that carry no attribution requirement. */
const NO_CREDIT_NEEDED = /^(cc0|public domain|pd[- ])/i;

/**
 * Placeholders that are not a creator's name. A fetcher bug once wrote the
 * literal string "null" into the Artist field of a CC BY 4.0 file — truthy, so
 * it would have rendered as "Photo: null · CC BY 4.0" on a card. The loader
 * rejects these independently of the fetcher, so a bad manifest cannot put a
 * nonsense credit on screen.
 */
const PLACEHOLDER_ARTIST = /^(null|undefined|unknown|anonymous|n\/?a|none|no author|-+|—|\?|\.)$/i;

function hasRealArtist(artist) {
  const value = String(artist ?? '').trim();
  return value.length > 0 && !PLACEHOLDER_ARTIST.test(value);
}

let cache = null;
let cachedMtimeMs = 0;
let cachedMissing = true;

/**
 * Load and validate the manifest.
 *
 * A malformed or partially-written file must never take the site down: an
 * unreadable manifest is treated as "no photographs", which degrades to the
 * drawn plates rather than to a broken atlas.
 */
export function loadImages() {
  if (!existsSync(MANIFEST_PATH)) {
    if (!cachedMissing) {
      cache = null;
      cachedMissing = true;
    }
    return cache;
  }

  let mtimeMs;
  try {
    mtimeMs = statSync(MANIFEST_PATH).mtimeMs;
  } catch {
    return cache;
  }

  if (cache && mtimeMs === cachedMtimeMs) return cache;

  try {
    const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    const clean = {};
    for (const [slug, entry] of Object.entries(raw ?? {})) {
      if (!entry || typeof entry !== 'object') continue;
      if (!entry.file || typeof entry.file !== 'string') continue;
      // An image with no determinable creator cannot be shown under CC BY or
      // CC BY-SA, so drop it rather than ship it uncredited. A placeholder like
      // "null" counts as no creator, not as a name.
      const needsCredit = !NO_CREDIT_NEEDED.test(String(entry.licence ?? ''));
      if (needsCredit && !hasRealArtist(entry.artist)) continue;
      clean[slug] = {
        file: entry.file,
        artist: hasRealArtist(entry.artist) ? String(entry.artist).trim() : '',
        licence: entry.licence ?? '',
        licenceUrl: entry.licenceUrl ?? '',
        sourceUrl: entry.sourceUrl ?? '',
        commonsTitle: entry.commonsTitle ?? '',
        width: Number(entry.width) || null,
        height: Number(entry.height) || null,
        // 'scientific' | 'common-name' | 'pinned'. Only 'common-name' is a
        // weaker signal — "Brittle stars Ophioderma" is a different genus from
        // the abyssal ophiuroids the card describes — so only that one is
        // disclosed in the interface. 'pinned' means a human chose the file
        // after looking at it, which is the strongest signal of the three.
        matchedOn: ['common-name', 'pinned'].includes(entry.matchedOn)
          ? entry.matchedOn
          : 'scientific',
        retrieved: entry.retrieved ?? '',
      };
    }
    cache = clean;
    cachedMtimeMs = mtimeMs;
    cachedMissing = false;
  } catch (err) {
    console.warn(`[abyss] species-images.json is unreadable (${err.message}); using drawn plates`);
    cache = null;
    cachedMissing = false;
  }

  return cache;
}

/** The image record for a slug, or null. */
export function imageFor(slug) {
  return loadImages()?.[slug] ?? null;
}

/** Counts for the catalogue summary. */
export function imageStats() {
  const all = loadImages();
  if (!all) return { withPhoto: 0, total: 0 };
  const slugs = Object.keys(all);
  return { withPhoto: slugs.length, total: slugs.length };
}

/**
 * A one-line credit suitable for a card: "Photo: NOAA · Public domain".
 * Kept short because it sits under a photograph in a grid of thirty-six.
 */
export function creditLine(entry) {
  if (!entry) return '';
  const who = entry.artist ? `Photo: ${entry.artist}` : 'Photo';
  return entry.licence ? `${who} · ${entry.licence}` : who;
}
