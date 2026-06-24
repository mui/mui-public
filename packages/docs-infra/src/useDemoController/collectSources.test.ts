import { describe, it, expect } from 'vitest';
import { collectSources } from './collectSources';
import { SCOPE_IMPORT_PREFIX } from './constants';

const P = SCOPE_IMPORT_PREFIX;

describe('collectSources', () => {
  it('plans a flat JS file under its extension-less and full-name specifiers', () => {
    const { nested, modules, styles, entry } = collectSources({
      'util.ts': { source: 'export const x = 1;' },
    });
    expect(nested).toBe(false);
    expect(styles).toEqual([]);
    expect(entry).toBeUndefined();
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({
      fileName: 'util.ts',
      source: 'export const x = 1;',
      primaryKeys: ['./util', './util.ts'],
    });
    expect(modules[0].directoryKey).toBeUndefined();
  });

  it('strips a leading ./ so a flat `./util.ts` key is not treated as nested', () => {
    const { nested, modules } = collectSources({ './util.ts': { source: 'export const x = 1;' } });
    expect(nested).toBe(false);
    expect(modules[0].primaryKeys).toEqual(['./util', './util.ts']);
  });

  it('routes `*.module.css` to a scoped style, `*.css` to a global one', () => {
    const { styles } = collectSources({
      'theme.module.css': { source: '.btn { color: red; }' },
      'global.css': { source: 'body { margin: 0; }' },
    });
    expect(styles).toEqual([
      {
        file: expect.any(Object),
        fileName: 'theme.module.css',
        source: '.btn { color: red; }',
        key: './theme.module.css',
        isModule: true,
      },
      {
        file: expect.any(Object),
        fileName: 'global.css',
        source: 'body { margin: 0; }',
        key: './global.css',
        isModule: false,
      },
    ]);
  });

  it('flips to nested when a file lives in a subdirectory, prefixing keys', () => {
    const { nested, modules } = collectSources({
      'lib/util.ts': { source: 'export const x = 42;' },
    });
    expect(nested).toBe(true);
    expect(modules[0].primaryKeys).toEqual([`${P}lib/util`, `${P}lib/util.ts`]);
  });

  it('carries the RAW source even when nested (absolutize happens at transpile time)', () => {
    const source = "import { x } from '../lib/util';\nexport const y = x;";
    const { modules } = collectSources({
      'lib/util.ts': { source: 'export const x = 42;' },
      'feature/use.ts': { source },
    });
    const use = modules.find((module) => module.fileName === 'feature/use.ts');
    // Not rewritten here — still the literal `../lib/util` specifier.
    expect(use?.source).toBe(source);
  });

  it('gives an `index` file a directory key alongside its own', () => {
    const { modules } = collectSources({ 'lib/index.ts': { source: 'export const v = 1;' } });
    expect(modules[0].primaryKeys).toEqual([`${P}lib/index`, `${P}lib/index.ts`]);
    expect(modules[0].directoryKey).toBe(`${P}lib`);
  });

  it('skips a file whose source is not a string', () => {
    const { modules, styles } = collectSources({ 'util.ts': { source: null } });
    expect(modules).toEqual([]);
    expect(styles).toEqual([]);
  });

  it('plans the main source as the entry under `./index` (flat, raw)', () => {
    const { entry } = collectSources(undefined, 'export default () => null;');
    expect(entry).toEqual({
      source: 'export default () => null;',
      fileName: 'index.tsx',
      primaryKeys: ['./index', './index.tsx'],
    });
  });

  it('prefixes the entry keys when nested but keeps its source raw', () => {
    const main = "import { x } from './lib/util';\nexport default () => x;";
    const { entry } = collectSources({ 'lib/util.ts': { source: 'export const x = 1;' } }, main);
    expect(entry).toEqual({
      source: main, // raw — absolutize runs at transpile time
      fileName: 'index.tsx',
      primaryKeys: [`${P}index`, `${P}index.tsx`],
    });
  });
});
