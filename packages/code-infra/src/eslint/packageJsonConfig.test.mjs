import * as path from 'node:path';
import { ESLint } from 'eslint';
import { describe, it, expect } from 'vitest';
import { createPackageJsonConfig } from './packageJsonConfig.mjs';

const eslint = new ESLint({
  cwd: import.meta.dirname,
  overrideConfigFile: true,
  overrideConfig: createPackageJsonConfig(),
});

const PUBLIC_PACKAGE = {
  name: '@mui/my-package',
  version: '1.0.0',
  author: 'MUI Team',
  description: 'My package.',
  license: 'MIT',
  repository: {
    type: 'git',
    url: 'git+https://github.com/mui/mui-public.git',
    directory: 'packages/code-infra/src/eslint/my-package',
  },
  exports: { '.': './index.js', './package.json': './package.json' },
};

const PRIVATE_PACKAGE = {
  name: 'my-app',
  version: '1.0.0',
  private: true,
};

/**
 * Lints a package.json object as if it lived at `my-package/package.json` and
 * returns the reported rule ids.
 * @param {Record<string, unknown>} packageJson
 */
async function lintPackageJson(packageJson) {
  const [result] = await eslint.lintText(JSON.stringify(packageJson, null, 2), {
    filePath: path.join(import.meta.dirname, 'my-package/package.json'),
  });
  return result.messages.map((message) => message.ruleId);
}

describe('createPackageJsonConfig', () => {
  describe('published packages', () => {
    it('accepts a complete package.json', async () => {
      expect(await lintPackageJson(PUBLIC_PACKAGE)).toEqual([]);
    });

    it('accepts a CLI-only package without exports', async () => {
      const { exports, ...packageJson } = PUBLIC_PACKAGE;
      expect(await lintPackageJson({ ...packageJson, bin: './cli.js' })).toEqual([]);
    });

    it('accepts the object form of browser', async () => {
      expect(
        await lintPackageJson({ ...PUBLIC_PACKAGE, browser: { 'dep/cjs/a.js': 'dep/esm/a.js' } }),
      ).toEqual([]);
    });

    it('requires a license', async () => {
      const { license, ...packageJson } = PUBLIC_PACKAGE;
      expect(await lintPackageJson(packageJson)).toContain('package-json/require-license');
    });

    it('requires an SPDX license', async () => {
      expect(await lintPackageJson({ ...PUBLIC_PACKAGE, license: 'MIT License' })).toContain(
        'package-json/valid-license',
      );
    });

    it('requires the author to be MUI Team', async () => {
      const { author, ...packageJson } = PUBLIC_PACKAGE;
      expect(await lintPackageJson(packageJson)).toContain('package-json/require-author');
      expect(await lintPackageJson({ ...PUBLIC_PACKAGE, author: 'Someone Else' })).toContain(
        'no-restricted-syntax',
      );
    });

    it('requires repository.directory to match the package location', async () => {
      expect(
        await lintPackageJson({
          ...PUBLIC_PACKAGE,
          repository: { ...PUBLIC_PACKAGE.repository, directory: 'packages/other' },
        }),
      ).toContain('package-json/valid-repository-directory');
    });
  });

  describe('private packages', () => {
    it('accepts a minimal package.json', async () => {
      expect(await lintPackageJson(PRIVATE_PACKAGE)).toEqual([]);
    });

    it('disallows a license', async () => {
      expect(await lintPackageJson({ ...PRIVATE_PACKAGE, license: 'MIT' })).toEqual([
        'package-json/restrict-private-properties',
      ]);
    });

    it('disallows files', async () => {
      expect(await lintPackageJson({ ...PRIVATE_PACKAGE, files: ['build'] })).toEqual([
        'package-json/restrict-private-properties',
      ]);
    });

    it('accepts a publish directory for code-infra build', async () => {
      expect(
        await lintPackageJson({ ...PRIVATE_PACKAGE, publishConfig: { directory: 'build' } }),
      ).toEqual([]);
    });
  });
});
