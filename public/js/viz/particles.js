/**
 * particles.js — the marine snow field.
 *
 * A canvas layer behind everything, drawing the two things that are always
 * present in the deep sea: marine snow drifting down, and the occasional
 * bioluminescent flash.
 *
 * Performance notes: particles are plain objects in a flat array (no per-frame
 * allocation), the canvas is sized to devicePixelRatio capped at 2, and the
 * whole loop is suspended when the tab is hidden or the user has asked for
 * reduced motion. Density and fall speed are both driven by the current depth,
 * so descending visibly thickens the snow and dims the flashes.
 */
import { state, on } from '../core/store.js';

const MAX_PARTICLES = 240;

export function createMarineSnow(canvas) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return { destroy() {} };

  const reduceMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let flashes = [];
  let raf = 0;
  let running = true;
  let lastTime = 0;

  /* Depth drives the look of the field. */
  let depthFactor = 0; // 0 at surface, 1 at full ocean depth
  let targetDepthFactor = 0;

  const off = on('depth', (d) => {
    targetDepthFactor = Math.min(1, d / 10935);
  });

  /* ── Sizing ───────────────────────────────────────────────────────── */

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  /* ── Population ───────────────────────────────────────────────────── */

  function seed() {
    // Fewer, larger particles near the surface; more, finer ones at depth.
    const count = Math.round(
      Math.min(MAX_PARTICLES, (width * height) / 9000) * (0.55 + depthFactor * 0.65),
    );
    particles = [];
    for (let i = 0; i < count; i++) particles.push(spawn(true));
  }

  function spawn(anywhere) {
    const depthBias = 0.35 + depthFactor * 0.65;
    return {
      x: Math.random() * width,
      y: anywhere ? Math.random() * height : -12,
      r: 0.6 + Math.random() * (2.2 - depthFactor * 0.8),
      // Marine snow sinks slowly; a little lateral drift comes from current.
      vy: (4 + Math.random() * 13) * depthBias,
      vx: (Math.random() - 0.5) * 5,
      alpha: 0.18 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      wobble: 0.4 + Math.random() * 1.1,
    };
  }

  /* ── Bioluminescent flashes ───────────────────────────────────────── */

  function maybeFlash(dt) {
    // Flashes become rarer as you descend — there is less life, and less
    // reason for it to advertise itself.
    const rate = 0.9 * (1 - depthFactor * 0.55);
    if (Math.random() < rate * dt) {
      flashes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 0,
        max: 16 + Math.random() * 44,
        life: 1,
        decay: 0.5 + Math.random() * 0.8,
        hue: Math.random() < 0.78 ? 'accent' : 'lure',
      });
      if (flashes.length > 14) flashes.shift();
    }
  }

  /* ── Frame ────────────────────────────────────────────────────────── */

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);

    const dt = Math.min(0.05, (now - lastTime) / 1000 || 0.016);
    lastTime = now;

    depthFactor += (targetDepthFactor - depthFactor) * Math.min(1, dt * 1.6);

    ctx.clearRect(0, 0, width, height);

    const style = getComputedStyle(document.documentElement);
    const accent = style.getPropertyValue('--accent').trim() || '#4fe3d0';
    const lure = style.getPropertyValue('--lure').trim() || '#ffb454';
    const snowColour = style.getPropertyValue('--text-0').trim() || '#e9f4fa';

    /* Marine snow */
    for (const p of particles) {
      p.phase += dt * p.wobble;
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(p.phase) * 4) * dt;

      if (p.y > height + 12) Object.assign(p, spawn(false));
      if (p.x < -12) p.x = width + 12;
      if (p.x > width + 12) p.x = -12;

      ctx.globalAlpha = p.alpha * (0.5 + depthFactor * 0.5);
      ctx.fillStyle = snowColour;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    /* Flashes */
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.life -= dt * f.decay;
      if (f.life <= 0) {
        flashes.splice(i, 1);
        continue;
      }
      const t = 1 - f.life; // 0 -> 1 over the life of the flash
      f.r = f.max * Math.sin(Math.PI * Math.min(1, t * 1.6));

      const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, Math.max(1, f.r));
      const colour = f.hue === 'accent' ? accent : lure;
      grad.addColorStop(0, hexA(colour, 0.55 * f.life));
      grad.addColorStop(0.45, hexA(colour, 0.16 * f.life));
      grad.addColorStop(1, hexA(colour, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(f.x, f.y, Math.max(1, f.r), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    maybeFlash(dt);
  }

  /* ── Lifecycle ────────────────────────────────────────────────────── */

  function start() {
    if (raf || reduceMotion) return;
    running = true;
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const onVisibility = () => (document.hidden ? stop() : start());
  const onResize = debounceRAF(resize);

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);

  resize();

  if (reduceMotion) {
    // Draw one static field so the background is not empty, then stop.
    running = true;
    frame(performance.now());
    stop();
  } else {
    start();
  }

  return {
    destroy() {
      stop();
      off();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    },
    get particleCount() {
      return particles.length;
    },
  };
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function debounceRAF(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}

/** Accept #rgb, #rrggbb or an existing rgb()/hsl() string. */
function hexA(colour, alpha) {
  const c = colour.trim();
  const m = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(c);
  if (m) return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
  const s = /^#([\da-f])([\da-f])([\da-f])$/i.exec(c);
  if (s) {
    const [r, g, b] = [s[1], s[2], s[3]].map((x) => parseInt(x + x, 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return c;
}

export { hexA };
