import { createPackageBin, createPackageExports, createPackageImports } from './build.mjs';

/**
 * @param {Object} options
 * @param {import('../cli/packageJson').PackageJson} options.packageJson - The source package.json content.
 * @param {import('./build.mjs').BundleType[]} options.bundles
 * @param {string} options.outputDir
 * @param {string} options.cwd
 * @param {boolean} options.addTypes - Whether to add type declarations for the package.
 * @param {boolean} [options.expand] - Whether to enumerate glob patterns into concrete entries.
 * @param {'module' | 'commonjs'} options.packageType - The package.json type field.
 * @returns {Promise<import('../cli/packageJson').PackageJson>} The package.json to publish from `outputDir`.
 */
export async function getPublishedPkgJson({
  packageJson: source,
  bundles,
  outputDir,
  cwd,
  addTypes = false,
  expand = true,
  packageType,
}) {
  const {
    scripts,
    devDependencies,
    exports: originalExports,
    imports: originalImports,
    bin: originalBin,
    ...packageJson
  } = source;

  if (packageJson.publishConfig) {
    const { directory, ...publishConfig } = packageJson.publishConfig;
    packageJson.publishConfig = publishConfig;
  }

  const resolvedPackageType = packageType || packageJson.type || 'commonjs';
  packageJson.type = resolvedPackageType;

  const [{ exports: packageExports, main, types }, packageImports] = await Promise.all([
    createPackageExports(originalExports, {
      bundles,
      outputDir,
      cwd,
      addTypes,
      expand,
      packageType: resolvedPackageType,
    }),
    originalImports
      ? createPackageImports(originalImports, {
          bundles,
          cwd,
          outputDir,
          addTypes,
          expand,
          packageType: resolvedPackageType,
        })
      : Promise.resolve(undefined),
  ]);

  packageJson.exports = packageExports;
  if (packageImports) {
    packageJson.imports = packageImports;
  }
  if (main) {
    packageJson.main = main;
  }
  if (types) {
    packageJson.types = types;
  }

  const bin = await createPackageBin(originalBin, {
    bundles,
    cwd,
    packageType: resolvedPackageType,
  });
  if (bin) {
    packageJson.bin = bin;
  }

  return packageJson;
}
