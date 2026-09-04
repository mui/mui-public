import { describe, it, expect } from 'vitest';
import { loadIsomorphicCodeVariant } from './loadIsomorphicCodeVariant';
import type {
  LoadFileCache,
  LoadSource,
  ParseSource,
  VariantCode,
  HastRoot,
} from '../../CodeHighlighter/types';

// A real (non-mock) in-memory implementation of the LoadFileCache contract, so the
// test exercises the actual cache routing in loadSingleFile rather than a stub.
function createMemoryFileCache() {
  const store = new Map<string, unknown>();
  const consulted: Array<{ url: string; variantKey: string; hit: boolean }> = [];
  const cache: LoadFileCache = async ({ url, variantKey, compute }) => {
    const key = `${url}\n${variantKey}`;
    const hit = store.has(key);
    consulted.push({ url, variantKey, hit });
    if (hit) {
      return store.get(key) as Awaited<ReturnType<typeof compute>>;
    }
    const result = await compute();
    store.set(key, result);
    return result;
  };
  return { cache, consulted };
}

describe('loadIsomorphicCodeVariant with loadFileCache', () => {
  it('routes a url-backed file through the cache and reuses its processed result across variants', async () => {
    const { cache, consulted } = createMemoryFileCache();

    // Real loaders that count how often the expensive work runs.
    let loadCount = 0;
    const loadSource: LoadSource = async () => {
      loadCount += 1;
      return { source: 'const value = 1;\n' };
    };
    let parseCount = 0;
    const parseSource: ParseSource = (): HastRoot => {
      parseCount += 1;
      return { type: 'root', children: [] };
    };

    const variant: VariantCode = { fileName: 'shared.ts', url: 'file:///shared.ts' };
    const options = {
      sourceParser: Promise.resolve(parseSource),
      loadSource,
      loadFileCache: cache,
      output: 'hast' as const,
    };

    // Two different variants loading the SAME file content (e.g. a shared demo-infra file).
    await loadIsomorphicCodeVariant('file:///shared.ts', 'first', { ...variant }, options);
    await loadIsomorphicCodeVariant('file:///shared.ts', 'second', { ...variant }, options);

    // The second load is a cache hit, so the file is loaded + highlighted only once.
    expect(loadCount).toBe(1);
    expect(parseCount).toBe(1);
    expect(consulted.map((entry) => entry.hit)).toEqual([false, true]);
  });

  it('does not consult the cache for an inline-source file (no on-disk content to key)', async () => {
    const { cache, consulted } = createMemoryFileCache();

    const parseSource: ParseSource = (): HastRoot => ({ type: 'root', children: [] });
    const variant: VariantCode = {
      fileName: 'inline.ts',
      source: 'const inline = 2;\n',
    };

    await loadIsomorphicCodeVariant('file:///inline.ts', 'default', variant, {
      sourceParser: Promise.resolve(parseSource),
      loadFileCache: cache,
      output: 'hast' as const,
    });

    expect(consulted).toHaveLength(0);
  });
});
