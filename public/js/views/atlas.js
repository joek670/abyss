/**
 * atlas.js — the searchable catalogue.
 *
 * Filter state lives in the URL (`#/atlas?q=squid&zone=hadal`), so a filtered
 * view is a linkable, back-button-able thing. The toolbar is sticky because
 * the grid is long, and the search is debounced against the server so that the
 * ranking rules live in exactly one place.
 */
import { h, num, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { state, bootstrap } from '../core/store.js';
import { specimenCard } from './parts.js';
import { notifyError } from '../core/toast.js';

const SORTS = [
  ['depth', 'Shallowest first'],
  ['deepest', 'Deepest first'],
  ['name', 'Name (A–Z)'],
  ['size', 'Largest first'],
];

export const atlasView = {
  title: () => 'Atlas',

  async render(ctx) {
    const q = ctx.query.get('q') ?? '';
    const zone = ctx.query.get('zone') ?? '';
    const glow = ctx.query.get('glow') ?? '';
    const sort = ctx.query.get('sort') ?? 'depth';

    const page = h('div.page.page--wide');

    page.append(
      h(
        'header',
        { style: { marginBottom: 'var(--s-5)' } },
        h('span.eyebrow', null, 'Catalogue'),
        h(
          'h1',
          {
            style: {
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--t-4)',
              fontWeight: '400',
              letterSpacing: 'var(--tr-tight)',
              marginTop: 'var(--s-2)',
            },
          },
          'The Atlas',
        ),
        h(
          'p.lede',
          { style: { marginTop: 'var(--s-3)' } },
          'Every specimen below has a recorded bathymetric range. The bar under each card ' +
            'is drawn against the full 10,935 m column, so a shallow-water fish and a hadal ' +
            'amphipod can be compared directly.',
        ),
      ),
    );

    /* ── Toolbar ────────────────────────────────────────────────────── */

    const searchInput = h('input.input', {
      type: 'search',
      value: q,
      placeholder: 'Search by name, family, or diet…',
      'aria-label': 'Search specimens',
      autocomplete: 'off',
      spellcheck: 'false',
    });

    const countEl = h('span.atlas__count', null, '—');

    const zoneChips = h('div.atlas__filters', { id: 'zone-chips' });
    const glowChip = h(
      'button.chip',
      {
        type: 'button',
        'aria-pressed': glow === 'true' ? 'true' : 'false',
        onclick: () => update({ glow: glow === 'true' ? '' : 'true' }),
      },
      h('span.chip__dot', { style: { background: 'var(--lure)' } }),
      'Bioluminescent only',
    );

    const sortSelect = h(
      'select.select',
      {
        'aria-label': 'Sort order',
        style: { width: 'auto', minWidth: '170px' },
        onchange: (e) => update({ sort: e.target.value }),
      },
      ...SORTS.map(([value, label]) =>
        h('option', { value, selected: value === sort }, label),
      ),
    );

    const toolbar = h(
      'div.atlas__toolbar',
      null,
      h(
        'div.atlas__search',
        null,
        searchIcon(),
        searchInput,
      ),
      zoneChips,
      glowChip,
      sortSelect,
      countEl,
    );

    page.append(toolbar);

    const grid = h('div.atlas__grid', { id: 'atlas-grid' }, ...skeletons(9));
    page.append(grid);

    /* ── Behaviour ──────────────────────────────────────────────────── */

    const update = (patch) => {
      const next = new URLSearchParams(ctx.query);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const qs = next.toString();
      location.hash = `#/atlas${qs ? '?' + qs : ''}`;
    };

    const onSearch = debounce((value) => update({ q: value.trim() }), 260);
    searchInput.addEventListener('input', () => onSearch(searchInput.value));

    return page;
  },

  async mount(ctx, node) {
    const grid = node.querySelector('#atlas-grid');
    const countEl = node.querySelector('.atlas__count');
    const chips = node.querySelector('#zone-chips');
    const searchInput = node.querySelector('.atlas__search input');

    const params = {
      q: ctx.query.get('q') ?? '',
      zone: ctx.query.get('zone') ?? '',
      glow: ctx.query.get('glow') ?? '',
      sort: ctx.query.get('sort') ?? 'depth',
      limit: 200,
    };

    /* Zone chips need the zone list. */
    try {
      const cat = await bootstrap();
      chips.replaceChildren(
        h(
          'button.chip',
          {
            type: 'button',
            'aria-pressed': params.zone ? 'false' : 'true',
            onclick: () => setZone(''),
          },
          'All zones',
        ),
        ...cat.zones.map((z) =>
          h(
            'button.chip',
            {
              type: 'button',
              'aria-pressed': params.zone === z.id ? 'true' : 'false',
              style: params.zone === z.id ? { '--chip-accent': z.accent } : null,
              onclick: () => setZone(z.id),
            },
            h('span.chip__dot', { style: { background: z.accent } }),
            `${z.name} (${z.speciesCount})`,
          ),
        ),
      );
    } catch {
      chips.replaceChildren();
    }

    function setZone(id) {
      const next = new URLSearchParams(ctx.query);
      if (id) next.set('zone', id);
      else next.delete('zone');
      const qs = next.toString();
      location.hash = `#/atlas${qs ? '?' + qs : ''}`;
    }

    /* Fetch and render. */
    try {
      const res = await api.species(params, { cacheMs: 0 });
      renderGrid(res, grid, countEl, params);
    } catch (err) {
      grid.replaceChildren(
        h(
          'div.empty',
          { style: { gridColumn: '1 / -1' } },
          h('p.empty__title', null, 'The catalogue could not be loaded'),
          h('p.muted', null, err.message),
        ),
      );
      notifyError(err);
    }

    /* Keep focus in the search box across a re-render triggered by typing. */
    if (params.q && searchInput) {
      searchInput.focus();
      searchInput.setSelectionRange(params.q.length, params.q.length);
    }
  },
};

function renderGrid(res, grid, countEl, params) {
  if (countEl) {
    const parts = [`${num(res.total)} specimen${res.total === 1 ? '' : 's'}`];
    if (params.q) parts.push(`matching “${params.q}”`);
    countEl.textContent = parts.join(' · ');
  }

  if (!res.items.length) {
    grid.replaceChildren(
      h(
        'div.empty',
        { style: { gridColumn: '1 / -1' } },
        emptyIcon(),
        h('p.empty__title', null, 'Nothing in the catalogue matches that'),
        h('p.muted', null, 'Try a shorter term, a scientific name, or clear the zone filter.'),
        h(
          'a.btn.btn--sm',
          { href: '#/atlas', style: { marginTop: 'var(--s-3)' } },
          'Clear all filters',
        ),
      ),
    );
    return;
  }

  grid.replaceChildren(...res.items.map((sp) => specimenCard(sp)));
}

/* ── Bits ────────────────────────────────────────────────────────────── */

function skeletons(n) {
  return Array.from({ length: n }, () =>
    h('div.skeleton', { style: { height: '290px', borderRadius: 'var(--r-4)' } }),
  );
}

function searchIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('aria-hidden', 'true');
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('cx', '11');
  c.setAttribute('cy', '11');
  c.setAttribute('r', '7');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'm20 20-3.6-3.6');
  svg.append(c, p);
  return svg;
}

function emptyIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('class', 'empty__icon');
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('cx', '11');
  c.setAttribute('cy', '11');
  c.setAttribute('r', '7');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'm20 20-3.6-3.6M8.5 11h5');
  svg.append(c, p);
  return svg;
}
