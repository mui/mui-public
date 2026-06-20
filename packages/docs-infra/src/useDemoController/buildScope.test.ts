import { describe, it, expect, vi } from 'vitest';
import { buildScope } from './buildScope';
import { instantiateElement } from './instantiateElement';
import { transpileSource, type Transpile } from './transpileSource';
import { SCOPE_IMPORT_PREFIX } from './constants';

const P = SCOPE_IMPORT_PREFIX;

/** Main-thread transpile — the same work the worker does, run inline for tests. */
const transpile: Transpile = async (source, options) => transpileSource(source, options);

describe('buildScope', () => {
  it('seeds the registry with the provided externals', async () => {
    const externals = { react: { marker: true } };
    const { imports, nested } = await buildScope({ externals, transpile });
    expect(imports.react).toBe(externals.react);
    expect(nested).toBe(false);
  });

  it('registers a flat JS file under its extension-less `./name` specifier', async () => {
    const { imports, nested } = await buildScope({
      extraFiles: { 'util.ts': { source: 'export const x = 1;' } },
      externals: {},
      transpile,
    });
    expect(nested).toBe(false);
    expect((imports['./util'] as { x: number }).x).toBe(1);
  });

  it('collects flat CSS-module styles and exports the class map under `./name`', async () => {
    const { imports, css, nested } = await buildScope({
      extraFiles: { 'theme.module.css': { source: '.btn { color: red; }' } },
      externals: {},
      transpile,
    });
    expect(nested).toBe(false);
    expect(css).toContain('color: red');
    expect((imports['./theme.module.css'] as Record<string, string>).btn).toBeTypeOf('string');
  });

  it('keys subdirectory files by absolute specifier and resolves cross-directory imports', async () => {
    const { imports, nested } = await buildScope({
      extraFiles: {
        'lib/util.ts': { source: 'export const x = 42;' },
        'feature/use.ts': {
          source: "import { x } from '../lib/util';\nexport const y = x + 1;",
        },
      },
      externals: {},
      transpile,
    });
    expect(nested).toBe(true);
    expect((imports[`${P}lib/util`] as { x: number }).x).toBe(42);
    expect((imports[`${P}feature/use`] as { y: number }).y).toBe(43);
  });

  it('keys subdirectory CSS modules by absolute specifier (extension preserved)', async () => {
    const { imports, css, nested } = await buildScope({
      extraFiles: { 'styles/theme.module.css': { source: '.btn { color: blue; }' } },
      externals: {},
      transpile,
    });
    expect(nested).toBe(true);
    expect(css).toContain('color: blue');
    expect((imports[`${P}styles/theme.module.css`] as Record<string, string>).btn).toBeTypeOf(
      'string',
    );
  });

  it('resolves a cross-file `composes ... from` to the sibling module class', async () => {
    const { imports } = await buildScope({
      extraFiles: {
        'base.module.css': { source: '.box { padding: 4px; }' },
        'theme.module.css': {
          source: '.btn { composes: box from "./base.module.css"; color: red; }',
        },
      },
      externals: {},
      transpile,
    });
    const base = imports['./base.module.css'] as Record<string, string>;
    const theme = imports['./theme.module.css'] as Record<string, string>;
    // `btn` carries its own scoped name plus the sibling's resolved `box` class.
    expect(theme.btn.split(' ')).toHaveLength(2);
    expect(theme.btn.startsWith('btn-')).toBe(true);
    expect(theme.btn.endsWith(base.box)).toBe(true);
  });

  it('autoprefixes CSS-module declarations for the Baseline target', async () => {
    const { css } = await buildScope({
      extraFiles: { 'theme.module.css': { source: '.btn { user-select: none; }' } },
      externals: {},
      transpile,
    });
    expect(css).toContain('-webkit-user-select: none');
  });

  it('skips files whose source is null', async () => {
    const { imports } = await buildScope({
      extraFiles: { 'util.ts': { source: null } },
      externals: {},
      transpile,
    });
    expect(imports['./util']).toBeUndefined();
  });

  describe('per-file transpile cache', () => {
    it('re-evaluates a cached module against changed siblings (cache preserves correctness)', async () => {
      const util = { source: 'export const x = 1;' };
      const consumer = { source: "import { x } from './util';\nexport const y = x + 1;" };

      const first = await buildScope({
        extraFiles: { 'util.ts': util, 'consumer.ts': consumer },
        externals: {},
        transpile,
      });
      expect((first.imports['./consumer'] as { y: number }).y).toBe(2);

      // Edit ONLY util (new object); consumer keeps its identity, so its transpile is
      // a cache hit — but it must still re-run against the new util.
      const editedUtil = { source: 'export const x = 10;' };
      const second = await buildScope({
        extraFiles: { 'util.ts': editedUtil, 'consumer.ts': consumer },
        externals: {},
        transpile,
      });
      expect((second.imports['./util'] as { x: number }).x).toBe(10);
      expect((second.imports['./consumer'] as { y: number }).y).toBe(11);
    });

    it('transpiles only the changed file on rebuild, serving the rest from cache', async () => {
      const spy = vi.fn(transpile);
      const keep = { source: 'export const a = 1;' };
      const before = { source: 'export const b = 1;' };
      await buildScope({
        extraFiles: { 'keep.ts': keep, 'edit.ts': before },
        externals: {},
        transpile: spy,
      });
      // Modules transpile eagerly (off-thread) — both on the first build.
      expect(spy.mock.calls.length).toBe(2);

      const after = { source: 'export const b = 2;' }; // edited -> new object
      await buildScope({
        extraFiles: { 'keep.ts': keep, 'edit.ts': after },
        externals: {},
        transpile: spy,
      });
      // `keep` is unchanged (same object) so it is NOT re-transpiled; only `edit` is.
      expect(spy.mock.calls.length).toBe(3);
    });

    it('re-transpiles a flat file when added subdirectories flip the demo to nested', async () => {
      const leaf = { source: 'export const v = 7;' };
      const root = { source: "import { v } from './leaf';\nexport const w = v;" };

      const flat = await buildScope({
        extraFiles: { 'leaf.ts': leaf, 'root.ts': root },
        externals: {},
        transpile,
      });
      expect((flat.imports['./root'] as { w: number }).w).toBe(7);

      const nested = await buildScope({
        extraFiles: {
          'leaf.ts': leaf,
          'root.ts': root,
          'sub/extra.ts': { source: 'export const e = 1;' },
        },
        externals: {},
        transpile,
      });
      expect((nested.imports[`${P}root`] as { w: number }).w).toBe(7);
      expect((nested.imports[`${P}leaf`] as { v: number }).v).toBe(7);
    });
  });

  describe('module resolution', () => {
    it('registers a module under both its extension-less and full-name keys', async () => {
      const { imports } = await buildScope({
        extraFiles: { 'lib/util.ts': { source: 'export const x = 5;' } },
        externals: {},
        transpile,
      });
      expect((imports[`${P}lib/util`] as { x: number }).x).toBe(5);
      expect((imports[`${P}lib/util.ts`] as { x: number }).x).toBe(5);
    });

    it('resolves an import written with an explicit extension', async () => {
      const { imports } = await buildScope({
        extraFiles: {
          'util.ts': { source: 'export const x = 1;' },
          'main.ts': { source: "import { x } from './util.ts';\nexport const y = x + 1;" },
        },
        externals: {},
        transpile,
      });
      expect((imports['./main'] as { y: number }).y).toBe(2);
    });

    it('resolves a forward reference to a later-registered sibling', async () => {
      const { imports } = await buildScope({
        extraFiles: {
          'consumer.ts': { source: "import { v } from './dep';\nexport const out = v * 2;" },
          'dep.ts': { source: 'export const v = 21;' },
        },
        externals: {},
        transpile,
      });
      expect((imports['./consumer'] as { out: number }).out).toBe(42);
    });

    it('resolves circular imports via in-progress exports (no infinite loop)', async () => {
      const { imports } = await buildScope({
        extraFiles: {
          'a.ts': {
            source: "import { b } from './b';\nexport const a = 1;\nexport const fromB = () => b;",
          },
          'b.ts': {
            source: "import { a } from './a';\nexport const b = 2;\nexport const fromA = () => a;",
          },
        },
        externals: {},
        transpile,
      });
      expect((imports['./a'] as { a: number }).a).toBe(1);
      expect((imports['./b'] as { b: number }).b).toBe(2);
      expect((imports['./a'] as { fromB: () => number }).fromB()).toBe(2);
      expect((imports['./b'] as { fromA: () => number }).fromA()).toBe(1);
    });

    it('resolves a directory import to that directory index file', async () => {
      const { imports } = await buildScope({
        extraFiles: {
          'lib/index.ts': { source: 'export const v = 99;' },
          'main.ts': { source: "import { v } from './lib';\nexport const out = v;" },
        },
        externals: {},
        transpile,
      });
      expect((imports[`${P}main`] as { out: number }).out).toBe(99);
    });

    it('shares one evaluation of the main between the entry and an importing extra', async () => {
      const built = await buildScope({
        extraFiles: {
          'reader.ts': {
            source: "import { store } from './index';\nexport const read = () => store;",
          },
        },
        externals: {},
        mainCode: 'export const store = { tag: "shared" };\nexport default () => null;',
        transpile,
      });
      // Simulate the runner rendering the entry — which evaluates the (already
      // transpiled) main once, into the shared exports.
      instantiateElement(built.runnerCode!, { import: built.imports });

      const entryStore = (built.imports['./index'] as { store: object }).store;
      const readerStore = (built.imports['./reader'] as { read: () => object }).read();
      expect(readerStore).toBe(entryStore);
    });

    it('does not let the main clobber an extra file that claims the same key', async () => {
      const { imports } = await buildScope({
        extraFiles: { 'index.ts': { source: "export const which = 'extra';" } },
        externals: {},
        mainCode: "export const which = 'main';\nexport default () => null;",
        transpile,
      });
      expect((imports['./index'] as { which: string }).which).toBe('extra');
    });

    it('resolves an import to a parent-directory extra (`../`-prefixed key)', async () => {
      const { imports } = await buildScope({
        extraFiles: {
          '../shared/data.ts': { source: 'export const d = 7;' },
          'main.ts': { source: "import { d } from '../shared/data';\nexport const out = d;" },
        },
        externals: {},
        transpile,
      });
      expect((imports[`${P}main`] as { out: number }).out).toBe(7);
    });

    it('lets a file win over a directory index on the same key (either order)', async () => {
      const file = { 'foo.ts': { source: "export const w = 'file';" } };
      const dir = { 'foo/index.ts': { source: "export const w = 'dir';" } };
      for (const extraFiles of [
        { ...file, ...dir },
        { ...dir, ...file },
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const { imports } = await buildScope({ extraFiles, externals: {}, transpile });
        expect((imports[`${P}foo`] as { w: string }).w).toBe('file');
        expect((imports[`${P}foo/index`] as { w: string }).w).toBe('dir');
      }
    });
  });

  describe('deferred transpile errors', () => {
    it('keeps a broken but UNUSED module from breaking the demo, throwing only on require', async () => {
      const { imports } = await buildScope({
        extraFiles: {
          'broken.ts': { source: 'export const x =' }, // syntax error
          'used.ts': { source: 'export const y = 1;' },
        },
        externals: {},
        transpile,
      });
      // The healthy module resolves; the broken one is registered but inert until required.
      expect((imports['./used'] as { y: number }).y).toBe(1);
      expect(() => imports['./broken']).toThrow();
    });
  });

  describe('key normalization (configurable storeAt modes)', () => {
    it('strips a leading ./ so a flat `./util.ts` key is not treated as nested', async () => {
      const { imports, nested } = await buildScope({
        extraFiles: { './util.ts': { source: 'export const x = 1;' } },
        externals: {},
        transpile,
      });
      expect(nested).toBe(false);
      expect((imports['./util'] as { x: number }).x).toBe(1);
    });

    it('resolves subdirectory imports when keys carry a ./ prefix', async () => {
      const { imports } = await buildScope({
        extraFiles: {
          './lib/data.ts': { source: 'export const d = 5;' },
          './main.ts': { source: "import { d } from './lib/data';\nexport const out = d;" },
        },
        externals: {},
        transpile,
      });
      expect((imports[`${P}main`] as { out: number }).out).toBe(5);
    });
  });
});
