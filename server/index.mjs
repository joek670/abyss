/**
 * index.mjs — ABYSS application server.
 *
 * One process, no dependencies. Boots the database, mounts the API, and serves
 * the static frontend from ./public. Requests under /api are routed; everything
 * else falls through to the file server.
 */
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, seed, DB_PATH } from './db.mjs';
import { buildRouter } from './api.mjs';
import { serveStatic, sendJson, sendError, readJson } from './http.mjs';
import { CHALLENGER_DEEP } from './ocean.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PUBLIC_DIR = join(ROOT, 'public');

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

/**
 * Canonical shared modules, exposed to the browser.
 * scripts/build-static.mjs copies the same two files into dist/ at these paths.
 */
const SHARED_MODULES = {
  '/js/lib/ocean.js': { root: join(ROOT, 'server'), rel: '/ocean.mjs' },
  '/js/lib/search.js': { root: join(ROOT, 'server', 'data'), rel: '/search.mjs' },
};

/* ── Boot ─────────────────────────────────────────────────────────── */

const db = openDatabase();
seed(db);
const router = buildRouter(db);

const startedAt = Date.now();

/* ── Request handling ─────────────────────────────────────────────── */

const server = createServer(async (req, res) => {
  const t0 = process.hrtime.bigint();

  // A single per-request identifier makes interleaved log lines readable.
  const rid = Math.random().toString(36).slice(2, 8);

  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? HOST}`);
    const pathname = url.pathname;

    // Baseline hardening. The app serves no third-party content and makes no
    // outbound requests, so the policy can be maximally restrictive.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'self'",
      ].join('; '),
    );

    /* API ---------------------------------------------------------- */

    if (pathname.startsWith('/api/')) {
      const match = router.match(req.method ?? 'GET', pathname);

      if (!match) {
        return sendError(res, 404, `No API route for ${req.method} ${pathname}`, {
          hint: 'See GET /api/health',
        });
      }
      if (!match.handler) {
        return sendError(res, 405, `${req.method} is not allowed on ${pathname}`);
      }

      const ctx = {
        req,
        res,
        params: match.params,
        query: url.searchParams,
        url,
        db,
        body: undefined,
      };

      // Only parse a body when the route is one that can carry one.
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        ctx.body = await readJson(req);
      }

      const result = match.handler(ctx);
      if (result && typeof result.then === 'function') await result;

      log(rid, req.method, pathname, res.statusCode, t0);
      return;
    }

    /* Static ------------------------------------------------------- */

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendError(res, 405, `${req.method} is not supported for static files`);
    }

    /*
     * Shared modules, served under a stable URL.
     *
     * The physics engine and the search ranking are pure ESM with no imports,
     * so the browser can run exactly the code the server runs. They live under
     * server/ because that is where they are authored; the static build copies
     * them to the same paths under dist/, so the client imports one URL that
     * resolves in BOTH modes.
     *
     * The alternative — a checked-in copy under public/ — is how a browser and
     * a server quietly start computing different numbers.
     */
    const shared = SHARED_MODULES[pathname];
    if (shared) {
      await serveStatic(req, res, shared.root, shared.rel);
      log(rid, req.method, pathname, res.statusCode, t0);
      return;
    }

    await serveStatic(req, res, PUBLIC_DIR, pathname, { spa: true });
    log(rid, req.method, pathname, res.statusCode, t0);
  } catch (err) {
    const status = err?.status ?? 500;
    if (status >= 500) {
      console.error(`[${rid}] ${req.method} ${req.url} -> ${status}\n`, err);
    } else {
      console.warn(`[${rid}] ${req.method} ${req.url} -> ${status}: ${err.message}`);
    }
    if (!res.headersSent) {
      sendError(res, status, err?.message ?? 'Internal server error');
    } else {
      res.end();
    }
  }
});

/* ── Diagnostics ──────────────────────────────────────────────────── */

// Node's default request timeout is 5 minutes, which would sever an SSE dive
// stream mid-descent. Streams are exempted; ordinary requests keep a sane cap.
server.requestTimeout = 0;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 65_000;

function log(rid, method, path, status, t0) {
  if (process.env.ABYSS_QUIET === '1') return;
  if (path.startsWith('/api/dive/stream')) return; // long-lived, logged on close
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const colour =
    status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : status >= 300 ? '\x1b[36m' : '\x1b[32m';
  console.log(
    `\x1b[90m${rid}\x1b[0m ${method.padEnd(6)} ${path.slice(0, 68).padEnd(68)} ` +
      `${colour}${status}\x1b[0m \x1b[90m${ms.toFixed(1)}ms\x1b[0m`,
  );
}

/* ── Lifecycle ────────────────────────────────────────────────────── */

server.listen(PORT, HOST, () => {
  const stats = db.prepare('SELECT COUNT(*) AS n FROM species').get();
  const dives = db.prepare('SELECT COUNT(*) AS n FROM dives').get();
  const url = `http://${HOST}:${PORT}`;

  console.log('');
  console.log('  \x1b[36m╭─────────────────────────────────────────────╮\x1b[0m');
  console.log('  \x1b[36m│\x1b[0m  \x1b[1mABYSS\x1b[0m — deep-sea exploration atlas       \x1b[36m│\x1b[0m');
  console.log('  \x1b[36m╰─────────────────────────────────────────────╯\x1b[0m');
  console.log('');
  console.log(`  listening   \x1b[1m${url}\x1b[0m`);
  console.log(`  database    ${DB_PATH}`);
  console.log(`  catalogue   ${stats.n} species · ${dives.n} logged dives`);
  console.log(`  deepest     ${CHALLENGER_DEEP} m · Challenger Deep`);
  console.log(`  node        ${process.version} (${process.platform}/${process.arch})`);
  console.log('');
  console.log('  \x1b[90mpress ctrl+c to stop\x1b[0m');
  console.log('');
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ${signal} received — closing ${server.connections ?? 0} connection(s)...`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    console.log(`  stopped cleanly after ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
    process.exit(0);
  });
  // Do not let an SSE stream hold the process open forever.
  setTimeout(() => process.exit(0), 4000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { server, db, router };
