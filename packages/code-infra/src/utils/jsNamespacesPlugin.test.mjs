import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { rolldown } from 'rolldown';
import { describe, expect, it } from 'vitest';

import { jsNamespacesPlugin } from './jsNamespacesPlugin.mjs';
import { makeTempFiles } from './testUtils.mjs';

// `import { x_exports }` reads the `__exportAll()` object bundlers can't tree-shake.
const NAMED_NAMESPACE = /\{[^}]*_exports[^}]*\} from/;

/**
 * Builds the `src` entries unbundled to `build` and returns the output directory.
 * @param {Record<string, string>} files
 * @param {string[]} entries
 * @param {import('rolldown').Plugin[]} plugins
 */
async function build(files, entries = ['index.js'], plugins = [jsNamespacesPlugin()]) {
  const cwd = await makeTempFiles(files);
  const bundle = await rolldown({
    cwd,
    input: entries.map((entry) => path.join(cwd, 'src', entry)),
    external: [/^[^./]/],
    plugins,
  });
  const outDir = path.join(cwd, 'build');
  await bundle.write({
    dir: outDir,
    format: 'es',
    preserveModules: true,
    preserveModulesRoot: path.join(cwd, 'src'),
  });
  return outDir;
}

describe('jsNamespacesPlugin', () => {
  // Fails once Rolldown keeps namespace re-exports, so the plugin can go:
  // https://github.com/rolldown/rolldown/issues/6669
  it('is still needed', async () => {
    const outDir = await build(
      {
        'src/index.js': "export * as Grid from './parts.js';",
        'src/parts.js': "export const Root = 'root';",
      },
      ['index.js'],
      [],
    );

    expect(await fs.readFile(path.join(outDir, 'parts.js'), 'utf8')).toContain('__exportAll');
  });

  it('imports namespace re-exports with import * as', async () => {
    const outDir = await build({
      'src/index.js': "export * as Grid from './parts.js';",
      'src/parts.js': "export const Root = 'root';\nexport const Item = 'item';",
    });

    const index = await fs.readFile(path.join(outDir, 'index.js'), 'utf8');
    const parts = await fs.readFile(path.join(outDir, 'parts.js'), 'utf8');
    expect(index).toContain('* as');
    expect(index).not.toMatch(NAMED_NAMESPACE);
    expect(parts).not.toContain('__exportAll');
    const { Grid } = await import(path.join(outDir, 'index.js'));
    expect({ ...Grid }).toEqual({ Item: 'item', Root: 'root' });
  });

  it('imports names from external star re-exports by name', async () => {
    const outDir = await build(
      {
        'node_modules/external/package.json': JSON.stringify({ name: 'external', type: 'module' }),
        'node_modules/external/index.js': 'export const useExternal = () => 1;',
        'src/index.js': "export { Shape } from './Shape.js';",
        'src/Shape.js':
          "import { useExternal } from './hooks/index.js';\nexport const Shape = () => useExternal();",
        'src/hooks/index.js': "export * from 'external';\nexport const useLocal = () => 2;",
      },
      ['index.js', 'hooks/index.js'],
    );

    const shape = await fs.readFile(path.join(outDir, 'Shape.js'), 'utf8');
    const hooks = await fs.readFile(path.join(outDir, 'hooks/index.js'), 'utf8');
    expect(shape).not.toMatch(NAMED_NAMESPACE);
    expect(hooks).not.toContain('__exportAll');
    expect((await import(path.join(outDir, 'index.js'))).Shape()).toBe(1);
  });

  it('keeps namespaces whose members Rolldown inlines', async () => {
    const outDir = await build({
      'src/index.js': "export * as Parts from './parts.js';",
      'src/parts.js':
        "export const a = 1;\nexport const b = 'b';\nexport function c() {\n  return a;\n}",
    });

    const { Parts } = await import(path.join(outDir, 'index.js'));
    expect({ a: Parts.a, b: Parts.b, c: Parts.c() }).toEqual({ a: 1, b: 'b', c: 1 });
  });

  it('keeps namespaces the module imports itself', async () => {
    const outDir = await build({
      'src/index.js': "export * as Parts from './parts.js';",
      'src/parts.js':
        "import * as self from './parts.js';\nexport function getParts() {\n  return self;\n}",
    });

    const { Parts } = await import(path.join(outDir, 'index.js'));
    expect(Parts.getParts()).toBe(Parts);
  });

  it('keeps quoted export names', async () => {
    const outDir = await build({
      'src/index.js': "export * as 'module.exports' from './parts.js';",
      'src/parts.js': "export const Root = 'root';",
    });

    expect((await import(path.join(outDir, 'index.js')))['module.exports'].Root).toBe('root');
  });
});
