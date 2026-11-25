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

const raw: DiffOptions = { ignoreWhitespace: false, normalizeSyntax: false };
const normalized: DiffOptions = { ignoreWhitespace: false, normalizeSyntax: true };

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

    const files = await diffAll(oldPackage, newPackage, raw);
    expect(files.map(({ path, changeType }) => ({ path, changeType }))).toEqual(expectedFiles);
    expect(files[1].blocks).toEqual([
      { text: '--- b.js\tpkg@1.0.0\n+++ b.js\tpkg@2.0.0\n', className: 'diff-preamble' },
      { text: '@@ -1,1 +1,1 @@\n', className: 'diff-hunk' },
      { text: '-b;\n', className: 'diff-removed' },
      { text: '+b2;\n', className: 'diff-added' },
      { text: '\n', className: null },
    ]);
  });

  it('drops files that only differ in formatting', async () => {
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

    const rawFiles = await diffAll(oldPackage, newPackage, raw);
    expect(rawFiles.map((file) => file.path)).toEqual([
      'index.d.ts',
      'index.js',
      'package.json',
      'styles.css',
    ]);

    expect(await diffAll(oldPackage, newPackage, normalized)).toEqual([]);
  });

  it('falls back to the raw contents when a file fails to parse', async () => {
    const [file] = await diffAll(
      createPackage('1.0.0', { 'index.js': 'export const a = "x"\n' }),
      createPackage('2.0.0', { 'index.js': 'export const = ;\n' }),
      normalized,
    );

    expect(file.formatError).toEqual(expect.any(String));
    expect(patchText(file)).toContain('-export const a = "x"\n+export const = ;\n');
  });

  it('leaves files without a known parser as they are', async () => {
    const [file] = await diffAll(
      createPackage('1.0.0', { 'index.js.map': '{"version":3}' }),
      createPackage('2.0.0', { 'index.js.map': '{ "version": 3 }' }),
      normalized,
    );

    expect(file.path).toBe('index.js.map');
    expect(file.formatError).toBeUndefined();
  });

  it('drops files that only differ in comments', async () => {
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

    const rawFiles = await diffAll(oldPackage, newPackage, raw);
    expect(rawFiles.map((file) => file.path)).toEqual([
      'index.d.ts',
      'index.js',
      'styles.css',
      'tsconfig.json',
    ]);

    expect(await diffAll(oldPackage, newPackage, normalized)).toEqual([]);
  });

  it('keeps comment syntax inside strings', async () => {
    const [file] = await diffAll(
      createPackage('1.0.0', { 'index.js': 'const a = "/* x */"; // c\n' }),
      createPackage('2.0.0', { 'index.js': 'const a = "// y";\n' }),
      normalized,
    );

    expect(patchText(file)).toContain(`-const a = "/* x */";\n+const a = "// y";\n`);
  });

  describe('normalizing syntax', () => {
    it.each([
      {
        name: '`void 0` and `undefined`',
        path: 'index.js',
        old: 'const a = undefined;\nf(a);\n',
        new: 'const a = void 0;\nf(a);\n',
      },
      {
        name: '`return undefined` and `return`',
        path: 'index.js',
        old: 'function f() {\n  return undefined;\n}\n',
        new: 'function f() {\n  return;\n}\n',
      },
      {
        name: 'number spellings',
        path: 'index.js',
        old: 'const a = 10_000;\n',
        new: 'const a = 1e4;\n',
      },
      {
        name: 'braces around single statements',
        path: 'index.js',
        old: 'if (a) b();\nelse c();\nfor (const x of y) f(x);\nwhile (a) b();\n',
        new: 'if (a) {\n  b();\n} else {\n  c();\n}\nfor (const x of y) {\n  f(x);\n}\nwhile (a) {\n  b();\n}\n',
      },
      {
        name: '`else { if }` and `else if`',
        path: 'index.js',
        old: 'if (a) {\n  b();\n} else {\n  if (c) {\n    d();\n  }\n}\n',
        new: 'if (a) b();\nelse if (c) d();\n',
      },
      {
        name: 'object shorthand',
        path: 'index.js',
        old: 'f({ children: children, a });\n',
        new: 'f({ children, a });\n',
      },
      {
        name: 'the order of specifiers inside braces',
        path: 'index.js',
        old: "import { b, a as c } from 'x';\nexport { b, c } from 'y';\nf(b, c);\n",
        new: "import { a as c, b } from 'x';\nexport { c, b } from 'y';\nf(b, c);\n",
      },
      {
        name: 'exports on declarations and in a list',
        path: 'index.js',
        old: 'export function f() {}\nexport const a = 1,\n  b = 2;\nexport class C {}\n',
        new: 'function f() {}\nconst a = 1,\n  b = 2;\nvar C = class C {};\nexport { a, C, f };\nexport { b };\n',
      },
      {
        name: 'class expressions assigned to a variable',
        path: 'index.js',
        old: 'class A extends B {}\n',
        new: 'var A = class extends B {};\n',
      },
      {
        name: 'exports and type modifiers in declaration files',
        path: 'index.d.ts',
        old: "import type { A } from './a';\nexport declare function f(a: A): void;\nexport interface B {}\nexport type { A };\n",
        new: "import { A } from './a';\ndeclare function f(a: A): void;\ninterface B {}\nexport { A, B, f };\n",
      },
      {
        name: '`&&`, `||` and `?:` statements and `if`',
        path: 'index.js',
        old: 'if (a) b();\nif (!c) d();\nif (e) f();\nif (g) h();\nelse i();\n',
        new: 'a && b();\nc || d();\ne ? f() : void 0;\ng ? h() : i();\n',
      },
      {
        name: 'a `return` at the end of a function',
        path: 'index.js',
        old: 'function f() {\n  g();\n  return;\n}\nconst h = () => {\n  return;\n};\n',
        new: 'function f() {\n  g();\n}\nconst h = () => {};\n',
      },
      {
        name: 'the names build tools give to imports',
        path: 'index.js',
        old: "import { jsx as _jsx } from 'react/jsx-runtime';\nimport capitalize_default from './capitalize.mjs';\nimport * as React$1 from 'react';\n_jsx('a', { b: capitalize_default('c'), d: React$1.version });\n",
        new: "import { jsx } from 'react/jsx-runtime';\nimport capitalize from './capitalize.mjs';\nimport * as React from 'react';\njsx('a', { b: capitalize('c'), d: React.version });\n",
      },
      {
        name: 'renamed bindings used as shorthand properties and exports',
        path: 'index.js',
        old: "import { a as _a } from 'x';\nf({ _a });\nconst { b: _b = 1 } = g;\nexport { _b as b };\n",
        new: "import { a } from 'x';\nf({ _a: a });\nconst { b = 1 } = g;\nexport { b };\n",
      },
      {
        name: 'renamed declarations in declaration files',
        path: 'index.d.ts',
        old: 'interface Theme$1 {\n  a: string;\n}\nexport { Theme$1 as Theme };\n',
        new: 'interface Theme {\n  a: string;\n}\nexport { Theme };\n',
      },
      {
        name: 'blank lines',
        path: 'index.js',
        old: 'a();\n\nb();\nconst c = {\n  d: 1,\n\n  e: 2,\n};\n',
        new: 'a();\nb();\nconst c = { d: 1, e: 2 };\n',
      },
      {
        name: 'default exports through a variable',
        path: 'index.js',
        old: 'export default f(1);\nexport const a = 2;\n',
        new: 'var Button_default = f(1);\nconst a = 2;\nexport { a, Button_default as default };\n',
      },
      {
        name: '`export default` of a constant',
        path: 'index.js',
        old: 'function g() {}\nexport default g;\n',
        new: 'function g() {}\nexport { g as default };\n',
      },
      {
        name: 'exports in TypeScript',
        path: 'index.ts',
        old: 'export const a: number = 1;\nexport type B = string;\n',
        new: 'const a: number = 1;\ntype B = string;\nexport { a, B };\n',
      },
    ])('drops files that only differ in $name', async ({ path, old, new: newSource }) => {
      const oldPackage = createPackage('1.0.0', { [path]: old });
      const newPackage = createPackage('2.0.0', { [path]: newSource });

      expect(await diffAll(oldPackage, newPackage, raw)).toHaveLength(1);
      expect(await diffAll(oldPackage, newPackage, normalized)).toEqual([]);
    });

    it('shows the normalized code of files with real changes', async () => {
      const [file] = await diffAll(
        createPackage('1.0.0', {
          'index.js': 'export function f(a) {\n  if (a) return void 0;\n  return 1;\n}\n',
        }),
        createPackage('2.0.0', {
          'index.js':
            'function f(a) {\n  if (a) {\n    return;\n  }\n  return 2;\n}\nexport { f };\n',
        }),
        normalized,
      );

      expect(patchText(file)).toBe(
        [
          '--- index.js\tpkg@1.0.0',
          '+++ index.js\tpkg@2.0.0',
          '@@ -1,7 +1,7 @@',
          ' function f(a) {',
          '   if (a) {',
          '     return;',
          '   }',
          '-  return 1;',
          '+  return 2;',
          ' }',
          ' export { f };',
          '',
          '',
        ].join('\n'),
      );
    });

    it.each([
      {
        name: '`void` of other values',
        old: 'f(undefined);\n',
        new: 'f(void 1);\n',
      },
      {
        name: 'returned values',
        old: 'function f() {\n  return null;\n}\n',
        new: 'function f() {\n  return;\n}\n',
      },
      {
        name: 'the order of import statements',
        old: "import 'a';\nimport 'b';\n",
        new: "import 'b';\nimport 'a';\n",
      },
      {
        name: 'renamed exports',
        old: 'const a = 1;\nexport { a as b };\n',
        new: 'export const b = 1;\n',
      },
      {
        name: 'shorthand property names',
        old: "import { a as _a } from 'x';\nf({ _a });\n",
        new: "import { a } from 'x';\nf({ a });\n",
      },
      {
        name: 'blank lines inside template literals',
        old: 'const a = `x\n\ny`;\n',
        new: 'const a = `x\ny`;\n',
      },
      {
        name: 'names that are taken',
        old: "import { jsx as _jsx } from 'x';\nconst jsx = 1;\n_jsx(jsx);\n",
        new: "import { jsx } from 'x';\nconst _jsx = 1;\njsx(_jsx);\n",
      },
      {
        name: 'default exports of variables that change',
        old: 'let a = 1;\nexport default a;\na = 2;\n',
        new: 'let a = 1;\nexport { a as default };\na = 2;\n',
      },
      {
        name: 'type exports outside declaration files',
        path: 'index.ts',
        old: 'type A = string;\nexport type { A };\n',
        new: 'type A = string;\nexport { A };\n',
      },
    ])('keeps differences in $name', async ({ path = 'index.js', old, new: newSource }) => {
      const files = await diffAll(
        createPackage('1.0.0', { [path]: old }),
        createPackage('2.0.0', { [path]: newSource }),
        normalized,
      );

      expect(files).toHaveLength(1);
      expect(files[0].formatError).toBeUndefined();
    });
  });
});
