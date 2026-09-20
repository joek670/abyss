/**
 * api.js — the client's only door to its data, in either runtime.
 *
 * Two implementations sit behind this facade and every view imports from here,
 * so no view knows or cares which one is live:
 *
 *   api-server.js   the Node backend answers /api/*  (npm start)
 *   api-static.js   the browser computes everything  (GitHub Pages)
 *
 * The switch is `STATIC_MODE`, written into core/mode.js by the build. It is a
 * build-time constant rather than a runtime probe on purpose: sniffing for the
 * API would turn a misconfiguration into a half-working page that silently
 * falls back, whereas a wrong flag fails immediately and visibly.
 *
 * Both implementations export the same names and the same payload shapes —
 * `npm test` asserts the shapes the static build produces against the server's.
 */
import { STATIC_MODE } from './mode.js';
import { api as serverApi, streamDive as serverStream, ApiError as ServerApiError } from './api-server.js';
import { api as staticApi, streamDive as staticStream, ApiError as StaticApiError } from './api-static.js';

export const ApiError = STATIC_MODE ? StaticApiError : ServerApiError;

export const api = STATIC_MODE ? staticApi : serverApi;

export function streamDive(opts) {
  return STATIC_MODE ? staticStream(opts) : serverStream(opts);
}

/** No-op in static mode: there is no response cache to clear. */
export function invalidate() {
  if (!STATIC_MODE) {
    // Imported lazily so the server module is not pulled in twice.
    return import('./api-server.js').then((m) => m.invalidate());
  }
  return undefined;
}

export { STATIC_MODE };