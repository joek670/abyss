/**
 * router.js — a hash router with view lifecycle management.
 *
 * Hash routing is used rather than the History API because the application is
 * served as static files with no server-side route table beyond the SPA
 * fallback; a hash change can never produce a 404 from a hard refresh, and it
 * works when the page is opened straight off the filesystem.
 *
 * Each view is an object: { render(ctx) -> Node, mount?(), unmount?() }. The
 * router guarantees `unmount` runs before the next view mounts, which is what
 * lets the console tear down its EventSource and the descent tear down its
 * scroll observer.
 */

const routes = [];
let current = null; // { view, ctx, node, cleanup }
let notFound = null;
let pending = false;

export function route(pattern, view) {
  routes.push({ pattern, matcher: compile(pattern), view });
}

export function setNotFound(view) {
  notFound = view;
}

function compile(pattern) {
  const names = [];
  const rx = pattern
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      if (seg.startsWith(':')) {
        names.push(seg.slice(1));
        return '([^/]+)';
      }
      if (seg.startsWith('*')) {
        names.push(seg.slice(1) || 'rest');
        return '(.*)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { rx: new RegExp(`^/${rx}/?$`), names };
}

/** Parse `#/atlas/squid?q=x` into { path, params, query }. */
export function parseHash(hash = location.hash) {
  let raw = hash.replace(/^#/, '');
  if (!raw) raw = '/';
  const qIndex = raw.indexOf('?');
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const query = new URLSearchParams(qIndex === -1 ? '' : raw.slice(qIndex + 1));
  return { path: path.startsWith('/') ? path : '/' + path, query };
}

function resolve(path) {
  for (const r of routes) {
    const m = r.matcher.rx.exec(path);
    if (m) {
      const params = {};
      r.matcher.names.forEach((name, i) => {
        params[name] = safeDecode(m[i + 1]);
      });
      return { view: r.view, params };
    }
  }
  return notFound ? { view: notFound, params: {} } : null;
}

function safeDecode(v) {
  try {
    return decodeURIComponent(v ?? '');
  } catch {
    return v ?? '';
  }
}

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

export function navigate(to, { replace = false } = {}) {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (location.hash === target) {
    handle();
    return;
  }
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
  if (replace) handle();
}

export function back() {
  history.back();
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

let container = null;
let progressEl = null;
let dispatching = false;

export function start(el, { progress } = {}) {
  container = el;
  progressEl = progress ?? null;

  window.addEventListener('hashchange', handle);
  if (!location.hash) history.replaceState(null, '', '#/');
  handle();

  // Intercept in-page anchors so that clicking a link to the current route
  // still scrolls to top rather than doing nothing.
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#/"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (a.target === '_blank') return;
    e.preventDefault();
    navigate(a.getAttribute('href').slice(1));
    window.scrollTo({ top: 0, behavior: 'auto' });
  });
}

async function handle() {
  if (dispatching) {
    // A hashchange arrived while a view was still rendering. Remember it and
    // re-run once the current render settles, so navigation is never dropped.
    pending = true;
    return;
  }
  dispatching = true;
  try {
    const { path, query } = parseHash();
    const match = resolve(path);

    if (!match) {
      container.replaceChildren(errorView(`No route for ${path}`));
      return;
    }

    // Tear the previous view down before anything else touches the DOM.
    if (current) {
      try {
        current.view.unmount?.(current.ctx);
      } catch (err) {
        console.error('unmount failed', err);
      }
      try {
        // A view may return a teardown function from mount(); it runs here,
        // which is how the console closes its EventSource and the chart
        // releases its ResizeObserver.
        current.cleanup?.();
      } catch (err) {
        console.error('view cleanup failed', err);
      }
      current = null;
    }

    const ctx = { path, params: match.params, query, navigate };
    setProgress(true);

    let node;
    try {
      node = await match.view.render(ctx);
    } catch (err) {
      console.error('view render failed', err);
      node = errorView(err?.message ?? 'Something went wrong rendering this page', err);
    }

    if (!(node instanceof Node)) {
      node = errorView('View returned no content');
    }

    container.replaceChildren(node);
    document.title = `${match.view.title?.(ctx) ?? 'ABYSS'} · ABYSS`;

    let cleanup = null;
    try {
      // AWAITED. Views populate their DOM asynchronously — the descent page
      // only appends its zone blocks after fetching species and the profile —
      // so firing `abyss:view` before mount settles meant the scroll observer
      // ran against an empty container, found no [data-depth] markers, and
      // silently never installed itself.
      cleanup = await match.view.mount?.(ctx, node);
    } catch (err) {
      console.error('mount failed', err);
    }

    current = {
      view: match.view,
      ctx,
      node,
      cleanup: typeof cleanup === 'function' ? cleanup : null,
    };
    syncNav(path);
    document.dispatchEvent(new CustomEvent('abyss:view', { detail: { path, ctx } }));
  } finally {
    dispatching = false;
    setProgress(false);
    if (pending) {
      pending = false;
      handle();
    }
  }
}

function setProgress(active) {
  if (!progressEl) return;
  progressEl.classList.toggle('is-active', active);
  progressEl.style.width = active ? '72%' : '100%';
  if (!active) {
    setTimeout(() => {
      progressEl.style.width = '0';
    }, 260);
  }
}

function syncNav(path) {
  let active = null;
  for (const a of document.querySelectorAll('#nav a[data-route]')) {
    const routePath = a.dataset.route;
    const isActive = routePath === '/' ? path === '/' : path.startsWith(routePath);
    if (isActive) {
      a.setAttribute('aria-current', 'page');
      active = a;
    } else {
      a.removeAttribute('aria-current');
    }
  }
  // On a phone the nav is a horizontal scroller that cannot show every link.
  // Without this the current page's own link is the one left half-cut at the
  // edge — the page you are on is the one you cannot read.
  if (active) scrollNavIntoView(active);
}

function scrollNavIntoView(link) {
  const nav = link.parentElement;
  if (!nav || nav.scrollWidth <= nav.clientWidth) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  try {
    // 'center' rather than 'nearest': nearest parks the link against the
    // faded trailing edge, which is where it is hardest to read.
    link.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  } catch {
    nav.scrollLeft = link.offsetLeft - nav.clientWidth / 2 + link.offsetWidth / 2;
  }
}

/* ------------------------------------------------------------------ *
 * Error view
 * ------------------------------------------------------------------ */

function errorView(message, err) {
  const wrap = document.createElement('div');
  wrap.className = 'page';
  const box = document.createElement('div');
  box.className = 'empty';
  box.style.minHeight = '50vh';

  const title = document.createElement('p');
  title.className = 'empty__title';
  title.textContent = 'This page could not be rendered';

  const msg = document.createElement('p');
  msg.className = 'muted';
  msg.textContent = message;

  const back = document.createElement('a');
  back.className = 'btn btn--primary';
  back.href = '#/';
  back.textContent = 'Return to the surface';

  box.append(title, msg, back);
  if (err?.stack) {
    const pre = document.createElement('pre');
    pre.className = 'equation';
    pre.style.maxWidth = '100%';
    pre.textContent = String(err.stack).split('\n').slice(0, 6).join('\n');
    box.append(pre);
  }
  wrap.append(box);
  return wrap;
}

export function currentRoute() {
  return current?.ctx ?? null;
}
