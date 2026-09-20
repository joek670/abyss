/**
 * inspect-species.mjs — why did a species get no photograph?
 *
 * The fetcher reports only what it REJECTED and why; it never shows what it
 * actually saw. That is fine for a bulk run and useless for answering "is there
 * really nothing, or is the filter wrong?". This dumps every candidate the
 * Commons search returned for a species, with its licence and the precise
 * verdict, so the answer is evidence rather than inference.
 *
 * It also searches alternative terms, which matters because two entries in the
 * catalogue are not species at all:
 *
 *   lanternfish   is "Myctophidae spp."  — a family of ~250 species
 *   brittle-star  is "Ophiuroidea spp."  — a whole class
 *
 * The fetcher requires a title to name the binomial, so those two can never
 * match by construction. They need a different search term, not a looser rule.
 *
 *   node scripts/inspect-species.mjs                     # the six with no photo
 *   node scripts/inspect-species.mjs --slug=dumbo-octopus
 *   node scripts/inspect-species.mjs --terms="Ophiuroidea,brittle star"
 */
import { SPECIES } from '../server/data/species.mjs';
import { nonPhotoReason, licenceVerdict, taxonMatch } from './fetch-species-images.mjs';

const args = process.argv.slice(2);
const ONLY = (args.find((a) => a.startsWith('--slug=')) ?? '').slice(7) || null;
const EXTRA_TERMS = (args.find((a) => a.startsWith('--terms=')) ?? '').slice(8) || null;

/** The six that came back with no photograph. */
const NO_PHOTO = [
  'dumbo-octopus',
  'brittle-star',
  'whalefall-osedax',
  'yeti-crab',
  'lanternfish',
  'barreleye',
];

const USER_AGENT = 'ABYSS-species-atlas/1.0 (educational deep-sea reference; node-fetch)';
const API = 'https://commons.wikimedia.org/w/api.php';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v)
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

async function search(term, limit = 20) {
  const url = new URL(API);
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: term,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1200',
  }).toString();

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (res.ok) {
      const json = await res.json();
      return json?.query?.pages ?? [];
    }
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** attempt;
      process.stderr.write(`  (HTTP ${res.status}, waiting ${Math.round(wait / 1000)}s)\n`);
      await sleep(Math.min(wait, 45000));
      continue;
    }
    throw new Error(`Commons ${res.status}`);
  }
  throw new Error('Commons request failed after retries');
}

/**
 * Verdict for one candidate.
 *
 * Uses the fetcher's own `taxonMatch` rather than a local copy. The duplicate
 * that used to live here went stale the moment the group-taxon fix landed, and
 * the diagnostic then reported "0 acceptable" for a species the fetcher could
 * match — a diagnostic that disagrees with the thing it diagnoses is worse than
 * none.
 */
function verdictFor(title, scientific, commonName = '') {
  const bad = nonPhotoReason(String(title).toLowerCase());
  if (bad) return { ok: false, why: bad };
  if (!taxonMatch(title, scientific, commonName)) {
    return { ok: false, why: `title does not name ${commonName || scientific}` };
  }
  return { ok: true, why: 'acceptable' };
}

async function inspect(sp, terms) {
  console.log(`\n\x1b[1m${sp.slug}\x1b[0m — ${sp.common} (${sp.scientific})`);

  for (const term of terms) {
    let pages;
    try {
      pages = await search(term);
    } catch (err) {
      console.log(`  search "${term}" failed: ${err.message}`);
      continue;
    }
    await sleep(1100);

    const usable = [];
    const rejected = [];
    // A search on the common name is judged on the common name, exactly as the
    // fetcher's fallback pass does.
    const usingCommon = term.toLowerCase() === String(sp.common).toLowerCase();
    const creditField = term;

    for (const page of pages) {
      const info = page?.imageinfo?.[0];
      if (!info) continue;
      if (!/^image\/(jpeg|png|webp)$/.test(info.mime ?? '')) continue;

      const meta = info.extmetadata ?? {};
      const lic = licenceVerdict(meta.LicenseShortName?.value);
      const artist = stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value) || '';
      const v = verdictFor(page.title, sp.scientific, usingCommon ? sp.common : '');

      // The fetcher refuses a file requiring attribution when no real creator is
      // recorded, so the diagnostic must apply the same rule — otherwise it
      // reports "acceptable" for a file the fetcher will always skip.
      const needsCredit = !/^(cc0|public domain|pd[- ])/i.test(lic.why);
      const hasArtist = artist && !/^(null|undefined|unknown|anonymous|n\/?a|none|-+)$/i.test(artist.trim());
      const creditOk = !needsCredit || hasArtist;

      const row = {
        title: page.title.replace(/^File:/, ''),
        licence: lic.ok ? lic.why : `NOT FREE (${lic.why})`,
        artist: hasArtist ? artist.slice(0, 34) : '(NO CREATOR RECORDED)',
        width: info.width,
        ok: v.ok && lic.ok && creditOk,
        why: !v.ok
          ? v.why
          : !lic.ok
            ? lic.why
            : !creditOk
              ? `licence ${lic.why} requires a creator, but none is recorded`
              : 'acceptable',
      };
      (row.ok ? usable : rejected).push(row);
    }

    console.log(
      `  \x1b[36msearch "${term}"\x1b[0m — ${pages.length} files, ${usable.length} acceptable${usingCommon ? ' \x1b[33m(common-name pass)\x1b[0m' : ''}`,
    );
    for (const r of usable) {
      console.log(`    \x1b[32mACCEPT\x1b[0m ${r.licence.padEnd(20)} ${String(r.width).padStart(5)}px  ${r.title.slice(0, 58)}`);
      console.log(`           credit: ${r.artist}`);
    }
    for (const r of rejected.slice(0, 10)) {
      console.log(`    reject ${r.licence.slice(0, 20).padEnd(20)} ${String(r.width).padStart(5)}px  ${r.title.slice(0, 58)}`);
      console.log(`           reason: ${r.why}`);
      if (/NO CREATOR/.test(r.artist)) console.log(`           credit: ${r.artist}`);
    }
    if (rejected.length > 10) console.log(`    … and ${rejected.length - 10} more rejected`);
    void creditField;
  }
}

const targets = ONLY
  ? SPECIES.filter((s) => s.slug === ONLY || s.slug.includes(ONLY))
  : SPECIES.filter((s) => NO_PHOTO.includes(s.slug));

console.log(`\nInspecting ${targets.length} species — every Commons candidate, and why it was accepted or rejected\n`);
console.log('='.repeat(78));

for (const sp of targets) {
  // The catalogue stores family- and class-level entries as "Xxx spp."; a
  // binomial search can never match those, so also search the group name.
  const terms = [sp.scientific];
  if (/spp\./i.test(sp.scientific)) {
    const genus = sp.scientific.replace(/\s*spp\.?/i, '').trim();
    terms.push(genus);
    terms.push(sp.common);
    if (sp.family) terms.push(sp.family);
  }
  if (EXTRA_TERMS && ONLY) terms.push(...EXTRA_TERMS.split(',').map((t) => t.trim()));
  await inspect(sp, [...new Set(terms)]);
}

console.log(`\n${'='.repeat(78)}\n`);
