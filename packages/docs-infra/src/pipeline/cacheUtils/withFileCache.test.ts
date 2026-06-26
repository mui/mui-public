import { describe, it, expect, afterEach } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { withFileCache } from './withFileCache';
import { hashCacheContent } from './hashCacheContent';
import { resolveCachePath } from './resolveCachePath';
import { saveFileCache } from './saveFileCache';

const TEST_DIR = join(__dirname, '.test-withFileCache');
const ref = { cacheDir: TEST_DIR, namespace: 'ns', cacheKey: 'key' };

describe('withFileCache', () => {
  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('runs the processor and caches the result on a miss', async () => {
    let calls = 0;
    const result = await withFileCache({
      ref,
      readOrigin: () => 'origin',
      getCacheContent: (origin) => origin,
      processor: (origin) => {
        calls += 1;
        return { value: origin.toUpperCase() };
      },
    });

    expect(result).toEqual({ value: 'ORIGIN' });
    expect(calls).toBe(1);
    const raw = await readFile(resolveCachePath(ref), 'utf-8');
    expect(JSON.parse(raw)).toEqual({
      hash: hashCacheContent('origin'),
      data: { value: 'ORIGIN' },
    });
  });

  it('returns the cached result without running the processor on a hit', async () => {
    await saveFileCache(ref, 'origin', { value: 'CACHED' });
    let calls = 0;

    const result = await withFileCache({
      ref,
      readOrigin: () => 'origin',
      getCacheContent: (origin) => origin,
      processor: () => {
        calls += 1;
        return { value: 'FRESH' };
      },
    });

    expect(result).toEqual({ value: 'CACHED' });
    expect(calls).toBe(0);
  });

  it('re-runs the processor when the cache content no longer matches', async () => {
    await saveFileCache(ref, 'old', { value: 'CACHED' });

    const result = await withFileCache({
      ref,
      readOrigin: () => 'new',
      getCacheContent: (origin) => origin,
      processor: (origin) => ({ value: origin }),
    });

    expect(result).toEqual({ value: 'new' });
  });

  it('hashes the derived cache content, not the raw processor input', async () => {
    const result = await withFileCache({
      ref,
      readOrigin: () => ({ raw: 'payload', version: 2 }),
      getCacheContent: (origin) => `v${origin.version}`,
      processor: (origin) => ({ out: origin.raw }),
    });

    expect(result).toEqual({ out: 'payload' });
    const raw = await readFile(resolveCachePath(ref), 'utf-8');
    expect(JSON.parse(raw).hash).toBe(hashCacheContent('v2'));
  });

  it('bypasses the cache entirely when ref is undefined', async () => {
    let calls = 0;
    const result = await withFileCache({
      ref: undefined,
      readOrigin: () => 'x',
      getCacheContent: (origin) => origin,
      processor: () => {
        calls += 1;
        return 'y';
      },
    });

    expect(result).toBe('y');
    expect(calls).toBe(1);
    await expect(readFile(resolveCachePath(ref), 'utf-8')).rejects.toThrow();
  });
});
