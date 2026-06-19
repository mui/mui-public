import { describe, it, expect, vi } from 'vitest';
import { buildScope } from './buildScope';
import * as compileModuleModule from './compileModule';
import { generateElement } from './generateElement';
import { SCOPE_IMPORT_PREFIX } from './absolutizeImports';

const P = SCOPE_IMPORT_PREFIX;

describe('buildScope', () => {
  it('seeds the registry with the provided externals', () => {
    const externals = { react: { marker: true } };
    const { imports, nested } = buildScope(undefined, externals);
    expect(imports.react).toBe(externals.react);
    expect(nested).toBe(false);
  });

  it('registers a flat JS file under its extension-less `./name` specifier', () => {
    const { imports, nested } = buildScope({ 'util.ts': { source: 'export const x = 1;' } }, {});
    expect(nested).toBe(false);
    expect((imports['./util'] as { x: number }).x).toBe(1);
  });

  it('collects flat CSS-module styles and exports the class map under `./name`', () => {
    const { imports, css, nested } = buildScope(
      { 'theme.module.css': { source: '.btn { color: red; }' } },
      {},
    );
    expect(nested).toBe(false);
    expect(css).toContain('color: red');
    // The class map is keyed by the original class name.
    expect((imports['./theme.module.css'] as Record<string, string>).btn).toBeTypeOf('string');
  });

  it('keys subdirectory files by absolute specifier and resolves cross-directory imports', () => {
    const { imports, nested } = buildScope(
      {
        // Registered before its dependent so it exists when evaluated.
        'lib/util.ts': { source: 'export const x = 42;' },
        'feature/use.ts': {
          source: "import { x } from '../lib/util';\nexport const y = x + 1;",
        },
      },
      {},
    );

    expect(nested).toBe(true);
    expect((imports[`${P}lib/util`] as { x: number }).x).toBe(42);
    // `feature/use` imported `../lib/util` — rewritten to the absolute key and resolved.
    expect((imports[`${P}feature/use`] as { y: number }).y).toBe(43);
  });

  it('keys subdirectory CSS modules by absolute specifier (extension preserved)', () => {
    const { imports, css, nested } = buildScope(
      { 'styles/theme.module.css': { source: '.btn { color: blue; }' } },
      {},
    );
    expect(nested).toBe(true);
    expect(css).toContain('color: blue');
    expect((imports[`${P}styles/theme.module.css`] as Record<string, string>).btn).toBeTypeOf(
      'string',
    );
  });

  it('skips files whose source is null', () => {
    const { imports } = buildScope({ 'util.ts': { source: null } }, {});
    expect(imports['./util']).toBeUndefined();
  });

  describe('per-file compile cache', () => {
    it('re-evaluates a cached module against changed siblings (cache preserves correctness)', () => {
      const util = { source: 'export const x = 1;' };
      // Imports `./util`; its own object identity stays stable across the rebuild.
      const consumer = { source: "import { x } from './util';\nexport const y = x + 1;" };

      const first = buildScope({ 'util.ts': util, 'consumer.ts': consumer }, {});
      expect((first.imports['./consumer'] as { y: number }).y).toBe(2);

      // Edit ONLY util (new object); consumer keeps its identity, so its compile is
      // a cache hit — but it must still re-run against the new util.
      const editedUtil = { source: 'export const x = 10;' };
      const second = buildScope({ 'util.ts': editedUtil, 'consumer.ts': consumer }, {});
      expect((second.imports['./util'] as { x: number }).x).toBe(10);
      expect((second.imports['./consumer'] as { y: number }).y).toBe(11);
    });

    it('compiles only the changed file on rebuild, serving the rest from cache', () => {
      const spy = vi.spyOn(compileModuleModule, 'compileModule');
      try {
        const keep = { source: 'export const a = 1;' };
        const before = { source: 'export const b = 1;' };
        const first = buildScope({ 'keep.ts': keep, 'edit.ts': before }, {});
        // Modules compile lazily on first access.
        expect(first.imports['./keep']).toBeDefined();
        expect(first.imports['./edit']).toBeDefined();
        const afterFirst = spy.mock.calls.length;
        expect(afterFirst).toBe(2); // both compiled on first access

        const after = { source: 'export const b = 2;' }; // edited -> new object
        const second = buildScope({ 'keep.ts': keep, 'edit.ts': after }, {});
        expect(second.imports['./keep']).toBeDefined();
        expect(second.imports['./edit']).toBeDefined();
        // `keep` is unchanged (same object) so it is NOT recompiled; only `edit` is.
        expect(spy.mock.calls.length - afterFirst).toBe(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('recompiles a flat file when added subdirectories flip the demo to nested', () => {
      // `leaf` is registered before `root` (incremental scope only resolves earlier
      // siblings). Same objects across both builds, but their keys/imports must
      // resolve differently once the demo goes nested.
      const leaf = { source: 'export const v = 7;' };
      const root = { source: "import { v } from './leaf';\nexport const w = v;" };

      const flat = buildScope({ 'leaf.ts': leaf, 'root.ts': root }, {});
      expect((flat.imports['./root'] as { w: number }).w).toBe(7);

      // Adding a subdirectory file flips `nested`; `root`/`leaf` keep their objects
      // but must be re-absolutized to the prefixed keys.
      const nested = buildScope(
        { 'leaf.ts': leaf, 'root.ts': root, 'sub/extra.ts': { source: 'export const e = 1;' } },
        {},
      );
      expect((nested.imports[`${P}root`] as { w: number }).w).toBe(7);
      expect((nested.imports[`${P}leaf`] as { v: number }).v).toBe(7);
    });
  });

  describe('module resolution', () => {
    it('registers a module under both its extension-less and full-name keys', () => {
      const { imports } = buildScope({ 'lib/util.ts': { source: 'export const x = 5;' } }, {});
      expect((imports[`${P}lib/util`] as { x: number }).x).toBe(5);
      expect((imports[`${P}lib/util.ts`] as { x: number }).x).toBe(5);
    });

    it('resolves an import written with an explicit extension', () => {
      const { imports } = buildScope(
        {
          'util.ts': { source: 'export const x = 1;' },
          // Imports the sibling WITH its `.ts` extension.
          'main.ts': { source: "import { x } from './util.ts';\nexport const y = x + 1;" },
        },
        {},
      );
      expect((imports['./main'] as { y: number }).y).toBe(2);
    });

    it('resolves a forward reference to a later-registered sibling', () => {
      const { imports } = buildScope(
        {
          // `consumer` is listed BEFORE `dep` but imports it — lazy eval makes the
          // registration order irrelevant.
          'consumer.ts': { source: "import { v } from './dep';\nexport const out = v * 2;" },
          'dep.ts': { source: 'export const v = 21;' },
        },
        {},
      );
      expect((imports['./consumer'] as { out: number }).out).toBe(42);
    });

    it('resolves circular imports via in-progress exports (no infinite loop)', () => {
      const { imports } = buildScope(
        {
          'a.ts': {
            source: "import { b } from './b';\nexport const a = 1;\nexport const fromB = () => b;",
          },
          'b.ts': {
            source: "import { a } from './a';\nexport const b = 2;\nexport const fromA = () => a;",
          },
        },
        {},
      );
      expect((imports['./a'] as { a: number }).a).toBe(1);
      expect((imports['./b'] as { b: number }).b).toBe(2);
      // Deferred cross-references see the fully-populated sibling.
      expect((imports['./a'] as { fromB: () => number }).fromB()).toBe(2);
      expect((imports['./b'] as { fromA: () => number }).fromA()).toBe(1);
    });

    it('resolves a directory import to that directory index file', () => {
      const { imports } = buildScope(
        {
          'lib/index.ts': { source: 'export const v = 99;' },
          // Imports the directory, not `./lib/index`.
          'main.ts': { source: "import { v } from './lib';\nexport const out = v;" },
        },
        {},
      );
      expect((imports[`${P}main`] as { out: number }).out).toBe(99);
    });

    it('shares one evaluation of the main between the entry and an importing extra', () => {
      const built = buildScope(
        {
          // Imports a MUTABLE value from the entry; it must be the SAME instance.
          'reader.ts': {
            source: "import { store } from './index';\nexport const read = () => store;",
          },
        },
        {},
        'export const store = { tag: "shared" };\nexport default () => null;',
      );
      // Simulate the runner rendering the entry — which evaluates the main once.
      generateElement({ code: built.runnerCode!, scope: { import: built.imports } });

      const entryStore = (built.imports['./index'] as { store: object }).store;
      const readerStore = (built.imports['./reader'] as { read: () => object }).read();
      // Same instance -> the main was evaluated exactly once and shared.
      expect(readerStore).toBe(entryStore);
    });

    it('does not let the main clobber an extra file that claims the same key', () => {
      const { imports } = buildScope(
        // An explicit root `index.ts` extra also answers `./index`.
        { 'index.ts': { source: "export const which = 'extra';" } },
        {},
        "export const which = 'main';\nexport default () => null;",
      );
      expect((imports['./index'] as { which: string }).which).toBe('extra');
    });

    it('resolves an import to a parent-directory extra (`../`-prefixed key)', () => {
      const { imports } = buildScope(
        {
          // A canonical-mode demo keys a shared file outside the demo folder by `../`.
          '../shared/data.ts': { source: 'export const d = 7;' },
          'main.ts': { source: "import { d } from '../shared/data';\nexport const out = d;" },
        },
        {},
      );
      expect((imports[`${P}main`] as { out: number }).out).toBe(7);
    });

    it('lets a file win over a directory index on the same key (either order)', () => {
      // `foo.ts` and `foo/index.ts` both want `<prefix>foo`; the concrete file
      // wins (Node resolution), and the index stays reachable by its full path.
      const file = { 'foo.ts': { source: "export const w = 'file';" } };
      const dir = { 'foo/index.ts': { source: "export const w = 'dir';" } };
      for (const extraFiles of [
        { ...file, ...dir },
        { ...dir, ...file },
      ]) {
        const { imports } = buildScope(extraFiles, {});
        expect((imports[`${P}foo`] as { w: string }).w).toBe('file');
        expect((imports[`${P}foo/index`] as { w: string }).w).toBe('dir');
      }
    });
  });

  describe('key normalization (configurable storeAt modes)', () => {
    it('strips a leading ./ so a flat `./util.ts` key is not treated as nested', () => {
      const { imports, nested } = buildScope(
        { './util.ts': { source: 'export const x = 1;' } },
        {},
      );
      expect(nested).toBe(false);
      expect((imports['./util'] as { x: number }).x).toBe(1);
    });

    it('resolves subdirectory imports when keys carry a ./ prefix', () => {
      const { imports } = buildScope(
        {
          './lib/data.ts': { source: 'export const d = 5;' },
          './main.ts': { source: "import { d } from './lib/data';\nexport const out = d;" },
        },
        {},
      );
      expect((imports[`${P}main`] as { out: number }).out).toBe(5);
    });
  });
});
