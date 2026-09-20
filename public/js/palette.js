/**
 * palette.js — the Ctrl-K command palette.
 *
 * One input, three result classes: species (from the server's search endpoint,
 * so ranking lives in one place), zones, and commands. Keyboard-first: the
 * arrow keys and Enter never leave the input, and the active option is
 * announced through aria-activedescendant rather than by moving focus.
 */
import { $, h, s, num, debounce, clamp } from './core/dom.js';
import { api } from './core/api.js';
import { state, bootstrap, setDepth, toggleTheme } from './core/store.js';
import { navigate } from './core/router.js';
import { sprite } from './viz/sprites.js';

const ICONS = {
  species: 'M3 12c3-5 8-7 13-6 3 .6 5 2 6 3-1 1-3 2.4-6 3-5 1-10-1-13-6Z',
  zone: 'M2 6h20M2 12h20M2 18h20',
  command: 'M4 7h16M4 12h10M4 17h7',
  depth: 'M12 3v18M7 8l5-5 5 5',
};

const COMMANDS = [
  {
    id: 'cmd:surface',
    name: 'Go to the surface',
    meta: 'Navigation',
    run: () => navigate('/'),
  },
  {
    id: 'cmd:descent',
    name: 'Begin the descent',
    meta: 'Navigation · scroll through all five zones',
    run: () => navigate('/descent'),
  },
  {
    id: 'cmd:atlas',
    name: 'Open the atlas',
    meta: 'Navigation · 36 specimens',
    run: () => navigate('/atlas'),
  },
  {
    id: 'cmd:console',
    name: 'Open the dive console',
    meta: 'Navigation · live water-column telemetry',
    run: () => navigate('/console'),
  },
  {
    id: 'cmd:log',
    name: 'Open the dive log',
    meta: 'Navigation · recorded dives',
    run: () => navigate('/log'),
  },
  {
    id: 'cmd:method',
    name: 'How the physics works',
    meta: 'Navigation · equations and sources',
    run: () => navigate('/about'),
  },
  {
    id: 'cmd:theme',
    name: 'Switch theme',
    meta: 'Toggle between abyss and daylight',
    run: () => toggleTheme(),
  },
  {
    id: 'cmd:glow',
    name: 'Show only bioluminescent species',
    meta: 'Atlas filter',
    run: () => navigate('/atlas?glow=true'),
  },
  {
    id: 'cmd:deepest',
    name: 'Jump to Challenger Deep',
    meta: '10,935 m · the floor of the Mariana Trench',
    run: () => {
      setDepth(10935, 'console');
      navigate('/console?depth=10935');
    },
  },
  {
    id: 'cmd:fish',
    name: 'Deepest fish ever filmed',
    meta: '8,336 m · Izu-Ogasawara Trench, 2022',
    run: () => navigate('/console?depth=8336'),
  },
  {
    id: 'cmd:titanic',
    name: 'Visit the Titanic',
    meta: '3,800 m · North Atlantic',
    run: () => navigate('/console?depth=3800'),
  },
];

const PRESET_DEPTHS = [200, 1000, 3800, 6000, 8336, 10935];

export function initPalette() {
  const root = $('#palette');
  const input = $('#palette-input');
  const list = $('#palette-results');
  if (!root || !input || !list) return { open() {}, close() {} };

  let items = [];
  let active = 0;
  let lastFocus = null;

  /* ── Open / close ─────────────────────────────────────────────────── */

  function open(seed = '') {
    lastFocus = document.activeElement;
    root.hidden = false;
    input.value = seed;
    document.body.style.overflow = 'hidden';
    search(seed);
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function close() {
    root.hidden = true;
    document.body.style.overflow = '';
    items = [];
    list.replaceChildren();
    if (lastFocus instanceof HTMLElement) lastFocus.focus();
  }

  const isOpen = () => !root.hidden;

  /* ── Search ───────────────────────────────────────────────────────── */

  const search = debounce(runSearch, 130);

  async function runSearch(term) {
    const q = term.trim();
    const groups = [];

    /* Commands first when the query matches them. */
    const matchedCommands = q
      ? COMMANDS.filter((c) => (c.name + ' ' + c.meta).toLowerCase().includes(q.toLowerCase()))
      : COMMANDS.slice(0, 4);
    if (matchedCommands.length) {
      groups.push({ label: 'Commands', items: matchedCommands.map(toCommandItem) });
    }

    /* Depth jumps for numeric queries. */
    const numeric = Number(q);
    if (Number.isFinite(numeric) && q !== '' && numeric >= 0 && numeric <= 10935) {
      groups.push({
        label: 'Depth',
        items: [
          {
            id: `depth:${numeric}`,
            name: `Descend to ${num(Math.round(numeric))} m`,
            meta: 'Open the console at this depth',
            icon: 'depth',
            run: () => {
              setDepth(numeric, 'console');
              navigate(`/console?depth=${Math.round(numeric)}`);
            },
          },
        ],
      });
    }

    /* Zones. */
    if (state.zones.length) {
      const zones = state.zones.filter(
        (z) => !q || (z.name + ' ' + z.alias).toLowerCase().includes(q.toLowerCase()),
      );
      if (zones.length) {
        groups.push({
          label: 'Zones',
          items: zones.map((z) => ({
            id: `zone:${z.id}`,
            name: `${z.name} — ${z.alias}`,
            meta: `${num(z.min)}–${num(z.max)} m · ${z.speciesCount} species`,
            icon: 'zone',
            accent: z.accent,
            run: () => navigate(`/atlas?zone=${z.id}`),
          })),
        });
      }
    }

    /* Species, ranked by the server. */
    if (q.length >= 2) {
      try {
        const res = await api.species({ q, limit: 8 });
        if (res.items?.length) {
          groups.push({
            label: 'Specimens',
            items: res.items.map((sp) => ({
              id: `species:${sp.slug}`,
              name: sp.common,
              meta: `${sp.scientific} · ${num(sp.depthMin)}–${num(sp.depthMax)} m`,
              icon: 'species',
              accent: sp.accent,
              spriteName: sp.sprite,
              run: () => navigate(`/atlas/${sp.slug}`),
            })),
          });
        }
      } catch {
        /* A failed search should never block the palette. */
      }
    }

    if (!isOpen()) return;
    items = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));
    active = 0;
    render(groups);
  }

  function toCommandItem(c) {
    return { ...c, icon: c.icon ?? 'command' };
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  function render(groups) {
    list.replaceChildren();

    if (!groups.length) {
      list.appendChild(
        h('li.palette__group', null, 'No matches'),
        h(
          'li',
          { style: { padding: 'var(--s-4)', color: 'var(--text-3)', fontSize: 'var(--t--1)' } },
          'Try a species name, a zone, a depth in metres, or a command.',
        ),
      );
      input.removeAttribute('aria-activedescendant');
      return;
    }

    let index = 0;
    for (const group of groups) {
      list.appendChild(h('li.palette__group', { role: 'presentation' }, group.label));
      for (const item of group.items) {
        const i = index++;
        const li = h(
          'li.palette__item',
          {
            id: `palette-opt-${i}`,
            role: 'option',
            'aria-selected': i === active ? 'true' : 'false',
            dataset: { index: i },
            style: item.accent ? { '--item-accent': item.accent } : null,
            onclick: () => choose(i),
            onpointerenter: () => setActive(i),
          },
          h('span.palette__icon', null, iconFor(item)),
          h(
            'span.palette__text',
            null,
            h('span.palette__name', null, item.name),
            item.meta ? h('span.palette__meta', null, item.meta) : null,
          ),
        );
        list.appendChild(li);
      }
    }
    syncActive();
  }

  function iconFor(item) {
    if (item.spriteName) {
      const svg = sprite(item.spriteName, { size: 17 });
      svg.setAttribute('class', '');
      return svg;
    }
    return s(
      'svg',
      { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 },
      s('path', { d: ICONS[item.icon] ?? ICONS.command }),
    );
  }

  function setActive(i) {
    active = clamp(i, 0, items.length - 1);
    syncActive();
  }

  function syncActive() {
    const opts = list.querySelectorAll('.palette__item');
    opts.forEach((el, i) => {
      const on = i === active;
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) {
        input.setAttribute('aria-activedescendant', el.id);
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function choose(i) {
    const item = items[i];
    if (!item) return;
    close();
    // Defer so the palette's teardown finishes before navigation.
    setTimeout(() => item.run(), 0);
  }

  /* ── Events ───────────────────────────────────────────────────────── */

  input.addEventListener('input', () => search(input.value));

  input.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive(active + 1 >= items.length ? 0 : active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive(active - 1 < 0 ? items.length - 1 : active - 1);
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(items.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        choose(active);
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'Tab':
        // Depth presets via Tab is a nice accelerator for keyboard users.
        e.preventDefault();
        cyclePreset(e.shiftKey ? -1 : 1);
        break;
      default:
        break;
    }
  });

  function cyclePreset(dir) {
    const current = Number(input.value);
    const idx = PRESET_DEPTHS.findIndex((d) => d >= current);
    const next = clamp((idx === -1 ? PRESET_DEPTHS.length : idx) + dir, 0, PRESET_DEPTHS.length - 1);
    input.value = String(PRESET_DEPTHS[next]);
    search(input.value);
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });

  $('#search-open')?.addEventListener('click', () => open());

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      isOpen() ? close() : open();
      return;
    }
    if (e.key === '/' && !isOpen() && !isTyping(e.target)) {
      e.preventDefault();
      open();
      return;
    }
    if (e.key === 'Escape' && isOpen()) close();
  });

  // Warm the zone list so the palette has something to show immediately.
  bootstrap().catch(() => {});

  return { open, close, isOpen };
}

function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
