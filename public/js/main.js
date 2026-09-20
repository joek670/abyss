/**
 * main.js — application entry point.
 *
 * Wires the persistent chrome, the router, and the background field together.
 * Every view module is imported statically: the whole client is well under
 * 200 kB uncompressed and there is no build step to do code splitting with, so
 * a dynamic import would cost a round trip and buy nothing.
 */
import { $ } from './core/dom.js';
import { initTheme } from './core/store.js';
import { route, setNotFound, start } from './core/router.js';
import { initShell, initScrollDepth, initReveal } from './shell.js';
import { initPalette } from './palette.js';
import { createMarineSnow } from './viz/particles.js';

import { homeView } from './views/home.js';
import { descentView } from './views/descent.js';
import { atlasView } from './views/atlas.js';
import { speciesView } from './views/species.js';
import { consoleView } from './views/console.js';
import { logView } from './views/log.js';
import { aboutView } from './views/about.js';
import { postView } from './views/post.js';

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

route('/', homeView);
route('/descent', descentView);
route('/atlas', atlasView);
route('/atlas/:slug', speciesView);
route('/console', consoleView);
route('/log', logView);
route('/about', aboutView);
route('/post', postView);

setNotFound({
  title: () => 'Not found',
  async render(ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'page';
    const box = document.createElement('div');
    box.className = 'empty';
    box.style.minHeight = '50vh';

    const code = document.createElement('p');
    code.className = 'mono dim';
    code.textContent = '404';

    const title = document.createElement('p');
    title.className = 'empty__title';
    title.textContent = 'Nothing at this depth';

    const msg = document.createElement('p');
    msg.className = 'muted';
    msg.textContent = `There is no page at ${ctx.path}.`;

    const back = document.createElement('a');
    back.className = 'btn btn--primary';
    back.href = '#/';
    back.textContent = 'Return to the surface';

    box.append(code, title, msg, back);
    wrap.append(box);
    return wrap;
  },
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function boot() {
  // Marks that scripting is available, which is what enables the reveal
  // animation. Without JS the page renders fully visible.
  document.documentElement.classList.add('js');

  initTheme();
  initShell();
  initPalette();

  /* Background particle field. */
  const canvas = $('#marine-snow');
  let snow = null;
  if (canvas) {
    try {
      snow = createMarineSnow(canvas);
    } catch (err) {
      console.warn('particle field unavailable:', err.message);
    }
  }

  /* Router. */
  start($('#view'), { progress: $('#route-progress') });

  /* Per-view scroll behaviour and reveal animations are re-armed whenever the
   * router swaps a view out. */
  let teardownScroll = null;
  document.addEventListener('abyss:view', (e) => {
    teardownScroll?.();
    const view = $('#view');
    teardownScroll = view.querySelector('[data-depth]') ? initScrollDepth(view) : null;
    initReveal(view);
    window.scrollTo({ top: 0, behavior: 'auto' });
    void e;
  });

  /* Re-check reveals after late-loading content settles. */
  window.addEventListener('load', () => initReveal($('#view')));

  window.addEventListener('beforeunload', () => snow?.destroy());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
