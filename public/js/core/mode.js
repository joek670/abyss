/**
 * mode.js — which runtime is this?
 *
 * false  the Node server is present and answers /api/*. This is what the repo
 *        ships, and what `npm start` serves.
 * true   there is no server. The browser computes the physics from the shared
 *        module, filters the catalogue from data/species.json, keeps the dive
 *        log in localStorage and simulates dive telemetry locally.
 *
 * scripts/build-static.mjs OVERWRITES this file in dist/ with `true`. Keeping
 * the flag explicit rather than sniffing for the API at runtime means the two
 * modes are distinguishable in the source, and a failure is a clear error
 * instead of a silent fallback that half-works.
 */
export const STATIC_MODE = false;
export const BUILT_AT = null;