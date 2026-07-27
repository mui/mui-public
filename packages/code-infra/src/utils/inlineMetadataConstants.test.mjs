import * as babel from '@babel/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { makeTempDir } from './testUtils.mjs';
import {
  createInlineMetadataConstantsPlugin,
  scanMetadataConstants,
} from './inlineMetadataConstants.mjs';

const MODULE_DIR = '/project/menu';
const METADATA = path.join(MODULE_DIR, 'MenuDataAttributes.ts');

/**
 * Transforms a source string with only the inline plugin, mirroring how the rolldown build
 * runs it (relative imports resolved against `filename`).
 *
 * @param {string} code
 * @param {Map<string, Map<string, string>>} constantsByModule
 * @returns {Promise<{ code: string, inlined: number }>}
 */
async function transform(code, constantsByModule) {
  const stats = { inlined: 0 };
  const result = await babel.transformAsync(code, {
    filename: path.join(MODULE_DIR, 'Menu.tsx'),
    configFile: false,
    babelrc: false,
    sourceType: 'module',
    parserOpts: { plugins: ['typescript'] },
    plugins: [createInlineMetadataConstantsPlugin({ constantsByModule, stats })],
  });
  return { code: result?.code ?? '', inlined: stats.inlined };
}

/**
 * @param {Record<string, string>} entries
 * @returns {Map<string, Map<string, string>>}
 */
function constantsMap(entries) {
  return new Map([[METADATA, new Map(Object.entries(entries))]]);
}

/**
 * Writes the given sources to a temp dir and scans them, keyed by basename.
 *
 * @param {Record<string, string>} filesByName
 * @returns {Promise<Map<string, Map<string, string>>>}
 */
async function scanFiles(filesByName) {
  const dir = await makeTempDir();
  await Promise.all(
    Object.entries(filesByName).map(([name, source]) => fs.writeFile(path.join(dir, name), source)),
  );
  const result = await scanMetadataConstants(Object.keys(filesByName), dir);
  return new Map([...result].map(([id, constants]) => [path.basename(id), constants]));
}

describe('createInlineMetadataConstantsPlugin', () => {
  it('inlines namespace member access and drops the fully consumed import', async () => {
    const { code, inlined } = await transform(
      `import * as MenuDataAttributes from './MenuDataAttributes';
export const props = { [MenuDataAttributes.open]: '', [MenuDataAttributes.closed]: '' };`,
      constantsMap({ open: 'data-open', closed: 'data-closed' }),
    );
    expect(inlined).toBe(2);
    expect(code).not.toContain('MenuDataAttributes');
    expect(code).toContain('"data-open"');
    expect(code).toContain('"data-closed"');
  });

  it('inlines computed and named-import references', async () => {
    const { code } = await transform(
      `import * as ns from './MenuDataAttributes';
import { closed } from './MenuDataAttributes';
export const a = ns['open'];
export const b = closed;`,
      constantsMap({ open: 'data-open', closed: 'data-closed' }),
    );
    expect(code).toContain('const a = "data-open"');
    expect(code).toContain('const b = "data-closed"');
    expect(code).not.toContain('MenuDataAttributes');
  });

  it('keeps the namespace import for members that are not inlinable', async () => {
    const { code, inlined } = await transform(
      `import * as ns from './MenuDataAttributes';
export const a = ns.open;
export const b = ns.notData;`,
      constantsMap({ open: 'data-open' }),
    );
    expect(inlined).toBe(1);
    expect(code).toContain('"data-open"');
    // still needed for the non-data member
    expect(code).toContain('ns.notData');
    expect(code).toContain("from './MenuDataAttributes'");
  });

  it('does not inline a shadowing local binding', async () => {
    const { code } = await transform(
      `import { open } from './MenuDataAttributes';
export function f(open) { return open; }
export const g = open;`,
      constantsMap({ open: 'data-open' }),
    );
    // the parameter reference is untouched...
    expect(code).toContain('function f(open) {\n  return open;\n}');
    // ...while the module-scope reference is inlined
    expect(code).toContain('const g = "data-open"');
  });

  it('ignores constants whose value is not a data attribute', async () => {
    const { code, inlined } = await transform(
      `import { plain } from './MenuDataAttributes';
export const a = plain;`,
      constantsMap({}),
    );
    expect(inlined).toBe(0);
    expect(code).toContain('plain');
  });

  it('leaves imports that do not resolve to a scanned module untouched', async () => {
    const { code, inlined } = await transform(
      `import { open } from './Unknown';
export const a = open;`,
      constantsMap({ open: 'data-open' }),
    );
    expect(inlined).toBe(0);
    expect(code).toContain("from './Unknown'");
  });

  it('does not inline a reference inside a `typeof` type position', async () => {
    const { code, inlined } = await transform(
      `import { open } from './MenuDataAttributes';
export type Props = Record<typeof open, string>;
export const a = open;`,
      constantsMap({ open: 'data-open' }),
    );
    // the value reference is inlined...
    expect(code).toContain('const a = "data-open"');
    // ...but the type-position reference stays an identifier
    expect(code).toContain('typeof open');
    expect(code).not.toContain('typeof "data-open"');
    // and the import is kept because the type still needs the binding
    expect(code).toContain("from './MenuDataAttributes'");
    expect(inlined).toBe(1);
  });

  it('does not inline a namespace member inside a `typeof` type position', async () => {
    const { code } = await transform(
      `import * as ns from './MenuDataAttributes';
export type Props = Record<typeof ns.open, string>;
export const a = ns.open;`,
      constantsMap({ open: 'data-open' }),
    );
    expect(code).toContain('const a = "data-open"');
    expect(code).toContain('typeof ns.open');
    expect(code).not.toContain('typeof "data-open"');
    expect(code).toContain("from './MenuDataAttributes'");
  });

  it('inlines CSS custom properties', async () => {
    const { code, inlined } = await transform(
      `import * as vars from './MenuDataAttributes';
import { popupHeight } from './MenuDataAttributes';
export const styles = { [vars.popupWidth]: '10px', [popupHeight]: '20px' };`,
      constantsMap({ popupWidth: '--popup-width', popupHeight: '--popup-height' }),
    );
    expect(inlined).toBe(2);
    expect(code).toContain('"--popup-width"');
    expect(code).toContain('"--popup-height"');
    expect(code).not.toContain('MenuDataAttributes');
  });

  it('ignores bare (non-relative) imports', async () => {
    const { code, inlined } = await transform(
      `import { open } from 'some-package';
export const a = open;`,
      constantsMap({ open: 'data-open' }),
    );
    expect(inlined).toBe(0);
    expect(code).toContain("from 'some-package'");
  });
});

describe('scanMetadataConstants forwarding exports', () => {
  it('follows a namespace-member alias to the literal', async () => {
    const scanned = await scanFiles({
      'common.ts': `export const popupOpen = 'data-popup-open';`,
      'trigger.ts': `import * as Common from './common';
export const popupOpen = Common.popupOpen;`,
    });
    expect(Object.fromEntries(scanned.get('trigger.ts') ?? new Map())).toEqual({
      popupOpen: 'data-popup-open',
    });
  });

  it('follows a named-import alias and a re-export', async () => {
    const scanned = await scanFiles({
      'common.ts': `export const open = 'data-open';
export const width = '--popup-width';`,
      'aliased.ts': `import { open as commonOpen } from './common';
export const open = commonOpen;
export { width } from './common';`,
    });
    expect(Object.fromEntries(scanned.get('aliased.ts') ?? new Map())).toEqual({
      open: 'data-open',
      width: '--popup-width',
    });
  });

  it('follows a chain across several modules', async () => {
    const scanned = await scanFiles({
      'a.ts': `export const open = 'data-open';`,
      'b.ts': `import * as A from './a';
export const open = A.open;`,
      'c.ts': `import * as B from './b';
export const open = B.open;`,
    });
    expect(Object.fromEntries(scanned.get('c.ts') ?? new Map())).toEqual({ open: 'data-open' });
  });

  it('does not hang on a cycle and resolves nothing for it', async () => {
    const scanned = await scanFiles({
      'x.ts': `import * as Y from './y';
export const open = Y.open;`,
      'y.ts': `import * as X from './x';
export const open = X.open;`,
    });
    expect(scanned.get('x.ts')).toBeUndefined();
    expect(scanned.get('y.ts')).toBeUndefined();
  });

  it('ignores aliases that do not reach an inlinable literal', async () => {
    const scanned = await scanFiles({
      'common.ts': `export const plain = 'hello';`,
      'aliased.ts': `import * as Common from './common';
export const plain = Common.plain;
export const external = someGlobal;`,
    });
    expect(scanned.get('aliased.ts')).toBeUndefined();
  });
});

describe('scanMetadataConstants', () => {
  it('collects only exported const string literals that are data attributes or CSS variables', async () => {
    const scanned = await scanFiles({
      'MenuDataAttributes.ts': `export const open = 'data-open';
export const closed: string = 'data-closed';
export const popupWidth = '--popup-width';
export const notData = 'plain';
export const endOfOptions = '--';
const notExported = 'data-hidden';
export let mutable = 'data-mutable';`,
      'plain.ts': `export const x = 'hello';`,
    });

    expect(scanned.size).toBe(1);
    // a bare `--` is the end-of-options marker, not a custom property
    expect(Object.fromEntries(scanned.get('MenuDataAttributes.ts') ?? new Map())).toEqual({
      open: 'data-open',
      closed: 'data-closed',
      popupWidth: '--popup-width',
    });
  });
});
