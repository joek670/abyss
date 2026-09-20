/**
 * api.js — the client's only door to the server.
 *
 * Every call goes through `request()`, which centralises error shaping and
 * gives the UI one error type to render. Responses are memoised in a small
 * Map keyed by URL so that navigating back to a page does not re-fetch a
 * profile that cannot have changed.
 */

const cache = new Map();
const inflight = new Map();

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, { method = 'GET', body, signal, cacheMs = 0 } = {}) {
  const key = `${method} ${path}`;

  if (cacheMs > 0) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < cacheMs) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
  }

  const promise = (async () => {
    let res;
    try {
      res = await fetch(path, {
        method,
        signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new ApiError('Cannot reach the server. Is it still running?', 0, null);
    }

    const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
    const payload = isJson ? await res.json().catch(() => null) : await res.text();

    if (!res.ok) {
      const message =
        (payload && typeof payload === 'object' && payload.error?.message) ||
        (typeof payload === 'string' && payload) ||
        `Request failed with status ${res.status}`;
      throw new ApiError(message, res.status, payload);
    }

    if (cacheMs > 0) cache.set(key, { at: Date.now(), value: payload });
    return payload;
  })();

  if (cacheMs > 0) {
    inflight.set(key, promise);
    promise.finally(() => inflight.delete(key)).catch(() => {});
  }
  return promise;
}

/* ------------------------------------------------------------------ *
 * Catalogue
 * ------------------------------------------------------------------ */

export const api = {
  health: () => request('/api/health', { cacheMs: 10_000 }),

  catalogue: () => request('/api/catalogue', { cacheMs: 300_000 }),

  zones: () => request('/api/zones', { cacheMs: 300_000 }),

  species: (params = {}, opts = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const q = qs.toString();
    return request(`/api/species${q ? '?' + q : ''}`, { ...opts, cacheMs: opts.cacheMs ?? 30_000 });
  },

  speciesOne: (slug) => request(`/api/species/${encodeURIComponent(slug)}`, { cacheMs: 300_000 }),

  /* ── Ocean model ──────────────────────────────────────────────── */

  oceanAt: (depth, opts = {}) =>
    request(`/api/ocean/at?depth=${encodeURIComponent(depth)}`, { cacheMs: 300_000, ...opts }),

  profile: (max = 10935, step = 50) =>
    request(`/api/ocean/profile?max=${max}&step=${step}`, { cacheMs: 3_600_000 }),

  equivalences: (depth) =>
    request(`/api/ocean/equivalences?depth=${encodeURIComponent(depth)}`, { cacheMs: 300_000 }),

  landmarks: (depth) =>
    request(`/api/ocean/landmarks?depth=${encodeURIComponent(depth)}`, { cacheMs: 300_000 }),

  /* ── Dive log ─────────────────────────────────────────────────── */

  dives: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    }
    const q = qs.toString();
    return request(`/api/dives${q ? '?' + q : ''}`);
  },

  createDive: (dive) => {
    invalidate('/api/dives');
    invalidate('/api/stats');
    return request('/api/dives', { method: 'POST', body: dive });
  },

  deleteDive: (id) => {
    invalidate('/api/dives');
    invalidate('/api/stats');
    return request(`/api/dives/${id}`, { method: 'DELETE' });
  },

  clearDives: () => {
    invalidate('/api/dives');
    invalidate('/api/stats');
    return request('/api/dives/clear', { method: 'POST' });
  },

  stats: () => request('/api/stats'),
};

/** Drop every cached response whose key contains `fragment`. */
export function invalidate(fragment) {
  for (const key of cache.keys()) {
    if (key.includes(fragment)) cache.delete(key);
  }
}

/**
 * Subscribe to the live dive telemetry stream.
 *
 * EventSource is used directly rather than wrapped in a promise: this is a
 * long-lived stream, not a request. Returns a handle with `close()`.
 */
export function streamDive({ depth, craft, duration = 30, timeScale = 240, onOpen, onTelemetry, onComplete, onError }) {
  const qs = new URLSearchParams({
    depth: String(depth),
    duration: String(duration),
    timeScale: String(timeScale),
  });
  if (craft) qs.set('craft', craft);

  const es = new EventSource(`/api/dive/stream?${qs}`);

  es.addEventListener('open', (e) => onOpen?.(JSON.parse(e.data)));
  es.addEventListener('telemetry', (e) => onTelemetry?.(JSON.parse(e.data)));
  es.addEventListener('complete', (e) => {
    onComplete?.(JSON.parse(e.data));
    es.close();
  });
  es.addEventListener('error', (e) => {
    // EventSource reports a normal close as an error too; only surface a real
    // failure (readyState CLOSED without a prior complete event).
    if (es.readyState === EventSource.CLOSED) onError?.(new ApiError('Telemetry stream closed', 0, null));
  });

  return {
    close: () => es.close(),
    get readyState() {
      return es.readyState;
    },
  };
}
