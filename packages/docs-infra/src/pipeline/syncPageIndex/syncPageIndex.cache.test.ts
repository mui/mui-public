import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { syncPageIndex } from './syncPageIndex';
import { createLoadServerPageIndex } from '../loadServerPageIndex';
import { hashCacheContent, resolveCachePath } from '../cacheUtils';
import type { PageMetadata } from './metadataToMarkdown';

const TEST_DIR = join(__dirname, '.test-syncPageIndex-cache');
const CACHE_DIR = join(TEST_DIR, '.cache');

function page(slug: string, title: string): PageMetadata {
  return { slug, path: `./${slug}/page.mdx`, title, description: `The ${title}.` };
}

async function syncChild(routeDir: string[], child: PageMetadata) {
  await mkdir(join(TEST_DIR, 'app', ...routeDir, child.slug), { recursive: true });
  await syncPageIndex({
    pagePath: join(TEST_DIR, 'app', ...routeDir, child.slug, 'page.mdx'),
    metadata: child,
    baseDir: TEST_DIR,
    rootContext: TEST_DIR,
    cacheDir: CACHE_DIR,
  });
}

/**
 * The cache is built from in-memory metadata at write time, so it must match what a
 * cold `loadServerPageIndex` would compute by parsing the written markdown. Reading the
 * same index with and without the cache must therefore return identical data.
 *
 * The comparison is on the serialized form: the cache stores JSON, so it never preserves
 * `undefined`-valued keys (e.g. `sections: undefined`) that a live parse leaves in place.
 * That cosmetic difference is irrelevant to consumers; any real drift (tags, order, titles)
 * survives serialization and is still caught.
 */
async function expectCacheMatchesFreshRead(indexPath: string) {
  const cached = await createLoadServerPageIndex({ rootContext: TEST_DIR, cacheDir: CACHE_DIR })(
    indexPath,
  );
  const fresh = await createLoadServerPageIndex({ rootContext: TEST_DIR })(indexPath);
  expect(JSON.parse(JSON.stringify(cached))).toEqual(JSON.parse(JSON.stringify(fresh)));
  return fresh;
}

describe('syncPageIndex caching', () => {
  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('cache for a freshly created index matches a fresh read', async () => {
    await syncChild(['components'], page('button', 'Button'));

    const indexPath = join(TEST_DIR, 'app', 'components', 'page.mdx');
    const result = await expectCacheMatchesFreshRead(indexPath);
    expect(result?.title).toBe('Components');
    expect(result?.pages).toHaveLength(1);
  });

  it('cache matches a fresh read after adding a page (the [New] tag case)', async () => {
    await syncChild(['components'], page('button', 'Button'));
    await syncChild(['components'], page('checkbox', 'Checkbox'));

    const indexPath = join(TEST_DIR, 'app', 'components', 'page.mdx');
    const result = await expectCacheMatchesFreshRead(indexPath);
    // The newly added page carries the [New] tag in both the cache and a fresh parse;
    // building from the raw merge input (without the tag) would fail the equality above.
    const checkbox = result?.pages.find((entry) => entry.slug === 'checkbox');
    expect(checkbox?.tags).toContain('New');
  });

  it('cache matches a fresh read for a nested route', async () => {
    await syncChild(['utilities', 'parsing'], page('tokenizer', 'Tokenizer'));

    const indexPath = join(TEST_DIR, 'app', 'utilities', 'parsing', 'page.mdx');
    const result = await expectCacheMatchesFreshRead(indexPath);
    expect(result?.title).toBe('Utilities Parsing');

    // The cache file lands at the nested route path.
    const cachePath = resolveCachePath({
      cacheDir: CACHE_DIR,
      namespace: 'pages-index',
      cacheKey: 'utilities/parsing',
    });
    await readFile(cachePath, 'utf-8'); // throws if missing
  });

  it('writes the cache at {cacheDir}/pages-index/{route}.json with the content hash', async () => {
    await syncChild(['components'], page('button', 'Button'));

    const indexPath = join(TEST_DIR, 'app', 'components', 'page.mdx');
    const markdown = await readFile(indexPath, 'utf-8');
    const cachePath = resolveCachePath({
      cacheDir: CACHE_DIR,
      namespace: 'pages-index',
      cacheKey: 'components',
    });
    const entry = JSON.parse(await readFile(cachePath, 'utf-8'));
    expect(entry.hash).toBe(hashCacheContent(markdown));
  });
});
