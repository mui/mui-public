import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  collectModuleSpecifiers,
  findDeclarationProblems,
  validateBuiltTypes,
} from './cmdValidateBuiltTypes.mjs';
import { makeTempDir, writePackage } from '../utils/testUtils.mjs';

describe('collectModuleSpecifiers', () => {
  it('collects every way a declaration file can reference another module', async () => {
    const code = [
      '/// <reference types="node" />',
      "import { Foo } from 'foo';",
      "import type { Bar } from 'bar/subpath';",
      "export { Baz } from '@scope/baz';",
      "export * from './local';",
      "import qux = require('qux');",
      "export declare const inferred: import('@scope/inferred').Type;",
    ].join('\n');

    expect(await collectModuleSpecifiers(code, 'index.d.ts')).toEqual([
      { specifier: 'foo', isTypeReference: false },
      { specifier: 'bar/subpath', isTypeReference: false },
      { specifier: '@scope/baz', isTypeReference: false },
      { specifier: './local', isTypeReference: false },
      { specifier: 'qux', isTypeReference: false },
      { specifier: '@scope/inferred', isTypeReference: false },
      { specifier: 'node', isTypeReference: true },
    ]);
  });

  it('ignores module augmentations', async () => {
    const code = "declare module 'foo' {\n  interface Options {}\n}\nexport {};";

    expect(await collectModuleSpecifiers(code, 'index.d.ts')).toEqual([]);
  });
});

describe('findDeclarationProblems', () => {
  const packageJson = {
    name: '@scope/button',
    dependencies: { foo: '^1.0.0', '@types/bar': '^1.0.0' },
    peerDependencies: { react: '*', '@types/react': '*', baz: '*' },
    optionalDependencies: { qux: '^1.0.0' },
    devDependencies: { '@types/baz': '^1.0.0', undeclared: '^1.0.0' },
  };

  /**
   * @param {string[]} specifiers
   */
  function problemsFor(specifiers) {
    return findDeclarationProblems(
      specifiers.map((specifier) => ({ specifier, isTypeReference: false })),
      packageJson,
    );
  }

  it('accepts relative, builtin, self and declared imports', () => {
    expect(
      problemsFor([
        './local',
        'node:fs',
        'path',
        'fs/promises',
        '@scope/button/utils',
        'foo/subpath',
        'react',
        'qux',
      ]),
    ).toEqual([]);
  });

  it('accepts an import whose types come from a declared @types package', () => {
    expect(problemsFor(['bar'])).toEqual([]);
  });

  it('reports an import of a package that is not declared', () => {
    expect(problemsFor(['undeclared', '@scope/missing/subpath'])).toEqual([
      '"undeclared" is not declared in dependencies or peerDependencies',
      '"@scope/missing" is not declared in dependencies or peerDependencies',
    ]);
  });

  it('reports an import whose types come from an @types devDependency', () => {
    expect(problemsFor(['baz'])).toEqual([
      'types for "baz" come from "@types/baz", which is only a devDependency; declare it in dependencies or as an optional peer dependency',
    ]);
    // A types-only package such as `hast` has no runtime package to declare.
    expect(
      findDeclarationProblems([{ specifier: 'hast', isTypeReference: false }], {
        name: 'pkg',
        devDependencies: { '@types/hast': '*' },
      }),
    ).toEqual([
      'types for "hast" come from "@types/hast", which is only a devDependency; declare it in dependencies or as an optional peer dependency',
    ]);
  });

  it('checks type reference directives against the @types package of that name', () => {
    expect(
      findDeclarationProblems(
        [
          { specifier: 'node', isTypeReference: true },
          { specifier: 'react', isTypeReference: true },
          { specifier: 'baz', isTypeReference: true },
          { specifier: 'undeclared', isTypeReference: true },
        ],
        packageJson,
      ),
    ).toEqual([
      'types for "baz" come from "@types/baz", which is only a devDependency; declare it in dependencies or as an optional peer dependency',
      '"undeclared" is not declared in dependencies or peerDependencies',
    ]);
  });

  it('maps scoped packages to their @types name', () => {
    expect(
      findDeclarationProblems([{ specifier: '@scope/untyped', isTypeReference: false }], {
        name: 'pkg',
        peerDependencies: { '@scope/untyped': '*' },
        devDependencies: { '@types/scope__untyped': '*' },
      }),
    ).toEqual([
      'types for "@scope/untyped" come from "@types/scope__untyped", which is only a devDependency; declare it in dependencies or as an optional peer dependency',
    ]);
  });

  it('only checks for local workspace paths without an owning manifest', () => {
    expect(
      findDeclarationProblems(
        [
          { specifier: 'undeclared', isTypeReference: false },
          { specifier: 'packages/button/src/Button', isTypeReference: false },
        ],
        null,
      ),
    ).toEqual([
      '"packages/button/src/Button" is a local workspace path, likely a type that is missing an export',
    ]);
  });

  it('reports imports of local workspace paths', () => {
    expect(problemsFor(['packages/button/src/Button'])).toEqual([
      '"packages/button/src/Button" is a local workspace path, likely a type that is missing an export',
    ]);
  });
});

describe('validateBuiltTypes', () => {
  it('reports problems in build output against the owning package', async () => {
    const root = await makeTempDir();
    await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    const pkgDir = await writePackage(root, 'packages/button', {
      name: '@scope/button',
      dependencies: { foo: '^1.0.0' },
    });
    await fs.mkdir(path.join(pkgDir, 'build/utils'), { recursive: true });
    await fs.mkdir(path.join(pkgDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(pkgDir, 'build/index.d.ts'),
      "export { Foo } from 'foo';\nexport * from './utils/theme';\n",
    );
    await fs.writeFile(
      path.join(pkgDir, 'build/utils/theme.d.mts'),
      "export declare const theme: import('bar').Theme;\n",
    );
    // Sources are not published, so they are not checked.
    await fs.writeFile(path.join(pkgDir, 'src/index.d.ts'), "export * from 'bar';\n");

    expect(await validateBuiltTypes(root)).toEqual([
      {
        file: 'packages/button/build/utils/theme.d.mts',
        message: '"bar" is not declared in dependencies or peerDependencies',
      },
    ]);
  });
});
