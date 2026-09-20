/**
 * fetch-species-images.mjs — retrieve freely-licensed species photography from
 * Wikimedia Commons.
 *
 * Run this once the egress allow-list includes Wikimedia (see README) and the
 * shell is working. It:
 *
 *   1. asks the Commons API for candidate files matching each species'
 *      scientific name,
 *   2. keeps only files whose licence is genuinely free — CC0, public domain,
 *      CC BY, or CC BY-SA. Anything NonCommercial, NoDerivs, "fair use" or
 *      unstated is REJECTED, because a species atlas is exactly the kind of
 *      thing that later gets reused commercially,
 *   3. downloads a 1000 px rendition into public/img/species/<slug>.jpg,
 *   4. writes server/data/species-images.json with the attribution each licence
 *      requires.
 *
 * Attribution is not optional. CC BY and CC BY-SA both require the creator to
 * be named and the licence stated; the manifest records artist, licence,
 * licence URL and the source file page so the interface can show them on the
 * card. Files whose artist cannot be determined are skipped rather than
 * shipped uncredited.
 *
 * Coverage is genuinely partial. Many of these animals are known from a handful
 * of specimens and have no free photograph at all — Abyssobrotula galatheae was
 * described from a single 1970 trawl. Species with no acceptable image are
 * reported and left for the drawn plate.
 *
 *   node scripts/fetch-species-images.mjs --dry-run     # show matches, download nothing
 *   node scripts/fetch-species-images.mjs               # fetch what is available
 *   node scripts/fetch-species-images.mjs --only=squid  # one species
 *   node scripts/fetch-species-images.mjs --force       # re-fetch existing files
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIES } from '../server/data/species.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const IMG_DIR = join(ROOT, 'public', 'img', 'species');
const MANIFEST = join(ROOT, 'server', 'data', 'species-images.json');

/**
 * Manual overrides: { "<slug>": "File:Exact Commons title.jpg" }.
 *
 * Automatic selection reasons about FILENAMES, so it cannot tell that
 * "Grimpoteuthis.jpg" is a line drawing or that a photo of a sponge on a lab
 * tray is not a brittle star. Four of the first 35 picks were wrong that way and
 * every filter passed them. A pin names the exact file a human chose after
 * looking at it, and the fetcher takes it verbatim — no scoring, no rules.
 */
const PINS_PATH = join(ROOT, 'server', 'data', 'species-image-pins.json');
const PINS = existsSync(PINS_PATH) ? JSON.parse(readFileSync(PINS_PATH, 'utf8')) : {};

const API = 'https://commons.wikimedia.org/w/api.php';

/**
 * Wikimedia's API policy requires a descriptive User-Agent with contact
 * information, and throttles vague or generic ones hard — the first run of this
 * script got HTTP 429 after eight requests.
 */
const USER_AGENT =
  'ABYSS-species-atlas/1.0 (educational deep-sea reference; node-fetch)';

/**
 * Commons throttles anonymous clients aggressively. Roughly one request per
 * second is the documented courtesy rate and the observed safe point; the
 * original 250 ms earned a 429 after eight calls. Downloads are slower still
 * because they hit upload.wikimedia.org, which is stricter.
 */
const API_DELAY_MS = 1100;
const DOWNLOAD_DELAY_MS = 1600;
const MAX_RETRIES = 5;

/**
 * Distinctive tokens: safe to match as substrings because nothing legitimate
 * contains them.
 */
const NON_PHOTO_SUBSTRING = [
  'stamp', 'postage', 'colnect', 'banknote', 'illustration', 'engraving',
  'lithograph', 'artwork', 'sketch', 'diagram', 'skeleton', 'specimen',
  'preserved', 'museum', 'taxidermy', 'replica', 'microscope', 'micrograph',
  'histology', 'phylogeny', 'cladogram', 'distribution', 'tentacular',
  'sucker', 'radula', 'carapace', 'otolith', 'statolith', 'egg case',
  'carcass', 'carrion', 'stranded', 'stranding', 'comiendo',
  'muerto', 'muerta', 'toten', 'morto', 'morte', 'x-ray', 'ct scan',
  // Compound map names. Word-boundary matching (below) cannot see these,
  // because there is no boundary between "dist" and "map" — which is exactly
  // how "Somniosus microcephalus distmap.png" got accepted on the first run of
  // the rule tests.
  'distmap', 'rangemap', 'areamap', 'habitatmap', 'depthmap', 'locationmap',
];

/**
 * Short or ambiguous tokens, matched on WORD BOUNDARIES only.
 *
 * Substring matching here produced two real false positives in the first run:
 * "…- geograph.org.uk - 3881775.jpg" tripped "graph", and "Cuvier's Beaked
 * Whale (Ziphius cavirostris).jpg" — the correct name of the very species being
 * searched for — tripped "beak". Both are legitimate photographs.
 */
const NON_PHOTO_WORD = [
  'graph', 'chart', 'map', 'plate', 'plot', 'beak', 'hook', 'claw', 'bone',
  'teeth', 'jaw', 'dead', 'model', 'flag', 'logo', 'coin', 'painting',
  'drawing', 'fossil', 'skull', 'larva', 'larval',
];

const NON_PHOTO_WORD_RE = new RegExp(`\\b(?:${NON_PHOTO_WORD.join('|')})\\b`, 'i');

/**
 * Why this title is not a photograph of the living animal, or null if it is
 * acceptable. Returning the reason lets the run hand near-misses to a human
 * instead of dropping them silently — a preserved specimen still depicts the
 * right animal, and someone may want it.
 */
function nonPhotoReason(title) {
  const sub = NON_PHOTO_SUBSTRING.find((t) => title.includes(t));
  if (sub) return `title contains "${sub}"`;
  const word = NON_PHOTO_WORD_RE.exec(title);
  if (word) return `title contains the word "${word[0]}"`;
  if (MUSEUM_CODE.test(title)) return 'museum accession code';
  if (PUBLICATION_PATTERNS.some((re) => re.test(title))) {
    return 'looks like a figure from a publication';
  }
  return null;
}

/**
 * Institutional catalogue codes. A title carrying one is a preserved specimen
 * with an accession number — "Kiwa hirsuta (MNHN-IU-2010-1683)" and
 * "Scotoplanes globosa (USNM E27694)" both matched this way.
 */
const MUSEUM_CODE =
  /\b(mnhn|usnm|nmnh|bmnh|nhm|zmuc|zmb|mcz|amnh|smf|sam|wam|qmb|nmsz|rmnh|zmh|mnk)\b/i;

/**
 * Signatures of a figure lifted from a publication: a DOI, a figure number, or
 * a pre-2000 year of the form used in taxonomic citations. The Mariana
 * snailfish matched "Pseudoliparis swirei (10.11646/zootaxa.4358.1.7) Figure 4",
 * and the giant squid matched "Architeuthis dux Verrill 1882" — an illustration,
 * not a photograph.
 */
const PUBLICATION_PATTERNS = [
  /\b10\.\d{4,}\//,
  /\bfig(?:ure)?\.?\s*\d+/i,
  /\b1[6-9]\d{2}\b/,
];

/**
 * Candidates rejected only on their title, kept so the run can print them for a
 * human. Silently discarding a preserved specimen of the right animal is worse
 * than offering it with the reason attached.
 */
const rejections = [];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
const ONLY = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7) || null;

/** Licences we will and will not ship. Matched case-insensitively. */
const ACCEPTED = [
  /^cc0/i,
  /^public domain/i,
  /^pd[- ]/i,
  /^cc[- ]by[- ]?[234]/i,
  /^cc[- ]by[- ]sa[- ]?[234]/i,
  /^cc by [234]/i,
  /^cc by-sa [234]/i,
];
const REJECTED = [/nc/i, /nd/i, /non[- ]?commercial/i, /no[- ]?deriv/i, /fair use/i, /copyright/i];

function licenceVerdict(shortName) {
  const s = String(shortName ?? '').trim();
  if (!s) return { ok: false, why: 'no licence stated' };
  if (REJECTED.some((re) => re.test(s))) return { ok: false, why: `restricted (${s})` };
  if (ACCEPTED.some((re) => re.test(s))) return { ok: true, why: s };
  return { ok: false, why: `unrecognised (${s})` };
}

/** extmetadata values arrive as HTML fragments; strip to plain text. */
function stripHtml(value) {  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Placeholders Commons carries in the Artist field instead of a name.
 *
 * "Campagne GEOCYATHERM - Vers géants (Riftia Pachyptila)" arrived with
 * artist: "null" — the literal four-character string, which is truthy and so
 * passed the has-an-artist check, putting "Photo: null · CC BY 4.0" on a card.
 */
const PLACEHOLDER_ARTIST = /^(null|undefined|unknown|anonymous|n\/?a|none|no author|-+|—|\?|\.)$/i;

/**
 * Collapse a value that Commons has doubled, e.g. "Unknown author Unknown
 * author". Several files carry the field twice with no separator, which would
 * otherwise render verbatim in a card's credit line.
 */
function dedupe(value) {
  const v = String(value).trim();
  const half = Math.floor(v.length / 2);
  for (const cut of [half, half + 1]) {
    const a = v.slice(0, cut).trim();
    const b = v.slice(cut).trim();
    if (a && a === b) return a;
  }
  return v;
}

/**
 * The first usable creator across the fields Commons uses for it. Returns ''
 * when none of them holds a real name, in which case a file requiring
 * attribution must not ship.
 */
function realArtist(meta) {
  for (const field of ['Artist', 'Credit', 'Attribution']) {
    const value = stripHtml(meta?.[field]?.value);
    if (value && !PLACEHOLDER_ARTIST.test(value)) return dedupe(value);
  }
  return '';
}

/**
 * Fetch with retry on 429 and 5xx.
 *
 * Commons throttling is the expected failure mode for a bulk client, not an
 * exceptional one, so a 429 backs off and retries rather than aborting the run.
 * `Retry-After` is honoured when the server sends it.
 */
async function fetchWithRetry(url, { accept = 'application/json' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept } });
    } catch (err) {
      lastErr = err;
      await sleep(1000 * (attempt + 1));
      continue;
    }

    if (res.ok) return res;

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
      process.stderr.write(`      (HTTP ${res.status}, waiting ${Math.round(wait / 1000)}s)\n`);
      await sleep(Math.min(wait, 60_000));
      lastErr = new Error(`Commons ${res.status} after ${attempt + 1} attempts`);
      continue;
    }

    throw new Error(`Commons API ${res.status} ${res.statusText}`);
  }
  throw lastErr ?? new Error('Commons request failed');
}

async function commonsSearch(term, limit = 14) {
  const url = new URL(API);
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: term,
    gsrnamespace: '6', // File:
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1200',
  }).toString();

  const res = await fetchWithRetry(url);
  const json = await res.json();
  return json?.query?.pages ?? [];
}

/**
 * Does this filename name the taxon being searched for?
 *
 * SINGLE SOURCE OF TRUTH. This logic was duplicated in inspect-species.mjs, and
 * when the group-taxon fix landed here the copy there went stale — the
 * diagnostic then reported "0 acceptable" for a species the fetcher could
 * actually match, which is worse than having no diagnostic at all.
 *
 * `commonName` switches the test to the weaker common-name match; the caller is
 * responsible for tagging the result.
 */
export function taxonMatch(title, scientific, commonName = '') {
  const t = String(title ?? '').toLowerCase();
  const binomial = String(scientific ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const isGroupTaxon = /\bspp?\.?\b/i.test(binomial) || !binomial.includes(' ');
  const baseName = binomial.replace(/\s*spp?\.?/i, '').trim();
  const genus = baseName.split(' ')[0];
  const epithet = isGroupTaxon ? '' : binomial.split(' ')[1] ?? '';
  const common = String(commonName ?? '').toLowerCase().trim();

  if (common) return t.includes(common);
  if (isGroupTaxon) return t.includes(baseName);
  return t.includes(binomial) || Boolean(epithet && t.includes(genus) && t.includes(epithet));
}

/**
 * Filter a search result set down to the single best acceptable file.
 *
 * Preference order: a JPEG/PNG over a drawing, a larger original over a small
 * one, and — where the search returns several — the one whose title actually
 * names this taxon, so "Melanocetus johnsonii" does not match a photo of an
 * entirely different anglerfish.
 *
 * `commonName` switches the naming test from the scientific name to the common
 * name. That is a weaker test and the caller tags the result accordingly; see
 * chooseFile below.
 *
 * GROUP TAXA. Three catalogue entries are not species at all:
 *
 *   dumbo-octopus   Grimpoteuthis spp.   a genus
 *   lanternfish     Myctophidae spp.     a family of ~250 species
 *   brittle-star    Ophiuroidea spp.     an entire class
 *
 * Requiring a filename to name the binomial "Grimpoteuthis spp." can never
 * match — no file is called that — so those three were silently starved of
 * photographs that plainly exist ("Grimpoteuthis umbellata.jpg", public domain,
 * 2566 px). For a group taxon the base name is the right thing to require.
 */
function collectCandidates(pages, scientific, commonName) {
  const binomial = scientific.toLowerCase().replace(/\s+/g, ' ').trim();
  const isGroupTaxon = /\bspp?\.?\b/i.test(binomial) || !binomial.includes(' ');
  const baseName = binomial.replace(/\s*spp?\.?/i, '').trim();
  const genus = baseName.split(' ')[0];
  const epithet = isGroupTaxon ? '' : binomial.split(' ')[1] ?? '';
  const common = String(commonName ?? '').toLowerCase().trim();

  const candidates = [];
  for (const page of pages) {
    const info = page?.imageinfo?.[0];
    if (!info) continue;
    if (!/^image\/(jpeg|png|webp)$/.test(info.mime ?? '')) continue;
    if (!info.thumburl) continue;

    const meta = info.extmetadata ?? {};
    const verdict = licenceVerdict(meta.LicenseShortName?.value);
    if (!verdict.ok) continue;

    const artist = realArtist(meta);
    if (!artist) continue; // never ship an uncredited CC file

    const title = String(page.title ?? '').toLowerCase();

    // Hard reject: anything whose title names it as not-a-photograph, carries a
    // museum accession code, or looks like a figure from a paper. The reason is
    // recorded so the run can hand these to a human instead of dropping them
    // silently — a preserved specimen is still the right animal, and someone
    // may well want it.
    const rejectReason = nonPhotoReason(title);
    if (rejectReason) {
      if (title.includes(binomial) || title.includes(genus)) {
        rejections.push({
          scientific,
          title: page.title,
          reason: rejectReason,
          page: info.descriptionurl,
        });
      }
      continue;
    }

    // Hard reject: the title must name THIS taxon. Genus-only matches would let
    // a well-photographed relative stand in for a species nobody has ever
    // photographed, which is a factual error in a reference atlas — but for a
    // group entry the base name IS the taxon, so that is what is required.
    //
    // On the common-name pass the test is the common name instead, which is
    // weaker by construction and why the caller tags the result.
    if (!taxonMatch(page.title, scientific, common)) continue;

    let score = common ? 60 : title.includes(binomial) || isGroupTaxon ? 100 : 45;
    if (info.width >= 1200) score += 12;
    score += Math.min(20, Math.round((info.width ?? 0) / 250));

    candidates.push({
      score,
      title: page.title,
      thumburl: info.thumburl,
      descriptionurl: info.descriptionurl,
      width: info.width,
      height: info.height,
      mime: info.mime,
      licence: verdict.why,
      licenceUrl: stripHtml(meta.LicenseUrl?.value),
      artist,
      credit: stripHtml(meta.Credit?.value),
      description: stripHtml(meta.ImageDescription?.value).slice(0, 300),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ?? null;
}

/**
 * Pick a photograph, preferring a scientific-name match and falling back to the
 * common name — never silently.
 *
 * Some species have excellent free-licensed photographs whose filenames use the
 * common name only: "Barreleye-fish GoK.jpg" is public domain at 4000 px and was
 * the sole usable candidate for Macropinna microstoma. But a common name is
 * ambiguous — "Brittle stars Ophioderma" is a different genus from the abyssal
 * ophiuroids the card describes — so a fallback match is tagged, recorded in the
 * manifest, and disclosed in the interface. The reader is told the image was
 * chosen on the common name and can weigh it; nothing is substituted in silence.
 */
function chooseFile(pages, scientific, { commonName = '' } = {}) {
  const strict = collectCandidates(pages, scientific, null);
  if (strict) return { ...strict, matchedOn: 'scientific' };

  if (commonName) {
    const loose = collectCandidates(pages, scientific, commonName);
    if (loose) return { ...loose, matchedOn: 'common-name' };
  }
  return null;
}

/**
 * Download a rendition and write it, naming the file after its ACTUAL format.
 *
 * Commons serves a thumbnail in the original file's format, so a PNG original
 * yields PNG bytes even though every URL ends in a plausible-looking name. The
 * first run wrote all of them as `.jpg` regardless, and because the server sets
 * `X-Content-Type-Options: nosniff` the browser then refused to decode them:
 * four cards (comb jelly, lanternfish, Mariana snailfish, megamouth shark) were
 * serving PNG and WebP bytes as image/jpeg. Returns the extension actually used.
 */
async function download(url, destBase) {
  const res = await fetchWithRetry(url, { accept: 'image/*' });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4096) throw new Error(`suspiciously small (${buf.length} bytes)`);

  let ext = null;
  if (buf[0] === 0xff && buf[1] === 0xd8) ext = 'jpg';
  else if (buf[0] === 0x89 && buf[1] === 0x50) ext = 'png';
  else if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') ext = 'webp';
  else if (buf.subarray(0, 3).toString('ascii') === 'GIF') ext = 'gif';

  if (!ext) throw new Error('response is not a recognised image format');

  const dest = `${destBase}.${ext}`;
  writeFileSync(dest, buf);
  return { bytes: buf.length, ext };
}

/**
 * Fetch one exact Commons file by title, bypassing search and scoring.
 *
 * Used for pinned overrides, where a human has already looked at the image. The
 * licence and creator are still validated — a pin chooses WHICH file, it does
 * not exempt the file from the licensing rules.
 */
async function fetchByTitle(title) {
  const url = new URL(API);
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1200',
  }).toString();

  const res = await fetchWithRetry(url);
  const json = await res.json();
  const pages = json?.query?.pages ?? [];
  const page = pages.find((p) => p.imageinfo?.[0]);
  if (!page) throw new Error(`pinned file not found on Commons: ${title}`);

  const info = page.imageinfo[0];
  const meta = info.extmetadata ?? {};
  const verdict = licenceVerdict(meta.LicenseShortName?.value);
  if (!verdict.ok) throw new Error(`pinned file is not freely licensed (${verdict.why})`);
  const artist = realArtist(meta);
  if (!artist) throw new Error('pinned file records no creator, so it cannot be credited');

  return {
    title: page.title,
    thumburl: info.thumburl,
    descriptionurl: info.descriptionurl,
    width: info.width,
    height: info.height,
    mime: info.mime,
    licence: verdict.why,
    licenceUrl: stripHtml(meta.LicenseUrl?.value),
    artist,
    credit: stripHtml(meta.Credit?.value),
    description: stripHtml(meta.ImageDescription?.value).slice(0, 300),
    matchedOn: 'pinned',
  };
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

async function main() {
  mkdirSync(IMG_DIR, { recursive: true });

  const existing = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  const manifest = { ...existing };
  const report = { fetched: [], skipped: [], failed: [] };

  const targets = ONLY ? SPECIES.filter((s) => s.slug.includes(ONLY)) : SPECIES;
  console.log(`\nABYSS species imagery — ${targets.length} species${DRY_RUN ? ' (dry run)' : ''}\n`);

  for (const sp of targets) {
    // An image may be .jpg, .png or .webp depending on the source file, so
    // "already present" means any known extension exists for this slug.
    const destBase = join(IMG_DIR, sp.slug);
    const existingFile = ['jpg', 'png', 'webp', 'gif']
      .map((e) => `${destBase}.${e}`)
      .find((p) => existsSync(p));
    if (existingFile && !FORCE) {
      console.log(`  ·  ${sp.slug.padEnd(24)} already present`);
      report.skipped.push({ slug: sp.slug, why: 'already downloaded' });
      continue;
    }

    try {
      /*
       * Search order matters as much as the matching rules.
       *
       * A group entry must be searched on its BASE name, not on "Xxx spp." —
       * the literal token "spp." poisons the Commons search and returns a page
       * of unrelated files, which is why brittle-star found nothing even after
       * the matching logic was fixed to accept "Ophiuroidea-Slangsterren.jpg".
       * Searching "Ophiuroidea" instead returns eight acceptable, properly
       * credited candidates.
       *
       * The common-name pass is last and tagged; see chooseFile.
       */
      const scientificTerms = [sp.scientific];
      if (/\bspp?\.?\b/i.test(sp.scientific)) {
        const base = sp.scientific.replace(/\s*spp?\.?/i, '').trim();
        if (base && base !== sp.scientific) scientificTerms.push(base);
      }

      const attempts = [
        ...scientificTerms.flatMap((t) => [
          { term: `"${t}"`, common: '' },
          { term: t, common: '' },
        ]),
        { term: `"${sp.common}"`, common: sp.common },
      ];

      let pick = null;

      // A pin wins outright: a human already looked at this file.
      if (PINS[sp.slug]) {
        try {
          pick = await fetchByTitle(PINS[sp.slug]);
        } catch (err) {
          console.log(`  !  ${sp.slug.padEnd(24)} pin failed (${err.message}); falling back to search`);
          pick = null;
        }
      }

      for (const attempt of pick ? [] : attempts) {
        const pages = await commonsSearch(attempt.term);
        pick = chooseFile(pages, sp.scientific, { commonName: attempt.common });
        if (pick) break;
        await sleep(API_DELAY_MS);
      }

      if (!pick) {
        console.log(`  –  ${sp.slug.padEnd(24)} no acceptable photograph`);
        report.skipped.push({ slug: sp.slug, why: 'no freely-licensed photograph naming this species' });
        await sleep(API_DELAY_MS);
        continue;
      }

      const via =
        pick.matchedOn === 'common-name'
          ? ' \x1b[33m(via common name)\x1b[0m'
          : pick.matchedOn === 'pinned'
            ? ' \x1b[36m(pinned)\x1b[0m'
            : '';

      if (DRY_RUN) {
        console.log(`  ?  ${sp.slug.padEnd(24)} ${pick.licence} — ${pick.title}${via}`);
        report.fetched.push({ slug: sp.slug, title: pick.title, licence: pick.licence, matchedOn: pick.matchedOn, dryRun: true });
        await sleep(API_DELAY_MS);
        continue;
      }

      const { bytes, ext } = await download(pick.thumburl, destBase);
      manifest[sp.slug] = {
        file: `/img/species/${sp.slug}.${ext}`,
        artist: pick.artist,
        licence: pick.licence,
        licenceUrl: pick.licenceUrl,
        sourceUrl: pick.descriptionurl,
        commonsTitle: pick.title,
        width: pick.width,
        height: pick.height,
        description: pick.description,
        // 'scientific' or 'common-name'. Recorded so the interface can disclose
        // a fallback match rather than passing it off as a binomial match.
        matchedOn: pick.matchedOn,
        retrieved: new Date().toISOString().slice(0, 10),
      };
      writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
      console.log(`  ✓  ${sp.slug.padEnd(24)} ${pick.licence} · ${(bytes / 1024).toFixed(0)} kB · ${pick.artist.slice(0, 32)}${via}`);
      report.fetched.push({ slug: sp.slug, title: pick.title, licence: pick.licence, matchedOn: pick.matchedOn });
    } catch (err) {
      console.log(`  ✗  ${sp.slug.padEnd(24)} ${err.message}`);
      report.failed.push({ slug: sp.slug, error: err.message });
    }

    // One request per second is Commons' courtesy rate. The original 250 ms
    // earned HTTP 429 after eight species.
    await sleep(DRY_RUN ? API_DELAY_MS : DOWNLOAD_DELAY_MS);
  }

  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  fetched ${report.fetched.length} · skipped ${report.skipped.length} · failed ${report.failed.length}`);
  if (!DRY_RUN && report.fetched.length) {
    console.log(`  images   ${IMG_DIR}`);
    console.log(`  manifest ${MANIFEST}`);
  }

  /*
   * Hand the near-misses to a human rather than dropping them. A preserved
   * museum specimen, a plate from a taxonomic paper, or a 19th-century
   * illustration still depicts the right animal — it simply is not a photograph
   * of the living one, which is what this atlas asked for. Somebody should get
   * to decide, so the reasons are printed with the links.
   */
  if (rejections.length) {
    console.log(`\n  ${rejections.length} candidate(s) rejected by title — review if you want them:`);
    const seen = new Set();
    for (const r of rejections) {
      const key = `${r.scientific}|${r.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`    ${r.scientific}`);
      console.log(`      ${r.title}`);
      console.log(`      rejected: ${r.reason}`);
      if (r.page) console.log(`      ${r.page}`);
    }
  }

  console.log('');
}

/**
 * Only run when executed directly.
 *
 * The matching rules are the part of this script most likely to be wrong — they
 * already produced two false positives that rejected legitimate photographs —
 * so `nonPhotoReason` is exported and unit-tested by scripts/test-match-rules.mjs.
 * Importing this module must therefore not start a network run.
 */
const isDirect =
  process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  main().catch((err) => {
    console.error('\nfetch-species-images failed:', err.message);
    console.error('If this is a network denial, add Wikimedia to the egress allow-list in');
    console.error('~/.dsh/rules.yaml and restart dsh. See README "Species photography".\n');
    process.exit(1);
  });
}

export { nonPhotoReason, chooseFile, licenceVerdict };
