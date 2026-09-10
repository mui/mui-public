import * as path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { makeTempDir } from '../utils/testUtils';
import { discoverCases, measurementNameOf, pagesOf } from './discoverCases';

/** A case folder to create in a throwaway harness. */
interface CaseFixture {
  config: any;
  pages?: string[];
}

/** Builds a throwaway harness: `src/<case>/tachometer.json` plus whatever pages each case owns. */
async function makeHarness(cases: Record<string, CaseFixture>): Promise<string> {
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

/** A minimal single-benchmark config. */
function config(name: string, url: string): any {
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

  it('finds a case nested in a folder', async () => {
    const harnessDir = await makeHarness({
      'libs/mount': { config: config('libs-mount', './index.html'), pages: ['index.html'] },
    });

    const cases = await discoverCases({ harnessDir });

    expect(cases.map((entry) => entry.name)).toEqual(['libs-mount']);
  });

  it('takes a case name from its benchmark rather than its folder', async () => {
    // The folder is where a case lives; the config is what it calls itself. Keeping them separate
    // is what lets a case move between folders without being renamed in every report.
    const harnessDir = await makeHarness({
      'libs/mount': { config: config('libs-mount', './index.html'), pages: ['index.html'] },
    });

    const [entry] = await discoverCases({ harnessDir });

    expect(entry.name).toBe('libs-mount');
  });

  it('selects a whole folder by filtering on the path', async () => {
    const harnessDir = await makeHarness({
      'libs/mount': { config: config('libs-mount', './index.html'), pages: ['index.html'] },
      'libs/scroll': { config: config('libs-scroll', './index.html'), pages: ['index.html'] },
      regression: { config: config('regression', './index.html'), pages: ['index.html'] },
    });

    const cases = await discoverCases({ harnessDir, filters: ['libs'] });

    expect(cases.map((entry) => entry.name)).toEqual(['libs-mount', 'libs-scroll']);
  });

  it('matches a filter case-insensitively', async () => {
    const harnessDir = await makeHarness({
      GridScroll: { config: config('grid-scroll', './index.html'), pages: ['index.html'] },
    });

    const cases = await discoverCases({ harnessDir, filters: ['gridscroll'] });

    expect(cases.map((entry) => entry.name)).toEqual(['grid-scroll']);
  });

  it('refuses two cases that call themselves the same thing', async () => {
    // The name identifies a case in the report and in the file its results are written to, so a
    // duplicate would silently overwrite rather than fail.
    const harnessDir = await makeHarness({
      'libs/scroll': { config: config('scroll', './index.html'), pages: ['index.html'] },
      scroll: { config: config('scroll', './index.html'), pages: ['index.html'] },
    });

    await expect(discoverCases({ harnessDir })).rejects.toThrow(
      /Two benchmark cases are both named "scroll"/,
    );
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

      expect(entry.config.benchmarks).toEqual([
        { name: 'alpha [current]', url: './index.html' },
        { name: 'alpha [baseline]', url: './index.html' },
      ]);
    });

    it('points the two variants at the two builds', async () => {
      const harnessDir = await makeHarness({
        alpha: { config: config('alpha', './index.html'), pages: ['index.html'] },
      });

      const [entry] = await discoverCases({ harnessDir });

      expect(entry.comparison).toBe('baseline');
      expect(entry.leaves.map((leaf) => leaf.ref)).toEqual(['current', 'baseline']);
    });

    it('hands tachometer benchmarks it cannot expand again', async () => {
      // The config is parsed afresh, so a benchmark that still carried `expand` would be expanded a
      // second time — and an un-rewritten parent url would point at a page that was never built.
      const harnessDir = await makeHarness({
        alpha: { config: config('alpha', './index.html'), pages: ['index.html'] },
      });

      const [entry] = await discoverCases({ harnessDir });

      for (const benchmark of entry.config.benchmarks) {
        expect(benchmark).not.toHaveProperty('expand');
      }
    });

    it('gives both variants the same page, query and fragment', async () => {
      // Everything after the page path belongs to the page. A parameterised case that lost it on one
      // side would compare the parameters against the defaults and call the difference a regression.
      const harnessDir = await makeHarness({
        alpha: { config: config('alpha', './index.html?rows=100#state'), pages: ['index.html'] },
      });

      const [entry] = await discoverCases({ harnessDir });
      const target = `${path.join('alpha', 'index.html')}?rows=100#state`;

      expect(entry.leaves.map((leaf) => `${leaf.page}${leaf.suffix}`)).toEqual([target, target]);
    });

    it('merges an expansion over its parent, nearest value winning', async () => {
      // Tachometer merges an expansion over its parent before it reads anything, so a field set
      // deeper wins and one set only on the parent is inherited. Flattening here has to match, or
      // the config handed over would describe different benchmarks than the ones discovered.
      const harnessDir = await makeHarness({
        libs: {
          config: {
            benchmarks: [
              {
                name: 'libs',
                measurement: { mode: 'performance', entryName: 'mount' },
                expand: [{ name: 'libs [ours]', url: './ours.html' }, { url: './theirs.html' }],
              },
            ],
          },
          pages: ['ours.html', 'theirs.html'],
        },
      });

      const [entry] = await discoverCases({ harnessDir });

      expect(entry.config.benchmarks).toEqual([
        {
          name: 'libs [ours]',
          url: './ours.html',
          measurement: { mode: 'performance', entryName: 'mount' },
        },
        {
          name: 'libs',
          url: './theirs.html',
          measurement: { mode: 'performance', entryName: 'mount' },
        },
      ]);
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
      // Its own variants, so they are compared with each other and all load the working tree.
      expect(entry.comparison).toBe('variants');
      expect(entry.leaves.map((leaf) => leaf.ref)).toEqual(['current', 'current']);
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

    it('carries the query and the fragment through as written', async () => {
      const harnessDir = await makeHarness({
        alpha: {
          config: {
            benchmarks: [
              { name: 'alpha', expand: [{ name: 'a', url: './index.html?rows=100&cols=8#x' }] },
            ],
          },
          pages: ['index.html'],
        },
      });

      const [entry] = await discoverCases({ harnessDir });

      expect(entry.leaves[0].suffix).toBe('?rows=100&cols=8#x');
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
  });

  describe('outside a repository', () => {
    it('names both builds without asking git anything', async () => {
      // The temp harness is no repository at all, so anything reaching for git would fail here.
      // Which build a variant loads follows from the case's shape, which is what lets a plain
      // `vite build` run in a checkout with no history.
      const harnessDir = await makeHarness({
        alpha: { config: config('alpha', './index.html'), pages: ['index.html'] },
      });

      const [entry] = await discoverCases({ harnessDir });

      expect(entry.leaves.map((leaf) => leaf.ref)).toEqual(['current', 'baseline']);
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

  it('names the "global" shorthand by the expression tachometer expands it to', () => {
    // `global` becomes an expression measurement, and a result is named by the expression — not by
    // the shorthand — so taking the shorthand at face value would never match its own result.
    expect(measurementNameOf('global')).toBe('window.tachometerResult');
    expect(measurementNameOf('global', 'window.myResult')).toBe('window.myResult');
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

    expect(entry.variants).toEqual(['alpha [current]', 'alpha [baseline]']);
    expect(entry.measurements).toEqual(['mount']);
  });

  it('falls back to the case name when a benchmark names neither itself nor its variants', async () => {
    // The case name is already the fallback for a nameless benchmark, so the variants read
    // "alpha [current]" rather than "undefined [current]".
    const harnessDir = await makeHarness({
      alpha: {
        config: { benchmarks: [{ url: './index.html' }] },
        pages: ['index.html'],
      },
    });

    const [entry] = await discoverCases({ harnessDir });

    expect(entry.variants).toEqual(['alpha [current]', 'alpha [baseline]']);
  });

  it('takes a variant name from the nearest node that sets one', async () => {
    // Tachometer merges an expansion over its parent, so a name set partway down the tree is what
    // it reports — reading only the leaf and the benchmark would look up a name it never used.
    const harnessDir = await makeHarness({
      alpha: {
        config: {
          benchmarks: [
            {
              name: 'alpha',
              expand: [
                { name: 'alpha [ours]', expand: [{ url: './index.html' }] },
                { name: 'alpha [theirs]', expand: [{ url: './other.html' }] },
              ],
            },
          ],
        },
        pages: ['index.html', 'other.html'],
      },
    });

    const [entry] = await discoverCases({ harnessDir });

    expect(entry.variants).toEqual(['alpha [ours]', 'alpha [theirs]']);
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
