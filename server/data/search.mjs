/**
 * search.mjs — catalogue ranking, shared by the server and the browser.
 *
 * Pure functions with no imports, for the same reason ocean.mjs has none: the
 * static export runs this in the browser, and the full-stack server runs it in
 * Node. Two copies of a ranking rule is how a static build and a live server
 * quietly start disagreeing about which squid is the best match for "squid",
 * so there is exactly one copy and scripts/build-static.mjs ships it verbatim.
 *
 * Ranking is deliberate rather than clever: a hit in the common name beats a
 * hit in the scientific name, which beats a hit in the group or diet, which
 * beats a hit in the blurb. With a few dozen rows that is both faster and far
 * more legible than a full-text index.
 */

/**
 * Score one species against a lowercased search term.
 * Returns 0 when it does not match at all.
 */
export function scoreSpecies(s, term) {
  let score = 0;
  const common = String(s.common ?? '').toLowerCase();
  const sci = String(s.scientific ?? '').toLowerCase();
  const fam = String(s.family ?? '').toLowerCase();
  const grp = String(s.group ?? '').toLowerCase();
  const blurb = String(s.blurb ?? '').toLowerCase();
  const diet = String(s.diet ?? '').toLowerCase();

  if (common === term) score += 100;
  else if (common.startsWith(term)) score += 60;
  else if (common.includes(term)) score += 35;

  if (sci === term) score += 90;
  else if (sci.startsWith(term)) score += 50;
  else if (sci.includes(term)) score += 30;

  if (grp.includes(term)) score += 25;
  if (fam.includes(term)) score += 20;
  if (diet.includes(term)) score += 12;
  if (blurb.includes(term)) score += 8;

  // Multi-word queries: every token must appear somewhere.
  const tokens = term.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const hay = `${common} ${sci} ${fam} ${grp} ${blurb} ${diet}`;
    if (!tokens.every((t) => hay.includes(t))) return 0;
    score += 10;
  }
  return score;
}

/** Comparators for the catalogue's sort control. */
export function sorterFor(sort) {
  switch (sort) {
    case 'name':
      return (a, b) => a.common.localeCompare(b.common);
    case 'size':
      return (a, b) => (b.sizeCm ?? 0) - (a.sizeCm ?? 0);
    case 'deepest':
      return (a, b) => b.depthMax - a.depthMax;
    case 'shallowest':
      return (a, b) => a.depthMin - b.depthMin;
    case 'depth':
    default:
      return (a, b) => a.depthMin - b.depthMin || a.common.localeCompare(b.common);
  }
}

/**
 * Search, filter and sort a plain array of species.
 *
 * This is the whole query the atlas needs, and it is identical in both modes.
 * The server passes its SQL rows through it; the browser passes the JSON the
 * build emitted.
 */
export function querySpecies(rows, { q = '', zone = '', glow = '', sort = 'depth', limit = 100, offset = 0 } = {}) {
  let list = rows;

  if (zone) list = list.filter((s) => s.zone === zone);
  if (glow === 'true' || glow === '1') list = list.filter((s) => s.bioluminescent);
  if (glow === 'false' || glow === '0') list = list.filter((s) => !s.bioluminescent);

  const term = String(q).trim().toLowerCase();
  if (term) {
    list = list
      .map((s) => ({ s, score: scoreSpecies(s, term) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.s.common.localeCompare(b.s.common))
      .map((x) => x.s);
  } else {
    list = [...list].sort(sorterFor(sort));
  }

  return { total: list.length, items: list.slice(offset, offset + limit) };
}