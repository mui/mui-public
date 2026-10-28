import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadFileCacheEntry } from './loadFileCacheEntry';
import { saveFileCache } from './saveFileCache';
import { hashCacheContent } from './hashCacheContent';

const TEST_DIR = join(__dirname, '.test-loadFileCacheEntry');

describe('loadFileCacheEntry', () => {
  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('returns null when the cache file does not exist', async () => {
    expect(
      await loadFileCacheEntry({
        cacheDir: TEST_DIR,
        namespace: 'pages-index',
        cacheKey: 'missing',
      }),
    ).toBeNull();
  });

  it('returns the raw { hash, data } entry without validating content', async () => {
    const ref = { cacheDir: TEST_DIR, namespace: 'pages-index', cacheKey: 'components' };
    await saveFileCache(ref, '# Components\n', { title: 'Components' });

    // No content is passed, so the entry is returned regardless of any hash match.
    expect(await loadFileCacheEntry(ref)).toEqual({
      hash: hashCacheContent('# Components\n'),
      data: { title: 'Components' },
    });
  });

  it('returns null for a corrupt cache file', async () => {
    const ref = { cacheDir: TEST_DIR, namespace: 'pages-index', cacheKey: 'broken' };
    await mkdir(join(TEST_DIR, 'pages-index'), { recursive: true });
    await writeFile(join(TEST_DIR, 'pages-index', 'broken.json'), '{ not json', 'utf-8');

    expect(await loadFileCacheEntry(ref)).toBeNull();
  });
});
