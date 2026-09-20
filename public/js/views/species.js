/**
 * species.js — a single specimen, as a full page.
 *
 * The drawer shows the same component in compact mode; this route is the
 * linkable version, so a specimen can be sent to someone else.
 */
import { h } from '../core/dom.js';
import { api } from '../core/api.js';
import { taxonDetail } from './parts.js';
import { setDepth } from '../core/store.js';

export const speciesView = {
  title: (ctx) => {
    // The slug is lowercase and hyphenated; render it as a readable name.
    const words = String(ctx.params.slug ?? 'Specimen').split('-');
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  },

  async render(ctx) {
    const page = h('div.page');
    page.append(
      h(
        'div',
        { id: 'specimen-host' },
        h('div.stack.stack-4', null, h('div.skeleton', { style: { height: '240px' } }), h('div.skeleton', { style: { height: '40px', width: '55%' } })),
      ),
    );
    return page;
  },

  async mount(ctx, node) {
    const host = node.querySelector('#specimen-host');
    const slug = ctx.params.slug;

    /* Breadcrumb back to the atlas. */
    const crumb = h(
      'nav.row',
      { style: { marginBottom: 'var(--s-5)' }, 'aria-label': 'Breadcrumb' },
      h('a.btn.btn--ghost.btn--sm', { href: '#/atlas' }, '← Atlas'),
    );

    try {
      const sp = await api.speciesOne(slug);
      host.replaceChildren(crumb, taxonDetail(sp));

      /* Point the instrument strip at this animal's mid-range depth. */
      setDepth(Math.round((sp.depthMin + sp.depthMax) / 2), 'scroll');
    } catch (err) {
      host.replaceChildren(
        crumb,
        h(
          'div.empty',
          { style: { minHeight: '40vh' } },
          h('p.empty__title', null, err.status === 404 ? 'No such specimen' : 'Could not load this specimen'),
          h('p.muted', null, err.message),
          h('a.btn.btn--primary', { href: '#/atlas', style: { marginTop: 'var(--s-4)' } }, 'Back to the atlas'),
        ),
      );
    }
  },
};
