/**
 * charts.js — canvas profile plots.
 *
 * The chart plots depth on the Y axis (0 at the top, as the ocean is always
 * drawn) and several physical properties on X. Because temperature, sound
 * speed and density occupy wildly different numeric ranges, each series is
 * normalised to its own span and the legend prints the real endpoints — the
 * standard convention for a water-column profile plot, and the only way to
 * show all three curves on one axis without lying about their magnitudes.
 *
 * Redrawn on: data change, resize, theme change, and depth change. A
 * ResizeObserver drives the first; the rest arrive as store events.
 */
import { on } from '../core/store.js';
import { clamp } from '../core/dom.js';

const SERIES = [
  { key: 'temperature', label: 'Temperature', unit: '°C', colour: '#ff8f6b', width: 2.2 },
  { key: 'soundSpeed', label: 'Sound speed', unit: 'm/s', colour: '#4fe3d0', width: 2.2 },
  { key: 'density', label: 'Density', unit: 'kg/m³', colour: '#8fa8ff', width: 1.8, dash: [5, 4] },
];

export function createProfileChart(canvas, { rows = [], maxDepth = 10935 } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { setData() {}, setDepth() {}, destroy() {} };

  let data = rows;
  let depth = 0;
  let hoverDepth = null;
  let raf = 0;
  let bounds = { w: 0, h: 0 };

  const PAD = { l: 52, r: 18, t: 26, b: 26 };

  /* ── Sizing ───────────────────────────────────────────────────────── */

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 260;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bounds = { w, h };
    schedule();
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }

  /* ── Scales ───────────────────────────────────────────────────────── */

  function ranges() {
    const out = {};
    for (const s of SERIES) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const r of data) {
        const v = r[s.key];
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!Number.isFinite(lo)) {
        lo = 0;
        hi = 1;
      }
      if (hi - lo < 1e-6) hi = lo + 1;
      out[s.key] = { lo, hi };
    }
    return out;
  }

  /* ── Draw ─────────────────────────────────────────────────────────── */

  function draw() {
    const { w, h } = bounds;
    if (!w || !h || !data.length) return;

    const style = getComputedStyle(document.documentElement);
    const text2 = style.getPropertyValue('--text-2').trim() || '#6f8b9d';
    const text3 = style.getPropertyValue('--text-3').trim() || '#4a6273';
    const line1 = style.getPropertyValue('--line-1').trim() || 'rgba(140,200,230,.13)';
    const accent = style.getPropertyValue('--accent').trim() || '#4fe3d0';
    const surface = style.getPropertyValue('--surface-solid').trim() || '#061622';

    const plotW = w - PAD.l - PAD.r;
    const plotH = h - PAD.t - PAD.b;
    const maxD = maxDepth;

    const x = (t) => PAD.l + clamp(t, 0, 1) * plotW;
    const y = (d) => PAD.t + clamp(d / maxD, 0, 1) * plotH;

    ctx.clearRect(0, 0, w, h);

    /* Depth gridlines every 2000 m, plus the seafloor. */
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let d = 0; d <= maxD; d += 2000) {
      const yy = Math.round(y(d)) + 0.5;
      ctx.strokeStyle = line1;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.l, yy);
      ctx.lineTo(w - PAD.r, yy);
      ctx.stroke();
      ctx.fillStyle = text3;
      ctx.fillText(d === 0 ? '0 m' : `${(d / 1000).toFixed(0)} km`, PAD.l - 8, yy);
    }

    const rng = ranges();

    /* Curves. */
    for (const s of SERIES) {
      const { lo, hi } = rng[s.key];
      ctx.beginPath();
      let started = false;
      for (const r of data) {
        const v = r[s.key];
        if (!Number.isFinite(v)) continue;
        const px = x((v - lo) / (hi - lo));
        const py = y(r.depth);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = s.colour;
      ctx.lineWidth = s.width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash(s.dash ?? []);
      ctx.stroke();
      ctx.setLineDash([]);

      /* A soft fill under the temperature curve only, to anchor the eye. */
      if (s.key === 'temperature') {
        ctx.save();
        ctx.lineTo(w - PAD.r, y(data[data.length - 1].depth));
        ctx.lineTo(PAD.l, y(data[data.length - 1].depth));
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, PAD.t, 0, h - PAD.b);
        grad.addColorStop(0, hexA(s.colour, 0.16));
        grad.addColorStop(1, hexA(s.colour, 0.01));
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
      }
    }

    /* Current depth marker. */
    const marked = hoverDepth ?? depth;
    if (marked > 0 && marked <= maxD) {
      const yy = Math.round(y(marked)) + 0.5;
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(PAD.l, yy);
      ctx.lineTo(w - PAD.r, yy);
      ctx.stroke();
      ctx.restore();

      /* A dot where the marker meets each curve. */
      const row = nearestRow(data, marked);
      if (row) {
        for (const s of SERIES) {
          const { lo, hi } = rng[s.key];
          const v = row[s.key];
          if (!Number.isFinite(v)) continue;
          const px = x((v - lo) / (hi - lo));
          ctx.beginPath();
          ctx.arc(px, yy, 3.4, 0, Math.PI * 2);
          ctx.fillStyle = s.colour;
          ctx.fill();
          ctx.strokeStyle = surface;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }

      /* Depth label on the right edge. */
      const label = `${Math.round(marked).toLocaleString('en-US')} m`;
      ctx.font = '10px ui-monospace, Consolas, monospace';
      const tw = ctx.measureText(label).width;
      const bx = w - PAD.r - tw - 10;
      const by = clamp(yy - 16, PAD.t, h - PAD.b - 18);
      ctx.fillStyle = surface;
      ctx.globalAlpha = 0.92;
      roundRect(ctx, bx, by, tw + 10, 16, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = accent;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + 5, by + 8.5);
    }

    /* Legend across the top, with each series' real numeric range. */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let lx = PAD.l;
    ctx.font = '10.5px system-ui, sans-serif';
    for (const s of SERIES) {
      const { lo, hi } = rng[s.key];
      const rangeText =
        Math.abs(hi) >= 1000
          ? `${lo.toFixed(0)}–${hi.toFixed(0)}`
          : `${lo.toFixed(1)}–${hi.toFixed(1)}`;
      const text = `${s.label} ${rangeText}${s.unit}`;

      ctx.strokeStyle = s.colour;
      ctx.lineWidth = 2.4;
      ctx.setLineDash(s.dash ?? []);
      ctx.beginPath();
      ctx.moveTo(lx, 13);
      ctx.lineTo(lx + 14, 13);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = text2;
      ctx.fillText(text, lx + 19, 13);
      lx += 19 + ctx.measureText(text).width + 22;
      if (lx > w - 120) break;
    }
  }

  /* ── Interaction: hover to read a depth ───────────────────────────── */

  function depthFromEvent(ev) {
    const rect = canvas.getBoundingClientRect();
    const py = ev.clientY - rect.top;
    const plotH = rect.height - PAD.t - PAD.b;
    const t = (py - PAD.t) / plotH;
    return clamp(t, 0, 1) * maxDepth;
  }

  const onMove = (ev) => {
    hoverDepth = depthFromEvent(ev);
    schedule();
  };
  const onLeave = () => {
    hoverDepth = null;
    schedule();
  };

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);

  /* ── Observers ────────────────────────────────────────────────────── */

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);

  const offDepth = on('depth', (d) => {
    depth = d;
    schedule();
  });
  const offTheme = on('theme', () => schedule());

  resize();

  return {
    setData(next) {
      data = next ?? [];
      schedule();
    },
    setDepth(d) {
      depth = d;
      schedule();
    },
    redraw: schedule,
    destroy() {
      ro.disconnect();
      offDepth();
      offTheme();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    },
  };
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function nearestRow(rows, depth) {
  let best = null;
  let bestDelta = Infinity;
  for (const r of rows) {
    const d = Math.abs(r.depth - depth);
    if (d < bestDelta) {
      bestDelta = d;
      best = r;
    }
  }
  return best;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexA(colour, alpha) {
  const m = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(colour.trim());
  if (!m) return colour;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

export { SERIES };
