import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ESLint } from 'eslint';
import { describe, it, expect } from 'vitest';
import { makeTempDir, writePackage } from '../utils/testUtils.mjs';
import { createBaseConfig, createNodeSupportConfig } from './index.mjs';

/**
 * Lints `code` as `relativePath` inside a temporary repository that contains a package at
 * `packageDir`, and returns the reported rule ids.
 * @param {Record<string, unknown>} packageJson
 * @param {string} relativePath
 * @param {string} code
 * @param {object} [options]
 * @param {string} [options.packageDir]
 * @param {'node-support' | 'base'} [options.config]
 */
async function lintInPackage(packageJson, relativePath, code, options = {}) {
  const { packageDir = 'packages/my-package', config = 'node-support' } = options;
  const cwd = await makeTempDir();
  await writePackage(cwd, packageDir, { name: 'my-package', ...packageJson });
  // Read by eslint-plugin-compat in the base config.
  await fs.writeFile(path.join(cwd, '.browserslistrc'), '[stable]\nchrome 120\n');
  const filePath = path.join(cwd, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, code);

  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig:
      config === 'base'
        ? createBaseConfig({ baseDirectory: cwd, markdown: false })
        : createNodeSupportConfig(cwd),
  });
  const [result] = await eslint.lintFiles([filePath]);
  return result.messages
    .map((message) => message.ruleId)
    .filter((ruleId) => ruleId?.startsWith('n/'));
}

const HAS_OWN = 'export const has = (obj, key) => Object.hasOwn(obj, key);\n';
const LOGICAL_ASSIGNMENT = 'export function init(obj) {\n  obj.value ??= 1;\n}\n';
const TIMERS_PROMISES =
  "import { setTimeout } from 'node:timers/promises';\n\nexport const wait = () => setTimeout(1);\n";
const NODE_14 = { engines: { node: '>=14.0.0' } };

describe('createNodeSupportConfig', () => {
  describe('packages that declare engines.node', () => {
    it('reports ECMAScript built-ins that engines.node does not support', async () => {
      expect(await lintInPackage(NODE_14, 'packages/my-package/src/index.js', HAS_OWN)).toEqual([
        'n/no-unsupported-features/es-builtins',
        'n/no-unsupported-features/es-syntax',
      ]);
    });

    it('reports syntax that engines.node does not support', async () => {
      expect(
        await lintInPackage(NODE_14, 'packages/my-package/src/index.js', LOGICAL_ASSIGNMENT),
      ).toEqual(['n/no-unsupported-features/es-syntax']);
    });

    it('reports Node.js APIs that engines.node does not support', async () => {
      expect(
        await lintInPackage(NODE_14, 'packages/my-package/src/index.js', TIMERS_PROMISES),
      ).toEqual([
        'n/no-unsupported-features/node-builtins',
        'n/no-unsupported-features/node-builtins',
      ]);
    });

    it('accepts built-ins, syntax and Node.js APIs that engines.node supports', async () => {
      expect(
        await lintInPackage(
          { engines: { node: '>=18.0.0' } },
          'packages/my-package/src/index.js',
          HAS_OWN + LOGICAL_ASSIGNMENT + TIMERS_PROMISES,
        ),
      ).toEqual([]);
    });

    it('lints packages in other packages* directories', async () => {
      expect(
        await lintInPackage(NODE_14, 'packages-internal/my-package/src/index.js', HAS_OWN, {
          packageDir: 'packages-internal/my-package',
        }),
      ).toContain('n/no-unsupported-features/es-builtins');
    });

    it('ignores packages outside the packages* directories', async () => {
      expect(
        await lintInPackage(NODE_14, 'apps/my-app/src/index.js', HAS_OWN, {
          packageDir: 'apps/my-app',
        }),
      ).toEqual([]);
    });

    it('accepts browser APIs that Node.js only exposes experimentally', async () => {
      expect(
        await lintInPackage(
          { engines: { node: '>=22.0.0' } },
          'packages/my-package/src/index.js',
          'export const read = (key) => localStorage.getItem(key) ?? navigator.language;\n',
        ),
      ).toEqual([]);
    });

    it('ignores test files', async () => {
      expect(
        await lintInPackage(NODE_14, 'packages/my-package/src/index.test.js', HAS_OWN),
      ).toEqual([]);
      expect(await lintInPackage(NODE_14, 'packages/my-package/src/user.spec.js', HAS_OWN)).toEqual(
        [],
      );
    });

    it('ignores files outside the package sources', async () => {
      expect(await lintInPackage(NODE_14, 'packages/my-package/scripts/build.js', HAS_OWN)).toEqual(
        [],
      );
    });
  });

  it('resolves package sources against baseDirectory, not the ESLint base path', async () => {
    const cwd = await makeTempDir();
    const baseDirectory = path.join(cwd, 'nested');
    await writePackage(baseDirectory, 'packages/my-package', { name: 'my-package', ...NODE_14 });
    const filePath = path.join(baseDirectory, 'packages/my-package/src/index.js');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, HAS_OWN);

    const eslint = new ESLint({
      cwd,
      overrideConfigFile: true,
      overrideConfig: createNodeSupportConfig(baseDirectory),
    });
    const [result] = await eslint.lintFiles([filePath]);
    expect(result.messages.map((message) => message.ruleId)).toContain(
      'n/no-unsupported-features/es-builtins',
    );
  });

  describe('packages without engines.node', () => {
    it('ignores their sources, which run on the repository Node.js version', async () => {
      expect(await lintInPackage({}, 'packages/my-package/src/index.js', HAS_OWN)).toEqual([]);
    });
  });

  describe('createBaseConfig', () => {
    it('includes the node support rules', async () => {
      expect(
        await lintInPackage(NODE_14, 'packages/my-package/src/index.js', HAS_OWN, {
          config: 'base',
        }),
      ).toEqual(['n/no-unsupported-features/es-builtins', 'n/no-unsupported-features/es-syntax']);
    });
  });
});
