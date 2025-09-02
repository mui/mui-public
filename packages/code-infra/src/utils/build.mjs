/**
 * @typedef {'esm' | 'cjs'} BundleType
 */
export const isMjsBuild = !!process.env.MUI_EXPERIMENTAL_MJS;

/**
 * @param {BundleType} bundle
 */
export function getOutExtension(bundle, isType = false) {
  if (isType) {
    if (!isMjsBuild) {
      return '.d.ts';
    }
    return bundle === 'esm' ? '.d.mts' : '.d.ts';
  }
  if (!isMjsBuild) {
    return '.js';
  }
  return bundle === 'esm' ? '.mjs' : '.js';
}

/**
 * Validates the package.json before building.
 * @param {Record<string, any>} packageJson
 */
export function validatePkgJson(packageJson) {
  /**
   * @type {string[]}
   */
  const errors = [];
  const buildDirBase = packageJson.publishConfig?.directory;
  if (!buildDirBase) {
    errors.push(
      `No build directory specified in "${packageJson.name}" package.json. Specify it in the "publishConfig.directory" field.`,
    );
  }
  if (packageJson.private === false) {
    errors.push(
      `Remove the field "private": false from "${packageJson.name}" package.json. This is redundant.`,
    );
  }

  if (packageJson.main) {
    errors.push(
      `Remove the field "main" from "${packageJson.name}" package.json. Add it as "exports["."]" instead.`,
    );
  }

  if (packageJson.module) {
    errors.push(
      `Remove the field "module" from "${packageJson.name}" package.json. Add it as "exports["."]" instead.`,
    );
  }

  if (packageJson.types || packageJson.typings) {
    errors.push(
      `Remove the field "types/typings" from "${packageJson.name}" package.json. Add it as "exports["."]" instead.`,
    );
  }

  if (errors.length > 0) {
    const error = new Error(errors.join('\n'));
    throw error;
  }
}
