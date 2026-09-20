/**
 * post.js — the build write-up.
 *
 * A blog-post-shaped page rather than a README dump: what the thing is, the
 * parts that were interesting to build, and the mistakes that only showed up
 * once something actually ran. The Method page documents the physics; this
 * documents the engineering.
 */
import { h } from '../core/dom.js';
import { STATIC_MODE } from '../core/api.js';

export const postView = {
  title: () => 'How ABYSS was built',

  async render() {
    const page = h('div.page');
    const prose = h('div.prose');

    /* ── Masthead ─────────────────────────────────────────────────── */

    prose.append(
      h(
        'header',
        { style: { marginBottom: 'var(--s-7)' } },
        h('span.eyebrow', null, 'Build notes'),
        h(
          'h1',
          {
            style: {
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--t-4)',
              fontWeight: '400',
              letterSpacing: 'var(--tr-tight)',
              lineHeight: '1.1',
              marginTop: 'var(--s-2)',
              marginBottom: 'var(--s-4)',
            },
          },
          'An atlas that computes the ocean instead of describing it',
        ),
        h(
          'p.lede',
          null,
          'ABYSS is a deep-sea reference atlas — 36 species, five depth zones, a dive ' +
            'console — with no framework, no bundler, and no dependencies at all. Every ' +
            'pressure, temperature and light reading on it is computed from published ' +
            'oceanographic equations rather than looked up. This is what was interesting ' +
            'to build, and what went wrong on the way.',
        ),
        h(
          'div.row',
          { style: { marginTop: 'var(--s-4)', gap: 'var(--s-2)' } },
          h('span.chip', null, 'Zero dependencies'),
          h('span.chip', null, 'Node 24 · node:sqlite'),
          h('span.chip', null, STATIC_MODE ? 'Static build' : 'Full-stack'),
          h('span.chip', null, '182 tests'),
        ),
      ),
    );

    /* ── 1 ────────────────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'The numbers are the point'),
      h(
        'p',
        null,
        'Most "deep sea" web pages tell you the Mariana Trench is 11 kilometres down ' +
          'and 1,000 atmospheres of pressure. That second number is a claim, and this ' +
          'project treats it as one: the site computes pressure by integrating the ' +
          'hydrostatic equation in one-metre steps against the ',
        h('strong', null, 'UNESCO EOS-80'),
        ' equation of state, complete with the secant bulk modulus that makes seawater ' +
          'compressible.',
      ),
      h(
        'p',
        null,
        'Doing it properly rather than quoting a figure produced the single most ' +
          'interesting result in the build. The widely repeated value for Challenger ' +
          'Deep is ',
        h('strong', null, '1,086 bar'),
        '. The integration gives ',
        h('strong', null, '1,128 bar'),
        '. One of those is wrong, and it is not the one you would guess: with seawater ' +
          'denser than 1,000 kg/m³ the pressure gradient cannot fall below 1.0 dbar per ' +
          'metre, so 10,935 m cannot be under 1,093 bar. The familiar 1,086 figure is ',
        h('em', null, 'below the physical floor'),
        ' — it is not a different measurement, it is an impossible one, descended from ' +
          'a 1960 estimate at a shallower sounding. The test suite asserts that floor ' +
          'explicitly so the error cannot creep back in.',
      ),
      h(
        'p',
        null,
        'Sound speed uses ',
        h('strong', null, "Mackenzie's nine-term regression (1981)"),
        ', which produces a genuine minimum around 900 m — the ',
        h('strong', null, 'SOFAR channel'),
        ', a waveguide that carries sound across an ocean basin. Light is Beer–Lambert ' +
          'attenuation applied per spectral band, which is why the site can tell you red ' +
          'is gone by 13 metres and blue survives past 184.',
      ),
      h(
        'p',
        { style: { color: 'var(--text-2)' } },
        h('em', null, 'Temperature and salinity are empirically fitted to a global-mean ' +
          'profile rather than measured, and the Method page says so. A model that hides ' +
          'its approximations is worse than one that lists them.'),
      ),
    );

    /* ── 2 ────────────────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'No dependencies, and what that buys'),
      h(
        'p',
        null,
        'Node 22.5 ships ',
        h('code', null, 'node:sqlite'),
        '. That one fact removed the last reason to have a ',
        h('code', null, 'node_modules'),
        ' directory: persistence needs no native module, ',
        h('code', null, 'node:http'),
        ' plus a forty-line pattern router covers the API, and ES modules are native so ' +
          'the frontend needs no bundler.',
      ),
      h(
        'p',
        null,
        'The practical effects are larger than the aesthetic one. There is no install ' +
          'step, so the repository runs the moment it is cloned. There is no lockfile to ' +
          'audit and no supply chain to trust. And the whole application is small enough ' +
          'to read end to end in an afternoon.',
      ),
      h(
        'p',
        null,
        'It also made this page possible. Because the physics and the search ranking are ' +
          'pure ES modules with zero imports, they run ',
        h('strong', null, 'unchanged in a browser'),
        '. The static build copies the two files the server uses and nothing is ' +
          'reimplemented — so the hosted version does not merely resemble the served ' +
          'one, it computes identical numbers.',
      ),
    );

    /* ── 3 ────────────────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'Six bugs that passed a green syntax check'),
      h(
        'p',
        null,
        'Every one of these was syntactically valid, type-correct as far as anything ' +
          'could tell, and wrong. They are the argument for driving a real browser in ' +
          'tests rather than trusting that code which parses also runs.',
      ),
    );

    const bugs = [
      [
        'The page that rendered nothing',
        'A view returned its cleanup function instead of its DOM node. The router happily inserted a function into the document and the console page came up blank. Nothing threw.',
      ],
      [
        'Text in the DOM that never painted',
        'Gauge readouts were built with createElementNS in the SVG namespace. An SVG-namespaced <div> has no rendering box: the text was present, selectable in devtools, findable by every DOM assertion — and invisible. The gauge arcs were fine; only the numbers were missing, which made it look like a styling problem for far too long.',
      ],
      [
        'A needle rotating about the wrong point',
        'transform-origin: center in CSS composed with a rotate(a 50 50) already in the SVG attribute, applying the origin twice. The gauge needle swung outside its dial.',
      ],
      [
        'The scroll observer that never installed',
        'The router fired its "view ready" event without awaiting the async mount(). The descent page builds its zone markers after fetching data, so the observer ran against an empty container, found no markers, and silently did nothing.',
      ],
      [
        'Two features fighting over one attribute',
        'The console\'s depth preset chips carried data-depth. The shell\'s scroll observer selects [data-depth]. Merely rendering the console yanked the depth rail to 100 m.',
      ],
      [
        'Zero treated as absent',
        'Number(x) || 3800. A target depth of 0 — the surface, and a perfectly valid request — is falsy, so ?depth=0 silently rendered 3,800 m.',
      ],
    ];

    for (const [title, body] of bugs) {
      prose.append(h('h3', null, title), h('p', null, body));
    }

    /* ── 4 ────────────────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'Photographs, and the limits of automation'),
      h(
        'p',
        null,
        'The atlas began with hand-drawn SVG plates, because the machine it was built ' +
          'on had no image assets and no way to fetch any. Later, ',
        h('code', null, 'fetch-species-images.mjs'),
        ' pulled 35 freely-licensed photographs from Wikimedia Commons — and finding ' +
          'them was the easy half.',
      ),
      h(
        'p',
        null,
        'A Commons search returns anything that mentions the name. The first run matched ' +
          'the barreleye to a ',
        h('strong', null, 'postage stamp'),
        ' from Abkhazia, the colossal squid to a photograph of a ',
        h('strong', null, 'beak'),
        ', and the ocean sunfish to gulls eating a ',
        h('strong', null, 'corpse'),
        '. Rules now reject museum accession codes, DOIs, figure numbers, pre-2000 years ' +
          'and body parts.',
      ),
      h(
        'p',
        null,
        'Then two of those rules were themselves wrong, in opposite directions. Matching ' +
          'on word boundaries to stop ',
        h('code', null, 'geograph.org.uk'),
        ' tripping the word "graph" also let ',
        h('code', null, 'distmap.png'),
        ' through, because "dist" and "map" share no boundary. And the rule rejecting ',
        h('code', null, 'beak'),
        ' also rejected ',
        h('em', null, "Cuvier's Beaked Whale"),
        ' — the correct name of the very species being searched for. Both were caught by ' +
          'unit-testing the predicate against real filenames, which is the only reason ' +
          'either was noticed.',
      ),
      h(
        'p',
        null,
        'The honest conclusion is that filename heuristics cannot see. Four images ' +
          'passed every filter and were still wrong: a black-and-white ',
        h('em', null, 'line drawing'),
        ' for the dumbo octopus, a five-species ',
        h('em', null, 'labelled diagram'),
        ' for the lanternfish, and for the brittle star a photograph of a ',
        h('em', null, 'sponge on a lab tray'),
        ', with a ruler and a sample label, in which the animal is barely visible. They ' +
          'were fixed by looking at them and naming the exact file to use — a small pins ' +
          'file, checked into the repository, that turns "choose for me" into "use this".',
      ),
    );

    /* ── 5 ────────────────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'Being honest about licences'),
      h(
        'p',
        null,
        'Only CC0, public domain, CC BY and CC BY-SA images are accepted. Anything ' +
          'NonCommercial, NoDerivs or unstated is refused, and a file whose creator ' +
          'cannot be determined is ',
        h('strong', null, 'skipped rather than shipped'),
        ' — because CC BY and CC BY-SA make naming the creator a condition of use.',
      ),
      h(
        'p',
        null,
        'That constraint shaped the interface. Attribution is never hover-only: a hover ' +
          'credit is unreachable on touch, absent from print, and gone the moment someone ' +
          'screenshots the grid — which, for a reference atlas, is the normal case. Every ' +
          'card carries its photographer and licence inline; the detail page adds the ' +
          'licence deed and the source file.',
      ),
    );

    /* ── 6 ────────────────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'One codebase, two runtimes'),
      h(
        'p',
        null,
        'GitHub Pages serves files and cannot run a server, so this site exists in two ' +
          'forms from one source. ',
        h('code', null, 'npm start'),
        ' runs the full-stack version: SQLite for the dive log, server-computed physics, ' +
          'a Server-Sent Events stream for dive telemetry. ',
        h('code', null, 'npm run build:static'),
        ' emits a directory of files in which the browser does all four jobs itself.',
      ),
      h(
        'div.equation',
        null,
        'npm start              full stack   node server + SQLite + SSE\n',
        'npm run build:static   static       dist/, no backend at all\n',
        'npm run check          verify       physics + rules + end-to-end\n',
      ),
      h(
        'p',
        null,
        'The switch is a build-time constant rather than a runtime probe for the API. ' +
          'Sniffing would turn a misconfiguration into a page that half-works and falls ' +
          'back quietly; a wrong flag fails immediately and visibly, which is what you ' +
          'want from something you are about to publish.',
      ),
      h(
        'p',
        null,
        'You are reading the ',
        h('strong', null, STATIC_MODE ? 'static build' : 'full-stack server'),
        '. ',
        STATIC_MODE
          ? 'There is no backend behind this page: the numbers below you were computed in your browser, and the dive log is stored on this device alone.'
          : 'A Node server is running behind this page, so the dive log is shared and persisted in SQLite.',
      ),
    );

    /* ── Colophon ─────────────────────────────────────────────────── */

    prose.append(
      h('h2', null, 'What it costs, and what it does not do'),
      h(
        'p',
        null,
        'The whole site is under 10 MB, most of it photographs. It runs behind a ' +
          'restrictive Content-Security-Policy with no third-party origins, makes no ' +
          'outbound requests at runtime, and works with the network unplugged.',
      ),
      h(
        'p',
        null,
        'What it does not do: temperature and salinity are global-mean fits and cannot ' +
          'show a 30 °C tropical surface or a −1.8 °C polar one; the dive stream is a ' +
          'kinematic simulation, not a vehicle model, with only the timing compressed; ' +
          'and six of the 36 species have no freely-licensed photograph at all, so they ' +
          'keep their drawn plate. The Method page lists all of it.',
      ),
      h(
        'div.row',
        { style: { marginTop: 'var(--s-6)' } },
        h('a.btn.btn--primary', { href: '#/atlas' }, 'Open the atlas'),
        h('a.btn', { href: '#/console' }, 'Try the dive console'),
        h('a.btn.btn--ghost', { href: '#/about' }, 'Read the physics'),
      ),
    );

    page.append(prose);
    return page;
  },
};