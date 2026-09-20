/**
 * descent.js — the scroll-driven narrative.
 *
 * Five full-height blocks, one per zone. Each carries `data-depth`, which the
 * shell's scroll observer reads to drive the depth rail and the instrument
 * strip; the background gradient follows via `--depth-progress`. Scrolling the
 * page therefore *is* the descent, and the chrome reports it as such.
 *
 * Boundary readings come from a single /api/ocean/profile call, indexed by
 * depth, rather than one request per boundary.
 */
import { h, num, percent } from '../core/dom.js';
import { api } from '../core/api.js';
import { bootstrap, setDepth } from '../core/store.js';
import { specimenCard } from './parts.js';

export const descentView = {
  title: () => 'The Descent',

  async render() {
    const page = h('div.page.page--wide.descent');

    /* Intro block, pinned at the surface. */
    page.append(
      h(
        'section.zone-block',
        { dataset: { depth: '0' }, style: { minHeight: '70dvh' } },
        h(
          'div.zone-block__head',
          null,
          h('span.eyebrow', null, 'The descent'),
          h(
            'h1.zone-block__name',
            { style: { fontSize: 'var(--t-4)' } },
            'Eleven kilometres, in five layers',
          ),
          h(
            'p.zone-block__summary',
            { style: { marginTop: 'var(--s-4)' } },
            'Oceanographers divide the water column by how much light is left in it. ' +
              'The boundaries are not arbitrary — each one marks a physical threshold that ' +
              'changes what can live there. Scroll, and the instruments at the edges of this ' +
              'page will follow you down.',
          ),
        ),
      ),
    );

    const host = h('div', { id: 'zone-blocks' });
    page.append(host);

    return page;
  },

  async mount(ctx, node) {
    const host = node.querySelector('#zone-blocks');
    if (!host) return;

    let zones = [];
    let speciesByZone = new Map();
    let profileIndex = new Map();

    const [catalogue, allSpecies, profile] = await Promise.allSettled([
      bootstrap(),
      api.species({ limit: 200, sort: 'depth' }),
      api.profile(10935, 25),
    ]);

    if (catalogue.status === 'fulfilled') zones = catalogue.value.zones ?? [];
    if (allSpecies.status === 'fulfilled') {
      for (const sp of allSpecies.value.items) {
        if (!speciesByZone.has(sp.zone)) speciesByZone.set(sp.zone, []);
        speciesByZone.get(sp.zone).push(sp);
      }
    }
    if (profile.status === 'fulfilled') {
      for (const row of profile.value.rows) profileIndex.set(row.depth, row);
    }

    const readAt = (depth) => {
      // Snap to the nearest sampled row.
      let best = null;
      let bestDelta = Infinity;
      for (const [d, row] of profileIndex) {
        const delta = Math.abs(d - depth);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = row;
        }
      }
      return best;
    };

    for (const [i, zone] of zones.entries()) {
      const fauna = (speciesByZone.get(zone.id) ?? []).slice(0, 4);
      const mid = Math.round((zone.min + zone.max) / 2);
      const atTop = readAt(zone.min + 1);
      const atBottom = readAt(zone.max - 1);

      host.append(
        h(
          'section.zone-block',
          {
            id: `zone-${zone.id}`,
            dataset: { depth: String(mid) },
            style: { '--zone-accent': zone.accent },
          },
          h(
            'div.zone-block__head',
            null,
            h('div.zone-block__index', null, `ZONE ${String(i + 1).padStart(2, '0')} · ${num(zone.min)}–${num(zone.max)} m`),
            h('h2.zone-block__name', null, zone.name),
            h('div.zone-block__alias', null, zone.alias),
            h('p.zone-block__summary', null, zone.summary),
          ),

          h(
            'div.zone-block__readings',
            null,
            reading('At the top', zone.min + 1, atTop),
            reading('At the base', zone.max - 1, atBottom),
            reading('Mid-zone', mid, readAt(mid)),
            h(
              'div.stat',
              null,
              h('div.stat__value', null, num(fauna.length ? speciesByZone.get(zone.id).length : 0)),
              h('div.stat__label', null, 'Specimens catalogued'),
            ),
          ),

          fauna.length
            ? h(
                'div',
                null,
                h('div.eyebrow', { style: { marginBottom: 'var(--s-4)' } }, 'Characteristic fauna'),
                h('div.zone-block__fauna', null, ...fauna.map((sp) => specimenCard(sp, { compact: true }))),
              )
            : null,

          h(
            'div.row',
            { style: { marginTop: 'var(--s-4)' } },
            h(
              'a.btn.btn--ghost.btn--sm',
              { href: `#/atlas?zone=${zone.id}` },
              `All ${speciesByZone.get(zone.id)?.length ?? 0} species in this zone`,
            ),
            h(
              'button.btn.btn--ghost.btn--sm',
              {
                type: 'button',
                onclick: () => {
                  setDepth(mid, 'console');
                  location.hash = `#/console?depth=${mid}`;
                },
              },
              `Dive to ${num(mid)} m`,
            ),
          ),
        ),
      );
    }

    /* Closing block at the floor. */
    host.append(
      h(
        'section.zone-block',
        { dataset: { depth: '10935' }, style: { '--zone-accent': '#0b2a3d' } },
        h(
          'div.zone-block__head',
          null,
          h('div.zone-block__index', null, 'THE FLOOR · 10,935 m'),
          h('h2.zone-block__name', null, 'Challenger Deep'),
          h('div.zone-block__alias', null, 'The deepest water on Earth'),
          h(
            'p.zone-block__summary',
            null,
            'The pressure here is about 1,128 bar — roughly 1,113 atmospheres, or ' +
              '1,150 kilograms pressing on every square centimetre. Water at this depth is ' +
              '4.6 percent denser than at the surface. It is 2.3 °C, because the weight above ' +
              'compresses and warms it. And there are fish.',
          ),
          h(
            'div.row',
            { style: { marginTop: 'var(--s-5)' } },
            h('a.btn.btn--primary', { href: '#/console?depth=10935' }, 'Run a dive to the floor'),
            h('a.btn', { href: '#/atlas?zone=hadal' }, 'See what lives here'),
          ),
        ),
      ),
    );
  },
};

function reading(label, depth, row) {
  if (!row) {
    return h(
      'div.stat',
      null,
      h('div.stat__value', null, '—'),
      h('div.stat__label', null, label),
    );
  }
  return h(
    'div.stat',
    null,
    h(
      'div.stat__value',
      { style: { fontSize: 'var(--t-2)' } },
      num(row.pressureBar, row.pressureBar < 100 ? 1 : 0),
      h('small', null, 'bar'),
    ),
    h(
      'div.stat__label',
      null,
      `${label} · ${num(depth)} m · ${num(row.temperature, 1)} °C · ${percent(row.lightPercent, 3)} blue light`,
    ),
  );
}
