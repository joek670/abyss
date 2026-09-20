/**
 * parts.js — components shared between views.
 *
 * The specimen card is used by the atlas, the descent, and the console's
 * "what lives here" list, so it lives in one place with one definition of what
 * a specimen looks like.
 */
import { h, num, percent, unit, tint, clear } from '../core/dom.js';
import { sprite } from '../viz/sprites.js';
import { api } from '../core/api.js';
import { CHALLENGER_DEEP } from '../core/store.js';
import { toast, notifyError } from '../core/toast.js';

/* ------------------------------------------------------------------ *
 * Depth bar
 * ------------------------------------------------------------------ */

/**
 * A species' recorded depth range, drawn against the full 0–10,935 m column so
 * that any two cards can be compared at a glance.
 */
export function depthBar(depthMin, depthMax, accent) {
  const left = (depthMin / CHALLENGER_DEEP) * 100;
  const width = Math.max(0.6, ((depthMax - depthMin) / CHALLENGER_DEEP) * 100);
  return h(
    'div.depthbar',
    { title: `${num(depthMin)}–${num(depthMax)} m` },
    h('div.depthbar__span', {
      style: { left: `${left}%`, width: `${width}%`, background: accent },
    }),
  );
}

/* ------------------------------------------------------------------ *
 * Specimen card
 * ------------------------------------------------------------------ */

/**
 * The artwork slot: a photograph when one exists, otherwise the drawn plate.
 *
 * A photograph carries its credit INLINE and always visible. CC BY and CC BY-SA
 * both make naming the creator a condition of use, and hiding that behind a
 * hover would fail it — hover is unreachable on touch, invisible in print, and
 * gone the moment someone screenshots the grid. The credit is short because it
 * sits under one of thirty-six cards; the full record with the source link
 * lives on the detail page.
 */
export function specimenArt(sp, { size = 200 } = {}) {
  if (sp.image?.file) {
    return h(
      'figure.specimen__photo',
      null,
      h('img', {
        src: sp.image.file,
        // Describe the subject, not the medium: a screen reader user wants to
        // know which animal this is, and the credit is already in the caption.
        alt: `${sp.common} — ${sp.scientific}`,
        loading: 'lazy',
        decoding: 'async',
      }),
      h('figcaption.credit', null, creditLine(sp.image)),
    );
  }

  return h(
    'div.specimen__art',
    null,
    sprite(sp.sprite, { size }),
    sp.bioluminescent ? h('span.specimen__glow') : null,
  );
}

/** "Photo: NOAA · Public domain" — compact enough for a card grid. */
export function creditLine(image) {
  if (!image) return '';
  const who = image.artist ? `Photo: ${image.artist}` : 'Photo';
  return image.licence ? `${who} · ${image.licence}` : who;
}

export function specimenCard(sp, { compact = false } = {}) {
  const accent = sp.accent ?? 'var(--accent)';

  const card = h(
    'a.specimen',
    {
      href: `#/atlas/${sp.slug}`,
      style: { '--specimen-accent': accent },
      'aria-label': `${sp.common}, ${sp.scientific}`,
    },
    specimenArt(sp, { size: 200 }),
    h(
      'div.specimen__body',
      null,
      h('div.specimen__name', null, sp.common),
      h('div.specimen__sci', null, sp.scientific),
      !compact && sp.blurb
        ? h(
            'p',
            {
              class: 'tiny muted',
              style: {
                display: '-webkit-box',
                WebkitLineClamp: '3',
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              },
            },
            sp.blurb,
          )
        : null,
      h(
        'div.specimen__foot',
        null,
        h('span.specimen__depth', null, `${num(sp.depthMin)}–${num(sp.depthMax)} m`),
        sp.bioluminescent ? h('span.chip.chip--glow', null, 'bioluminescent') : null,
      ),
      depthBar(sp.depthMin, sp.depthMax, accent),
    ),
  );

  return card;
}

/* ------------------------------------------------------------------ *
 * Stat
 * ------------------------------------------------------------------ */

export function stat({ value, unit: u = '', label, tone = '' }) {
  return h(
    `div.stat${tone ? '.stat--' + tone : ''}`,
    null,
    h(
      'div.stat__value',
      null,
      value,
      u ? h('small', null, u) : null,
    ),
    h('div.stat__label', null, label),
  );
}

/* ------------------------------------------------------------------ *
 * Specimen drawer (quick look)
 * ------------------------------------------------------------------ */

let drawerEls = null;

function ensureDrawer() {
  if (drawerEls) return drawerEls;
  const root = document.getElementById('drawer');
  const body = document.getElementById('drawer-body');
  if (!root || !body) return null;

  let onClose = null;
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeDrawer();
  });

  drawerEls = {
    root,
    body,
    setCloseHandler(fn) {
      onClose = fn;
    },
    get onClose() {
      return onClose;
    },
  };
  return drawerEls;
}

export function closeDrawer() {
  const d = ensureDrawer();
  if (!d) return;
  d.root.hidden = true;
  document.body.style.overflow = '';
  d.onClose?.();
}

export function isDrawerOpen() {
  const d = ensureDrawer();
  return !!d && !d.root.hidden;
}

/**
 * Open the quick-look drawer for a species slug.
 * `onClose` is used by the console to stop anything it started.
 */
export async function openSpeciesDrawer(slug, { onClose } = {}) {
  const d = ensureDrawer();
  if (!d) return;

  d.setCloseHandler(onClose ?? null);
  d.root.hidden = false;
  document.body.style.overflow = 'hidden';
  d.body.replaceChildren(
    h('div.stack.stack-4', null, h('div.skeleton', { style: { height: '180px' } }), h('div.skeleton', { style: { height: '28px', width: '60%' } })),
  );

  try {
    const sp = await api.speciesOne(slug);
    if (d.root.hidden) return; // closed while loading
    clear(d.body);
    d.body.append(taxonDetail(sp, { compact: true }));
  } catch (err) {
    clear(d.body);
    d.body.append(
      h('div.empty', null, h('p.empty__title', null, 'Could not load this specimen'), h('p.muted', null, err.message)),
    );
  }
}

/* ------------------------------------------------------------------ *
 * Taxon detail — shared by the drawer and the full page
 * ------------------------------------------------------------------ */

/**
 * The large plate on the detail page and in the drawer.
 *
 * Where a photograph exists this carries the FULL attribution record — artist,
 * the licence with a link to its deed, and a link to the Commons file page —
 * rather than the abbreviated card line. The licence has to travel with the
 * image, and this is the surface with room to do it properly.
 */
export function taxonPlate(sp) {
  if (!sp.image?.file) {
    return h('div.taxon__art', null, sprite(sp.sprite, { size: 260, title: sp.common }));
  }

  const img = sp.image;
  const external = { target: '_blank', rel: 'noopener noreferrer' };

  return h(
    'figure.taxon__photo',
    null,
    h('img', {
      src: img.file,
      alt: `${sp.common} — ${sp.scientific}`,
      loading: 'lazy',
      decoding: 'async',
    }),
    h(
      'figcaption.credit.credit--full',
      null,
      h('span', null, `Photo: ${img.artist || 'unknown'}`),
      img.licence
        ? h(
            'span',
            null,
            img.licenceUrl
              ? h('a', { href: img.licenceUrl, ...external }, img.licence)
              : img.licence,
          )
        : null,
      img.sourceUrl
        ? h('a', { href: img.sourceUrl, ...external }, 'Wikimedia Commons')
        : null,
      // Disclose a fallback match. This image was chosen on the common name, not
      // the scientific one, so it may show a related species rather than the
      // exact animal the card describes. Saying so is the difference between a
      // documented approximation and a silent substitution.
      img.matchedOn === 'common-name'
        ? h(
            'span.dim',
            {
              title:
                'No free-licensed photograph naming this species was found. This image was ' +
                'selected on the common name and may show a related species.',
            },
            '⚠ matched on common name — may show a related species',
          )
        : null,
      img.retrieved ? h('span.dim', null, `retrieved ${img.retrieved}`) : null,
    ),
  );
}

export function taxonDetail(sp, { compact = false } = {}) {
  const accent = sp.accent ?? 'var(--accent)';

  const rows = [
    ['Scientific name', h('i', null, sp.scientific)],
    ['Family', sp.family ?? '—'],
    ['Group', sp.group ?? '—'],
    ['Recorded depth', `${num(sp.depthMin)} – ${num(sp.depthMax)} m`],
    ['Typical size', sp.sizeCm ? `${num(sp.sizeCm, sp.sizeCm < 10 ? 1 : 0)} cm` : '—'],
    ['Mass', sp.massKg ? formatMass(sp.massKg) : '—'],
    ['Diet', sp.diet ?? '—'],
    ['IUCN status', sp.iucn ?? 'Not evaluated'],
    [
      'Bioluminescent',
      sp.bioluminescent ? h('span.accent', null, 'Yes — produces its own light') : 'No',
    ],
  ];

  return h(
    'article.taxon',
    { style: { '--spec-accent': accent } },
    taxonPlate(sp),
    h(
      'div.taxon__names',
      null,
      h('h1.taxon__common', null, sp.common),
      h('p.taxon__sci', null, sp.scientific),
      h(
        'div.row',
        { style: { marginTop: 'var(--s-3)' } },
        sp.bioluminescent ? h('span.chip.chip--glow', null, 'bioluminescent') : null,
        h('span.chip', null, sp.group ?? 'Specimen'),
        h('span.chip', null, `${num(sp.depthMin)}–${num(sp.depthMax)} m`),
      ),
    ),
    h('p.lede', null, sp.blurb),

    sp.facts?.length
      ? h(
          'section',
          { style: { marginTop: 'var(--s-6)' } },
          h('div.eyebrow', null, 'Field notes'),
          h(
            'div.taxon__facts',
            null,
            sp.facts.map((f, i) =>
              h('div.fact', null, h('span.fact__n', null, String(i + 1).padStart(2, '0')), h('span', null, f)),
            ),
          ),
        )
      : null,

    h(
      'section',
      { style: { marginTop: 'var(--s-6)' } },
      h('div.eyebrow', { style: { marginBottom: 'var(--s-3)' } }, 'Classification'),
      h(
        'div.speclist',
        null,
        rows.map(([k, v]) =>
          h('div.speclist__row', null, h('div.speclist__key', null, k), h('div.speclist__val', null, v)),
        ),
      ),
    ),

    sp.environment
      ? h(
          'section',
          { style: { marginTop: 'var(--s-6)' } },
          h('div.eyebrow', { style: { marginBottom: 'var(--s-3)' } }, 'Conditions across its range'),
          h(
            'div.speclist',
            null,
            envRow('At its shallow limit', sp.environment.shallow),
            envRow('At its deep limit', sp.environment.deep),
          ),
        )
      : null,

    !compact && sp.related?.length
      ? h(
          'section',
          { style: { marginTop: 'var(--s-6)' } },
          h('div.eyebrow', { style: { marginBottom: 'var(--s-3)' } }, 'Shares this zone with'),
          h(
            'div.related',
            null,
            sp.related.map((r) =>
              h(
                'a.related__item',
                { href: `#/atlas/${r.slug}`, style: { '--spec-accent': r.accent } },
                h('b', null, r.common),
                h('i.tiny.dim', null, r.scientific),
                h('span.tiny.dim', null, `${num(r.depthMin)}–${num(r.depthMax)} m`),
              ),
            ),
          ),
        )
      : null,
  );
}

function envRow(label, env) {
  if (!env) return null;
  return h(
    'div.speclist__row',
    null,
    h('div.speclist__key', null, label),
    h(
      'div.speclist__val',
      null,
      h(
        'span.mono',
        null,
        `${num(env.depth)} m · ${num(env.pressureBar, 1)} bar · ${num(env.temperature, 2)} °C · ` +
          `${num(env.soundSpeed, 1)} m/s · light ${percent(env.lightPercent, 4)}`,
      ),
      h('div.tiny.dim', { style: { marginTop: '2px' } }, env.isDark ? 'Permanently dark' : 'Some light penetrates'),
    ),
  );
}

function formatMass(kg) {
  if (kg >= 1000) return `${num(kg / 1000, 1)} t`;
  if (kg >= 1) return `${num(kg, 1)} kg`;
  return `${num(kg * 1000, 0)} g`;
}

/* ------------------------------------------------------------------ *
 * Buttons that do things
 * ------------------------------------------------------------------ */

export async function withBusy(button, fn) {
  const original = button.textContent;
  button.setAttribute('aria-disabled', 'true');
  button.textContent = 'Working…';
  try {
    return await fn();
  } catch (err) {
    notifyError(err);
    return null;
  } finally {
    button.removeAttribute('aria-disabled');
    button.textContent = original;
  }
}

export { toast, notifyError };
