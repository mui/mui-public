import { describe, expect, it } from 'vitest';
import { createPackageDiff } from './packageDiff';
import type { DiffOptions, FileDiffResult } from './packageDiff';
import type { PackageContents } from '../packageDownload';

function createPackage(version: string, files: Record<string, string>): PackageContents {
  return {
    name: 'pkg',
    version,
    resolved: `pkg@${version}`,
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
  };
}

function patchText(file: FileDiffResult): string {
  return file.blocks.map((block) => block.text).join('');
}

// The diffs of all changed files, leaving out the ones that turn out unchanged
async function diffAll(
  oldPackage: PackageContents,
  newPackage: PackageContents,
  options: DiffOptions,
): Promise<FileDiffResult[]> {
  const diff = createPackageDiff(oldPackage, newPackage);
  const results = await Promise.all(diff.files.map((file) => diff.diffFile(file, options)));
  return results.filter((result) => result !== null);
}

const ignoreWhitespace = false;

describe('createPackageDiff', () => {
  it('lists added, removed and modified files sorted by path', async () => {
    const oldPackage = createPackage('1.0.0', {
      'b.js': 'b;\n',
      'c.js': 'c;\n',
      'same.js': 'same;\n',
    });
    const newPackage = createPackage('2.0.0', {
      'a.js': 'a;\n',
      'b.js': 'b2;\n',
      'same.js': 'same;\n',
    });
    const expectedFiles = [
      { path: 'a.js', changeType: 'added' },
      { path: 'b.js', changeType: 'modified' },
      { path: 'c.js', changeType: 'removed' },
    ];

    // Listed right away, before any file is diffed
    expect(createPackageDiff(oldPackage, newPackage).files).toEqual(expectedFiles);

    const files = await diffAll(oldPackage, newPackage, {
      ignoreWhitespace,
      format: false,
      removeComments: false,
    });
    expect(files.map(({ path, changeType }) => ({ path, changeType }))).toEqual(expectedFiles);
    expect(files[1].blocks).toEqual([
      { text: '--- b.js\tpkg@1.0.0\n+++ b.js\tpkg@2.0.0\n', className: 'diff-preamble' },
      { text: '@@ -1,1 +1,1 @@\n', className: 'diff-hunk' },
      { text: '-b;\n', className: 'diff-removed' },
      { text: '+b2;\n', className: 'diff-added' },
      { text: '\n', className: null },
    ]);
  });

  it('drops files that only differ in formatting when formatting', async () => {
    const oldPackage = createPackage('1.0.0', {
      'index.js': 'export const a = "x"\n',
      'index.d.ts': 'export declare const a: string\n',
      'package.json': '{"name":"pkg"}',
      'styles.css': 'a{color:red}',
    });
    const newPackage = createPackage('2.0.0', {
      'index.js': "export const a = 'x';\n",
      'index.d.ts': 'export declare const a: string;\n',
      'package.json': '{\n  "name": "pkg"\n}\n',
      'styles.css': 'a {\n  color: red;\n}\n',
    });

    const raw = await diffAll(oldPackage, newPackage, {
      ignoreWhitespace,
      format: false,
      removeComments: false,
    });
    expect(raw.map((file) => file.path)).toEqual([
      'index.d.ts',
      'index.js',
      'package.json',
      'styles.css',
    ]);

    const formatted = await diffAll(oldPackage, newPackage, {
      ignoreWhitespace,
      format: true,
      removeComments: false,
    });
    expect(formatted).toEqual([]);
  });

  it('diffs the formatted code of files with real changes', async () => {
    const [file] = await diffAll(
      createPackage('1.0.0', { 'index.js': 'export function f(){return "a"}' }),
      createPackage('2.0.0', { 'index.js': "export function f() {\n  return 'b';\n}\n" }),
      { ignoreWhitespace, format: true, removeComments: false },
    );

    expect(file.formatError).toBeUndefined();
    expect(patchText(file)).toContain('-  return "a";\n+  return "b";\n');
  });

  it('falls back to the raw contents when a file fails to parse', async () => {
    const [file] = await diffAll(
      createPackage('1.0.0', { 'index.js': 'export const a = "x"\n' }),
      createPackage('2.0.0', { 'index.js': 'export const = ;\n' }),
      { ignoreWhitespace, format: true, removeComments: false },
    );

    expect(file.formatError).toEqual(expect.any(String));
    expect(patchText(file)).toContain('-export const a = "x"\n+export const = ;\n');
  });

  it('leaves files without a known parser as they are', async () => {
    const [file] = await diffAll(
      createPackage('1.0.0', { 'index.js.map': '{"version":3}' }),
      createPackage('2.0.0', { 'index.js.map': '{ "version": 3 }' }),
      { ignoreWhitespace, format: true, removeComments: false },
    );

    expect(file.path).toBe('index.js.map');
    expect(file.formatError).toBeUndefined();
  });

  it('drops files that only differ in comments when removing comments', async () => {
    const oldPackage = createPackage('1.0.0', {
      'index.js': '/** @license MIT */\nexport const a = /*#__PURE__*/ f(); // trailing\n',
      'index.d.ts': '/**\n * Docs.\n */\nexport declare const a: string;\n',
      'tsconfig.json': '{ "a": 1 }',
      'styles.css': 'a { color: red; }',
    });
    const newPackage = createPackage('2.0.0', {
      'index.js': 'export const a = f();\n',
      'index.d.ts': 'export declare const a: string;\n',
      'tsconfig.json': '{\n  // comment\n  "a": 1\n}',
      'styles.css': '/* header */\na {\n  /* inner */\n  color: red;\n}\n',
    });

    const withComments = await diffAll(oldPackage, newPackage, {
      ignoreWhitespace,
      format: true,
      removeComments: false,
    });
    expect(withComments.map((file) => file.path)).toEqual([
      'index.d.ts',
      'index.js',
      'styles.css',
      'tsconfig.json',
    ]);

    const withoutComments = await diffAll(oldPackage, newPackage, {
      ignoreWhitespace,
      format: true,
      removeComments: true,
    });
    expect(withoutComments).toEqual([]);
  });

  it('keeps comment syntax inside strings when removing comments', async () => {
    const [file] = await diffAll(
      createPackage('1.0.0', { 'index.js': 'const a = "/* x */"; // c\n' }),
      createPackage('2.0.0', { 'index.js': 'const a = "// y";\n' }),
      { ignoreWhitespace, format: true, removeComments: true },
    );

    expect(patchText(file)).toContain(`-const a = "/* x */";\n+const a = "// y";\n`);
  });
});
