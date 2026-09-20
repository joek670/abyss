/**
 * serve-static.mjs — preview dist/ with NO backend.
 *
 * This exists to prove the static build stands alone. It serves only files: no
 * /api routes, no database, no SSE. If the site renders correctly behind this,
 * it will render on GitHub Pages, and any accidental dependency on the server
 * shows up immediately as a failed fetch rather than as a surprise after
 * deploying.
 *
 * It reuses the real static handler from server/http.mjs, so gzip, ETag and the
 * path-traversal guard are the same code the application server uses.
 *
 *   node scripts/serve-static.mjs [dir] [--port=8899]
 */
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '../server/http.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith('--port='));
const PORT = Number(portArg ? portArg.slice(7) : process.env.PORT ?? 8899);
const dirArg = args.find((a) => !a.startsWith('--'));
const DIR = join(ROOT, dirArg ?? 'dist');

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  /*
   * Anything under /api is a hard 404.
   *
   * Not a nicety — without this the SPA fallback answers /api/health with
   * index.html and a 200, which makes "there is no backend" impossible to test
   * and would hide a real API dependency behind a page of HTML. GitHub Pages
   * behaves the same way: unknown paths 404.
   */
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — this is a static build; there is no API.\n');
    return;
  }

  await serveStatic(req, res, DIR, url.pathname, { spa: true });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ABYSS static preview (no backend)`);
  console.log(`  serving   ${DIR}`);
  console.log(`  at        http://127.0.0.1:${PORT}\n`);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));