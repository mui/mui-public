import { describe, it, expect } from 'vitest';
// eslint-disable-next-line n/prefer-node-protocol
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'fs';
// eslint-disable-next-line n/prefer-node-protocol
import { tmpdir } from 'os';
// eslint-disable-next-line n/prefer-node-protocol
import { join } from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import { pathToFileURL } from 'url';
import { createServerFileCache } from './createServerFileCache';
import { CODE_FILE_CACHE_NAMESPACE } from './resolveCodeFileCacheKey';

// Real filesystem, no mocks (convention 3.5): each test gets its own temp project +
// cache dir, so disk reads/writes exercise the actual read-through cache.
function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'docs-infra-code-file-cache-'));
  return { root, cacheDir: join(root, '.next', 'cache', 'docs-infra') };
}

function writeSource(root: string, name: string, content: string) {
  const filePath = join(root, name);
  writeFileSync(filePath, content);
  return { filePath, url: pathToFileURL(filePath).toString() };
}

describe('createServerFileCache', () => {
  it('returns cached data on a repeat call with unchanged content (processor runs once)', async () => {
    const { root, cacheDir } = makeProject();
    const { url } = writeSource(root, 'Button.tsx', 'export const Button = 1;\n');
    const cache = createServerFileCache({ cacheDir, rootContext: root, globalOptionsKey: 'g' });

    let calls = 0;
    const run = () =>
      cache({
        url,
        variantKey: 'vk',
        compute: async () => {
          calls += 1;
          return { value: calls };
        },
      });

    const first = await run();
    const second = await run();

    expect(calls).toBe(1);
    expect(second).toEqual(first);
    expect(existsSync(join(cacheDir, CODE_FILE_CACHE_NAMESPACE))).toBe(true);
  });

  it('recomputes when the file content changes', async () => {
    const { root, cacheDir } = makeProject();
    const { filePath, url } = writeSource(root, 'Button.tsx', 'export const Button = 1;\n');
    const cache = createServerFileCache({ cacheDir, rootContext: root, globalOptionsKey: 'g' });

    let calls = 0;
    const run = () =>
      cache({
        url,
        variantKey: 'vk',
        compute: async () => {
          calls += 1;
          return { value: calls };
        },
      });

    await run();
    writeFileSync(filePath, 'export const Button = 2;\n');
    await run();

    expect(calls).toBe(2);
  });

  it('recomputes when the build-wide options key changes (stale-hash miss)', async () => {
    const { root, cacheDir } = makeProject();
    const { url } = writeSource(root, 'Button.tsx', 'export const Button = 1;\n');

    let calls = 0;
    const compute = async () => {
      calls += 1;
      return { value: calls };
    };
    await createServerFileCache({ cacheDir, rootContext: root, globalOptionsKey: 'g1' })({
      url,
      variantKey: 'vk',
      compute,
    });
    await createServerFileCache({ cacheDir, rootContext: root, globalOptionsKey: 'g2' })({
      url,
      variantKey: 'vk',
      compute,
    });

    expect(calls).toBe(2);
  });

  it('keeps a single entry per file, overwriting when the variantKey changes (no accumulation)', async () => {
    const { root, cacheDir } = makeProject();
    const { url } = writeSource(root, 'Button.tsx', 'export const Button = 1;\n');
    const cache = createServerFileCache({ cacheDir, rootContext: root, globalOptionsKey: 'g' });

    let calls = 0;
    const compute = async () => {
      calls += 1;
      return { value: calls };
    };
    await cache({ url, variantKey: 'framed', compute });
    // A different variantKey is a hash mismatch → recompute → overwrite the same entry.
    await cache({ url, variantKey: 'plain', compute });

    expect(calls).toBe(2);
    // Exactly one file on disk — the stale 'framed' entry was overwritten, not orphaned.
    const entries = readdirSync(join(cacheDir, CODE_FILE_CACHE_NAMESPACE));
    expect(entries.length).toBe(1);

    // The most-recent variantKey hits; the overwritten one recomputes.
    await cache({ url, variantKey: 'plain', compute });
    expect(calls).toBe(2);
    await cache({ url, variantKey: 'framed', compute });
    expect(calls).toBe(3);
  });

  it('bypasses the cache for files outside the project root', async () => {
    const { cacheDir } = makeProject();
    const elsewhere = makeProject();
    const { url } = writeSource(elsewhere.root, 'Outside.tsx', 'export const Outside = 1;\n');
    // rootContext is the first project; the file lives in a different temp dir.
    const cache = createServerFileCache({
      cacheDir,
      rootContext: join(tmpdir(), 'docs-infra-code-file-cache-nonexistent'),
      globalOptionsKey: 'g',
    });

    let calls = 0;
    const run = () =>
      cache({
        url,
        variantKey: 'vk',
        compute: async () => {
          calls += 1;
          return { value: calls };
        },
      });
    await run();
    await run();

    expect(calls).toBe(2); // no caching → recomputed each time
    expect(existsSync(join(cacheDir, CODE_FILE_CACHE_NAMESPACE))).toBe(false);
  });
});
