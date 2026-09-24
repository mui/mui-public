/* eslint-disable no-console */
import * as babel from '@babel/core';
import pluginTypescriptSyntax from '@babel/plugin-syntax-typescript';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import * as path from 'node:path';
import { groupBy, mapAsync } from 'es-toolkit/array';

/**
 * @typedef {Object} ModuleSpecifier
 * @property {string} specifier The module the declaration file references.
 * @property {'import' | 'importType' | 'typeReference'} kind How it is referenced: an import or
 *   export declaration, an `import("...")` type, or a `/// <reference types="..." />` directive.
 */

/**
 * @typedef {Object} Problem
 * @property {string} message What is wrong.
 * @property {string} fix How to resolve it.
 */

/**
 * @typedef {Problem & { packageDir: string, file: string }} DeclarationProblem
 *   Paths are relative to the workspace root.
 */

const TYPE_REFERENCE_REGEX = /^\/\s*<reference\s+types\s*=\s*(['"])(.+?)\1/;

const LOCAL_PATH_FIX =
  'A type in the public API is likely not exported from its package. Export it so declaration emit can reference it by package name.';

/**
 * Collects the modules a declaration file references. Module augmentations
 * (`declare module 'x' {}`) are not included.
 *
 * @param {string} code
 * @param {string} filename
 * @returns {Promise<ModuleSpecifier[]>}
 */
export async function collectModuleSpecifiers(code, filename) {
  const ast = await babel.parseAsync(code, {
    filename,
    babelrc: false,
    configFile: false,
    plugins: [[pluginTypescriptSyntax, { dts: true }]],
  });
  if (!ast) {
    return [];
  }

  /** @type {ModuleSpecifier[]} */
  const specifiers = [];
  /**
   * @param {string} specifier
   * @param {ModuleSpecifier['kind']} [kind]
   */
  const add = (specifier, kind = 'import') => specifiers.push({ specifier, kind });

  babel.traverse(ast, {
    ImportDeclaration(nodePath) {
      add(nodePath.node.source.value);
    },
    ExportNamedDeclaration(nodePath) {
      if (nodePath.node.source) {
        add(nodePath.node.source.value);
      }
    },
    ExportAllDeclaration(nodePath) {
      add(nodePath.node.source.value);
    },
    // Declaration emit writes these for inferred types, so they appear without a matching import in the sources.
    TSImportType(nodePath) {
      add(nodePath.node.argument.value, 'importType');
    },
    TSExternalModuleReference(nodePath) {
      add(nodePath.node.expression.value);
    },
  });

  for (const comment of ast.comments ?? []) {
    const match = comment.type === 'CommentLine' ? TYPE_REFERENCE_REGEX.exec(comment.value) : null;
    if (match) {
      add(match[2], 'typeReference');
    }
  }

  return specifiers;
}

/**
 * @param {string} specifier
 * @returns {string}
 */
function getPackageName(specifier) {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

/**
 * @param {string} packageName
 * @returns {string}
 */
function getTypesPackageName(packageName) {
  if (packageName.startsWith('@types/')) {
    return packageName;
  }
  return `@types/${packageName.startsWith('@') ? packageName.slice(1).replace('/', '__') : packageName}`;
}

/**
 * Checks the modules referenced by a published declaration file against the
 * manifest of the package that publishes it. Consumers only install what the
 * manifest declares, so any other package only resolves when it happens to be
 * hoisted.
 *
 * Suggested fixes mirror how the package uses the referenced package at
 * runtime: types of a dependency are a dependency, types of a peer dependency
 * are an optional peer dependency.
 *
 * @param {ModuleSpecifier[]} specifiers
 * @param {import('./packageJson').PackageJson | null} packageJson The owning manifest, or `null` to
 *   only check for local workspace paths.
 * @returns {Problem[]}
 */
export function findDeclarationProblems(specifiers, packageJson) {
  const dependencies = new Set([
    ...Object.keys(packageJson?.dependencies ?? {}),
    ...Object.keys(packageJson?.optionalDependencies ?? {}),
  ]);
  const peerDependencies = new Set(Object.keys(packageJson?.peerDependencies ?? {}));
  const devDependencies = new Set(Object.keys(packageJson?.devDependencies ?? {}));
  /**
   * @param {string} name
   */
  const isDeclared = (name) =>
    name === packageJson?.name || dependencies.has(name) || peerDependencies.has(name);

  /** @type {Map<string, Problem>} */
  const problems = new Map();
  /**
   * @param {string} message
   * @param {string} fix
   */
  const report = (message, fix) => problems.set(message, { message, fix });

  for (const { specifier, kind } of specifiers) {
    if (
      specifier.startsWith('.') ||
      specifier.startsWith('/') ||
      (kind === 'typeReference' ? specifier === 'node' : isBuiltin(specifier))
    ) {
      continue;
    }
    if (specifier.startsWith('packages/')) {
      report(`"${specifier}" is a local workspace path`, LOCAL_PATH_FIX);
      continue;
    }
    if (!packageJson) {
      continue;
    }

    const name = kind === 'typeReference' ? specifier : getPackageName(specifier);
    const typesName = getTypesPackageName(name);
    if (isDeclared(typesName)) {
      continue;
    }

    if (devDependencies.has(typesName)) {
      const message = `types for "${name}" come from "${typesName}", which is only a devDependency`;
      if (peerDependencies.has(name)) {
        report(
          message,
          `"${name}" is a peer dependency, so add "${typesName}" as an optional peer dependency.`,
        );
      } else if (dependencies.has(name)) {
        report(message, `"${name}" is a dependency, so move "${typesName}" to dependencies.`);
      } else if (devDependencies.has(name)) {
        report(
          message,
          `"${name}" is only a devDependency, so consumers provide it: add "${name}" and "${typesName}" as optional peer dependencies.`,
        );
      } else {
        report(
          message,
          `If "${name}" is a types-only package, move "${typesName}" to dependencies. If consumers provide "${name}", add "${name}" and "${typesName}" as optional peer dependencies.`,
        );
      }
    } else if (isDeclared(name)) {
      continue;
    } else if (devDependencies.has(name)) {
      report(
        `"${name}" is only a devDependency`,
        `If consumers provide "${name}", add it as an optional peer dependency. If this package uses it at runtime or it only provides types, move it to dependencies.`,
      );
    } else if (kind === 'importType') {
      report(
        `"${name}" is not declared`,
        `An import("${name}") type is usually emitted for an inferred type. Add an explicit type annotation that uses a type from a declared dependency (the isolatedDeclarations compiler option enforces this), or declare "${name}" the way this package uses it at runtime.`,
      );
    } else {
      report(
        `"${name}" is not declared`,
        `Declare "${name}" the way this package uses it at runtime: in dependencies, or as a peer dependency if consumers provide it.`,
      );
    }
  }
  return Array.from(problems.values());
}

/**
 * Validates the declaration files in every `build` directory of the workspace.
 *
 * @param {string} workspaceRoot
 * @param {{ checkDependencies: boolean }} options With `checkDependencies: false`, only
 *   imports of local workspace paths are reported.
 * @returns {Promise<DeclarationProblem[]>}
 */
export async function validateBuiltTypes(workspaceRoot, { checkDependencies }) {
  const declarationFiles = await globby(['**/build/**/*.d.{ts,cts,mts}'], {
    ignore: ['**/node_modules/**'],
    followSymbolicLinks: false,
    cwd: workspaceRoot,
  });
  declarationFiles.sort();

  /** @type {Map<string, Promise<import('./packageJson').PackageJson | null>>} */
  const manifests = new Map();
  /**
   * The source manifest of the package that owns a build directory. It is the
   * one holding `devDependencies`, which the build output copy may not.
   *
   * @param {string} packageDir
   */
  const getManifest = (packageDir) => {
    if (!checkDependencies) {
      return null;
    }
    let manifest = manifests.get(packageDir);
    if (!manifest) {
      manifest = fs.readFile(path.join(workspaceRoot, packageDir, 'package.json'), 'utf8').then(
        (content) => JSON.parse(content),
        () => null,
      );
      manifests.set(packageDir, manifest);
    }
    return manifest;
  };

  const problems = await mapAsync(
    declarationFiles,
    async (declarationFile) => {
      const segments = declarationFile.split('/');
      const packageDir = segments.slice(0, segments.indexOf('build')).join('/');
      const [code, packageJson] = await Promise.all([
        fs.readFile(path.join(workspaceRoot, declarationFile), 'utf8'),
        getManifest(packageDir),
      ]);
      const specifiers = await collectModuleSpecifiers(code, declarationFile);
      return findDeclarationProblems(specifiers, packageJson).map((problem) => ({
        packageDir,
        file: declarationFile,
        ...problem,
      }));
    },
    { concurrency: 20 },
  );
  return problems.flat();
}

/**
 * @typedef {Object} Args
 * @property {boolean} [checkDependencies] - Check that referenced packages are declared (default: true)
 */

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'validate-built-types',
  describe:
    'Validate built TypeScript declaration files for imports of local files and of undeclared dependencies.',
  builder: (yargs) =>
    yargs.option('check-dependencies', {
      type: 'boolean',
      default: true,
      describe:
        'Check that packages referenced from declaration files are declared in the owning package.json. Use --no-check-dependencies to only check for local workspace paths.',
    }),
  handler: async ({ checkDependencies = true }) => {
    const workspaceRoot = await findWorkspaceDir(process.cwd());
    if (!workspaceRoot) {
      throw new Error('Workspace directory not found');
    }
    const problems = await validateBuiltTypes(workspaceRoot, { checkDependencies });

    if (problems.length > 0) {
      const grouped = groupBy(problems, ({ packageDir, message }) => `${packageDir}\0${message}`);
      console.error('❌ Found invalid imports in built declaration files.\n');
      for (const [first, ...rest] of Object.values(grouped)) {
        console.error(`${first.packageDir || '.'}: ${first.message}`);
        console.error(`  Fix: ${first.fix}`);
        for (const { file } of [first, ...rest]) {
          console.error(`  - ${file}`);
        }
        console.error('');
      }
      if (checkDependencies) {
        console.error('Run with --no-check-dependencies to only check for local workspace paths.');
      }
      process.exit(1);
    }

    console.log('✅ Found no invalid imports in built declaration files.');
  },
});
