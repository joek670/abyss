/**
 * about.js — the method page.
 *
 * A model is only trustworthy if it says where it came from and where it
 * stops working. This page states the equations, cites them, and lists the
 * three things about this implementation that are approximations rather than
 * published results.
 */
import { h } from '../core/dom.js';

export const aboutView = {
  title: () => 'Method',

  async render() {
    const page = h('div.page');

    page.append(
      h(
        'header',
        { style: { marginBottom: 'var(--s-6)' } },
        h('span.eyebrow', null, 'Method'),
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
          'Where the numbers come from',
        ),
        h(
          'p.lede',
          { style: { marginTop: 'var(--s-3)' } },
          'Every reading on this site is computed on the server from the equations below. ' +
            'Nothing is a lookup table and nothing is hard-coded in the browser. The ' +
            'validation harness that checks this engine against published reference values ' +
            'runs with a single command.',
        ),
      ),
    );

    const prose = h('div.prose');

    /* ── Density ────────────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'Density — UNESCO EOS-80'),
      h(
        'p',
        null,
        'Seawater density is not a constant. It depends on temperature, salinity ' +
          'and — critically at depth — on pressure, because water is compressible. ABYSS ' +
          'implements the full ',
        h('strong', null, 'UNESCO 1983 (EOS-80)'),
        ' equation of state, including the secant bulk modulus ',
        h('code', null, 'K(T, S, p)'),
        ', so a parcel at 10,000 m is correctly reported as about 4.6 % denser than the ' +
          'same parcel at the surface.',
      ),
      h(
        'div.equation',
        null,
        'rho(T, S, p) = rho0(T, S) / (1 - p / K(T, S, p))\n\n',
        h('em', null, '  rho0  one-atmosphere density (the sigma-0 polynomial)\n'),
        h('em', null, '  K     secant bulk modulus, in bar\n'),
        h('em', null, '  p     sea pressure, in bar\n'),
      ),
    );

    /* ── Pressure ───────────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'Pressure — numerical hydrostatic integration'),
      h(
        'p',
        null,
        'Pressure is obtained by integrating the hydrostatic equation in one-metre ' +
          'steps, evaluating the equation of state at each step. The usual rule of thumb ' +
          'that "one metre of depth is one decibar" is only true near the surface; it ' +
          'underestimates pressure by roughly 3 % at full ocean depth because it ignores ' +
          'compressibility.',
      ),
      h(
        'div.equation',
        null,
        'p(z) = integral of rho(T(z), S(z), p(z)) * g dz\n\n',
        h('em', null, '  g = 9.80665 m/s^2 (standard gravity, ISO 80000-3)\n'),
      ),
      h(
        'p',
        null,
        'This produces ',
        h('strong', null, '1,128 bar'),
        ' at 10,935 m. The figure of 1,086 bar that circulates widely for Challenger Deep ' +
          'is ',
        h('em', null, 'below the hydrostatic floor'),
        ' — the gradient is ρg⁄10⁴ dbar per metre, and even for the lightest ' +
          'seawater under equatorial gravity that is above 1.0 dbar per metre, so ' +
          'pressure at that depth must exceed 1,094 bar. That widely ' +
          'quoted number descends from a 1960 estimate at a shallower sounding and is ' +
          'physically impossible. The validation harness asserts the floor explicitly.',
      ),
    );

    /* ── Sound ──────────────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'Sound speed — Mackenzie (1981)'),
      h(
        'p',
        null,
        'Sound speed in seawater is a function of temperature, salinity and pressure. ' +
          'ABYSS uses Mackenzie\'s nine-term regression, which is accurate to about ' +
          '0.1 m/s over its stated range.',
      ),
      h(
        'div.equation',
        null,
        'c = 1448.96 + 4.591T - 5.304e-2 T^2 + 2.374e-4 T^3\n',
        '  + 1.340(S - 35) + 1.630e-2 D + 1.675e-7 D^2\n',
        '  - 1.025e-2 T(S - 35) - 7.139e-13 T D^3\n\n',
        h('em', null, '  T  temperature (C),  -2 to 30\n'),
        h('em', null, '  S  salinity (PSU),   25 to 40\n'),
        h('em', null, '  D  depth (m),         0 to 8000\n'),
      ),
      h(
        'p',
        null,
        'The resulting profile has a minimum — the ',
        h('strong', null, 'SOFAR channel'),
        ' — at roughly 900 m in this model. Sound entering that waveguide is refracted ' +
          'back toward the axis repeatedly and can travel across an ocean basin with very ' +
          'little loss. Above 8,000 m the depth terms are evaluated at their limit and the ' +
          'API flags the result as extrapolated.',
      ),
    );

    /* ── Light ──────────────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'Light — Beer–Lambert attenuation per band'),
      h(
        'p',
        null,
        'Light is attenuated exponentially with depth, and the attenuation coefficient ' +
          'depends strongly on wavelength. ABYSS applies Beer–Lambert separately to five ' +
          'spectral bands using diffuse attenuation coefficients for clear open-ocean ' +
          '(Case I) water.',
      ),
      h(
        'div.equation',
        null,
        'I(z) = I0 * exp(-Kd * z)\n\n',
        h('em', null, '  Kd(red 650nm)   = 0.35 /m   -> 1% at  13 m\n'),
        h('em', null, '  Kd(amber 590nm) = 0.12 /m   -> 1% at  38 m\n'),
        h('em', null, '  Kd(green 530nm) = 0.07 /m   -> 1% at  66 m\n'),
        h('em', null, '  Kd(blue 470nm)  = 0.025 /m  -> 1% at 184 m\n'),
        h('em', null, '  Kd(violet 425nm)= 0.032 /m  -> 1% at 144 m\n'),
      ),
      h(
        'p',
        null,
        'This is why the deep sea is blue, and why the overwhelming majority of ' +
          'bioluminescence is blue: it is the only colour that travels.',
      ),
    );

    /* ── Approximations ─────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'What is approximated, and why it matters'),
      h(
        'p',
        null,
        'Three parts of this model are not transcriptions of a published equation. ' +
          'They are stated here rather than buried, because a reader should know which ' +
          'numbers to trust absolutely and which to treat as representative.',
      ),
      h(
        'ul',
        null,
        h(
          'li',
          null,
          h('strong', null, 'Temperature and salinity. '),
          'These are empirical fits to a ',
          h('em', null, 'globally averaged'),
          ' open-ocean profile — a warm mixed layer, an exponential thermocline, a cold ' +
            'deep reservoir, and an adiabatic gradient that makes hadal water slightly ' +
            'warmer than abyssal water. They are representative of the open ocean, not a ' +
            'measurement at any particular station. Real profiles vary enormously: the ' +
            'surface is 30 °C in the tropics and −1.8 °C at the poles, and this model ' +
            'cannot show that.',
        ),
        h(
          'li',
          null,
          h('strong', null, 'Attenuation coefficients. '),
          'The five Kd values are for clear Case I water. Coastal, polar and turbid ' +
            'water attenuates far faster, and the euphotic depth can fall below 20 m.',
        ),
        h(
          'li',
          null,
          h('strong', null, 'The dive stream. '),
          'The descent is a kinematic simulation, not a vehicle model. Depth, pressure ' +
            'and temperature at each instant are computed from the real ocean model — only ' +
            'the ',
          h('em', null, 'timing'),
          ' is compressed, because a real descent to 10,000 m takes about five hours. ' +
            'The console labels the time-compression factor on every run.',
        ),
      ),
    );

    /* ── Validation ─────────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'Validation'),
      h(
        'p',
        null,
        'The engine is checked against published reference values on every run. ',
        h('code', null, 'npm run verify'),
        ' executes 41 assertions covering the EOS-80 worked examples, pure-water density ' +
          'maximum, compressibility at depth, hand-evaluated Mackenzie values, the SOFAR ' +
          'minimum, per-band extinction depths, and the physical invariants (monotonic ' +
          'pressure, no NaN anywhere in the profile, hadal water warmer than abyssal).',
      ),
    );

    /* ── Architecture ───────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'Architecture'),
      h(
        'p',
        null,
        'ABYSS is a zero-dependency full-stack application. There is no framework, no ' +
          'bundler, and no ',
        h('code', null, 'node_modules'),
        ' directory — the server runs on Node\'s built-in ',
        h('code', null, 'node:http'),
        ' and ',
        h('code', null, 'node:sqlite'),
        ', and the client is hand-written ES modules loaded directly by the browser.',
      ),
    );

    const layers = [
      ['Physics', ['EOS-80 equation of state', 'Mackenzie sound speed', 'Beer–Lambert light', 'Hydrostatic integration']],
      ['Persistence', ['node:sqlite (built in)', 'Numbered migrations', 'Reference-data re-sync', 'Dive log + frozen physics']],
      ['Transport', ['node:http router', 'REST + SSE', 'gzip, ETag, 304', 'Path-traversal defence']],
      ['Client', ['Hash router, no build', 'Canvas particles + charts', 'SVG specimen plates', 'Store-driven chrome']],
    ];

    prose.append(
      h(
        'div.arch',
        null,
        ...layers.map(([layer, items]) =>
          h(
            'div.arch__row',
            null,
            h('div.arch__layer', null, layer),
            h('div.arch__items', null, ...items.map((i) => h('span.chip', null, i))),
          ),
        ),
      ),
    );

    /* ── API ────────────────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'API'),
      h(
        'p',
        null,
        'The same endpoints the interface uses are open. ',
        h('a', { href: '/api/health' }, 'GET /api/health'),
        ' is a good place to start.',
      ),
    );

    const endpoints = [
      ['GET', '/api/catalogue', 'Zones, counts, depth limits'],
      ['GET', '/api/zones', 'The five depth zones'],
      ['GET', '/api/species', 'Search: q, zone, glow, sort, limit, offset'],
      ['GET', '/api/species/:slug', 'One specimen, plus conditions across its range'],
      ['GET', '/api/ocean/at?depth=', 'Full water-column state at a depth'],
      ['GET', '/api/ocean/profile', 'Sampled profile for charting'],
      ['GET', '/api/ocean/equivalences', 'Pressure translated into human terms'],
      ['GET', '/api/ocean/landmarks', 'Notable depths bracketing a target'],
      ['GET', '/api/dive/stream', 'SSE telemetry for a simulated descent'],
      ['GET', '/api/dives', 'The dive log'],
      ['POST', '/api/dives', 'Record a dive'],
      ['DELETE', '/api/dives/:id', 'Remove a dive'],
      ['GET', '/api/stats', 'Aggregate log and catalogue statistics'],
    ];

    prose.append(
      h(
        'div.panel',
        { style: { marginTop: 'var(--s-5)' } },
        h(
          'table.table',
          null,
          h('thead', null, h('tr', null, h('th', null, 'Method'), h('th', null, 'Path'), h('th', null, 'Purpose'))),
          h(
            'tbody',
            null,
            ...endpoints.map(([method, path, purpose]) =>
              h(
                'tr',
                null,
                h('td', null, h('span.badge', null, method)),
                h('td', null, h('code', null, path)),
                h('td.muted', null, purpose),
              ),
            ),
          ),
        ),
      ),
    );

    /* ── Sources ────────────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'Sources'),
      h(
        'ul',
        null,
        h(
          'li',
          null,
          'UNESCO (1983). ',
          h('em', null, 'Algorithms for computation of fundamental properties of seawater.'),
          ' UNESCO Technical Papers in Marine Science 44. (EOS-80 equation of state.)',
        ),
        h(
          'li',
          null,
          'Mackenzie, K. V. (1981). Nine-term equation for sound speed in the oceans. ',
          h('em', null, 'Journal of the Acoustical Society of America'),
          ' 70(3), 807–812.',
        ),
        h(
          'li',
          null,
          'Saunders, P. M. (1981). Practical conversion of pressure to depth. ',
          h('em', null, 'Journal of Physical Oceanography'),
          ' 11, 573–574.',
        ),
        h(
          'li',
          null,
          'Jerlov, N. G. (1976). ',
          h('em', null, 'Marine Optics.'),
          ' Elsevier. (Diffuse attenuation coefficients by water type.)',
        ),
        h(
          'li',
          null,
          'Jamieson, A. J. et al. (2010). Hadal trenches: the ecology of the deepest places ',
          'on Earth. ',
          h('em', null, 'Trends in Ecology & Evolution'),
          ' 25(3), 190–197.',
        ),
        h(
          'li',
          null,
          'Yancey, P. H. et al. (2014). Marine fish may be biochemically constrained from ',
          'inhabiting the deepest ocean depths. ',
          h('em', null, 'PNAS'),
          ' 111(12), 4461–4465. (TMAO and the ~8,200 m fish limit.)',
        ),
      ),
    );

    prose.append(
      h(
        'p',
        { style: { marginTop: 'var(--s-8)', color: 'var(--text-3)' } },
        h('span.mono', null, 'ABYSS v1.0 · 36 specimens · 5 zones · 10,935 m'),
      ),
    );

    page.append(prose);
    return page;
  },
};
