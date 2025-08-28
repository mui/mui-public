/**
 * @typedef {Object} Args
 * @property {import('../utils/build.mjs').BundleType[]} bundle - The bundles to build.
 * @property {boolean} [hasLargeFiles=false] - The large files to build.
 * @property {boolean} [skipBundlePackageJson=false] - Whether to skip generating a package.json file in the /esm folder.
 * @property {string} [cjsOutDir="."] - The directory to copy the cjs files to.
 * @property {boolean} [verbose=false] - Whether to enable verbose logging.
 * @property {boolean} [buildTypes=true] - Whether to build types for the package.
 * @property {boolean} [skipTsc=false] - Whether to build types for the package.
 * @property {boolean} [skipBabelRuntimeCheck=false] - Whether to skip checking for Babel runtime dependencies in the package.
 * @property {boolean} [skipPackageJson=false] - Whether to skip generating the package.json file in the bundle output.
 * @property {boolean} [watch=false] - Enable watch mode for the build process.
 * @property {string[]} [ignore] - Globs to be ignored by Babel.
 */

const validBundles = [
  // build for node using commonJS modules
  'cjs',
  // build with a hardcoded target using ES6 modules
  'esm',
];

export default /** @type {import('yargs').CommandModule<{}, Args>} */ ({
  command: 'rolldown',
  describe: 'Builds the package using "rolldown" for publishing.',
  builder: (yargs) =>
    yargs
      .option('bundle', {
        array: true,
        demandOption: true,
        type: 'string',
        choices: validBundles,
        description: 'Bundles to output',
        default: ['esm', 'cjs'],
      })
      .option('bundle', {
        array: true,
        demandOption: true,
        type: 'string',
        choices: validBundles,
        description: 'Bundles to output',
        default: ['esm', 'cjs'],
      })
      .option('hasLargeFiles', {
        type: 'boolean',
        default: false,
        describe: 'Set to `true` if you know you are transpiling large files.',
      })
      .option('skipBundlePackageJson', {
        type: 'boolean',
        default: false,
        describe:
          "Set to `true` if you don't want to generate a package.json file in the bundle output.",
      })
      .option('cjsOutDir', {
        default: '.',
        type: 'string',
        description: 'The directory to output the cjs files to.',
      })
      .option('verbose', {
        type: 'boolean',
        default: false,
        description: 'Enable verbose logging.',
      })
      .option('buildTypes', {
        type: 'boolean',
        default: true,
        description: 'Whether to build types for the package.',
      })
      .option('skipTsc', {
        type: 'boolean',
        default: false,
        description: 'Skip running TypeScript compiler (tsc) for building types.',
      })
      .option('ignore', {
        type: 'string',
        array: true,
        description: 'Extra globs to be ignored by Babel.',
        default: [],
      })
      .option('skipBabelRuntimeCheck', {
        type: 'boolean',
        default: false,
        description: 'Skip checking for Babel runtime dependencies in the package.',
      })
      .option('skipPackageJson', {
        type: 'boolean',
        default: false,
        description: 'Skip generating the package.json file in the bundle output.',
      })
      .option('watch', {
        type: 'boolean',
        default: false,
        description: 'Enable watch mode for the build process.',
      }),
  async handler(args) {
    await (await import('./rolldown.mjs')).build(args);
  },
});
