import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ESLint } from 'eslint';
import { describe, it, expect } from 'vitest';
import { makeTempDir } from '../utils/testUtils.mjs';
import { createNodeSupportConfig } from './nodeSupportConfig.mjs';

/**
 * Lints `code` as `relativePath` inside a temporary repository with a `packages/my-package`
 * workspace package, and returns the reported rule ids.
 * @param {Record<string, unknown>} packageJson
 * @param {string} relativePath
 * @param {string} code
 */
async function lintInPackage(packageJson, relativePath, code) {
  const cwd = await makeTempDir();
  const packageDir = path.join(cwd, 'packages/my-package');
  await fs.mkdir(packageDir, { recursive: true });
  await fs.writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: 'my-package', ...packageJson }),
  );
  const filePath = path.join(cwd, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, code);

  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: createNodeSupportConfig(cwd),
  });
  const [result] = await eslint.lintFiles([filePath]);
  return result.messages.map((message) => message.ruleId);
}

const HAS_OWN = 'export const has = (obj, key) => Object.hasOwn(obj, key);\n';
const LOGICAL_ASSIGNMENT = 'export function init(obj) {\n  obj.value ??= 1;\n}\n';
const NODE_14 = { engines: { node: '>=14.0.0' } };

describe('createNodeSupportConfig', () => {
  describe('packages that declare engines.node', () => {
    it('reports built-ins that engines.node does not support', async () => {
      expect(await lintInPackage(NODE_14, 'packages/my-package/src/index.js', HAS_OWN)).toContain(
        'n/no-unsupported-features/es-builtins',
      );
    });

    it('reports syntax that engines.node does not support', async () => {
      expect(
        await lintInPackage(NODE_14, 'packages/my-package/src/index.js', LOGICAL_ASSIGNMENT),
      ).toEqual(['n/no-unsupported-features/es-syntax']);
    });

    it('accepts built-ins and syntax that engines.node supports', async () => {
      expect(
        await lintInPackage(
          { engines: { node: '>=18.0.0' } },
          'packages/my-package/src/index.js',
          HAS_OWN + LOGICAL_ASSIGNMENT,
        ),
      ).toEqual([]);
    });

    it('ignores test files', async () => {
      expect(
        await lintInPackage(NODE_14, 'packages/my-package/src/index.test.js', HAS_OWN),
      ).toEqual([]);
    });

    it('ignores files outside the package sources', async () => {
      expect(await lintInPackage(NODE_14, 'packages/my-package/scripts/build.js', HAS_OWN)).toEqual(
        [],
      );
    });
  });

  describe('packages without engines.node', () => {
    it('ignores their sources, which run on the repository Node.js version', async () => {
      expect(await lintInPackage({}, 'packages/my-package/src/index.js', HAS_OWN)).toEqual([]);
    });
  });
});
