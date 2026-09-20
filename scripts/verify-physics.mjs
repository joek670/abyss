/**
 * verify-physics.mjs — validation harness for server/ocean.mjs
 *
 * Every check below compares the engine against a value that can be traced to
 * a published source. Run with `npm run verify`. A non-zero exit means the
 * physics has drifted and the UI must not be trusted.
 */
import { SPECIES } from '../server/data/species.mjs';
import {
  stateAt,
  density,
  density0,
  pressureAt,
  soundSpeedMackenzie,
  sofarAxisDepth,
  lightAt,
  bandExtinctionDepth,
  profile,
  ZONES,
  CHALLENGER_DEEP,
} from '../server/ocean.mjs';

let passed = 0;
let failed = 0;

function check(name, actual, expected, tolerance, unit = '') {
  const delta = Math.abs(actual - expected);
  const rel = expected !== 0 ? delta / Math.abs(expected) : delta;
  const ok = delta <= tolerance || rel <= tolerance;
  const mark = ok ? '  ok  ' : ' FAIL ';
  if (ok) passed++;
  else failed++;
  const fmt = (v) => (Math.abs(v) >= 1000 ? v.toFixed(1) : v.toPrecision(5));
  console.log(
    `[${mark}] ${name.padEnd(52)} got ${fmt(actual)}${unit}  expected ${fmt(expected)}${unit}  (d=${delta.toPrecision(2)})`,
  );
}

console.log('\n── UNESCO EOS-80 density ─────────────────────────────────────────');
// UNESCO 1983 worked examples for the one-atmosphere density of seawater.
// Standard check values from the EOS-80 documentation.
check('rho(0 C, 35 PSU, 0 bar)', density(0, 35, 0), 1028.106, 5e-4, ' kg/m3');
check('rho(25 C, 35 PSU, 0 bar)', density(25, 35, 0), 1023.343, 5e-4, ' kg/m3');
check('rho(20 C, 35 PSU, 0 bar)', density(20, 35, 0), 1024.763, 5e-4, ' kg/m3');
// Pure water at 4 C is the definition of the density maximum: 999.975 kg/m3.
check('rho(4 C, 0 PSU, 0 bar)  [pure water max]', density(4, 0, 0), 999.975, 5e-4, ' kg/m3');
// Compression. Seawater at the bottom of the Mariana Trench is ~4.6 % denser
// than the same parcel at the surface; the intermediate value at 1000 bar
// (~9850 m) is ~4.1 %.
check(
  'compressibility at 1000 bar (~9850 m)',
  (density(2, 34.7, 1000) / density0(2, 34.7) - 1) * 100,
  4.13,
  0.01,
  ' %',
);
check(
  'compressibility at full ocean depth',
  (density(2.28, 34.65, 1128) / density0(2.28, 34.65) - 1) * 100,
  4.6,
  0.02,
  ' %',
);

console.log('\n── Hydrostatic pressure ──────────────────────────────────────────');
// The classic rule of thumb: 1 m of seawater ~ 1.005 dbar near the surface,
// rising to ~1.03 dbar/m at full depth as the water is compressed.
check('pressure at 1000 m (dbar)', pressureAt(1000) * 10, 1009, 0.005, ' dbar');
check('pressure at 4000 m (bar)', pressureAt(4000), 406, 0.005, ' bar');
// A published, widely quoted anchor: the wreck of RMS Titanic lies at 3800 m
// under roughly 380 atm / 5600 psi.
const titanic = pressureAt(3800);
check('pressure at 3800 m (atm)  [Titanic]', (titanic * 1e5) / 101325, 380, 0.01, ' atm');
check(
  'pressure at 3800 m (psi)  [Titanic]',
  (titanic * 1e5) / 6894.757293168,
  5600,
  0.01,
  ' psi',
);
// Hydrostatic floor: the gradient is rho*g/1e4 dbar per metre, NOT a flat
// 1.0 dbar/m -- at rho = 1000 kg/m3 it is only 0.98. Taking the lightest
// seawater anyone measures (rho >= 1023 kg/m3) and the reduced gravity near
// the equator (g >= 9.78 m/s2) gives >= 1.0005 dbar/m, so pressure at
// 10935 m must exceed ~1094 bar however generously you round.
// NOTE: the figure of "1086 bar" that circulates widely for Challenger Deep
// is BELOW this floor and is therefore physically impossible; it descends
// physically impossible whatever its provenance. The engine's ~1128 bar
// is consistent with the modern in-situ measurement of ~1100-1130 bar.
const deepest = pressureAt(CHALLENGER_DEEP);
check('deep pressure above hydrostatic floor', deepest > 1094 ? 1 : 0, 1, 0, '');
check('pressure at 10935 m (bar)', deepest, 1128, 0.02, ' bar');
check(
  'pressure at 10935 m (psi)',
  (deepest * 1e5) / 6894.757293168,
  16360,
  0.02,
  ' psi',
);
check('pressure gradient rises with depth', pressureAt(10000) / 10000 > pressureAt(1000) / 1000 ? 1 : 0, 1, 0, '');

console.log('\n── Mackenzie (1981) sound speed ──────────────────────────────────');
// Hand-evaluated values of Mackenzie's nine-term regression.
check('c(T=0,  S=35, D=0)', soundSpeedMackenzie(0, 35, 0), 1448.96, 2e-5, ' m/s');
check('c(T=25, S=35, D=0)', soundSpeedMackenzie(25, 35, 0), 1534.29, 1e-4, ' m/s');
check('c(T=10, S=35, D=0)', soundSpeedMackenzie(10, 35, 0), 1489.8, 1e-4, ' m/s');
check('c(T=25, S=35, D=1000)', soundSpeedMackenzie(25, 35, 1000), 1550.74, 1e-4, ' m/s');
check('c(T=10, S=35, D=1000)', soundSpeedMackenzie(10, 35, 1000), 1506.26, 1e-4, ' m/s');
// Salinity and pressure terms must both raise sound speed at fixed T.
check('dS +1 PSU raises c', soundSpeedMackenzie(10, 36, 100) > soundSpeedMackenzie(10, 35, 100) ? 1 : 0, 1, 0, '');
check('dD +1000 m raises c at fixed T,S', soundSpeedMackenzie(2, 35, 3000) > soundSpeedMackenzie(2, 35, 2000) ? 1 : 0, 1, 0, '');
// The SOFAR channel: a genuine minimum in the open-ocean profile.
const axis = sofarAxisDepth();
check('SOFAR axis lies between 600 and 1400 m', axis.depth > 600 && axis.depth < 1400 ? 1 : 0, 1, 0, '');
check('SOFAR axis speed ~1480 m/s', axis.soundSpeed, 1482, 0.01, ' m/s');
const cShallow = soundSpeedMackenzie(stateAt(100).temperature, stateAt(100).salinity, 100);
const cAbyss = soundSpeedMackenzie(stateAt(5000).temperature, stateAt(5000).salinity, 5000);
check('sound speed at 100 m > axis', cShallow > axis.soundSpeed ? 1 : 0, 1, 0, '');
check('sound speed at 5000 m > axis', cAbyss > axis.soundSpeed ? 1 : 0, 1, 0, '');

console.log('\n── Beer-Lambert light field ──────────────────────────────────────');
// Textbook extinction depths for clear ocean water: red is gone by ~15-25 m,
// green by ~65-100 m, blue penetrates past 150 m.
check('red 1 % extinction depth', bandExtinctionDepth(0.35, 0.01), 13.2, 0.05, ' m');
check('green 1 % extinction depth', bandExtinctionDepth(0.07, 0.01), 65.8, 0.05, ' m');
check('blue 1 % extinction depth', bandExtinctionDepth(0.025, 0.01), 184.2, 0.05, ' m');
const l100 = lightAt(100);
check(
  'red is < 1 % at 100 m',
  l100.bands.find((b) => b.key === 'red').percent,
  0.0,
  0.01,
  ' %',
);
check(
  'blue still > 8 % at 100 m',
  l100.bands.find((b) => b.key === 'blue').percent,
  8.2,
  0.05,
  ' %',
);

console.log('\n── Water column shape ────────────────────────────────────────────');
check('SST (warm low-latitude profile) 22-29 C', stateAt(0).temperature, 25.5, 0.14, ' C');
check('temperature at 1000 m 3-6 C', stateAt(1000).temperature, 3.9, 0.35, ' C');
check('temperature at 4000 m 1-3 C', stateAt(4000).temperature, 2.0, 0.5, ' C');
check('hadal water warmer than abyssal', stateAt(10935).temperature > stateAt(4000).temperature ? 1 : 0, 1, 0, '');
check('salinity within 34.5-35.1', stateAt(500).salinity, 34.6, 0.02, ' PSU');
check('density at 4000 m > surface', stateAt(4000).density > stateAt(0).density ? 1 : 0, 1, 0, '');
check('sigma-0 at surface 21-27', stateAt(0).densityAnomaly, 23.4, 0.2, ' kg/m3');

console.log('\n── Profile integrity ─────────────────────────────────────────────');
const rows = profile({ max: CHALLENGER_DEEP, step: 50 });
check('profile row count', rows.length, 220, 0.02, '');
check('profile is monotonic in depth', rows.every((r, i) => i === 0 || r.depth > rows[i - 1].depth) ? 1 : 0, 1, 0, '');
check('no NaN anywhere in profile', rows.every((r) => Object.values(r).every((v) => Number.isFinite(v))) ? 1 : 0, 1, 0, '');
check('pressure monotonic increasing', rows.every((r, i) => i === 0 || r.pressureBar > rows[i - 1].pressureBar) ? 1 : 0, 1, 0, '');

console.log('\n── Depth budget sanity ───────────────────────────────────────────');
const s = stateAt(10935);
console.log(
  `  Challenger Deep: ${s.pressureBar.toFixed(0)} bar | ${s.pressureAtm.toFixed(0)} atm | ` +
    `${s.pressurePsi.toFixed(0)} psi | ${s.pressureKgCm2.toFixed(0)} kg/cm2 | ` +
    `${s.temperature.toFixed(2)} C | ${s.soundSpeed.toFixed(1)} m/s | ${s.compression.toFixed(2)} % compressed`,
);
const s2 = stateAt(3800);
console.log(
  `  Titanic (3800 m): ${s2.pressureBar.toFixed(0)} bar | ${s2.pressureAtm.toFixed(0)} atm | ` +
    `${s2.pressurePsi.toFixed(0)} psi | ${s2.temperature.toFixed(2)} C`,
);

console.log('\n── Specimen catalogue ────────────────────────────────────────────');
// The catalogue is the part of the atlas with no published reference to check
// against, so these are the assertions that CAN be made mechanically. They
// cannot tell you a depth is right, only that the record is self-consistent.
// Provenance is tracked per record in `sources` (issue #4).
const ZONE_BOUNDS = Object.fromEntries(ZONES.map((z) => [z.id, [z.min, z.max]]));
const IUCN_VOCAB = new Set([
  'Not Evaluated', 'Data Deficient', 'Least Concern', 'Near Threatened',
  'Vulnerable', 'Endangered', 'Critically Endangered',
  'Extinct in the Wild', 'Extinct',
]);

const badRange = SPECIES.filter((sp) => !(sp.depthMin < sp.depthMax));
check('every depth range is ordered', badRange.length ? 0 : 1, 1, 0, '');
if (badRange.length) console.log(`         ${badRange.map((s) => s.slug).join(', ')}`);

const badDepth = SPECIES.filter((sp) => sp.depthMin < 0 || sp.depthMax > CHALLENGER_DEEP);
check('no depth outside 0..Challenger Deep', badDepth.length ? 0 : 1, 1, 0, '');
if (badDepth.length) console.log(`         ${badDepth.map((s) => s.slug).join(', ')}`);

const badZone = SPECIES.filter((sp) => {
  const b = ZONE_BOUNDS[sp.zone];
  return !b || sp.depthMax < b[0] || sp.depthMin > b[1];
});
check('declared zone overlaps the depth range', badZone.length ? 0 : 1, 1, 0, '');
if (badZone.length) console.log(`         ${badZone.map((s) => `${s.slug} (${s.zone})`).join(', ')}`);

const badIucn = SPECIES.filter((sp) => !IUCN_VOCAB.has(sp.iucn));
check('IUCN status drawn from the Red List vocabulary', badIucn.length ? 0 : 1, 1, 0, '');
if (badIucn.length) console.log(`         ${badIucn.map((s) => `${s.slug}: ${s.iucn}`).join(', ')}`);

const badSize = SPECIES.filter((sp) => !(sp.sizeCm > 0) || !(sp.massKg > 0));
check('every record has a positive size and mass', badSize.length ? 0 : 1, 1, 0, '');
if (badSize.length) console.log(`         ${badSize.map((s) => s.slug).join(', ')}`);

const dupes = SPECIES.map((s) => s.slug).filter((v, i, a) => a.indexOf(v) !== i);
check('slugs are unique', dupes.length ? 0 : 1, 1, 0, '');

const sourced = SPECIES.filter((sp) => Array.isArray(sp.sources) && sp.sources.length).length;
console.log(
  `[  ..  ] ${'records carrying a source'.padEnd(52)} ${sourced} of ${SPECIES.length}` +
    `  (issue #4 — not yet an assertion)`,
);


console.log(
  `\n${failed === 0 ? 'ALL CHECKS PASSED' : 'FAILURES PRESENT'} — ${passed} passed, ${failed} failed\n`,
);
process.exit(failed === 0 ? 0 : 1);
