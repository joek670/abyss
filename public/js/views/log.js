/**
 * log.js — the dive log.
 *
 * The only mutable resource in the application, and the only page that writes
 * to the database. Each entry freezes the physics at the moment it was
 * recorded, so the log stays historically accurate even if the ocean model is
 * later revised.
 *
 * Structure follows the view contract: `render()` is pure markup, `mount()`
 * wires behaviour and loads data.
 */
import { h, num, percent, duration, relativeTime } from '../core/dom.js';
import { api } from '../core/api.js';
import { zoneAt, CHALLENGER_DEEP, state } from '../core/store.js';
import { stat } from './parts.js';
import { toast, notifyError } from '../core/toast.js';

const CRAFT = [
  'DSV Limiting Factor',
  'ROV Jason II',
  'ROV Victor 6000',
  'Kaikō ROV',
  'Trieste',
  'unmanned lander',
  'free-diving mammal',
  'other',
];

export const logView = {
  title: () => 'Dive Log',

  async render() {
    const page = h('div.page');

    page.append(
      h(
        'header',
        { style: { marginBottom: 'var(--s-6)' } },
        h('span.eyebrow', null, 'Field record'),
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
          'Dive Log',
        ),
        h(
          'p.lede',
          { style: { marginTop: 'var(--s-3)' } },
          'Record a dive and the server stores the water-column conditions at that depth ' +
            'alongside it. Entries are written to SQLite, so they survive a restart.',
        ),
      ),
    );

    page.append(h('div.logstats', { id: 'log-stats' }, skeletons(5)));

    page.append(
      h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 'var(--s-5)',
            alignItems: 'start',
            marginTop: 'var(--s-6)',
          },
        },

        /* ── Form ─────────────────────────────────────────────────── */
        h(
          'form.panel',
          { id: 'dive-form', novalidate: true },
          h('div.panel__head', null, h('span.panel__title', null, 'Record a dive')),
          h(
            'div.panel__body.stack.stack-4',
            null,
            h(
              'div',
              {
                style: {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                  gap: 'var(--s-4)',
                },
              },
              h(
                'div.field',
                { style: { gridColumn: '1 / -1' } },
                h('label.field__label', { for: 'dive-label' }, 'Label'),
                h('input.input', {
                  id: 'dive-label',
                  name: 'label',
                  type: 'text',
                  placeholder: 'e.g. Mariana Trench transect 01',
                  maxlength: '120',
                  required: true,
                }),
              ),
              h(
                'div.field',
                null,
                h('label.field__label', { for: 'dive-depth' }, 'Target depth (m)'),
                h('input.input', {
                  id: 'dive-depth',
                  name: 'depth',
                  type: 'number',
                  min: '0',
                  max: String(CHALLENGER_DEEP),
                  step: '1',
                  value: '3800',
                }),
              ),
              h(
                'div.field',
                null,
                h('label.field__label', { for: 'dive-craft' }, 'Vehicle'),
                h(
                  'select.select',
                  { id: 'dive-craft', name: 'craft' },
                  ...CRAFT.map((c) => h('option', { value: c }, c)),
                ),
              ),
            ),
            h(
              'div.field',
              null,
              h('label.field__label', { for: 'dive-notes' }, 'Notes'),
              h('textarea.textarea', {
                id: 'dive-notes',
                name: 'notes',
                placeholder: 'What did you see? Anything worth remembering about this depth.',
                maxlength: '2000',
              }),
            ),
            h(
              'div.row.row--between',
              null,
              h('p.field__hint', null, 'The physics for this depth is captured automatically.'),
              h('button.btn.btn--primary', { type: 'submit', id: 'dive-submit' }, 'Record this dive'),
            ),
          ),
        ),

        /* ── List ─────────────────────────────────────────────────── */
        h(
          'section',
          null,
          h(
            'div.section-head',
            null,
            h('div.section-head__text', null, h('span.eyebrow', null, 'Recorded dives')),
            h(
              'button.btn.btn--danger.btn--sm',
              { type: 'button', id: 'clear-dives' },
              'Clear all',
            ),
          ),
          h('div.loglist', { id: 'log-list' }, skeletons(3)),
        ),
      ),
    );

    return page;
  },

  async mount(ctx, node) {
    const statsHost = node.querySelector('#log-stats');
    const listHost = node.querySelector('#log-list');
    const form = node.querySelector('#dive-form');
    const labelInput = node.querySelector('#dive-label');
    const depthInput = node.querySelector('#dive-depth');
    const craftSelect = node.querySelector('#dive-craft');
    const notesInput = node.querySelector('#dive-notes');
    const submitBtn = node.querySelector('#dive-submit');
    const clearBtn = node.querySelector('#clear-dives');

    // Seed the depth field from wherever the reader currently is.
    depthInput.value = String(Math.round(state.depth || 3800));

    async function refresh() {
      const [statsRes, listRes] = await Promise.allSettled([
        api.stats(),
        api.dives({ limit: 100 }),
      ]);
      if (statsRes.status === 'fulfilled') paintStats(statsHost, statsRes.value);
      if (listRes.status === 'fulfilled') paintList(listHost, listRes.value, refresh);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const label = labelInput.value.trim();
      if (!label) {
        labelInput.focus();
        notifyError(new Error('Give the dive a label first.'));
        return;
      }

      const depth = Number(depthInput.value);
      if (!Number.isFinite(depth) || depth < 0 || depth > CHALLENGER_DEEP) {
        notifyError(new Error(`Depth must be between 0 and ${num(CHALLENGER_DEEP)} m.`));
        depthInput.focus();
        return;
      }

      submitBtn.setAttribute('aria-disabled', 'true');
      submitBtn.textContent = 'Recording…';
      try {
        const res = await api.createDive({
          label,
          targetDepth: depth,
          craft: craftSelect.value,
          notes: notesInput.value.trim(),
        });
        toast(
          `“${res.dive.label}” recorded at ${num(res.dive.targetDepth)} m — ` +
            `${num(res.dive.pressureBar, 1)} bar.`,
          { title: 'Dive logged', tone: 'ok' },
        );
        labelInput.value = '';
        notesInput.value = '';
        depthInput.value = String(Math.round(state.depth || 3800));
        await refresh();
      } catch (err) {
        notifyError(err);
      } finally {
        submitBtn.removeAttribute('aria-disabled');
        submitBtn.textContent = 'Record this dive';
      }
    });

    clearBtn.addEventListener('click', async () => {
      if (clearBtn.dataset.confirm !== 'yes') {
        clearBtn.dataset.confirm = 'yes';
        clearBtn.textContent = 'Click again to confirm';
        setTimeout(() => {
          clearBtn.dataset.confirm = '';
          clearBtn.textContent = 'Clear all';
        }, 4000);
        return;
      }
      try {
        const res = await api.clearDives();
        toast(`Removed ${res.removed} dive${res.removed === 1 ? '' : 's'}.`, { tone: 'lure' });
        clearBtn.dataset.confirm = '';
        clearBtn.textContent = 'Clear all';
        await refresh();
      } catch (err) {
        notifyError(err);
      }
    });

    await refresh();
  },
};

/* ------------------------------------------------------------------ *
 * Painting
 * ------------------------------------------------------------------ */

function paintStats(host, data) {
  if (!host) return;
  const d = data.dives;
  host.replaceChildren(
    stat({ value: num(d.dives), label: 'Dives recorded' }),
    stat({
      value: d.deepest ? num(d.deepest) : '—',
      unit: d.deepest ? 'm' : '',
      label: 'Deepest',
      tone: 'accent',
    }),
    stat({
      value: d.meanDepth ? num(d.meanDepth) : '—',
      unit: d.meanDepth ? 'm' : '',
      label: 'Mean depth',
    }),
    stat({
      value: d.maxPressure ? num(d.maxPressure, 1) : '—',
      unit: d.maxPressure ? 'bar' : '',
      label: 'Peak pressure',
      tone: 'lure',
    }),
    stat({
      value: d.totalSeconds ? duration(d.totalSeconds) : '—',
      label: 'Total bottom time',
    }),
  );
}

function paintList(host, res, onChanged) {
  if (!host) return;

  if (!res.items.length) {
    host.replaceChildren(
      h(
        'div.empty',
        { style: { border: '1px dashed var(--line-2)', borderRadius: 'var(--r-4)' } },
        h('p.empty__title', null, 'No dives recorded yet'),
        h('p.muted', null, 'Use the form to log your first descent.'),
      ),
    );
    return;
  }

  host.replaceChildren(
    ...res.items.map((d) => {
      const zone = zoneAt(d.targetDepth);
      return h(
        'article.logentry',
        { style: { '--entry-accent': zone.accent ?? 'var(--accent)' } },
        h('div.logentry__bar'),
        h(
          'div.logentry__main',
          null,
          h('div.logentry__label', null, d.label),
          d.notes ? h('div.logentry__notes', { title: d.notes }, d.notes) : null,
          h(
            'div.logentry__meta',
            null,
            h('span', null, zone.name),
            h('span', null, d.craft),
            h('span', null, `${num(d.pressureBar, 1)} bar`),
            h('span', null, `${num(d.temperature, 2)} °C`),
            h('span', null, `${num(d.soundSpeed, 1)} m/s`),
            h('span', null, `light ${percent(d.lightPercent, 3)}`),
            h('span', null, relativeTime(d.createdAt)),
          ),
        ),
        h(
          'div.stack.stack-2',
          { style: { alignItems: 'flex-end' } },
          h('div.logentry__depth', null, num(d.targetDepth), h('small', null, 'm')),
          h(
            'button.btn.btn--danger.btn--sm',
            {
              type: 'button',
              'aria-label': `Delete dive ${d.label}`,
              onclick: async (e) => {
                const btn = e.currentTarget;
                btn.setAttribute('aria-disabled', 'true');
                try {
                  await api.deleteDive(d.id);
                  toast(`Deleted “${d.label}”.`, { tone: 'lure' });
                  await onChanged();
                } catch (err) {
                  notifyError(err);
                  btn.removeAttribute('aria-disabled');
                }
              },
            },
            'Delete',
          ),
        ),
      );
    }),
  );
}

function skeletons(n) {
  return Array.from({ length: n }, () =>
    h('div.skeleton', {
      style: { height: '70px', borderRadius: 'var(--r-3)', marginBottom: 'var(--s-3)' },
    }),
  );
}
