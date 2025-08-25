/**
 * Fields that get overwritten during the build process and should not be manually set
 * in the source package.json
 */
const OVERWRITABLE_FIELDS = ['main', 'module', 'types', 'exports'];

/**
 * Validates a package.json object for fields that will be overwritten during build
 * @param {Record<string, any>} packageJson - The parsed package.json content
 * @param {Object} [options] - Validation options
 * @param {boolean} [options.errorOnOverwritable] - Whether to throw an error or just warn (default: false)
 * @returns {{warnings: string[], errors: string[]}} Validation results
 */
export function validatePackageJson(packageJson, options = {}) {
  const { errorOnOverwritable = false } = options;
  const warnings = [];
  const errors = [];

  for (const field of OVERWRITABLE_FIELDS) {
    if (packageJson.hasOwnProperty(field) && packageJson[field] !== undefined) {
      const message = `Field "${field}" is present in package.json but will be overwritten during build. Consider removing it from the source package.json.`;

      if (errorOnOverwritable) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }
  }

  return { warnings, errors };
}

/**
 * Validates package.json and logs warnings/errors to console
 * @param {Record<string, any>} packageJson - The parsed package.json content
 * @param {Object} [options] - Validation options
 * @param {boolean} [options.errorOnOverwritable] - Whether to throw an error or just warn (default: false)
 * @throws {Error} If validation errors are found and errorOnOverwritable is true
 */
export function validateAndLogPackageJson(packageJson, options = {}) {
  const { warnings, errors } = validatePackageJson(packageJson, options);

  if (warnings.length > 0) {
    console.warn('⚠️  Package.json validation warnings:');
    warnings.forEach((warning) => console.warn(`   ${warning}`));
    console.warn('   These fields will be automatically generated during the build process.');
    console.warn('');
  }

  if (errors.length > 0) {
    console.error('❌ Package.json validation errors:');
    errors.forEach((error) => console.error(`   ${error}`));
    console.error('');
    throw new Error(
      'Package.json validation failed. Fix the errors above or use --allow-overwritable-fields to continue.',
    );
  }
}
