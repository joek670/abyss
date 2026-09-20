/**
 * dom.js — element construction and formatting.
 *
 * `h()` is a small hyperscript. It exists so that view modules read like the
 * markup they produce, without a build step and without ever touching
 * innerHTML with untrusted data: every string passed as a child becomes a text
 * node, so species names and user-written dive labels cannot inject markup.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Elements that actually render in the SVG namespace. Anything else created
 * with createElementNS(SVG_NS, ...) is an inert node: it occupies the DOM and
 * carries attributes and text, but the renderer gives it no box, so it never
 * appears on screen. That failure is silent and extremely confusing to debug,
 * so `s()` refuses unknown tags rather than producing one.
 */
const SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'title', 'desc', 'metadata', 'style',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask',
  'filter', 'feGaussianBlur', 'feOffset', 'feBlend', 'feColorMatrix',
  'feMerge', 'feMergeNode', 'feFlood', 'feComposite', 'marker',
  'image', 'foreignObject', 'switch', 'view',
]);

/**
 * h('div.card#main', { onclick, style: {...}, dataset: {...} }, ...children)
 *
 * Supported props:
 *   class / className   string or array of strings
 *   style               object of CSS properties (camelCase or kebab)
 *   dataset             object -> data-* attributes
 *   on<event>           event listener
 *   html                raw HTML (only ever used with author-controlled strings)
 *   everything else     set as an attribute; `true` sets "", `false`/null removes
 */
export function h(spec, props, ...children) {
  const { tag, classes, id } = parseSpec(spec);
  const el = document.createElement(tag);

  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');

  if (props && isProps(props)) {
    applyProps(el, props);
  } else if (props !== null && props !== undefined) {
    children.unshift(props);
  }

  append(el, children);
  return el;
}

/** Same as h(), but in the SVG namespace. Rejects non-SVG tags outright. */
export function s(spec, props, ...children) {
  const { tag, classes, id } = parseSpec(spec);
  if (!SVG_TAGS.has(tag)) {
    throw new Error(
      `s(): "${tag}" is not an SVG element. Use h() for HTML — an SVG-namespaced ` +
        `<${tag}> would be inert and never render.`,
    );
  }
  const el = document.createElementNS(SVG_NS, tag);
  if (id) el.setAttribute('id', id);
  if (classes.length) el.setAttribute('class', classes.join(' '));
  if (props && isProps(props)) applyProps(el, props, true);
  else if (props !== null && props !== undefined) children.unshift(props);
  append(el, children, true);
  return el;
}

function parseSpec(spec) {
  const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(spec);
  if (!m) throw new Error(`h(): cannot parse element spec "${spec}"`);
  const tag = m[1] ?? 'div';
  const classes = [];
  let id = '';
  for (const token of (m[2] ?? '').match(/[.#][\w-]+/g) ?? []) {
    if (token[0] === '.') classes.push(token.slice(1));
    else id = token.slice(1);
  }
  return { tag, classes, id };
}

function isProps(v) {
  return typeof v === 'object' && v !== null && !(v instanceof Node) && !Array.isArray(v);
}

function applyProps(el, props, isSvg = false) {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class' || key === 'className') {
      const cls = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
      if (isSvg) el.setAttribute('class', cls);
      else el.className = el.className ? `${el.className} ${cls}` : cls;
    } else if (key === 'style') {
      if (typeof value === 'string') el.setAttribute('style', value);
      else for (const [k, v] of Object.entries(value)) {
        if (v === null || v === undefined) continue;
        if (k.startsWith('--')) el.style.setProperty(k, String(v));
        else el.style.setProperty(k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), String(v));
      }
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(value)) {
        if (v !== null && v !== undefined) el.dataset[k] = String(v);
      }
    } else if (key === 'html') {
      el.innerHTML = String(value);
    } else if (key === 'text') {
      el.textContent = String(value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value' && 'value' in el) {
      el.value = value;
    } else if (key === 'checked' || key === 'selected' || key === 'disabled' || key === 'hidden') {
      if (value) el.setAttribute(key, '');
      if (key in el) el[key] = !!value;
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

function append(el, children, isSvg = false) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (child instanceof Node) el.appendChild(child);
    else if (typeof child === 'object' && typeof child.render === 'function') el.appendChild(child.render());
    else el.appendChild(document.createTextNode(String(child)));
  }
}

/* ------------------------------------------------------------------ *
 * Query helpers
 * ------------------------------------------------------------------ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function mount(parent, ...children) {
  clear(parent);
  append(parent, children);
  return parent;
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

/** Thousands separators, fixed decimals. */
export function num(value, dp = 0) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Compact metres: 10935 -> "10,935 m", 10935 -> "10.9 km" when asked. */
export function metres(value, { km = false } = {}) {
  if (!Number.isFinite(value)) return '—';
  if (km && Math.abs(value) >= 1000) return `${num(value / 1000, 2)} km`;
  return `${num(value, 0)} m`;
}

/** A number plus a unit, in a mono-friendly form. */
export function unit(value, suffix, dp = 0) {
  if (!Number.isFinite(value)) return '—';
  return `${num(value, dp)}${suffix ? ' ' + suffix : ''}`;
}

/**
 * Percentages that stay informative across 13 orders of magnitude: 8.2 %,
 * 0.031 %, and 4.1e-9 % are all shown honestly rather than all rounding to
 * "0 %", which would be a lie about the photic zone.
 */
export function percent(value, dp = 2) {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0 %';
  const abs = Math.abs(value);
  if (abs >= 1) return `${num(value, dp)} %`;
  if (abs >= 0.01) return `${num(value, 3)} %`;
  if (abs >= 1e-6) return `${value.toExponential(1).replace('e-', 'e−')} %`;
  return `${value.toExponential(1).replace('e-', 'e−')} %`;
}

/** Seconds -> "3 h 42 min". */
export function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 s';
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  const hrs = Math.floor(m / 60);
  if (hrs < 24) return `${hrs} h ${String(m % 60).padStart(2, '0')} min`;
  return `${Math.floor(hrs / 24)} d ${hrs % 24} h`;
}

/** Relative time for log entries. */
export function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = (Date.now() - then) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 604800) return `${Math.round(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Clamp. */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Linear interpolation. */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Debounce, for search-as-you-type. */
export function debounce(fn, ms = 180) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** requestAnimationFrame-throttled callback. */
export function rafThrottle(fn) {
  let queued = false;
  let lastArgs;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...lastArgs);
    });
  };
}

/** Escape for the rare case where a string must go through innerHTML. */
export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** Hex -> rgba() string, for per-species accent tinting. */
export function tint(hex, alpha) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex).trim());
  if (!m) return `rgba(79, 227, 208, ${alpha})`;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
