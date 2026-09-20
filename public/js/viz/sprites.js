/**
 * sprites.js — specimen artwork.
 *
 * There are no photographs in this project: the machine it was built on has no
 * network access and therefore no image assets. Rather than ship broken image
 * links, every specimen is drawn as a vector silhouette on a shared 100x100
 * grid, in the style of a field-guide plate.
 *
 * The drawings are deliberately abstract rather than photorealistic — a
 * confident geometric silhouette reads as intentional design at 200 px, where
 * a crude attempt at realism would read as a mistake. Everything is filled with
 * `currentColor`, so a card's accent colour drives the whole illustration, and
 * translucent parts (fins, membranes, transparent skulls) are drawn at reduced
 * opacity to suggest the gelatinous bodies most of these animals actually have.
 */
import { s } from '../core/dom.js';

/* ── Primitives ───────────────────────────────────────────────────────── */

const P = (d, o = {}) => s('path', { d, ...norm(o) });
const C = (cx, cy, r, o = {}) => s('circle', { cx, cy, r, ...norm(o) });
const E = (cx, cy, rx, ry, o = {}) => s('ellipse', { cx, cy, rx, ry, ...norm(o) });
const G = (children, o = {}) => s('g', norm(o), children);

function norm(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'o') out.opacity = v;
    else if (k === 'stroke') out.stroke = v;
    else if (k === 'sw') out['stroke-width'] = v;
    else if (k === 'fill') out.fill = v;
    else out[k] = v;
  }
  return out;
}

const SOLID = { fill: 'currentColor' };
const GHOST = { fill: 'currentColor', o: 0.34 };
const FAINT = { fill: 'currentColor', o: 0.18 };
const OUTLINE = { fill: 'none', stroke: 'currentColor', sw: 2.4 };

/**
 * Detail drawn ON TOP of a solid body — teeth, jaw lines, gill slits, lateral
 * lines. These must not use `currentColor`: the body beneath them is already
 * `currentColor`, so the detail would be invisible. They are drawn in the page
 * background colour instead, which contrasts against the accent-tinted body in
 * both themes.
 */
const DETAIL = { fill: 'none', stroke: 'var(--bg-1)', sw: 2.4, 'stroke-linecap': 'round' };

/* ── Eye helper: a lens with a highlight ──────────────────────────────── */

const eye = (cx, cy, r = 3.2, bg = 'var(--bg-1)') =>
  G([C(cx, cy, r, { fill: bg }), C(cx, cy, r * 0.55, SOLID)]);

/* ====================================================================== *
 * Archetypes
 * ====================================================================== */

const SPRITES = {
  /* ── Fishes ───────────────────────────────────────────────────────── */

  sunfish: () => [
    E(48, 50, 30, 34, SOLID),
    P('M74 26 q12 4 10 14 q-2 10-10 14 Z', GHOST),
    P('M74 74 q12-4 10-14 q-2-10-10-14 Z', GHOST),
    P('M78 50 l14-8 v16 Z', GHOST),
    C(30, 46, 3.4, { fill: 'var(--bg-1)' }),
    P('M20 50 q4 4 9 3', { ...DETAIL, sw: 2 }),
  ],

  shark: () => [
    P('M12 54 q10-12 30-14 q20-2 34 4 q10 4 16 12 q-8 8-20 10 q-16 3-32 0 q-18-4-28-12 Z', SOLID),
    P('M50 40 l6-18 l10 20 Z', SOLID),
    P('M30 62 l-8 14 l14-10 Z', GHOST),
    P('M86 56 l12-10 l-2 12 l2 12 l-12-10 Z', GHOST),
    P('M20 58 q6 4 14 4', { ...DETAIL, sw: 2.2, o: 0.7 }),
    eye(26, 50, 2.6),
  ],

  lanternfish: () => [
    P('M18 50 q10-13 26-14 q18-1 30 8 q8 5 12 6 q-4 4-12 7 q-12 8-30 7 q-16-1-26-14 Z', SOLID),
    P('M62 38 l6-12 l8 14 Z', GHOST),
    P('M30 62 l-6 10 l12-6 Z', GHOST),
    P('M86 50 l10-8 l-1 8 l1 8 Z', GHOST),
    C(30, 60, 1.8, { fill: 'var(--lure)' }),
    C(40, 62, 1.8, { fill: 'var(--lure)' }),
    C(50, 63, 1.8, { fill: 'var(--lure)' }),
    C(60, 61, 1.8, { fill: 'var(--lure)' }),
    eye(26, 46, 3.4),
  ],

  hatchetfish: () => [
    P('M24 44 q8-16 24-18 q16-1 24 12 q4 8 2 20 q-3 16-14 22 q-14 6-26-4 q-12-11-10-32 Z', SOLID),
    P('M40 66 q10 12 24 8 q-6 12-18 12 q-10 0-6-20 Z', GHOST),
    P('M72 40 l8-10 l4 14 Z', GHOST),
    P('M22 40 l-8-6 l2 10 Z', FAINT),
    C(40, 66, 1.7, { fill: 'var(--lure)' }),
    C(50, 70, 1.7, { fill: 'var(--lure)' }),
    C(60, 70, 1.7, { fill: 'var(--lure)' }),
    eye(36, 36, 3.6),
    eye(48, 34, 3.6),
  ],

  loosejaw: () => [
    P('M10 52 q14-8 34-9 q22-1 34 6 q10 5 14 7 q-6 3-16 5 q-14 5-32 4 q-20-1-34-13 Z', SOLID),
    P('M12 58 q16 12 38 10 q-12 8-28 6 q-12-2-10-16 Z', GHOST),
    P('M56 40 l4-12 l8 14 Z', GHOST),
    P('M80 56 l12-6 l-2 8 l2 8 Z', GHOST),
    C(24, 50, 2.4, { fill: '#ff5a6e' }),
    P('M14 54 l6-4 M18 58 l6-4 M24 60 l6-4', { ...DETAIL, sw: 1.8, o: 0.85 }),
    eye(28, 46, 2.8),
  ],

  viperfish: () => [
    P('M8 48 q16-6 34-6 q22 0 34 8 q10 6 16 8 q-8 3-18 4 q-14 3-30 3 q-22 0-36-9 Z', SOLID),
    P('M14 58 q10 12 30 12 q-10 8-24 5 q-10-2-6-17 Z', GHOST),
    P('M54 42 l2-14 l10 16 Z', GHOST),
    P('M40 40 l-2-12 l10 10 Z', GHOST),
    P('M20 44 v10 M26 44 v12 M32 45 v12 M38 46 v11', { ...DETAIL, sw: 2.2 }),
    P('M52 40 q8-14 4-22', { stroke: 'currentColor', sw: 1.6, fill: 'none', o: 0.7 }),
    C(56, 16, 3.4, { fill: 'var(--lure)' }),
    eye(24, 42, 3),
  ],

  barreleye: () => [
    P('M20 56 q10-12 28-13 q18-1 28 9 q8 7 12 9 q-6 4-16 5 q-14 3-30 2 q-16-1-22-12 Z', SOLID),
    P('M22 52 q4-20 22-22 q18-2 26 12 q4 7 2 12 q-10-6-26-6 q-16 0-24 4 Z', { fill: 'currentColor', o: 0.2 }),
    E(36, 42, 5, 7, { fill: 'none', stroke: 'currentColor', sw: 2.2 }),
    E(52, 42, 5, 7, { fill: 'none', stroke: 'currentColor', sw: 2.2 }),
    C(36, 40, 1.8, SOLID),
    C(52, 40, 1.8, SOLID),
    P('M78 62 l12-6 l-2 8 l2 8 Z', GHOST),
    C(40, 62, 1.5, { fill: 'var(--lure)' }),
    C(52, 63, 1.5, { fill: 'var(--lure)' }),
  ],

  fangtooth: () => [
    P('M20 46 q10-18 28-18 q20 0 28 16 q4 10 0 20 q-5 14-20 16 q-16 2-26-8 q-12-11-10-26 Z', SOLID),
    P('M28 66 q12 10 28 4 q-8 12-22 10 q-10-1-6-14 Z', GHOST),
    P('M46 30 l4-12 l8 14 Z', GHOST),
    P('M24 52 v12 M31 52 v14 M38 53 v13 M45 54 v12 M52 55 v10', { ...DETAIL, sw: 2.4 }),
    P('M24 50 v-6 M31 50 v-7 M38 51 v-6', { ...DETAIL, sw: 2, o: 0.55 }),
    P('M76 52 l14-4 l-4 8 l4 8 Z', GHOST),
    eye(34, 42, 3.6),
  ],

  'gulper-eel': () => [
    P('M14 54 q4-22 26-26 q22-4 30 10 q4 8-2 14 q-10 10-30 10 q-20 0-24-8 Z', SOLID),
    P('M14 54 q22 16 48 4 q-10 18-30 18 q-18 0-18-22 Z', GHOST),
    P('M66 44 q14-2 22 6 q6 7 0 14 q-6 6-16 4', { fill: 'none', stroke: 'currentColor', sw: 3, o: 0.8 }),
    P('M88 58 q6 8 2 16', { fill: 'none', stroke: 'currentColor', sw: 2, o: 0.6 }),
    C(90, 76, 3, { fill: 'var(--lure)' }),
    eye(26, 42, 3.4),
  ],

  snailfish: () => [
    P('M22 50 q8-18 26-19 q20-1 26 16 q3 10-2 20 q-8 16-24 16 q-14 0-20-12 q-6-11-6-21 Z', { fill: 'currentColor', o: 0.55 }),
    P('M22 50 q-8 2-10 8 q-2 6 4 8 q6 2 10-4', { fill: 'currentColor', o: 0.45 }),
    P('M70 46 q14 4 22 0 q-4 10-14 12 q-8 1-8-12 Z', GHOST),
    P('M46 34 q10-6 20-2', { fill: 'none', stroke: 'currentColor', sw: 1.6, o: 0.5 }),
    C(34, 44, 2.4, SOLID),
    P('M30 58 q14 8 30 4', { fill: 'none', stroke: 'currentColor', sw: 1.4, o: 0.45 }),
  ],

  'cusk-eel': () => [
    P('M10 54 q10-14 30-16 q22-2 34 8 q8 6 12 8 q-6 4-14 6 q-14 5-32 4 q-20-1-30-10 Z', SOLID),
    P('M56 42 l6-12 l8 14 Z', GHOST),
    P('M14 58 q10 10 28 9 q-10 7-22 5 q-10-2-6-14 Z', GHOST),
    P('M84 56 l12-8 l-2 10 l2 10 Z', GHOST),
    P('M20 52 h4', { stroke: 'var(--bg-1)', sw: 2, fill: 'none' }),
    C(24, 52, 1.4, SOLID),
    P('M28 60 h4 M36 62 h4 M44 62 h4', { stroke: 'currentColor', sw: 1, fill: 'none', o: 0.4 }),
  ],

  blobfish: () => [
    P('M20 48 q6-22 30-22 q24 0 30 22 q4 14-4 24 q-10 12-26 12 q-16 0-26-12 q-8-10-4-24 Z', { fill: 'currentColor', o: 0.6 }),
    P('M30 62 q20 14 40 0 q-4 14-20 14 q-16 0-20-14 Z', GHOST),
    P('M36 70 q14 6 28 0', { ...DETAIL, sw: 2.2, o: 0.75 }),
    C(38, 46, 3.6, { fill: 'var(--bg-1)' }),
    C(38, 46, 2, SOLID),
    C(62, 46, 3.6, { fill: 'var(--bg-1)' }),
    C(62, 46, 2, SOLID),
    P('M44 58 q6-3 12 0', { fill: 'none', stroke: 'currentColor', sw: 2, o: 0.7 }),
  ],

  megamouth: () => [
    P('M8 50 q14-20 40-20 q28 0 40 14 q6 6 4 12 q-4 10-22 12 q-26 3-44-4 q-16-6-18-14 Z', SOLID),
    P('M10 48 q20-10 42-6 q-16 14-38 16 q-6-4-4-10 Z', { fill: 'currentColor', o: 0.22 }),
    P('M52 32 l6-12 l10 14 Z', SOLID),
    P('M84 52 l12-10 l-2 12 l2 12 Z', GHOST),
    P('M14 56 q22 6 44 0', { ...DETAIL, sw: 2.6, o: 0.9 }),
    eye(30, 40, 2.8),
  ],

  /* ── Sharks ───────────────────────────────────────────────────────── */

  'goblin-shark': () => [
    P('M6 56 q18-10 40-12 q24-2 34 6 q8 5 10 8 q-6 4-16 6 q-16 4-36 3 q-24-1-32-11 Z', SOLID),
    P('M10 52 q16-10 38-10 q-6 6-20 10 q-12 3-18 0 Z', { fill: 'currentColor', o: 0.3 }),
    P('M56 44 l6-14 l10 18 Z', SOLID),
    P('M30 62 l-6 14 l14-10 Z', GHOST),
    P('M84 58 l14-10 l-3 12 l3 12 Z', GHOST),
    P('M22 62 q6 8 14 6', { ...DETAIL, sw: 3 }),
    eye(22, 52, 2.6),
  ],

  eelshark: () => [
    P('M10 52 q10-10 26-12 q18-2 30 6 q12 8 20 10 q-10 5-22 6 q-16 2-30-1 q-18-4-24-9 Z', SOLID),
    P('M30 42 q4 20 0 26 M40 40 q4 22 0 28 M50 40 q4 20 0 26', { ...DETAIL, sw: 2, o: 0.6 }),
    P('M62 38 l6-12 l8 14 Z', GHOST),
    P('M86 56 l12-8 l-2 10 l2 10 Z', GHOST),
    P('M16 46 q10 12 24 12', { fill: 'none', stroke: 'currentColor', sw: 1.6, o: 0.6 }),
    eye(20, 48, 2.8),
  ],

  chimaera: () => [
    P('M8 52 q14-14 34-16 q22-2 34 8 q10 7 14 9 q-8 5-18 6 q-16 4-32 2 q-20-2-32-9 Z', SOLID),
    P('M14 56 q10 12 26 12 q-10 8-22 6 q-10-2-4-18 Z', GHOST),
    P('M40 36 q14-2 24 6 q-12 2-24-6 Z', GHOST),
    P('M30 62 l-6 14 l14-10 Z', GHOST),
    P('M84 58 l14-8 l-3 10 l3 12 Z', GHOST),
    P('M8 52 q-6-4-6-10 q6 4 10 8 Z', { fill: 'currentColor', o: 0.5 }),
    eye(26, 48, 3),
  ],

  /* ── Cephalopods ──────────────────────────────────────────────────── */

  squid: () => [
    P('M50 8 q14 10 14 30 q0 14-14 20 q-14-6-14-20 q0-20 14-30 Z', SOLID),
    P('M50 8 q-16 2-18 12 q8-6 18-6 Z', GHOST),
    P('M50 8 q16 2 18 12 q-8-6-18-6 Z', GHOST),
    P('M40 56 q-4 14-10 24 M50 58 q0 14-2 26 M60 56 q4 14 10 24', {
      fill: 'none', stroke: 'currentColor', sw: 3.4, 'stroke-linecap': 'round',
    }),
    P('M44 58 q-8 14-16 18 M56 58 q8 14 16 18', {
      fill: 'none', stroke: 'currentColor', sw: 2.4, o: 0.7, 'stroke-linecap': 'round',
    }),
    C(50, 34, 5, { fill: 'var(--bg-1)' }),
    C(50, 34, 2.6, SOLID),
  ],

  'colossal-squid': () => [
    P('M50 6 q18 12 18 34 q0 16-18 24 q-18-8-18-24 q0-22 18-34 Z', SOLID),
    P('M50 6 q-22 4-24 16 q10-8 24-8 Z', GHOST),
    P('M50 6 q22 4 24 16 q-10-8-24-8 Z', GHOST),
    P('M38 62 q-6 14-14 22 M50 64 q-2 16-4 26 M62 62 q6 14 14 22', {
      fill: 'none', stroke: 'currentColor', sw: 4, 'stroke-linecap': 'round',
    }),
    P('M40 74 l-6 6 M46 84 l-5 6 M60 74 l6 6 M54 84 l5 6', {
      fill: 'none', stroke: 'currentColor', sw: 2.4, 'stroke-linecap': 'round',
    }),
    C(50, 36, 5.6, { fill: 'var(--bg-1)' }),
    C(50, 36, 3, SOLID),
  ],

  'vampire-squid': () => [
    P('M50 12 q20 10 20 26 q0 14-20 18 q-20-4-20-18 q0-16 20-26 Z', SOLID),
    P('M30 46 q-8 12-6 26 q10-4 16-14 Z', GHOST),
    P('M70 46 q8 12 6 26 q-10-4-16-14 Z', GHOST),
    P('M40 52 q-6 12-4 24 q8-4 12-14 Z', GHOST),
    P('M60 52 q6 12 4 24 q-8-4-12-14 Z', GHOST),
    P('M44 56 q-2 10-1 18 M50 58 q0 10 0 18 M56 56 q2 10 1 18', {
      fill: 'none', stroke: 'currentColor', sw: 1.4, o: 0.55,
    }),
    C(42, 32, 4.4, { fill: 'var(--bg-1)' }),
    C(58, 32, 4.4, { fill: 'var(--bg-1)' }),
    C(42, 32, 2.2, SOLID),
    C(58, 32, 2.2, SOLID),
  ],

  'dumbo-octopus': () => [
    E(50, 34, 24, 20, SOLID),
    P('M28 24 q-12-6-14-16 q12 2 18 12 Z', GHOST),
    P('M72 24 q12-6 14-16 q-12 2-18 12 Z', GHOST),
    P('M30 50 q-10 16-8 32 q10-6 14-20 Z', GHOST),
    P('M70 50 q10 16 8 32 q-10-6-14-20 Z', GHOST),
    P('M40 52 q-4 18-2 32 q8-6 10-22 Z', GHOST),
    P('M60 52 q4 18 2 32 q-8-6-10-22 Z', GHOST),
    P('M50 52 q0 18 0 32 q6-8 6-24 Z', GHOST),
    C(42, 32, 4.6, { fill: 'var(--bg-1)' }),
    C(58, 32, 4.6, { fill: 'var(--bg-1)' }),
    C(42, 32, 2.4, SOLID),
    C(58, 32, 2.4, SOLID),
  ],

  /* ── Cnidarians ───────────────────────────────────────────────────── */

  'comb-jelly': () => [
    E(50, 36, 24, 26, { fill: 'currentColor', o: 0.5 }),
    E(50, 36, 24, 26, OUTLINE),
    P('M32 28 q18-8 36 0 M30 38 q20-8 40 0 M32 48 q18-8 36 0', {
      fill: 'none', stroke: 'currentColor', sw: 1.6, o: 0.75,
    }),
    P('M40 60 q-6 16-10 30 M60 60 q6 16 10 30', {
      fill: 'none', stroke: 'currentColor', sw: 1.8, o: 0.7,
    }),
    P('M44 62 q-4 18-2 32 M56 62 q4 18 2 32', {
      fill: 'none', stroke: 'currentColor', sw: 1.2, o: 0.45,
    }),
  ],

  siphonophore: () => [
    E(50, 18, 12, 10, SOLID),
    E(50, 34, 9, 8, GHOST),
    E(50, 48, 7, 7, GHOST),
    P('M50 10 q-14 4-14 12 q0 6 14 8 q14-2 14-8 q0-8-14-12 Z', { fill: 'currentColor', o: 0.2 }),
    P('M50 54 q-2 20 2 36', { fill: 'none', stroke: 'currentColor', sw: 2, o: 0.75 }),
    P('M38 26 q-10 14-14 30 M62 26 q10 14 14 30', {
      fill: 'none', stroke: 'currentColor', sw: 1.4, o: 0.5,
    }),
    P('M34 40 q-8 12-12 26 M66 40 q8 12 12 26', {
      fill: 'none', stroke: 'currentColor', sw: 1, o: 0.35,
    }),
    C(30, 58, 1.6, { fill: 'var(--lure)' }),
    C(70, 58, 1.6, { fill: 'var(--lure)' }),
    C(50, 88, 1.6, { fill: 'var(--lure)' }),
  ],

  /* ── Anglerfish & kin ─────────────────────────────────────────────── */

  anglerfish: () => [
    P('M22 52 q4-26 28-30 q26-4 34 16 q6 14-4 26 q-12 14-32 12 q-20-2-26-24 Z', SOLID),
    P('M22 52 q14 20 40 14 q-12 16-28 14 q-16-2-12-28 Z', GHOST),
    P('M52 24 q10-16 6-22', { fill: 'none', stroke: 'currentColor', sw: 1.8, o: 0.8 }),
    C(58, 2, 5, { fill: 'var(--lure)' }),
    P('M26 54 l6 12 M34 56 l6 13 M42 57 l5 13 M50 57 l4 12', { ...DETAIL, sw: 2.6 }),
    P('M28 50 l6-10 M36 50 l5-11 M44 51 l4-10', { ...DETAIL, sw: 2, o: 0.6 }),
    P('M72 40 q12 6 14 16', { fill: 'none', stroke: 'currentColor', sw: 2, o: 0.6 }),
    eye(34, 44, 3.6),
  ],

  /* ── Crustaceans & invertebrates ──────────────────────────────────── */

  'yeti-crab': () => [
    E(50, 48, 22, 16, SOLID),
    P('M28 44 q-12-10-18-22 q14 2 22 12 Z', GHOST),
    P('M72 44 q12-10 18-22 q-14 2-22 12 Z', GHOST),
    P('M10 22 q6 4 10 0 M8 18 q6 4 10 0 M90 22 q-6 4-10 0 M92 18 q-6 4-10 0', {
      fill: 'none', stroke: 'currentColor', sw: 1.4, o: 0.65,
    }),
    P('M36 62 l-4 16 M46 64 l-2 16 M54 64 l2 16 M64 62 l4 16', {
      fill: 'none', stroke: 'currentColor', sw: 2.4, 'stroke-linecap': 'round',
    }),
    P('M30 36 q20-10 40 0', { ...DETAIL, sw: 1.8, o: 0.6 }),
    C(42, 42, 2.8, { fill: 'var(--bg-1)' }),
    C(58, 42, 2.8, { fill: 'var(--bg-1)' }),
  ],

  amphipod: () => [
    P('M26 44 q10-14 26-14 q18 0 24 12 q4 8-2 16 q-8 12-26 12 q-16 0-22-12 q-4-8 0-14 Z', SOLID),
    P('M28 40 q-12-6-18-16 M32 38 q-10-10-12-20', {
      fill: 'none', stroke: 'currentColor', sw: 2.2, 'stroke-linecap': 'round',
    }),
    P('M34 66 l-4 14 M44 68 l-2 14 M54 68 l2 14 M64 64 l6 12', {
      fill: 'none', stroke: 'currentColor', sw: 2, 'stroke-linecap': 'round',
    }),
    P('M40 46 h6 M52 46 h6 M40 56 h6 M52 56 h6', { ...DETAIL, sw: 1.3, o: 0.5 }),
    P('M74 56 l14-6 l-3 8 l3 8 Z', GHOST),
    eye(34, 46, 2.6),
  ],

  'sea-pig': () => [
    E(50, 46, 26, 18, { fill: 'currentColor', o: 0.65 }),
    P('M36 28 q2-12 8-14 M50 26 q0-12 0-16 M64 28 q-2-12-8-14', {
      fill: 'none', stroke: 'currentColor', sw: 2.4, 'stroke-linecap': 'round',
    }),
    P('M32 60 l-4 20 M44 62 l-2 20 M56 62 l2 20 M68 60 l4 20', {
      fill: 'none', stroke: 'currentColor', sw: 3.4, 'stroke-linecap': 'round',
    }),
    P('M34 44 q16-6 32 0', { ...DETAIL, sw: 1.6, o: 0.6 }),
    P('M76 42 q8 2 10 8', { fill: 'none', stroke: 'currentColor', sw: 1.6, o: 0.6 }),
  ],

  'brittle-star': () => [
    C(50, 50, 11, SOLID),
    P('M50 39 q-2-18 0-32 M61 50 q18-2 32 0 M50 61 q2 18 0 32 M39 50 q-18 2-32 0', {
      fill: 'none', stroke: 'currentColor', sw: 5, 'stroke-linecap': 'round',
    }),
    P('M57 43 q14-12 26-20 M43 57 q-14 12-26 20 M57 57 q14 12 26 20 M43 43 q-14-12-26-20', {
      fill: 'none', stroke: 'currentColor', sw: 3.4, o: 0.6, 'stroke-linecap': 'round',
    }),
    P('M50 7 l-3 5 M82 50 l-5-3 M50 93 l3-5 M18 50 l5 3', {
      fill: 'none', stroke: 'currentColor', sw: 1.6, o: 0.5,
    }),
  ],

  xenophyophore: () => [
    P(
      'M50 14 q14 0 18 12 q12-2 16 8 q4 10-6 16 q8 8 0 16 q-8 8-18 2 q-4 12-16 12 q-12 0-14-12 q-12 4-18-6 q-6-10 4-18 q-8-8-2-18 q6-10 18-6 q2-16 18-16 Z',
      { fill: 'currentColor', o: 0.55 },
    ),
    P(
      'M50 14 q14 0 18 12 q12-2 16 8 q4 10-6 16 q8 8 0 16 q-8 8-18 2 q-4 12-16 12 q-12 0-14-12 q-12 4-18-6 q-6-10 4-18 q-8-8-2-18 q6-10 18-6 q2-16 18-16 Z',
      OUTLINE,
    ),
    P('M40 34 q10-4 18 2 M34 52 q12-6 26-2 M44 70 q8-4 16 0', {
      fill: 'none', stroke: 'currentColor', sw: 1.6, o: 0.6,
    }),
    C(38, 44, 2, FAINT),
    C(62, 40, 2.4, FAINT),
    C(56, 66, 2, FAINT),
  ],

  woodborer: () => [
    P('M18 62 h64 v20 h-64 Z', { fill: 'currentColor', o: 0.28 }),
    E(46, 54, 18, 13, SOLID),
    P('M30 54 q16-10 32 0', { ...DETAIL, sw: 2.2, o: 0.7 }),
    P('M40 42 q-2-10 4-14 M52 42 q2-10-4-14', {
      fill: 'none', stroke: 'currentColor', sw: 2.6, 'stroke-linecap': 'round',
    }),
    P('M38 66 l4 12 M46 68 l0 12 M54 66 l-4 12', {
      fill: 'none', stroke: 'currentColor', sw: 1.4, o: 0.4,
    }),
  ],

  /* ── Worms ────────────────────────────────────────────────────────── */

  'tube-worm': () => [
    P('M40 92 q-2-30 2-44 l16 0 q4 14 2 44 Z', { fill: 'currentColor', o: 0.35 }),
    P('M42 48 q0-24 8-32 q8 8 8 32 q-8 8-16 0 Z', SOLID),
    P('M44 30 q-14-8-18-18 M56 30 q14-8 18-18 M50 26 q0-16 0-22 M46 34 q-12-4-16-12 M54 34 q12-4 16-12', {
      fill: 'none', stroke: 'currentColor', sw: 3, 'stroke-linecap': 'round',
    }),
  ],

  'worm-tube': () => [
    P('M44 94 q-3-34 1-52 l14 0 q4 18 1 52 Z', { fill: 'currentColor', o: 0.32 }),
    P('M46 42 q-2-18 6-24 q8 6 6 24 q-6 6-12 0 Z', SOLID),
    P('M48 22 q-8-6-10-14 M56 22 q8-6 10-14 M52 20 q0-12 0-16', {
      fill: 'none', stroke: 'currentColor', sw: 2.4, 'stroke-linecap': 'round',
    }),
    P('M30 60 q8 2 14 0 M70 60 q-8 2-14 0', { fill: 'none', stroke: 'currentColor', sw: 1.4, o: 0.4 }),
  ],

  boneworm: () => [
    P('M14 66 q18-12 40-10 q24 2 34 12 q-12 10-36 10 q-24 0-38-12 Z', { fill: 'currentColor', o: 0.35 }),
    P('M34 46 q-2-14 4-20 q8 6 8 20 q-6 6-12 0 Z', SOLID),
    P('M38 28 q-10-6-12-16 M46 28 q10-6 12-16', {
      fill: 'none', stroke: 'currentColor', sw: 2.2, 'stroke-linecap': 'round',
    }),
    P('M30 64 q-6 10-8 18 M46 66 q-2 12-2 20 M60 64 q4 10 8 18', {
      fill: 'none', stroke: 'currentColor', sw: 2, o: 0.65,
    }),
  ],

  /* ── Cetaceans ────────────────────────────────────────────────────── */

  'sperm-whale': () => [
    P('M10 50 q4-16 26-18 q22-2 40 4 q16 5 20 12 q-6 8-22 12 q-18 5-38 3 q-22-2-26-13 Z', SOLID),
    P('M10 50 q-6-2-8-8 q6 0 10 4 Z', GHOST),
    P('M14 58 q14 12 34 10 q-12 8-28 6 q-12-2-6-16 Z', GHOST),
    P('M84 56 l14-12 l-4 14 l4 14 Z', GHOST),
    P('M30 58 q14 6 30 2', { ...DETAIL, sw: 2.2, o: 0.8 }),
    C(28, 50, 2.8, { fill: 'var(--bg-1)' }),
    P('M46 40 q-2-10 4-12', { fill: 'none', stroke: 'currentColor', sw: 1.6, o: 0.5 }),
  ],

  'beaked-whale': () => [
    P('M8 52 q6-16 28-18 q24-2 40 6 q14 6 18 10 q-6 6-20 9 q-18 5-38 4 q-24-2-28-11 Z', SOLID),
    P('M8 52 q-4-2-5-7 q5 0 8 3 Z', GHOST),
    P('M16 60 q12 10 30 9 q-10 7-24 5 q-10-2-6-14 Z', GHOST),
    P('M52 38 l6-10 l8 12 Z', SOLID),
    P('M86 58 l14-10 l-3 12 l3 12 Z', GHOST),
    C(22, 52, 2.4, { fill: 'var(--bg-1)' }),
    P('M30 44 q10-4 20-2', { ...DETAIL, sw: 1.8, o: 0.5 }),
  ],

  /* ── Oddities ─────────────────────────────────────────────────────── */

  'tripod-fish': () => [
    P('M28 40 q10-14 26-14 q18 0 24 12 q4 8-2 14 q-8 10-24 10 q-14 0-22-10 q-4-6-2-12 Z', SOLID),
    P('M52 30 l6-12 l8 14 Z', GHOST),
    P('M30 56 q-8 18-14 34 M46 60 q-2 18-4 32 M62 56 q8 18 14 34', {
      fill: 'none', stroke: 'currentColor', sw: 3, 'stroke-linecap': 'round',
    }),
    P('M22 90 h-8 M42 92 h-8 M76 90 h8', {
      fill: 'none', stroke: 'currentColor', sw: 3, 'stroke-linecap': 'round',
    }),
    P('M30 46 q-12 2-16 8 M58 46 q12 2 16 8', {
      fill: 'none', stroke: 'currentColor', sw: 2.4, o: 0.7, 'stroke-linecap': 'round',
    }),
    C(36, 42, 1.8, { fill: 'var(--bg-1)' }),
  ],
};

/* ====================================================================== *
 * Public API
 * ====================================================================== */

/** True if a sprite archetype exists. */
export function hasSprite(name) {
  return Object.hasOwn(SPRITES, name);
}

/**
 * Build an SVG element for a species.
 * Falls back to a generic fish so an unknown sprite name can never produce an
 * empty card.
 */
export function sprite(name, { size = 100, className = '', title = '' } = {}) {
  const build = SPRITES[name] ?? SPRITES.snailfish;
  const children = build();
  const svg = s(
    'svg',
    {
      viewBox: '0 0 100 100',
      width: size,
      height: size,
      class: className,
      role: title ? 'img' : 'presentation',
      'aria-hidden': title ? null : 'true',
      focusable: 'false',
    },
    title ? s('title', null, title) : null,
    children,
  );
  return svg;
}

export const spriteNames = Object.keys(SPRITES);
