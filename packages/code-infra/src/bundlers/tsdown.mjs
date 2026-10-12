import { findWorkspaceDir } from '@pnpm/find-workspace-dir';
import { execa } from 'execa';
import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as semver from 'semver';
import {
  BASE_IGNORES,
  createPackageBin,
  createPackageExports,
  createPackageImports,
  getOutExtension,
} from '../utils/build.mjs';
import { getVersionEnvVariables } from '../utils/babel.mjs';
import { copyFiles } from '../utils/copyFiles.mjs';
import { readPnpmConfig } from '../utils/pnpm.mjs';
import { createTypes } from '../utils/typescript.mjs';

/**
 * Builds a library as independent modules so application bundlers can prune its exports.
 * @param {import('../cli/cmdBuildNew.mjs').Args} args
 * @param {import('../cli/packageJson').PackageJson} pkgJson
 */
export async function build(args, pkgJson) {
  const cwd = process.cwd();
  const workspaceDir = await findWorkspaceDir(cwd);
  if (!workspaceDir) {
    throw new Error('Could not find workspace root');
  }
  const sourceDir = path.join(cwd, 'src');
  const ignores = [
    ...BASE_IGNORES,
    ...args.ignore.map((pattern) => pattern.replace(/^(\.\/)?src\//, '')),
    '**/*.{test,spec}.*',
    '**/__fixtures__/**',
    '**/__snapshots__/**',
    '**/__tests__/**',
  ];
  const outDir = path.resolve(cwd, /** @type {string} */ (pkgJson.publishConfig?.directory));
  const packageType = pkgJson.type === 'module' ? 'module' : 'commonjs';
  const bundles = [...new Set(args.bundle)];
  const configFile = await Promise.all(
    ['babel.config.mjs', 'babel.config.js'].map(async (name) => {
      const file = path.join(workspaceDir, name);
      return (await fs.stat(file).then(
        () => true,
        () => false,
      ))
        ? file
        : null;
    }),
  ).then((files) => files.find(Boolean) ?? null);
  let runtimeVersion = pkgJson.dependencies?.['@babel/runtime'] ?? '';
  if (runtimeVersion === 'catalog:') {
    runtimeVersion = (await readPnpmConfig()).catalog?.['@babel/runtime'] ?? '';
  }
  if (configFile && !runtimeVersion) {
    throw new Error(
      'Declare @babel/runtime in dependencies when using a Babel build configuration.',
    );
  }

  const bins = Object.values(
    typeof pkgJson.bin === 'string' ? { bin: pkgJson.bin } : (pkgJson.bin ?? {}),
  );
  for (const bin of bins) {
    if (bin && !path.resolve(cwd, bin).startsWith(`${sourceDir}${path.sep}`)) {
      throw new Error(
        `The bin source "${bin}" must be inside src for build-new. Move the executable into src or use code-infra build.`,
      );
    }
  }
  // Clean only after checking the build configuration.
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  await Promise.all(
    bundles.map(async (bundle) => {
      const options = {
        sourceDir,
        ignores,
        outDir,
        configFile,
        binSources: Object.values(
          typeof pkgJson.bin === 'string' ? { bin: pkgJson.bin } : (pkgJson.bin ?? {}),
        ).flatMap((file) => (file ? [path.resolve(cwd, file)] : [])),
        banner: `/**
 * ${pkgJson.name} v${pkgJson.version}
 *
 * @license ${pkgJson.license ?? 'MIT'}
 * This source code is licensed under the ${pkgJson.license ?? 'MIT'} license found in the
 * LICENSE file in the root directory of this source tree.
 */`,
        bundle,
        outExtension: getOutExtension(bundle, { packageType }),
        sourceMap: args.sourceMap,
        verbose: args.verbose,
      };
      await execa(
        process.execPath,
        [path.join(import.meta.dirname, 'tsdownModules.mjs'), JSON.stringify(options)],
        {
          cwd,
          stdio: 'inherit',
          env: {
            NODE_ENV: 'production',
            BABEL_ENV: bundle === 'esm' ? 'stable' : 'node',
            MUI_OUT_FILE_EXTENSION: options.outExtension,
            MUI_BABEL_RUNTIME_VERSION: runtimeVersion,
            MUI_BUILD_VERBOSE: args.verbose ? 'true' : 'false',
            MUI_OPTIMIZE_CLSX:
              pkgJson.dependencies?.clsx || pkgJson.dependencies?.classnames ? 'true' : 'false',
            MUI_REMOVE_PROP_TYPES: pkgJson.dependencies?.['prop-types'] ? 'true' : 'false',
            MUI_REACT_COMPILER_REACT_VERSION: args.enableReactCompiler
              ? (semver.minVersion(pkgJson.peerDependencies?.react || '')?.version ?? 'latest')
              : undefined,
            ...getVersionEnvVariables(pkgJson.version ?? ''),
          },
        },
      );
    }),
  );

  // Assets keep source-relative paths. Custom copy globs are applied below as well.
  const assets = await globby('**/*', {
    cwd: sourceDir,
    ignore: [...ignores, '**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
  });
  await Promise.all(
    assets.map(async (file) => {
      const target = path.join(outDir, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (
        file.endsWith('.cjs') &&
        (await fs.stat(target).then(
          () => true,
          () => false,
        ))
      ) {
        return;
      }
      await fs.copyFile(path.join(sourceDir, file), target);
    }),
  );
  if (!args.skipTypes) {
    await createTypes({
      bundles,
      srcDir: sourceDir,
      cwd,
      buildDir: outDir,
      skipTsc: false,
      useTsgo: args.tsgo,
      packageType,
      verbose: args.verbose,
    });
  }
  const testDeclarations = await globby(
    [
      '**/*.{test,spec}.d.{ts,mts,cts}',
      ...ignores.map((pattern) => pattern.replace(/\.[cm]?[jt]sx?$/, '.d.{ts,mts,cts}')),
    ],
    {
      cwd: outDir,
      absolute: true,
    },
  );
  await Promise.all(testDeclarations.map((file) => fs.rm(file)));
  /** @type {Parameters<typeof createPackageExports>[1]} */
  const options = { bundles, outputDir: outDir, cwd, addTypes: !args.skipTypes, packageType };
  const [{ exports: packageExports, main, types }, imports, bin] = await Promise.all([
    createPackageExports(pkgJson.exports, options),
    pkgJson.imports ? createPackageImports(pkgJson.imports, options) : undefined,
    createPackageBin(pkgJson.bin, { bundles, cwd, packageType }),
  ]);
  const published = { ...pkgJson, type: packageType, exports: packageExports };
  delete published.devDependencies;
  delete published.scripts;
  published.publishConfig = { ...pkgJson.publishConfig };
  delete published.publishConfig.directory;
  if (Object.keys(published.publishConfig).length === 0) {
    delete published.publishConfig;
  }
  if (pkgJson.packageScripts) {
    published.scripts = pkgJson.packageScripts;
  }
  delete published.packageScripts;
  if (main) {
    published.main = main;
  }
  if (types) {
    published.types = types;
  }
  if (imports) {
    published.imports = imports;
  }
  if (bin) {
    published.bin = bin;
  }
  await fs.writeFile(path.join(outDir, 'package.json'), `${JSON.stringify(published, null, 2)}\n`);
  await copyFiles({ cwd, globs: args.copy ?? [], buildDir: outDir, verbose: args.verbose });
}
