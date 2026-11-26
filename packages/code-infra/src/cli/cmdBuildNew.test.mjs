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
      exports: { '.': './src/index.ts' },
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
  it('keeps every Next.js font loader call assigned to a const', async () => {
    // Mirrors `nextFonts` in `@mui/internal-core-docs`. Next.js rejects a font loader call that
    // isn't assigned to a const, and `minify: 'dce-only'` inlines single-use ones like `deferred`.
    const outDir = await buildPackage({
      'src/index.ts': [
        "import { Inter } from 'next/font/google';",
        "import localFont from 'next/font/local';",
        "export const inter = Inter({ subsets: ['latin'] });",
        "export const regular = localFont({ src: './fonts/Regular.woff2' });",
        "const deferred = localFont({ src: './fonts/Bold.woff2', preload: false });",
        'export const fonts = [regular, deferred, inter];',
      ].join('\n'),
    });

    const esm = await fs.readFile(path.join(outDir, 'index.js'), 'utf8');
    const calls = [...esm.matchAll(/^(.*)\b(?:localFont|Inter)\(/gm)].map(([, before]) => before);
    expect(calls).toEqual(['const inter = ', 'const regular = ', 'const deferred = ']);
  }, 60_000);

  it('starts CJS files with "use strict" before other directives', async () => {
    const outDir = await buildPackage({
      'src/index.ts': ["'use client';", 'export const value = 1;'].join('\n'),
    });

    const cjs = await fs.readFile(path.join(outDir, 'index.cjs'), 'utf8');
    expect(cjs).toMatch(/^"use strict";\s*["']use client["'];/m);
  }, 60_000);
});
