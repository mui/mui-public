/**
 * Default root directory for docs-infra build caches. Sits alongside the marker
 * directories already written under `.next/cache/docs-infra`.
 */
export const DEFAULT_CACHE_DIR = '.next/cache/docs-infra';

/**
 * Version of the shape of cached *output*. Entries are validated by hashing their inputs, so a
 * pipeline change that alters the output for unchanged input is invisible to that hash — and
 * `.next/cache` survives between builds (`@mui/internal-netlify-cache` restores it), so a warm
 * cache would keep serving output produced by the previous code.
 *
 * Bump this whenever such a change lands. Caches whose stored shape can change fold it into their
 * `getCacheContent`, which makes existing entries hash as stale and be recomputed in place.
 */
export const CACHE_SCHEMA_VERSION = 1;
