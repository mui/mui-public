import * as babel from '@babel/core';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
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

  it('inlines data attributes and CSS variables from the same module', async () => {
    const { code, inlined } = await transform(
      `import * as meta from './MenuDataAttributes';
export const a = meta.open;
export const b = meta.popupWidth;`,
      constantsMap({ open: 'data-open', popupWidth: '--popup-width' }),
    );
    expect(inlined).toBe(2);
    expect(code).toContain('const a = "data-open"');
    expect(code).toContain('const b = "--popup-width"');
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

describe('scanMetadataConstants', () => {
  it('collects only exported const string literals matching data-*', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inline-scan-'));
    try {
      await fs.writeFile(
        path.join(dir, 'MenuDataAttributes.ts'),
        `export const open = 'data-open';
export const closed: string = 'data-closed';
export const popupWidth = '--popup-width';
export const notData = 'plain';
export const endOfOptions = '--';
const notExported = 'data-hidden';
export let mutable = 'data-mutable';`,
      );
      await fs.writeFile(path.join(dir, 'plain.ts'), `export const x = 'hello';`);

      const result = await scanMetadataConstants(['MenuDataAttributes.ts', 'plain.ts'], dir);

      expect(result.size).toBe(1);
      const constants = result.get(path.join(dir, 'MenuDataAttributes.ts')) ?? new Map();
      // a bare `--` is the end-of-options marker, not a custom property
      expect(Object.fromEntries(constants)).toEqual({
        open: 'data-open',
        closed: 'data-closed',
        popupWidth: '--popup-width',
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
