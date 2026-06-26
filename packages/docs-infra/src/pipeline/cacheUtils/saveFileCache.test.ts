import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { saveFileCache } from './saveFileCache';
import { hashCacheContent } from './hashCacheContent';

const TEST_DIR = join(__dirname, '.test-saveFileCache');

describe('saveFileCache', () => {
  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('writes a { hash, data } envelope at {cacheDir}/{namespace}/{cacheKey}.json', async () => {
    const ref = { cacheDir: TEST_DIR, namespace: 'pages-index', cacheKey: 'components' };
    const content = '# Components\n';
    await saveFileCache(ref, content, { title: 'Components' });

    const raw = await readFile(join(TEST_DIR, 'pages-index', 'components.json'), 'utf-8');
    expect(JSON.parse(raw)).toEqual({
      hash: hashCacheContent(content),
      data: { title: 'Components' },
    });
  });

  it('creates nested directories for slashed cache keys', async () => {
    const ref = { cacheDir: TEST_DIR, namespace: 'pages-index', cacheKey: 'utilities/parsing' };
    await saveFileCache(ref, 'x', { ok: true });

    const raw = await readFile(join(TEST_DIR, 'pages-index', 'utilities', 'parsing.json'), 'utf-8');
    expect(JSON.parse(raw).data).toEqual({ ok: true });
  });

  it('throws when the cache directory cannot be created', async () => {
    await mkdir(TEST_DIR, { recursive: true });
    // Occupy the namespace path with a file so creating the directory fails.
    await writeFile(join(TEST_DIR, 'pages-index'), 'i am a file', 'utf-8');
    const ref = { cacheDir: TEST_DIR, namespace: 'pages-index', cacheKey: 'components' };

    await expect(saveFileCache(ref, 'x', { ok: true })).rejects.toThrow();
  });
});
