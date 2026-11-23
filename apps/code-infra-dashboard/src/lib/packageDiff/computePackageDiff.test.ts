import { describe, expect, it } from 'vitest';
import { computePackageDiff } from './computePackageDiff';
import type { FileDiffResult } from './computePackageDiff';
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

const ignoreWhitespace = false;

describe('computePackageDiff', () => {
  it('lists added, removed and modified files sorted by path', async () => {
    const files = await computePackageDiff(
      createPackage('1.0.0', { 'b.js': 'b;\n', 'c.js': 'c;\n', 'same.js': 'same;\n' }),
      createPackage('2.0.0', { 'a.js': 'a;\n', 'b.js': 'b2;\n', 'same.js': 'same;\n' }),
      { ignoreWhitespace, format: false },
    );

    expect(files.map(({ path, changeType }) => ({ path, changeType }))).toEqual([
      { path: 'a.js', changeType: 'added' },
      { path: 'b.js', changeType: 'modified' },
      { path: 'c.js', changeType: 'removed' },
    ]);
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

    const raw = await computePackageDiff(oldPackage, newPackage, {
      ignoreWhitespace,
      format: false,
    });
    expect(raw.map((file) => file.path)).toEqual([
      'index.d.ts',
      'index.js',
      'package.json',
      'styles.css',
    ]);

    const formatted = await computePackageDiff(oldPackage, newPackage, {
      ignoreWhitespace,
      format: true,
    });
    expect(formatted).toEqual([]);
  });

  it('diffs the formatted code of files with real changes', async () => {
    const [file] = await computePackageDiff(
      createPackage('1.0.0', { 'index.js': 'export function f(){return "a"}' }),
      createPackage('2.0.0', { 'index.js': "export function f() {\n  return 'b';\n}\n" }),
      { ignoreWhitespace, format: true },
    );

    expect(file.formatError).toBeUndefined();
    expect(patchText(file)).toContain('-  return "a";\n+  return "b";\n');
  });

  it('falls back to the raw contents when a file fails to parse', async () => {
    const [file] = await computePackageDiff(
      createPackage('1.0.0', { 'index.js': 'export const a = "x"\n' }),
      createPackage('2.0.0', { 'index.js': 'export const = ;\n' }),
      { ignoreWhitespace, format: true },
    );

    expect(file.formatError).toEqual(expect.any(String));
    expect(patchText(file)).toContain('-export const a = "x"\n+export const = ;\n');
  });

  it('leaves files without a known parser as they are', async () => {
    const [file] = await computePackageDiff(
      createPackage('1.0.0', { 'index.js.map': '{"version":3}' }),
      createPackage('2.0.0', { 'index.js.map': '{ "version": 3 }' }),
      { ignoreWhitespace, format: true },
    );

    expect(file.path).toBe('index.js.map');
    expect(file.formatError).toBeUndefined();
  });
});
