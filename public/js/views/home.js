/**
 * home.js — the surface.
 *
 * The hero establishes the premise, then immediately proves it with real
 * numbers: the light-extinction panel is fetched from /api/ocean/at, so the
 * first thing a visitor reads is computed by the same engine the rest of the
 * application uses.
 */
import { h, num, percent } from '../core/dom.js';
import { api } from '../core/api.js';
import { state, bootstrap, setDepth } from '../core/store.js';
import { specimenCard, stat } from './parts.js';
import { sprite } from '../viz/sprites.js';
import { navigate } from '../core/router.js';

export const homeView = {
  title: () => 'Deep-Sea Exploration Atlas',

  async render() {
    const page = h('div.page.page--wide');
    const hero = h('section.hero');

    /* ── Copy ───────────────────────────────────────────────────────── */

    hero.append(
      h('div', null, h('span.eyebrow', null, 'An instrument for the water column')),
      h(
        'h1.hero__title',
        null,
        'The ocean is ',
        h('em', null, 'eleven kilometres'),
        ' deep. We have mapped a fraction of it.',
      ),
      h(
        'p.hero__lede',
        null,
        'ABYSS is a working atlas of the deep sea. Every pressure, temperature, ' +
          'sound speed and light level on this site is computed live from published ' +
          'oceanographic equations — UNESCO EOS-80 for density, Mackenzie (1981) for ' +
          'sound, Beer–Lambert for light — not read from a table.',
      ),
      h(
        'div.hero__actions',
        null,
        h(
          'button.btn.btn--primary.btn--lg',
          { type: 'button', onclick: () => navigate('/descent') },
          'Begin the descent',
          iconArrow(),
        ),
        h(
          'button.btn.btn--lg',
          { type: 'button', onclick: () => navigate('/console') },
          'Open the dive console',
        ),
      ),
      h(
        'div.hero__cue',
        null,
        h('span.hero__cue-bar'),
        'Scroll to descend',
      ),
    );

    /* ── Headline numbers (filled after fetch) ──────────────────────── */

    const facts = h('div.hero__facts');
    hero.append(facts);

    page.append(hero);

    /* ── Light extinction + featured fauna ──────────────────────────── */

    const below = h('section', { style: { marginTop: 'var(--s-9)' } });
    below.append(
      h(
        'div.section-head',
        null,
        h(
          'div.section-head__text',
          null,
          h('span.eyebrow', null, 'What happens on the way down'),
          h(
            'h2',
            { style: { fontFamily: 'var(--font-display)', fontSize: 'var(--t-3)', fontWeight: '400', marginTop: 'var(--s-2)' } },
            'Colour dies before the light does',
          ),
          h(
            'p.lede',
            { style: { marginTop: 'var(--s-3)' } },
            'Seawater absorbs long wavelengths first. Red is gone within about 13 metres, ' +
              'green by 66, and blue — the last colour left — does not fall to one percent ' +
              'until 184 metres. Below that, every photon you see was made by something alive.',
          ),
        ),
      ),
    );

    const grid = h('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))',
        gap: 'var(--s-5)',
        alignItems: 'start',
      },
    });

    const bandsPanel = h(
      'div.panel',
      null,
      h('div.panel__head', null, h('span.panel__title', null, 'Spectral extinction'), h('span.badge', { id: 'bands-depth' }, 'at 0 m')),
      h('div.panel__body', null, h('div.bands', { id: 'bands' }, skeletonRows(5))),
    );

    const faunaPanel = h(
      'div.panel',
      null,
      h(
        'div.panel__head',
        null,
        h('span.panel__title', null, 'Shallowest specimens'),
        h('a.btn.btn--ghost.btn--sm', { href: '#/atlas' }, 'Full atlas'),
      ),
      h('div.panel__body', null, h('div', { id: 'featured' }, skeletonRows(3))),
    );

    grid.append(bandsPanel, faunaPanel);
    below.append(grid);
    page.append(below);

    return page;
  },

  async mount(ctx, node) {
    // The rail and strip should read as "at the surface" while on this page.
    setDepth(0, 'scroll');

    const [catalogue, ocean, species] = await Promise.allSettled([
      bootstrap(),
      api.oceanAt(0),
      api.species({ sort: 'shallowest', limit: 6 }),
    ]);

    /* Headline numbers. */
    const facts = node.querySelector('.hero__facts');
    if (facts) {
      const cat = catalogue.status === 'fulfilled' ? catalogue.value : null;
      const o = ocean.status === 'fulfilled' ? ocean.value : null;
      facts.replaceChildren(
        stat({ value: cat ? num(cat.stats.species) : '36', label: 'Specimens catalogued' }),
        stat({
          // Absolute, not gauge: at the surface the sea contributes nothing, so
          // the honest reading is the weight of the atmosphere above it.
          value: o ? num(o.pressureAbsoluteAtm ?? 1, 0) : '1',
          unit: 'atm',
          label: 'Pressure at the surface',
        }),
        stat({ value: '10,935', unit: 'm', label: 'To the Challenger Deep', tone: 'accent' }),
        stat({
          value: cat ? num(cat.stats.bioluminescent) : '11',
          label: 'Species that make their own light',
          tone: 'lure',
        }),
      );
    }

    /* Light bands. */
    const bandsHost = node.querySelector('#bands');
    if (bandsHost && ocean.status === 'fulfilled') {
      const bands = ocean.value.light.bands;
      bandsHost.replaceChildren(
        ...bands.map((b) =>
          h(
            'div.band',
            { style: { '--band-color': b.hex } },
            h('span.band__name', null, `${b.label} ${b.nm}nm`),
            h('div.band__track', null, h('div.band__fill', { style: { transform: `scaleX(${b.transmission})` } })),
            h('span.band__pct', null, percent(b.percent, 2)),
          ),
        ),
      );
      const label = node.querySelector('#bands-depth');
      if (label) {
        label.textContent = `1 % of blue gone by ${num(bands.find((b) => b.key === 'blue').extinct1pct, 0)} m`;
      }
    }

    /* Featured specimens. */
    const featured = node.querySelector('#featured');
    if (featured && species.status === 'fulfilled') {
      featured.replaceChildren(
        h(
          'div',
          { style: { display: 'grid', gap: 'var(--s-4)' } },
          ...species.value.items.slice(0, 3).map((sp) =>
            h(
              'a',
              {
                href: `#/atlas/${sp.slug}`,
                class: 'row',
                style: {
                  gap: 'var(--s-4)',
                  padding: 'var(--s-3)',
                  borderRadius: 'var(--r-3)',
                  border: '1px solid var(--line-1)',
                  background: 'var(--surface-1)',
                  flexWrap: 'nowrap',
                  alignItems: 'center',
                },
              },
              h(
                'span',
                {
                  style: {
                    flex: 'none',
                    width: '46px',
                    height: '46px',
                    display: 'grid',
                    placeItems: 'center',
                    color: sp.accent,
                  },
                },
                specimenGlyph(sp.sprite),
              ),
              h(
                'span.grow',
                null,
                h('span', { style: { display: 'block', fontWeight: '600' } }, sp.common),
                h('span.tiny.dim', { style: { display: 'block', fontStyle: 'italic' } }, sp.scientific),
              ),
              h('span.tiny.mono.dim', null, `${num(sp.depthMin)}–${num(sp.depthMax)} m`),
            ),
          ),
        ),
      );
    }
  },
};

/* ── Small helpers ───────────────────────────────────────────────────── */

function skeletonRows(n) {
  return Array.from({ length: n }, () => h('div.skeleton', { style: { height: '26px' } }));
}

function iconArrow() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M12 5v14M6 13l6 6 6-6');
  svg.append(p);
  return svg;
}

function specimenGlyph(name) {
  return sprite(name, { size: 40 });
}
