import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';

import { makeTempFiles } from '../utils/testUtils.mjs';
import cmdBuildNew from './cmdBuildNew.mjs';

/**
 * @param {Record<string, string>} sources
 * @returns {Promise<string>} The output directory.
 */
async function buildPackage(sources) {
  const root = await makeTempFiles({
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    'package.json': JSON.stringify({ name: 'root', private: true }),
    'packages/pkg/.browserslistrc': '[stable]\nchrome 120\n\n[node]\nnode 20\n',
    'packages/pkg/package.json': JSON.stringify({
      name: '@acme/pkg',
      version: '1.0.0',
      type: 'module',
      exports: { '.': './src/index.js' },
      publishConfig: { directory: 'build' },
    }),
    ...Object.fromEntries(
      Object.entries(sources).map(([name, contents]) => [`packages/pkg/${name}`, contents]),
    ),
  });
  const cwd = path.join(root, 'packages/pkg');
  const previousCwd = process.cwd();
  process.chdir(cwd);
  onTestFinished(() => process.chdir(previousCwd));

  await /** @type {(args: object) => Promise<void>} */ (cmdBuildNew.handler)({
    bundle: ['esm', 'cjs'],
    copy: [],
    buildTypes: false,
    enableReactCompiler: false,
    cjsCopy: false,
    expand: true,
  });
  return path.join(cwd, 'build');
}

describe('build-new', () => {
  it('keeps single-use constants assigned, as Next.js font loaders require', async () => {
    const outDir = await buildPackage({
      'src/index.js': [
        "import localFont from 'next/font/local';",
        "const deferred = localFont({ src: './font.woff2' });",
        'export const fonts = [deferred];',
      ].join('\n'),
    });

    const esm = await fs.readFile(path.join(outDir, 'index.js'), 'utf8');
    expect(esm).toMatch(/const deferred = localFont\(/);
    expect(esm).toMatch(/const fonts = \[deferred\]/);
  }, 60_000);

  it('starts CJS files with "use strict" before other directives', async () => {
    const outDir = await buildPackage({
      'src/index.js': ["'use client';", 'export const value = 1;'].join('\n'),
    });

    const cjs = await fs.readFile(path.join(outDir, 'index.cjs'), 'utf8');
    expect(cjs).toMatch(/^"use strict";\s*["']use client["'];/m);
  }, 60_000);
});
