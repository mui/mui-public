import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { makeTempDir, writePackage } from '../utils/testUtils.mjs';

const run = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../bin/code-infra.mjs', import.meta.url));
const CLI_TIMEOUT = 30_000;

describe('netlify-ignore', () => {
  it.each([
    { target: '@test/app', name: '@test/app' },
    { target: './apps/app', name: '@test/app' },
    { target: './apps/app', name: undefined },
  ])(
    'tracks transitive dependencies for $target (name: $name)',
    async ({ target, name }) => {
      const root = await makeTempDir();
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ private: true }));
      await fs.writeFile(
        path.join(root, 'pnpm-workspace.yaml'),
        'packages:\n  - apps/*\n  - packages/*\n',
      );
      const app = await writePackage(root, 'apps/app', {
        ...(name ? { name } : {}),
        private: true,
        dependencies: { '@test/lib': 'workspace:*' },
      });
      await writePackage(root, 'packages/lib', {
        name: '@test/lib',
        version: '1.0.0',
        dependencies: { '@test/leaf': 'workspace:*' },
      });
      await writePackage(root, 'packages/leaf', { name: '@test/leaf', version: '1.0.0' });
      const configPath = path.join(app, 'netlify.toml');
      await fs.writeFile(configPath, '[build]\n  ignore = "false"\n');

      await run(process.execPath, [CLI_PATH, 'netlify-ignore', target], { cwd: root });

      expect(await fs.readFile(configPath, 'utf8')).toBe(
        '[build]\n  ignore = """cd ../../ && [ "$CONTEXT" = "deploy-preview" ] && git fetch origin master --depth=500 -q && git diff --quiet FETCH_HEAD...$COMMIT_REF -- apps/app packages/leaf packages/lib pnpm-lock.yaml"""\n',
      );
    },
    CLI_TIMEOUT,
  );
});
