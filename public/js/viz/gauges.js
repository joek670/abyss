/**
 * gauges.js — the console's analogue readouts.
 *
 * Each gauge is a 270-degree arc built from a stroked circle rather than a
 * hand-computed arc path: a circle's dash array gives an exact, cheaply
 * animatable arc, and `stroke-dashoffset` transitions smoothly in every
 * browser. The needle is a separate rotated line so the two can move at
 * different rates — the arc eases, the needle is nearly immediate, which is
 * what makes it read as an instrument rather than a progress bar.
 */
import { s } from '../core/dom.js';
import { clamp } from '../core/dom.js';

const R = 42;
const CX = 50;
const CY = 50;
const SWEEP_DEG = 270;
const START_DEG = 135; // measured clockwise from the positive x-axis
const CIRC = 2 * Math.PI * R;
const ARC = CIRC * (SWEEP_DEG / 360);

export function createGauge({
  label = '',
  unit = '',
  min = 0,
  max = 1,
  colour = 'var(--accent)',
  format = (v) => String(Math.round(v)),
  ticks = 5,
  log = false,
} = {}) {
  const track = s('circle', {
    cx: CX,
    cy: CY,
    r: R,
    class: 'gauge__track',
    'stroke-width': 7,
    'stroke-dasharray': `${ARC} ${CIRC}`,
    transform: `rotate(${START_DEG} 50 50)`,
  });

  const arc = s('circle', {
    cx: CX,
    cy: CY,
    r: R,
    class: 'gauge__arc',
    'stroke-width': 7,
    'stroke-dasharray': `${ARC} ${CIRC}`,
    'stroke-dashoffset': ARC,
    transform: `rotate(${START_DEG} 50 50)`,
    style: { '--gauge-color': colour },
  });

  /* Tick marks around the dial. */
  const tickGroup = s('g');
  for (let i = 0; i <= ticks; i++) {
    const deg = START_DEG + (SWEEP_DEG * i) / ticks;
    const rad = (deg * Math.PI) / 180;
    const inner = R - 11;
    const outer = R - 7;
    tickGroup.appendChild(
      s('line', {
        x1: CX + Math.cos(rad) * inner,
        y1: CY + Math.sin(rad) * inner,
        x2: CX + Math.cos(rad) * outer,
        y2: CY + Math.sin(rad) * outer,
        stroke: 'currentColor',
        'stroke-width': 1,
        opacity: 0.28,
      }),
    );
  }

  const needle = s('line', {
    x1: CX,
    y1: CY,
    x2: CX,
    y2: CY - R + 13,
    class: 'gauge__needle',
  });

  const readout = document.createElement('div');
  readout.className = 'gauge__readout';
  readout.textContent = '—';

  const unitEl = document.createElement('div');
  unitEl.className = 'gauge__unit';
  unitEl.textContent = unit || '\u00a0';

  const svg = s(
    'svg',
    { viewBox: '0 0 100 100', role: 'img', 'aria-label': label },
    s('title', null, label),
    tickGroup,
    track,
    arc,
    needle,
    s('circle', { cx: CX, cy: CY, r: 3.2, class: 'gauge__hub' }),
  );

  // The gauge is an SVG dial plus HTML readouts. The readouts MUST be created
  // as HTML: `s()` builds elements in the SVG namespace, and an SVG-namespaced
  // <div> has no rendering box, so its text lands in the DOM but is never
  // painted.
  const wrap = document.createElement('div');
  wrap.className = 'gauge';
  wrap.append(svg, readout, unitEl);

  let value = min;

  function norm(v) {
    if (log) {
      const lo = Math.log10(Math.max(min, 1e-12));
      const hi = Math.log10(Math.max(max, 1e-11));
      const t = (Math.log10(Math.max(v, 1e-12)) - lo) / (hi - lo || 1);
      return clamp(t, 0, 1);
    }
    return clamp((v - min) / (max - min || 1), 0, 1);
  }

  return {
    el: wrap,
    set(next) {
      value = Number.isFinite(next) ? next : min;
      const t = norm(value);
      arc.setAttribute('stroke-dashoffset', String(ARC * (1 - t)));
      const deg = START_DEG + SWEEP_DEG * t;
      needle.setAttribute('transform', `rotate(${deg} 50 50)`);
      readout.textContent = format(value);
      wrap.style.setProperty('--gauge-color', colour);
    },
    setColour(c) {
      arc.style.setProperty('--gauge-color', c);
      wrap.style.setProperty('--gauge-color', c);
    },
    get value() {
      return value;
    },
    destroy() {
      wrap.remove();
    },
  };
}

/**
 * A compact linear meter, used where a full dial would be too much furniture.
 */
export function createMeter({ label = '', unit = '', min = 0, max = 1, colour = 'var(--accent)', format } = {}) {
  const valueEl = document.createElement('span');
  valueEl.className = 'meter__value';

  const fill = document.createElement('div');
  fill.className = 'meter__fill';
  fill.style.setProperty('--meter-color', colour);

  const track = document.createElement('div');
  track.className = 'meter__track';
  track.append(fill);

  const head = document.createElement('div');
  head.className = 'meter__head';
  const nameEl = document.createElement('span');
  nameEl.className = 'meter__name';
  nameEl.textContent = label;
  head.append(nameEl, valueEl);

  const wrap = document.createElement('div');
  wrap.className = 'meter';
  wrap.append(head, track);

  const fmt = format ?? ((v) => `${Math.round(v)}${unit ? ' ' + unit : ''}`);

  return {
    el: wrap,
    set(v) {
      const t = clamp((v - min) / (max - min || 1), 0, 1);
      fill.style.width = `${(t * 100).toFixed(2)}%`;
      valueEl.textContent = Number.isFinite(v) ? fmt(v) : '—';
    },
  };
}
