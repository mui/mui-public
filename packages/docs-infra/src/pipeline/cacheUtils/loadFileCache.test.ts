import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadFileCache } from './loadFileCache';
import { saveFileCache } from './saveFileCache';

const TEST_DIR = join(__dirname, '.test-loadFileCache');

describe('loadFileCache', () => {
  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('returns null when the cache file does not exist', async () => {
    const result = await loadFileCache(
      { cacheDir: TEST_DIR, namespace: 'pages-index', cacheKey: 'missing' },
      'content',
    );
    expect(result).toBeNull();
  });

  it('returns the cached data when the hash matches the content', async () => {
    const ref = { cacheDir: TEST_DIR, namespace: 'pages-index', cacheKey: 'components' };
    const content = '# Components\n';
    await saveFileCache(ref, content, { title: 'Components' });

    expect(await loadFileCache(ref, content)).toEqual({ title: 'Components' });
  });

  it('returns null when the content no longer matches the stored hash', async () => {
    const ref = { cacheDir: TEST_DIR, namespace: 'pages-index', cacheKey: 'components' };
    await saveFileCache(ref, '# Components\n', { title: 'Components' });

    expect(await loadFileCache(ref, '# Components changed\n')).toBeNull();
  });

  it('returns null for a corrupt cache file', async () => {
    const ref = { cacheDir: TEST_DIR, namespace: 'pages-index', cacheKey: 'broken' };
    await mkdir(join(TEST_DIR, 'pages-index'), { recursive: true });
    await writeFile(join(TEST_DIR, 'pages-index', 'broken.json'), '{ not json', 'utf-8');

    expect(await loadFileCache(ref, 'anything')).toBeNull();
  });

  it('reads nested cache keys', async () => {
    const ref = { cacheDir: TEST_DIR, namespace: 'pages-index', cacheKey: 'utilities/parsing' };
    const content = '# Parsing\n';
    await saveFileCache(ref, content, { title: 'Utilities Parsing' });

    expect(await loadFileCache(ref, content)).toEqual({ title: 'Utilities Parsing' });
  });
});
