import { createHash } from 'node:crypto';

/**
 * Computes the sha256 hex digest of cache source content. Used to validate that a
 * cached value still matches the file it was derived from.
 */
export function hashCacheContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
