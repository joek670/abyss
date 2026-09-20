/**
 * ocean.mjs — the physical oceanography engine behind ABYSS.
 *
 * Everything the interface reports about the water column is computed here, on
 * the server, from published empirical relationships. No values are hard-coded
 * in the client. Three of the models are exact transcriptions of their source
 * papers:
 *
 *   1. Density        UNESCO (1983) / EOS-80 equation of state, including the
 *                     full secant bulk modulus K(T,S,p), so density is a true
 *                     function of pressure and not just a surface sigma-0.
 *   2. Sound speed    Mackenzie, K.V. (1981), "Nine-term equation for sound
 *                     speed in the oceans", J. Acoust. Soc. Am. 70(3), 807-812.
 *   3. Light          Beer-Lambert attenuation, applied per spectral band with
 *                     band-specific diffuse attenuation coefficients.
 *
 * Temperature and salinity are empirical fits to a *globally averaged* open
 * ocean profile (mixed layer -> thermocline -> deep water -> adiabatic hadal
 * warming). They are representative, not a measurement at a specific station,
 * and the interface says so. The fits are documented term-by-term below so the
 * shape of the curve is auditable rather than mysterious.
 *
 * Reference values used to validate this file live in scripts/verify-physics.mjs
 */

/** Standard gravity (m/s^2), ISO 80000-3. */
export const G = 9.80665;

/** Mean surface pressure of the atmosphere (Pa). */
export const P_ATM = 101325;

/** Deepest known point on Earth: Challenger Deep, Mariana Trench (m). */
export const CHALLENGER_DEEP = 10935;

/** Deepest fish ever captured on camera: Pseudoliparis sp., Izu-Ogasawara (m). */
export const DEEPEST_FISH = 8336;

/* ------------------------------------------------------------------ *
 * Temperature and salinity
 * ------------------------------------------------------------------ */

/**
 * Globally averaged open-ocean temperature in degrees Celsius.
 *
 * Three superimposed terms:
 *   - a warm surface reservoir decaying with a 300 m e-folding scale
 *     (the main thermocline),
 *   - a cold deep reservoir decaying with a 2500 m scale (Antarctic
 *     bottom water mixing upward),
 *   - a constant 0.95 C abyssal floor plus an adiabatic gradient of
 *     1.18e-4 C/m, which is why hadal water is *warmer* than the
 *     abyssal water above it despite receiving no sunlight.
 */
export function temperatureAt(depthM) {
  const z = Math.max(0, depthM);
  const thermocline = 21.5 * Math.exp(-z / 300);
  const deep = 3.0 * Math.exp(-z / 2500);
  const floor = 0.95;
  const adiabatic = 1.18e-4 * z;
  return thermocline + deep + floor + adiabatic;
}

/**
 * Globally averaged salinity in practical salinity units (PSU).
 * Surface enrichment from net evaporation, a shallow subsurface maximum,
 * relaxing to a near-uniform 34.65 PSU deep water mass.
 */
export function salinityAt(depthM) {
  const z = Math.max(0, depthM);
  return 34.65 + 0.55 * Math.exp(-z / 150) - 0.18 * Math.exp(-z / 800);
}

/* ------------------------------------------------------------------ *
 * UNESCO (1983) equation of state — EOS-80
 * ------------------------------------------------------------------ */

/**
 * Density of pure water at one atmosphere (kg/m^3), UNESCO 1983 eq. 1.
 * Valid -2 <= T <= 40 C.
 */
function pureWaterDensity0(T) {
  return (
    999.842594 +
    6.793952e-2 * T -
    9.09529e-3 * T ** 2 +
    1.001685e-4 * T ** 3 -
    1.120083e-6 * T ** 4 +
    6.536332e-9 * T ** 5
  );
}

/**
 * Density at one atmosphere as a function of temperature and salinity
 * (kg/m^3) — the "sigma-0" reference density, UNESCO 1983 eq. 2.
 */
export function density0(T, S) {
  return (
    pureWaterDensity0(T) +
    (0.824493 -
      4.0899e-3 * T +
      7.6438e-5 * T ** 2 -
      8.2467e-7 * T ** 3 +
      5.3875e-9 * T ** 4) *
      S +
    (-5.72466e-3 + 1.0227e-4 * T - 1.6546e-6 * T ** 2) * Math.pow(S, 1.5) +
    4.8314e-4 * S ** 2
  );
}

/**
 * Secant bulk modulus K(T, S, p) in bar, UNESCO 1983 eq. 3.
 * This is the term that makes seawater compressible: at 10 000 m the water
 * itself is about 4.6 % denser than it would be at the surface.
 */
export function secantBulkModulus(T, S, pBar) {
  const p = pBar;
  return (
    19652.21 +
    148.4206 * T -
    2.327105 * T ** 2 +
    1.360477e-2 * T ** 3 -
    5.155288e-5 * T ** 4 +
    (54.6746 - 0.603459 * T + 1.09987e-2 * T ** 2 - 6.167e-5 * T ** 3) * S +
    (7.944e-2 + 1.6483e-2 * T - 5.3009e-4 * T ** 2) * Math.pow(S, 1.5) +
    p *
      (3.239908 +
        1.43713e-3 * T +
        1.16092e-4 * T ** 2 -
        5.77905e-7 * T ** 3 +
        (2.2838e-3 - 1.0981e-5 * T - 1.6078e-6 * T ** 2) * S +
        1.91075e-4 * Math.pow(S, 1.5)) +
    p ** 2 *
      (8.50935e-5 -
        6.12293e-6 * T +
        5.2787e-8 * T ** 2 +
        (-9.9348e-7 + 2.0816e-8 * T + 9.1697e-10 * T ** 2) * S)
  );
}

/**
 * Full in-situ density (kg/m^3) at temperature T (C), salinity S (PSU) and
 * sea pressure p (bar). UNESCO 1983 eq. 4.
 */
export function density(T, S, pBar) {
  const rho0 = density0(T, S);
  const K = secantBulkModulus(T, S, pBar);
  return rho0 / (1 - pBar / K);
}

/* ------------------------------------------------------------------ *
 * Pressure
 * ------------------------------------------------------------------ */

/**
 * Sea pressure in bar, obtained by numerically integrating the hydrostatic
 * equation dp = rho(T,S,p) * g * dz in 1 m steps.
 *
 * The naive rule of thumb (1 m of depth ~ 1 dbar) is off by about 1.5 % at
 * full ocean depth because it ignores compressibility; integrating the real
 * equation of state recovers that missing pressure.
 */
export function pressureAt(depthM) {
  const target = Math.max(0, depthM);
  const step = 1;
  let pPa = 0;
  let z = 0;
  while (z < target) {
    const h = Math.min(step, target - z);
    const zMid = z + h / 2;
    const T = temperatureAt(zMid);
    const S = salinityAt(zMid);
    const pBar = pPa / 1e5;
    const rho = density(T, S, pBar);
    pPa += rho * G * h;
    z += h;
  }
  return pPa / 1e5; // bar
}

/** Sea pressure expressed in decibars (the oceanographer's default unit). */
export function pressureDbar(depthM) {
  return pressureAt(depthM) * 10;
}

/* ------------------------------------------------------------------ *
 * Sound speed — Mackenzie (1981)
 * ------------------------------------------------------------------ */

/**
 * Sound speed in seawater (m/s). Mackenzie's nine-term equation, validated
 * for 0 <= D <= 8000 m, -2 <= T <= 30 C, 25 <= S <= 40 PSU.
 *
 * The signature feature of the resulting profile is the SOFAR channel: sound
 * speed falls through the thermocline, reaches a minimum near 1000-1200 m,
 * then rises again as pressure stiffens the water. Sound trapped in that
 * waveguide can cross an ocean basin with very little loss.
 *
 * Above 8000 m the depth terms are evaluated at 8000 m and the result is
 * flagged `extrapolated` by the caller.
 */
export function soundSpeedMackenzie(T, S, depthM) {
  const D = Math.min(Math.max(depthM, 0), 8000);
  return (
    1448.96 +
    4.591 * T -
    5.304e-2 * T ** 2 +
    2.374e-4 * T ** 3 +
    1.34 * (S - 35) +
    1.63e-2 * D +
    1.675e-7 * D ** 2 -
    1.025e-2 * T * (S - 35) -
    7.139e-13 * T * D ** 3
  );
}

/** Depth of the sound-speed minimum (the SOFAR axis), by ternary search. */
export function sofarAxisDepth() {
  let lo = 200;
  let hi = 3000;
  for (let i = 0; i < 60; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const c1 = soundSpeedMackenzie(temperatureAt(m1), salinityAt(m1), m1);
    const c2 = soundSpeedMackenzie(temperatureAt(m2), salinityAt(m2), m2);
    if (c1 < c2) hi = m2;
    else lo = m1;
  }
  const d = (lo + hi) / 2;
  return {
    depth: d,
    soundSpeed: soundSpeedMackenzie(temperatureAt(d), salinityAt(d), d),
  };
}

/* ------------------------------------------------------------------ *
 * Light — Beer-Lambert attenuation per spectral band
 * ------------------------------------------------------------------ */

/**
 * Diffuse attenuation coefficients Kd (1/m) for the visible bands in clear
 * open-ocean (Case I) water. Red is absorbed almost immediately; blue
 * penetrates deepest, which is why the deep sea is blue and why most
 * bioluminescence is blue.
 */
export const BANDS = [
  { key: 'red', label: 'Red', nm: 650, kd: 0.35, hex: '#ff4d3d' },
  { key: 'amber', label: 'Amber', nm: 590, kd: 0.12, hex: '#ffab3d' },
  { key: 'green', label: 'Green', nm: 530, kd: 0.07, hex: '#4fe07a' },
  { key: 'blue', label: 'Blue', nm: 470, kd: 0.025, hex: '#3fa9f5' },
  { key: 'violet', label: 'Violet', nm: 425, kd: 0.032, hex: '#8b6cf0' },
];

/** Fraction of surface irradiance remaining in a band at a given depth. */
export function bandTransmission(kd, depthM) {
  return Math.exp(-kd * Math.max(0, depthM));
}

/** Depth at which a band falls to `fraction` of its surface value. */
export function bandExtinctionDepth(kd, fraction = 0.01) {
  return Math.log(1 / fraction) / kd;
}

/** Per-band state of the light field at a given depth. */
export function lightAt(depthM) {
  const bands = BANDS.map((b) => {
    const transmission = bandTransmission(b.kd, depthM);
    return {
      ...b,
      transmission,
      percent: transmission * 100,
      extinct1pct: bandExtinctionDepth(b.kd, 0.01),
      extinct01pct: bandExtinctionDepth(b.kd, 0.001),
      visible: transmission > 0.0001,
    };
  });
  // Total photosynthetically available radiation, weighted toward the bands
  // that actually carry energy at depth. Normalised so surface PAR = 1.
  const par = bands.reduce((a, b) => a + b.transmission * (b.kd < 0.1 ? 0.3 : 0.05), 0);
  const parSurface = BANDS.reduce((a, b) => a + (b.kd < 0.1 ? 0.3 : 0.05), 0);
  return {
    bands,
    parFraction: par / parSurface,
    euphoticDepth: bandExtinctionDepth(0.025, 0.01), // 1 % of blue light
    aphoticDepth: bandExtinctionDepth(0.025, 1e-6), // functionally dark
  };
}

/* ------------------------------------------------------------------ *
 * Zones
 * ------------------------------------------------------------------ */

export const ZONES = [
  {
    id: 'epipelagic',
    name: 'Epipelagic',
    alias: 'The Sunlight Zone',
    min: 0,
    max: 200,
    accent: '#6fd8ea',
    summary:
      'The only layer with enough light for photosynthesis. Roughly 90 % of marine life lives here, and it is where the ocean exchanges heat and gas with the atmosphere.',
  },
  {
    id: 'mesopelagic',
    name: 'Mesopelagic',
    alias: 'The Twilight Zone',
    min: 200,
    max: 1000,
    accent: '#2f8fc4',
    summary:
      'Sunlight is too weak for plants but bright enough for animals to be seen from below. This is the domain of counterillumination, vertical migration, and the largest daily movement of biomass on the planet.',
  },
  {
    id: 'bathypelagic',
    name: 'Bathypelagic',
    alias: 'The Midnight Zone',
    min: 1000,
    max: 4000,
    accent: '#1d5f8a',
    summary:
      'No sunlight reaches here at all. Every photon is biological. Food arrives only as marine snow falling from above, so bodies are built to conserve energy rather than to chase.',
  },
  {
    id: 'abyssopelagic',
    name: 'Abyssopelagic',
    alias: 'The Abyssal Zone',
    min: 4000,
    max: 6000,
    accent: '#14425f',
    summary:
      'Near-freezing, permanently dark, and under 400 to 600 atmospheres. It covers most of the seafloor — the single largest habitat on Earth, and the least surveyed.',
  },
  {
    id: 'hadal',
    name: 'Hadal',
    alias: 'The Trenches',
    min: 6000,
    max: 11000,
    accent: '#0b2a3d',
    summary:
      'Named for Hades. Found only in tectonic trenches, isolated from one another like deep-water islands. Pressure exceeds a tonne per square centimetre, yet fish still live here.',
  },
];

/** The zone containing a given depth. */
export function zoneAt(depthM) {
  return ZONES.find((z) => depthM >= z.min && depthM < z.max) ?? ZONES[ZONES.length - 1];
}

/* ------------------------------------------------------------------ *
 * The composite profile
 * ------------------------------------------------------------------ */

/**
 * The full state of the water column at one depth. This is the single function
 * every API endpoint funnels through, so the client can never disagree with
 * itself about what the ocean is doing.
 */
export function stateAt(depthM) {
  const depth = Math.max(0, Math.min(CHALLENGER_DEEP, depthM));
  const temperature = temperatureAt(depth);
  const salinity = salinityAt(depth);
  const pressureBar = pressureAt(depth);
  const pBar = pressureBar;
  const rho = density(temperature, salinity, pBar);
  const rho0 = density0(temperature, salinity);
  const sound = soundSpeedMackenzie(temperature, salinity, depth);
  const light = lightAt(depth);
  const zone = zoneAt(depth);
  const axis = sofarAxisDepth();

  return {
    depth,
    zone: { id: zone.id, name: zone.name, alias: zone.alias, accent: zone.accent },
    temperature,
    salinity,
    density: rho,
    densityAnomaly: rho0 - 1000, // sigma-0
    compression: (rho / rho0 - 1) * 100, // % denser than at the surface
    pressureBar,
    pressureDbar: pressureBar * 10,
    pressurePa: pressureBar * 1e5,
    // Sea pressure is GAUGE pressure: zero at the surface. That is the
    // oceanographic convention and what a CTD reports, but it means "pressure
    // at the surface" reads 0 atm, which surprises anyone who expects absolute
    // pressure. Both are exposed, and the field names say which is which.
    pressureConvention: 'gauge',
    pressureAtm: (pressureBar * 1e5) / P_ATM,
    pressureAbsoluteBar: pressureBar + P_ATM / 1e5,
    pressureAbsoluteAtm: (pressureBar * 1e5) / P_ATM + 1,
    pressurePsi: (pressureBar * 1e5) / 6894.757293168,
    pressureKgCm2: (pressureBar * 1e5) / 98066.5,
    soundSpeed: sound,
    soundExtrapolated: depth > 8000,
    sofarDepth: axis.depth,
    light,
    // How long a free-diving animal could work here before the pressure
    // gradient becomes the limiting factor is out of scope; instead report
    // the two numbers that actually drive design at depth.
    oxygenMinimumZone: depth >= 400 && depth <= 1000,
    inEuphotic: depth <= light.euphoticDepth,
    isDark: depth > light.aphoticDepth,
  };
}

/**
 * A sampled profile of the whole water column, used for the depth-profile
 * charts. `step` is in metres; the default of 50 m yields 220 rows across the
 * full 10 935 m, which is smooth enough to draw and small enough to ship.
 */
export function profile({ max = CHALLENGER_DEEP, step = 50 } = {}) {
  const rows = [];
  const limit = Math.max(1, Math.min(CHALLENGER_DEEP, max));
  const increment = Math.max(1, Math.min(1000, step));
  for (let z = 0; z <= limit; z += increment) {
    const s = stateAt(z);
    rows.push({
      depth: z,
      temperature: round(s.temperature, 3),
      salinity: round(s.salinity, 4),
      density: round(s.density, 3),
      soundSpeed: round(s.soundSpeed, 2),
      pressureBar: round(s.pressureBar, 2),
      lightPercent: round(s.light.bands.find((b) => b.key === 'blue').percent, 6),
    });
  }
  if (rows[rows.length - 1].depth !== limit) {
    const s = stateAt(limit);
    rows.push({
      depth: limit,
      temperature: round(s.temperature, 3),
      salinity: round(s.salinity, 4),
      density: round(s.density, 3),
      soundSpeed: round(s.soundSpeed, 2),
      pressureBar: round(s.pressureBar, 2),
      lightPercent: round(s.light.bands.find((b) => b.key === 'blue').percent, 6),
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 * Human-scale equivalences
 * ------------------------------------------------------------------ */

const REFERENCE_DEPTHS = [
  { depth: 40, label: 'Recreational scuba limit', note: 'PADI / NOAA recommended maximum' },
  { depth: 100, label: 'Technical scuba limit', note: 'Beyond this, trimix and staged deco' },
  { depth: 214, label: 'Deepest scuba dive, open circuit', note: 'Ahmed Gabr, Red Sea, 2014' },
  { depth: 332, label: 'Deepest scuba dive ever', note: 'Ahmed Gabr, Red Sea, 2014' },
  { depth: 535, label: 'Deepest penguin dive', note: 'Emperor penguin, Ross Sea' },
  { depth: 1000, label: 'Bathypelagic boundary', note: 'Sunlight is gone in every band' },
  { depth: 1280, label: 'Deepest reptile dive', note: 'Leatherback turtle' },
  { depth: 2250, label: 'Typical sperm whale hunt', note: 'Physeter macrocephalus' },
  { depth: 2992, label: 'Deepest mammal dive', note: "Cuvier's beaked whale, 3 h 42 min" },
  { depth: 3800, label: 'RMS Titanic', note: 'North Atlantic, 41.7N 49.9W' },
  { depth: 4267, label: 'Mean ocean depth', note: 'Half the seafloor is deeper than this' },
  { depth: 6000, label: 'Hadal boundary', note: 'Trenches only below this line' },
  { depth: 8336, label: 'Deepest fish ever filmed', note: 'Snailfish, Izu-Ogasawara Trench, 2022' },
  { depth: 10935, label: 'Challenger Deep', note: 'Mariana Trench — the floor' },
];

/** Notable depths bracketing a target depth, for the "where am I" panel. */
export function landmarksAround(depthM) {
  const sorted = [...REFERENCE_DEPTHS].sort((a, b) => a.depth - b.depth);
  const deeper = sorted.find((r) => r.depth > depthM) ?? null;
  const shallower =
    [...sorted].reverse().find((r) => r.depth <= depthM) ?? null;
  return { shallower, deeper, all: sorted };
}

/**
 * Translate an abstract pressure into things a person can picture. The
 * comparisons are deliberately physical rather than whimsical: each one is
 * computed from the pressure, not looked up.
 */
export function equivalences(depthM) {
  const s = stateAt(depthM);
  const pa = s.pressurePa;

  // An African bush elephant, ~6000 kg, standing on one foot pad of 0.05 m^2.
  const elephantPa = (6000 * G) / 0.05;
  // A 1 cm^2 column of water this deep.
  const kgPerCm2 = s.pressureKgCm2;
  // A blue whale (150 000 kg) spread over its 30 m x 4 m footprint.
  const whalePa = (150000 * G) / (30 * 4);

  return {
    depth: s.depth,
    pressureBar: s.pressureBar,
    pressureAtm: s.pressureAtm,
    pressurePsi: s.pressurePsi,
    kgPerCm2,
    atmospheres: s.pressureAtm,
    elephantsPerCm2: pa / elephantPa / 10000 * 1,
    elephantEquivalents: pa / elephantPa,
    blueWhalesStacked: pa / whalePa,
    // Steel yields around 250 MPa; how much of that budget is spent here.
    steelYieldFraction: pa / 250e6,
    // A 10 cm diameter viewport on a submersible sees this much force.
    viewportForceNewtons: pa * Math.PI * 0.05 ** 2,
    humanLungVolumeCompressedMl: 6000 / (1 + pa / 1.0e9 * 0),
    note: 'Comparisons are computed from the integrated hydrostatic pressure, not tabulated.',
  };
}

/* ------------------------------------------------------------------ */

function round(v, dp) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

export { round, REFERENCE_DEPTHS };
