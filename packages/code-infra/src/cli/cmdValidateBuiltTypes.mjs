/* eslint-disable no-console */
import * as babel from '@babel/core';
import pluginTypescriptSyntax from '@babel/plugin-syntax-typescript';
import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import * as path from 'node:path';
import { mapAsync } from 'es-toolkit/array';

/**
 * @typedef {Object} ModuleSpecifier
 * @property {string} specifier The module the declaration file references.
 * @property {boolean} isTypeReference Whether it comes from a `/// <reference types="..." />` directive.
 */

/**
 * @typedef {Object} DeclarationProblem
 * @property {string} file Declaration file, relative to the workspace root.
 * @property {string} message
 */

const TYPE_REFERENCE_REGEX = /^\/\s*<reference\s+types\s*=\s*(['"])(.+?)\1/;

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
   */
  const add = (specifier) => specifiers.push({ specifier, isTypeReference: false });

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
      add(nodePath.node.argument.value);
    },
    TSExternalModuleReference(nodePath) {
      add(nodePath.node.expression.value);
    },
  });

  for (const comment of ast.comments ?? []) {
    const match = comment.type === 'CommentLine' ? TYPE_REFERENCE_REGEX.exec(comment.value) : null;
    if (match) {
      specifiers.push({ specifier: match[2], isTypeReference: true });
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
 * @param {ModuleSpecifier[]} specifiers
 * @param {import('./packageJson').PackageJson | null} packageJson The owning manifest, or `null` to
 *   only check for local workspace paths.
 * @returns {string[]} A message for each problem found.
 */
export function findDeclarationProblems(specifiers, packageJson) {
  if (!packageJson) {
    return findDeclarationProblems(
      specifiers.filter(({ specifier }) => specifier.startsWith('packages/')),
      {},
    );
  }
  const declared = new Set([
    packageJson.name,
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ]);
  const devDependencies = new Set(Object.keys(packageJson.devDependencies ?? {}));

  /** @type {Set<string>} */
  const problems = new Set();
  for (const { specifier, isTypeReference } of specifiers) {
    if (
      specifier.startsWith('.') ||
      specifier.startsWith('/') ||
      (isTypeReference ? specifier === 'node' : isBuiltin(specifier))
    ) {
      continue;
    }
    if (specifier.startsWith('packages/')) {
      problems.add(
        `"${specifier}" is a local workspace path, likely a type that is missing an export`,
      );
      continue;
    }

    const packageName = isTypeReference ? specifier : getPackageName(specifier);
    const typesPackageName = getTypesPackageName(packageName);
    if (declared.has(typesPackageName)) {
      continue;
    }
    if (devDependencies.has(typesPackageName)) {
      problems.add(
        `types for "${packageName}" come from "${typesPackageName}", which is only a devDependency; declare it in dependencies or as an optional peer dependency`,
      );
    } else if (!declared.has(packageName)) {
      problems.add(`"${packageName}" is not declared in dependencies or peerDependencies`);
    }
  }
  return Array.from(problems);
}

/**
 * Validates the declaration files in every `build` directory of the workspace.
 *
 * @param {string} workspaceRoot
 * @returns {Promise<DeclarationProblem[]>}
 */
export async function validateBuiltTypes(workspaceRoot) {
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
   * @param {string} declarationFile
   */
  const getManifest = (declarationFile) => {
    const segments = declarationFile.split('/');
    const packageDir = segments.slice(0, segments.indexOf('build')).join('/');
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
      const [code, packageJson] = await Promise.all([
        fs.readFile(path.join(workspaceRoot, declarationFile), 'utf8'),
        getManifest(declarationFile),
      ]);
      const specifiers = await collectModuleSpecifiers(code, declarationFile);
      return findDeclarationProblems(specifiers, packageJson).map((message) => ({
        file: declarationFile,
        message,
      }));
    },
    { concurrency: 20 },
  );
  return problems.flat();
}

export default /** @type {import('yargs').CommandModule<{}, {}>} */ ({
  command: 'validate-built-types',
  describe:
    'Validate built TypeScript declaration files for imports of local files and of undeclared dependencies.',
  handler: async () => {
    const workspaceRoot = await findWorkspaceDir(process.cwd());
    if (!workspaceRoot) {
      throw new Error('Workspace directory not found');
    }
    const problems = await validateBuiltTypes(workspaceRoot);

    if (problems.length > 0) {
      console.error('❌ Found invalid imports in built declaration files:');
      for (const { file, message } of problems) {
        console.error(`${file}: ${message}`);
      }
      process.exit(1);
    }

    console.log('✅ Found no invalid imports in built declaration files.');
  },
});
