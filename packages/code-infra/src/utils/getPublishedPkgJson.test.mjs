import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { expect, it } from 'vitest';

import { getPublishedPkgJson } from './getPublishedPkgJson.mjs';
import { makeTempDir } from './testUtils.mjs';

it('returns the published manifest without changing the source', async () => {
  const cwd = await makeTempDir();
  const outputDir = path.join(cwd, 'build');
  await Promise.all(
    ['src/index.ts', 'src/cli.ts', 'build/index.js', 'build/cli.js'].map(async (file) => {
      await fs.mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
      await fs.writeFile(path.join(cwd, file), '');
    }),
  );
  /** @type {import('../cli/packageJson').PackageJson} */
  const source = {
    name: '@test/example',
    version: '1.0.0',
    scripts: { build: 'code-infra build' },
    exports: { '.': './src/index.ts' },
    imports: { '#cli': './src/cli.ts' },
    bin: { example: './src/cli.ts' },
    devDependencies: { vitest: '*' },
    publishConfig: { access: 'public', directory: 'build' },
  };
  const snapshot = structuredClone(source);

  const published = await getPublishedPkgJson({
    packageJson: source,
    bundles: ['esm'],
    outputDir,
    cwd,
    addTypes: false,
    packageType: 'module',
  });

  expect(published).toEqual({
    name: '@test/example',
    version: '1.0.0',
    publishConfig: { access: 'public' },
    type: 'module',
    exports: {
      '.': { import: './index.js', default: './index.js' },
      './package.json': './package.json',
    },
    imports: { '#cli': { import: './cli.js', default: './cli.js' } },
    bin: { example: './cli.js' },
  });
  expect(source).toEqual(snapshot);
});
