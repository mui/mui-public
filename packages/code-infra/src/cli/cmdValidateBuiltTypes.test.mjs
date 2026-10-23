import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { makeTempDir, writePackage } from '../utils/testUtils.mjs';

const run = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../bin/code-infra.mjs', import.meta.url));
const CLI_TIMEOUT = 120_000;

/**
 * A workspace where `@test/b`'s types import `@test/a`.
 *
 * @param {{ declareA: boolean }} options
 */
async function createWorkspace({ declareA }) {
  const root = await makeTempDir();
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ private: true }));
  await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  /**
   * @param {string} name
   * @param {string} types
   * @param {Record<string, string>} [dependencies]
   */
  const writeTypedPackage = async (name, types, dependencies) => {
    const pkgDir = await writePackage(root, `packages/${name}`, {
      name: `@test/${name}`,
      version: '1.0.0',
      dependencies,
      exports: { '.': { types: './index.d.ts', default: './index.js' } },
      files: ['index.d.ts', 'index.js'],
    });
    await fs.writeFile(path.join(pkgDir, 'index.d.ts'), types);
    await fs.writeFile(path.join(pkgDir, 'index.js'), 'export {};\n');
  };
  await writeTypedPackage('a', 'export type A = string;\n');
  await writeTypedPackage(
    'b',
    "import type { A } from '@test/a';\nexport type B = A;\n",
    declareA ? { '@test/a': 'workspace:*' } : undefined,
  );
  return root;
}

describe('validate-built-types', () => {
  it(
    'passes when every package declares what its types import',
    async () => {
      const root = await createWorkspace({ declareA: true });

      const { stdout } = await run(process.execPath, [CLI_PATH, 'validate-built-types'], {
        cwd: root,
      });

      expect(stdout).toContain('✅ 2 entry points of 2 packages type-check for consumers.');
    },
    CLI_TIMEOUT,
  );

  it(
    'reports a package its types import without declaring it, even when the consumer installed it',
    async () => {
      const root = await createWorkspace({ declareA: false });

      const result = await run(process.execPath, [CLI_PATH, 'validate-built-types'], {
        cwd: root,
      }).then(
        () => null,
        (/** @type {{ code: number, stderr: string }} */ error) => error,
      );

      expect(result?.code).toBe(1);
      expect(result?.stderr).toContain(
        "@test/b/index.d.ts: TS2307 Cannot find module '@test/a' or its corresponding type declarations.",
      );
    },
    CLI_TIMEOUT,
  );
});
