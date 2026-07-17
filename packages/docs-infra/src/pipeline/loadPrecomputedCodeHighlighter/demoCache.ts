import { createHash } from 'node:crypto';
// eslint-disable-next-line n/prefer-node-protocol
import { readFile } from 'fs/promises';
// eslint-disable-next-line n/prefer-node-protocol
import { fileURLToPath } from 'url';
import * as path from 'path-module';

/** Cache namespace for the precomputed demo output (the loader's emitted source). */
export const DEMO_PRECOMPUTE_CACHE_NAMESPACE = 'demo-precompute';

/**
 * Bumped whenever the precompute output shape changes. Part of the hash content so an
 * upgraded docs-infra can never serve an entry written by an older, incompatible version.
 */
const DEMO_CACHE_VERSION = 1;

/** What the loader emits, plus the watch list needed to re-register deps on a cache hit. */
export interface DemoCacheData {
  /** The transformed module source the loader passes to `callback`. */
  output: string;
  /** Every file the precompute read, as file:// URLs or fs paths (webpack's watch list). */
  dependencies: string[];
}

export function resolveDemoCacheKey(resourcePath: string, rootContext: string): string {
  const relative = path.relative(rootContext, resourcePath);
  // Key on the full relative path (minus extension) so sibling demos never collide.
  return relative.replace(/\.[^./\\]+$/, '').replace(/\\/g, '/');
}

function toFsPath(dep: string): string {
  return dep.startsWith('file://') ? fileURLToPath(dep) : dep;
}

/**
 * Hashes each dependency's bytes individually rather than concatenating their contents, so the
 * hash input stays small (a demo can pull in megabytes of source) and binary assets hash safely.
 *
 * Rejects if any dependency is unreadable — a deleted file must invalidate the entry, so the
 * caller treats a rejection as a miss rather than serving output derived from a file that is gone.
 */
export async function buildDemoCacheContent(
  source: string,
  optionsSignature: unknown,
  dependencies: string[],
): Promise<string> {
  const sorted = [...new Set(dependencies.map(toFsPath))].sort();
  const hashed = await Promise.all(
    sorted.map(async (dep) => {
      const bytes = await readFile(dep);
      return [dep, createHash('sha256').update(bytes).digest('hex')] as const;
    }),
  );

  return JSON.stringify({
    version: DEMO_CACHE_VERSION,
    source,
    options: optionsSignature,
    dependencies: hashed,
  });
}
