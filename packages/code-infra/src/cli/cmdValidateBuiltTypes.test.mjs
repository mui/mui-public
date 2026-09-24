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
      { specifier: 'foo', kind: 'import' },
      { specifier: 'bar/subpath', kind: 'import' },
      { specifier: '@scope/baz', kind: 'import' },
      { specifier: './local', kind: 'import' },
      { specifier: 'qux', kind: 'import' },
      { specifier: '@scope/inferred', kind: 'importType' },
      { specifier: 'node', kind: 'typeReference' },
    ]);
  });

  it('ignores module augmentations', async () => {
    const code = "declare module 'foo' {\n  interface Options {}\n}\nexport {};";

    expect(await collectModuleSpecifiers(code, 'index.d.ts')).toEqual([]);
  });
});

describe('findDeclarationProblems', () => {
  /**
   * @param {string[]} specifiers
   * @param {import('./packageJson').PackageJson | null} packageJson
   */
  function problemsFor(specifiers, packageJson) {
    return findDeclarationProblems(
      specifiers.map((specifier) => ({ specifier, kind: /** @type {const} */ ('import') })),
      packageJson,
    );
  }

  it('accepts relative, builtin, self and declared imports', () => {
    expect(
      problemsFor(
        ['./local', 'node:fs', 'path', 'fs/promises', '@scope/button/utils', 'foo/subpath', 'bar'],
        {
          name: '@scope/button',
          dependencies: { foo: '^1.0.0' },
          peerDependencies: { bar: '*' },
        },
      ),
    ).toEqual([]);
  });

  it('accepts an import whose types come from a declared @types package', () => {
    expect(
      problemsFor(['foo', 'bar'], {
        name: 'pkg',
        dependencies: { foo: '^1.0.0', '@types/foo': '^1.0.0' },
        peerDependencies: { bar: '*', '@types/bar': '*' },
      }),
    ).toEqual([]);
  });

  describe('when types come from an @types devDependency', () => {
    it('suggests an optional peer dependency for a peer dependency', () => {
      expect(
        problemsFor(['react'], {
          name: 'pkg',
          peerDependencies: { react: '*' },
          devDependencies: { '@types/react': '*' },
        }),
      ).toEqual([
        {
          message: 'types for "react" come from "@types/react", which is only a devDependency',
          fix: '"react" is a peer dependency, so add "@types/react" as an optional peer dependency.',
        },
      ]);
    });

    it('suggests a dependency for a dependency', () => {
      expect(
        problemsFor(['foo'], {
          name: 'pkg',
          dependencies: { foo: '^1.0.0' },
          devDependencies: { '@types/foo': '^1.0.0' },
        }),
      ).toEqual([
        {
          message: 'types for "foo" come from "@types/foo", which is only a devDependency',
          fix: '"foo" is a dependency, so move "@types/foo" to dependencies.',
        },
      ]);
    });

    it('suggests optional peer dependencies for a devDependency', () => {
      expect(
        problemsFor(['foo'], {
          name: 'pkg',
          devDependencies: { foo: '^1.0.0', '@types/foo': '^1.0.0' },
        }),
      ).toEqual([
        {
          message: 'types for "foo" come from "@types/foo", which is only a devDependency',
          fix: '"foo" is only a devDependency, so consumers provide it: add "foo" and "@types/foo" as optional peer dependencies.',
        },
      ]);
    });

    it('suggests both options when the package is not declared', () => {
      // Either a types-only package such as `hast`, or one that consumers provide.
      expect(
        problemsFor(['hast'], { name: 'pkg', devDependencies: { '@types/hast': '*' } }),
      ).toEqual([
        {
          message: 'types for "hast" come from "@types/hast", which is only a devDependency',
          fix: 'If "hast" is a types-only package, move "@types/hast" to dependencies. If consumers provide "hast", add "hast" and "@types/hast" as optional peer dependencies.',
        },
      ]);
    });

    it('maps scoped packages to their @types name', () => {
      expect(
        problemsFor(['@scope/untyped'], {
          name: 'pkg',
          dependencies: { '@scope/untyped': '*' },
          devDependencies: { '@types/scope__untyped': '*' },
        }),
      ).toEqual([
        {
          message:
            'types for "@scope/untyped" come from "@types/scope__untyped", which is only a devDependency',
          fix: '"@scope/untyped" is a dependency, so move "@types/scope__untyped" to dependencies.',
        },
      ]);
    });
  });

  it('reports an import of a devDependency', () => {
    expect(
      problemsFor(['foo/subpath'], { name: 'pkg', devDependencies: { foo: '^1.0.0' } }),
    ).toEqual([
      {
        message: '"foo" is only a devDependency',
        fix: 'If consumers provide "foo", add it as an optional peer dependency. If this package uses it at runtime or it only provides types, move it to dependencies.',
      },
    ]);
  });

  it('reports an import of a package that is not declared', () => {
    expect(problemsFor(['foo', '@scope/missing/subpath', 'foo'], { name: 'pkg' })).toEqual([
      {
        message: '"foo" is not declared',
        fix: 'Declare "foo" the way this package uses it at runtime: in dependencies, or as a peer dependency if consumers provide it.',
      },
      {
        message: '"@scope/missing" is not declared',
        fix: 'Declare "@scope/missing" the way this package uses it at runtime: in dependencies, or as a peer dependency if consumers provide it.',
      },
    ]);
  });

  it('suggests an annotation for an undeclared import type', () => {
    expect(
      findDeclarationProblems([{ specifier: 'foo', kind: 'importType' }], { name: 'pkg' }),
    ).toEqual([
      {
        message: '"foo" is not declared',
        fix: 'An import("foo") type is usually emitted for an inferred type. Add an explicit type annotation that uses a type from a declared dependency (the isolatedDeclarations compiler option enforces this), or declare "foo" the way this package uses it at runtime.',
      },
    ]);
  });

  it('checks type reference directives against the @types package of that name', () => {
    expect(
      findDeclarationProblems(
        [
          { specifier: 'node', kind: 'typeReference' },
          { specifier: 'react', kind: 'typeReference' },
          { specifier: 'foo', kind: 'typeReference' },
        ],
        {
          name: 'pkg',
          peerDependencies: { react: '*', '@types/react': '*' },
          dependencies: { foo: '*' },
          devDependencies: { '@types/foo': '*' },
        },
      ),
    ).toEqual([
      {
        message: 'types for "foo" come from "@types/foo", which is only a devDependency',
        fix: '"foo" is a dependency, so move "@types/foo" to dependencies.',
      },
    ]);
  });

  it('reports imports of local workspace paths', () => {
    expect(problemsFor(['packages/button/src/Button'], { name: 'pkg' })).toEqual([
      {
        message: '"packages/button/src/Button" is a local workspace path',
        fix: 'A type in the public API is likely not exported from its package. Export it so declaration emit can reference it by package name.',
      },
    ]);
  });

  it('only checks for local workspace paths without an owning manifest', () => {
    expect(problemsFor(['undeclared', 'packages/button/src/Button'], null)).toEqual([
      {
        message: '"packages/button/src/Button" is a local workspace path',
        fix: 'A type in the public API is likely not exported from its package. Export it so declaration emit can reference it by package name.',
      },
    ]);
  });
});

describe('validateBuiltTypes', () => {
  /**
   * A workspace with one package whose build output imports an undeclared
   * package and a local workspace path.
   */
  async function createWorkspace() {
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
      "export declare const theme: import('bar').Theme;\nexport declare const local: import('packages/other/src').Local;\n",
    );
    // Sources are not published, so they are not checked.
    await fs.writeFile(path.join(pkgDir, 'src/index.d.ts'), "export * from 'bar';\n");
    return root;
  }

  it('reports problems in build output against the owning package', async () => {
    const root = await createWorkspace();

    expect(await validateBuiltTypes(root, { checkDependencies: true })).toEqual([
      {
        packageDir: 'packages/button',
        file: 'packages/button/build/utils/theme.d.mts',
        message: '"bar" is not declared',
        fix: 'An import("bar") type is usually emitted for an inferred type. Add an explicit type annotation that uses a type from a declared dependency (the isolatedDeclarations compiler option enforces this), or declare "bar" the way this package uses it at runtime.',
      },
      {
        packageDir: 'packages/button',
        file: 'packages/button/build/utils/theme.d.mts',
        message: '"packages/other/src" is a local workspace path',
        fix: 'A type in the public API is likely not exported from its package. Export it so declaration emit can reference it by package name.',
      },
    ]);
  });

  it('only checks for local workspace paths when dependency checks are disabled', async () => {
    const root = await createWorkspace();

    expect(await validateBuiltTypes(root, { checkDependencies: false })).toEqual([
      expect.objectContaining({ message: '"packages/other/src" is a local workspace path' }),
    ]);
  });
});
