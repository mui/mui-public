import { describe, it, expect } from 'vitest';
import { resolve, sep } from 'node:path';
import { resolveCachePath } from './resolveCachePath';

describe('resolveCachePath', () => {
  it('resolves cache entries when the cache directory is the filesystem root', () => {
    expect(
      resolveCachePath({ cacheDir: sep, namespace: 'pages-index', cacheKey: 'components' }),
    ).toBe(resolve(sep, 'pages-index', 'components.json'));
  });

  it('rejects paths that escape to a sibling with the same prefix', () => {
    expect(() =>
      resolveCachePath({
        cacheDir: '/tmp/cache',
        namespace: '..',
        cacheKey: 'cache-bad/components',
      }),
    ).toThrow('escapes the cache directory');
  });

  it('rejects absolute namespace paths outside the cache directory', () => {
    expect(() =>
      resolveCachePath({ cacheDir: '/tmp/cache', namespace: '/tmp/other', cacheKey: 'components' }),
    ).toThrow('escapes the cache directory');
  });
});
