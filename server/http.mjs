/**
 * http.mjs — the transport layer.
 *
 * Deliberately hand-rolled on `node:http` rather than pulled from a framework.
 * The pieces a framework would supply are small enough to own outright, and
 * owning them means the static handler can do conditional requests, gzip and
 * path-traversal defence exactly the way this application needs them.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

/* ------------------------------------------------------------------ *
 * MIME
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json|javascript)|image\/svg)/;

export function mimeFor(path) {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/* ------------------------------------------------------------------ *
 * Responses
 * ------------------------------------------------------------------ */

export function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function sendError(res, status, message, extra = {}) {
  sendJson(res, status, { error: { status, message, ...extra } });
}

export function sendText(res, status, text, headers = {}) {
  const body = Buffer.from(text);
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    ...headers,
  });
  res.end(body);
}

/* ------------------------------------------------------------------ *
 * Body parsing
 * ------------------------------------------------------------------ */

const MAX_BODY = 64 * 1024; // 64 KiB is generous for this API's payloads

export async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const err = new Error('Request body too large');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('Request body is not valid JSON');
    err.status = 400;
    throw err;
  }
}

/* ------------------------------------------------------------------ *
 * Static files
 * ------------------------------------------------------------------ */

/**
 * Serve a file from `root`, with ETag/Last-Modified conditional requests and
 * gzip for text-ish content.
 *
 * `urlPath` is attacker-controlled, so it is normalised and then verified to
 * still resolve inside `root` before anything is opened. A request for
 * `/../../server/db.mjs` normalises to something outside the root and is
 * rejected rather than served.
 */
export async function serveStatic(req, res, root, urlPath, { spa = false } = {}) {
  const decoded = safeDecode(urlPath);
  if (decoded === null) return sendError(res, 400, 'Malformed URL encoding');

  let relative = normalize(decoded).replace(/^([/\\])+/, '');
  if (relative === '' || relative === '.') relative = 'index.html';

  let filePath = join(root, relative);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (filePath !== root && !filePath.startsWith(rootWithSep)) {
    return sendError(res, 403, 'Forbidden');
  }

  let info = await statOrNull(filePath);

  // Directory request -> its index.html
  if (info?.isDirectory()) {
    filePath = join(filePath, 'index.html');
    info = await statOrNull(filePath);
  }

  // Single-page fallback for extensionless paths.
  if (!info && spa && !extname(relative)) {
    filePath = join(root, 'index.html');
    info = await statOrNull(filePath);
  }

  if (!info || !info.isFile()) {
    return sendError(res, 404, `Not found: ${urlPath}`);
  }

  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  const lastModified = new Date(info.mtimeMs).toUTCString();
  const type = mimeFor(filePath);

  const headers = {
    'Content-Type': type,
    ETag: etag,
    'Last-Modified': lastModified,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };

  // Conditional request: the client already has this exact version.
  const inm = req.headers['if-none-match'];
  const ims = req.headers['if-modified-since'];
  if (
    (inm && inm.split(',').map((s) => s.trim()).includes(etag)) ||
    (!inm && ims && new Date(ims).getTime() >= Math.floor(info.mtimeMs / 1000) * 1000)
  ) {
    res.writeHead(304, { ETag: etag, 'Last-Modified': lastModified, 'Cache-Control': 'no-cache' });
    return res.end();
  }

  // HEAD gets the headers and nothing else.
  if (req.method === 'HEAD') {
    res.writeHead(200, { ...headers, 'Content-Length': info.size });
    return res.end();
  }

  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');

  // Small text assets are cheap to compress in memory on every request, and
  // doing so keeps the server stateless. Large files are streamed as-is.
  if (acceptsGzip && COMPRESSIBLE.test(type) && info.size < 512 * 1024) {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(filePath);
    const gz = gzipSync(raw, { level: 6 });
    res.writeHead(200, {
      ...headers,
      'Content-Encoding': 'gzip',
      'Content-Length': gz.length,
      Vary: 'Accept-Encoding',
    });
    return res.end(gz);
  }

  res.writeHead(200, { ...headers, 'Content-Length': info.size });
  createReadStream(filePath).pipe(res);
}

async function statOrNull(p) {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */

/**
 * A tiny pattern router. Patterns use `:name` segments, which are captured and
 * handed to the handler as `ctx.params`. Matching is exact on segment count, so
 * `/api/species` and `/api/species/foo/bar` never collide.
 */
export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const segments = pattern.split('/').filter(Boolean);
    routes.push({ method, segments, handler, pattern });
  }

  const router = {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    delete: (p, h) => add('DELETE', p, h),
    match(method, pathname) {
      const parts = pathname.split('/').filter(Boolean);
      let pathMatched = false;
      for (const route of routes) {
        if (route.segments.length !== parts.length) continue;
        const params = {};
        let ok = true;
        for (let i = 0; i < parts.length; i++) {
          const seg = route.segments[i];
          if (seg.startsWith(':')) params[seg.slice(1)] = safeDecode(parts[i]) ?? parts[i];
          else if (seg !== parts[i]) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        pathMatched = true;
        if (route.method === method) return { handler: route.handler, params };
      }
      return pathMatched
        ? { handler: null, params: {}, methodMismatch: true }
        : null;
    },
    get routes() {
      return routes.map((r) => `${r.method} ${r.pattern}`);
    },
  };

  return router;
}

/* ------------------------------------------------------------------ *
 * Server-Sent Events
 * ------------------------------------------------------------------ */

/**
 * Open an SSE stream and return a handle for writing frames to it.
 *
 * A comment line is sent immediately so that intermediaries do not buffer the
 * response, and a heartbeat keeps the connection alive through proxies that
 * would otherwise close an idle socket.
 */
export function openEventStream(req, res, { heartbeatMs = 15000 } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': abyss telemetry stream open\n\n');

  let closed = false;
  const heartbeat = setInterval(() => {
    if (!closed) res.write(`: heartbeat ${Date.now()}\n\n`);
  }, heartbeatMs);
  heartbeat.unref?.();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);

  return {
    send(event, data) {
      if (closed) return false;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    },
    comment(text) {
      if (closed) return false;
      res.write(`: ${text}\n\n`);
      return true;
    },
    close() {
      cleanup();
      res.end();
    },
    get closed() {
      return closed;
    },
  };
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

export function etagOf(value) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

export function clientIp(req) {
  return req.socket?.remoteAddress ?? 'unknown';
}
