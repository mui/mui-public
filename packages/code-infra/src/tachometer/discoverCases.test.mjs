import * as path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from '../utils/testUtils.mjs';
import { discoverCases, measurementNameOf, pagesOf } from './discoverCases.mjs';

/**
 * Builds a throwaway harness: `src/<case>/tachometer.json` plus whatever pages each case owns.
 *
 * @param {Record<string, { config: any, pages?: string[] }>} cases - Case folders to create
 * @returns {Promise<string>} The harness directory
 */
async function makeHarness(cases) {
  const harnessDir = await makeTempDir();
  await Promise.all(
    Object.entries(cases).map(async ([name, { config, pages = [] }]) => {
      const caseDir = path.join(harnessDir, 'src', name);
      await mkdir(caseDir, { recursive: true });
      await writeFile(path.join(caseDir, 'tachometer.json'), JSON.stringify(config, null, 2));
      await Promise.all(
        pages.map((page) => writeFile(path.join(caseDir, page), '<!doctype html>\n')),
      );
    }),
  );
  return harnessDir;
}

/**
 * A minimal single-benchmark config.
 *
 * @param {string} name - Benchmark name
 * @param {string} url - Page url
 * @returns {any}
 */
function config(name, url) {
  return {
    $schema: '../../node_modules/tachometer/config.schema.json',
    benchmarks: [{ name, url }],
  };
}

describe('discoverCases', () => {
  it('finds every case folder holding a tachometer.json', async () => {
    const harnessDir = await makeHarness({
      alpha: { config: config('alpha', './index.html'), pages: ['index.html'] },
      beta: { config: config('beta', './index.html'), pages: ['index.html'] },
    });

    const cases = await discoverCases({ harnessDir });

    expect(cases.map((entry) => entry.name)).toEqual(['alpha', 'beta']);
  });

  it('narrows to cases matching a filter', async () => {
    const harnessDir = await makeHarness({
      'grid-init': { config: config('grid-init', './index.html'), pages: ['index.html'] },
      'grid-scroll': { config: config('grid-scroll', './index.html'), pages: ['index.html'] },
    });

    const cases = await discoverCases({ harnessDir, filters: ['scroll'] });

    expect(cases.map((entry) => entry.name)).toEqual(['grid-scroll']);
  });

  it('strips $schema, which tachometer rejects in a config it is handed', async () => {
    const harnessDir = await makeHarness({
      alpha: { config: config('alpha', './index.html'), pages: ['index.html'] },
    });

    const [entry] = await discoverCases({ harnessDir });

    expect(entry.config.$schema).toBeUndefined();
  });

  it('throws when no case matches', async () => {
    const harnessDir = await makeHarness({
      alpha: { config: config('alpha', './index.html'), pages: ['index.html'] },
    });

    await expect(discoverCases({ harnessDir, filters: ['nope'] })).rejects.toThrow(
      /No benchmark case .* matches "nope"/,
    );
  });

  describe('auto-expansion', () => {
    it('expands a benchmark with no variants into current versus baseline', async () => {
      const harnessDir = await makeHarness({
        alpha: { config: config('alpha', './index.html'), pages: ['index.html'] },
      });

      const [entry] = await discoverCases({ harnessDir });

      expect(entry.config.benchmarks[0].expand).toEqual([
        { name: 'alpha [current]', url: './index.html' },
        { name: 'alpha [baseline]', url: './index.html?ref=baseline' },
      ]);
    });

    it('removes the parent url once variants carry it', async () => {
      // Leaving the un-rewritten source url on the parent would let tachometer inherit a page that
      // was never built.
      const harnessDir = await makeHarness({
        alpha: { config: config('alpha', './index.html'), pages: ['index.html'] },
      });

      const [entry] = await discoverCases({ harnessDir });

      expect(entry.config.benchmarks[0]).not.toHaveProperty('url');
    });

    it('joins the ref with an ampersand when the url already has a query', async () => {
      const harnessDir = await makeHarness({
        alpha: { config: config('alpha', './index.html?rows=100'), pages: ['index.html'] },
      });

      const [entry] = await discoverCases({ harnessDir });

      expect(entry.config.benchmarks[0].expand[1].url).toBe('./index.html?rows=100&ref=baseline');
    });

    it('leaves a benchmark that declares its own variants alone', async () => {
      const harnessDir = await makeHarness({
        libs: {
          config: {
            benchmarks: [
              {
                name: 'libs',
                expand: [
                  { name: 'libs [ours]', url: './ours.html' },
                  { name: 'libs [theirs]', url: './theirs.html' },
                ],
              },
            ],
          },
          pages: ['ours.html', 'theirs.html'],
        },
      });

      const [entry] = await discoverCases({ harnessDir });

      expect(entry.leaves.map((leaf) => leaf.page)).toEqual(['libs/ours.html', 'libs/theirs.html']);
    });
  });

  describe('leaf urls', () => {
    it('inherits a parent url through a nested expand', async () => {
      const harnessDir = await makeHarness({
        alpha: {
          config: {
            benchmarks: [
              {
                name: 'alpha',
                url: './index.html',
                expand: [
                  { name: 'alpha [one]', expand: [{ name: 'alpha [one/a]' }] },
                  { name: 'alpha [two]', url: './other.html' },
                ],
              },
            ],
          },
          pages: ['index.html', 'other.html'],
        },
      });

      const [entry] = await discoverCases({ harnessDir });

      expect(entry.leaves.map((leaf) => leaf.page)).toEqual([
        'alpha/index.html',
        'alpha/other.html',
      ]);
    });

    it('consumes the ref and carries every other query parameter through', async () => {
      const harnessDir = await makeHarness({
        alpha: {
          config: {
            benchmarks: [
              {
                name: 'alpha',
                expand: [{ name: 'a', url: './index.html?rows=100&ref=baseline#x' }],
              },
            ],
          },
          pages: ['index.html'],
        },
      });

      const [entry] = await discoverCases({ harnessDir });

      expect(entry.leaves[0].suffix).toBe('?rows=100#x');
    });

    it('resolves a case that owns no page but parameterises a sibling', async () => {
      const harnessDir = await makeHarness({
        updates: { config: config('updates', './index.html'), pages: ['index.html'] },
        'updates-throttled': {
          config: {
            benchmarks: [
              {
                name: 'updates-throttled',
                expand: [{ name: 'throttled', url: '../updates/index.html?throttle=16' }],
              },
            ],
          },
        },
      });

      const cases = await discoverCases({ harnessDir });
      const throttled = cases.find((entry) => entry.name === 'updates-throttled');

      expect(throttled?.leaves[0]).toMatchObject({
        page: path.join('updates', 'index.html'),
        suffix: '?throttle=16',
      });
    });

    it('rejects a url resolving outside src', async () => {
      const harnessDir = await makeHarness({
        alpha: {
          config: {
            benchmarks: [{ name: 'alpha', expand: [{ name: 'a', url: '../../outside.html' }] }],
          },
        },
      });

      await expect(discoverCases({ harnessDir })).rejects.toThrow(/resolves outside/);
    });

    it('rejects a url pointing at a missing page', async () => {
      const harnessDir = await makeHarness({
        alpha: { config: config('alpha', './missing.html') },
      });

      await expect(discoverCases({ harnessDir })).rejects.toThrow(/missing page/);
    });

    it('rejects an unknown ref scheme even when refs are not being resolved', async () => {
      const harnessDir = await makeHarness({
        alpha: {
          config: {
            benchmarks: [
              { name: 'alpha', expand: [{ name: 'a', url: './index.html?ref=nonsense' }] },
            ],
          },
          pages: ['index.html'],
        },
      });

      await expect(discoverCases({ harnessDir })).rejects.toThrow(/Unknown ref "nonsense"/);
    });
  });

  describe('without a ref resolver', () => {
    it('leaves refs unresolved and makes no git calls', async () => {
      // The temp harness is not a git repository at all, so anything reaching for git would fail.
      const harnessDir = await makeHarness({
        alpha: { config: config('alpha', './index.html'), pages: ['index.html'] },
      });

      const [entry] = await discoverCases({ harnessDir });

      expect(entry.leaves).toHaveLength(2);
      expect(entry.leaves.every((leaf) => leaf.ref === null)).toBe(true);
    });

    it('still yields the full page list', async () => {
      const harnessDir = await makeHarness({
        alpha: { config: config('alpha', './index.html'), pages: ['index.html'] },
        libs: {
          config: {
            benchmarks: [
              {
                name: 'libs',
                expand: [
                  { name: 'libs [ours]', url: './ours.html' },
                  { name: 'libs [theirs]', url: './theirs.html' },
                ],
              },
            ],
          },
          pages: ['ours.html', 'theirs.html'],
        },
      });

      expect(pagesOf(await discoverCases({ harnessDir }))).toEqual([
        path.join('alpha', 'index.html'),
        path.join('libs', 'ours.html'),
        path.join('libs', 'theirs.html'),
      ]);
    });
  });
});

describe('pagesOf', () => {
  it('deduplicates the pages a case references from several variants', async () => {
    // The auto-expanded [current] and [baseline] variants point at the same page.
    const harnessDir = await makeHarness({
      alpha: { config: config('alpha', './index.html'), pages: ['index.html'] },
    });

    expect(pagesOf(await discoverCases({ harnessDir }))).toEqual([
      path.join('alpha', 'index.html'),
    ]);
  });
});

describe('measurementNameOf', () => {
  it('uses an explicit name', () => {
    expect(measurementNameOf({ mode: 'performance', entryName: 'mount', name: 'paint' })).toBe(
      'paint',
    );
  });

  it('uses the expression for an expression measurement', () => {
    expect(measurementNameOf({ mode: 'expression', expression: 'window.total' })).toBe(
      'window.total',
    );
  });

  it('names a callback measurement', () => {
    expect(measurementNameOf({ mode: 'callback' })).toBe('callback');
    expect(measurementNameOf('callback')).toBe('callback');
  });

  it('falls back to the entry name', () => {
    expect(measurementNameOf({ mode: 'performance', entryName: 'mount' })).toBe('mount');
  });

  it('abbreviates first-contentful-paint the way tachometer does', () => {
    expect(measurementNameOf({ mode: 'performance', entryName: 'first-contentful-paint' })).toBe(
      'fcp',
    );
  });
});

describe('case variants and measurements', () => {
  it('lists the auto-expanded variants in order, the reference first', async () => {
    const harnessDir = await makeHarness({
      alpha: {
        config: {
          benchmarks: [
            {
              name: 'alpha',
              url: './index.html',
              measurement: { mode: 'performance', entryName: 'mount' },
            },
          ],
        },
        pages: ['index.html'],
      },
    });

    const [entry] = await discoverCases({ harnessDir });

    expect(entry.variants.map((variant) => variant.name)).toEqual([
      'alpha [current]',
      'alpha [baseline]',
    ]);
    expect(entry.measurements).toEqual(['mount']);
  });

  it('collects every measurement a benchmark declares', async () => {
    // A page with several measurements is exactly the case whose results must be paired by name.
    const harnessDir = await makeHarness({
      alpha: {
        config: {
          benchmarks: [
            {
              name: 'alpha',
              url: './index.html',
              measurement: [
                { mode: 'performance', entryName: 'mount' },
                { mode: 'performance', entryName: 'scroll' },
              ],
            },
          ],
        },
        pages: ['index.html'],
      },
    });

    const [entry] = await discoverCases({ harnessDir });

    expect(entry.measurements).toEqual(['mount', 'scroll']);
  });

  it('defaults to the callback measurement when none is declared', async () => {
    const harnessDir = await makeHarness({
      alpha: { config: config('alpha', './index.html'), pages: ['index.html'] },
    });

    const [entry] = await discoverCases({ harnessDir });

    expect(entry.measurements).toEqual(['callback']);
  });
});
