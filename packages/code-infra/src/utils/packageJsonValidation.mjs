import { globby } from 'globby';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Fields that get overwritten during the build process and should not be manually set
 * in the source package.json (excluding exports which has separate validation)
 */
const OVERWRITABLE_FIELDS = ['main', 'module', 'types'];

/**
 * File fields that should point to existing files if present (excluding overwritable fields)
 */
const FILE_FIELDS = ['typings'];

/**
 * Checks if a file exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} Whether the file exists
 */
async function fileExists(filePath) {
  const stats = await fs.stat(filePath);
  return stats.isFile();
}

/**
 * Validates file existence for exports entries
 * @param {string | Record<string, any>} exportEntry - Export entry to validate
 * @param {string} cwd - Current working directory
 * @returns {Promise<string[]>} Array of error messages
 */
async function validateExportEntry(exportEntry, cwd) {
  const errors = [];

  if (typeof exportEntry === 'string') {
    // Handle simple string exports
    if (exportEntry.includes('*')) {
      // Handle glob patterns
      const matches = await globby(exportEntry, { cwd });
      if (matches.length === 0) {
        errors.push(`Export pattern "${exportEntry}" matches no files`);
      }
    } else {
      // Handle direct file paths
      const fullPath = path.resolve(cwd, exportEntry);
      try {
        if (!(await fileExists(fullPath))) {
          errors.push(`Export file "${exportEntry}" does not exist`);
        }
      } catch {
        errors.push(`Export file "${exportEntry}" does not exist`);
      }
    }
  } else if (typeof exportEntry === 'object' && exportEntry !== null) {
    // Handle conditional exports (object format)
    for (const [, value] of Object.entries(exportEntry)) {
      if (typeof value === 'string') {
        // eslint-disable-next-line no-await-in-loop
        const subErrors = await validateExportEntry(value, cwd);
        errors.push(...subErrors);
      }
    }
  }

  return errors;
}

/**
 * Comprehensive package.json validation including build overwrite checks and lint checks
 * @param {Record<string, any>} packageJson - The parsed package.json content
 * @param {Object} [options] - Validation options
 * @param {boolean} [options.errorOnOverwritable] - Whether to throw an error or just warn for overwritable fields (default: false)
 * @param {string} [options.cwd] - Current working directory for file existence checks (default: process.cwd())
 * @param {boolean} [options.checkFileExistence] - Whether to validate file existence (default: true)
 * @param {boolean} [options.checkPrivateField] - Whether to validate private field (default: true)
 * @returns {Promise<{warnings: string[], errors: string[]}>} Validation results
 */
export async function validatePackageJson(packageJson, options = {}) {
  const { cwd = process.cwd(), checkFileExistence = true, checkPrivateField = true } = options;
  const warnings = [];
  const errors = [];

  // Check for overwritable fields - warn only if they don't point to existing files
  if (checkFileExistence) {
    for (const field of OVERWRITABLE_FIELDS) {
      if (packageJson.hasOwnProperty(field) && packageJson[field] !== undefined) {
        const fieldValue = packageJson[field];

        if (typeof fieldValue === 'string' && field !== 'exports') {
          // For simple file fields (main, module, types)
          const fullPath = path.resolve(cwd, fieldValue);
          try {
            // eslint-disable-next-line no-await-in-loop
            if (!(await fileExists(fullPath))) {
              warnings.push(
                `Field "${field}" points to non-existent file: ${fieldValue}. Consider omitting this field from the source package.json.`,
              );
            }
          } catch {
            warnings.push(
              `Field "${field}" points to non-existent file: ${fieldValue}. Consider omitting this field from the source package.json.`,
            );
          }
        } else if (field === 'exports' && typeof fieldValue === 'object' && fieldValue !== null) {
          // For exports field, validate all entries
          for (const [, exportValue] of Object.entries(fieldValue)) {
            if (exportValue !== null) {
              try {
                // eslint-disable-next-line no-await-in-loop
                const exportErrors = await validateExportEntry(exportValue, cwd);
                if (exportErrors.length > 0) {
                  warnings.push(
                    `Field "exports" contains invalid entries. Consider omitting this field from the source package.json.`,
                  );
                  break; // Only warn once for exports field
                }
              } catch {
                warnings.push(
                  `Field "exports" contains invalid entries. Consider omitting this field from the source package.json.`,
                );
                break;
              }
            }
          }
        }
      }
    }
  }

  // Check private field
  if (
    checkPrivateField &&
    packageJson.hasOwnProperty('private') &&
    packageJson.private !== undefined
  ) {
    if (packageJson.private !== true) {
      errors.push(
        `Field "private" is present but not set to true. Private packages should have "private": true`,
      );
    }
  }

  if (checkFileExistence) {
    // Check file fields existence
    for (const field of FILE_FIELDS) {
      if (packageJson.hasOwnProperty(field) && packageJson[field] !== undefined) {
        const filePath = packageJson[field];
        if (typeof filePath === 'string') {
          const fullPath = path.resolve(cwd, filePath);
          try {
            // eslint-disable-next-line no-await-in-loop
            if (!(await fileExists(fullPath))) {
              errors.push(`File field "${field}" points to non-existent file: ${filePath}`);
            }
          } catch {
            errors.push(`File field "${field}" points to non-existent file: ${filePath}`);
          }
        }
      }
    }

    // Check exports field entries
    if (packageJson.hasOwnProperty('exports') && packageJson.exports !== undefined) {
      const exports = packageJson.exports;
      if (typeof exports === 'object' && exports !== null) {
        for (const [exportKey, exportValue] of Object.entries(exports)) {
          if (exportValue !== null) {
            try {
              // eslint-disable-next-line no-await-in-loop
              const exportErrors = await validateExportEntry(exportValue, cwd);
              errors.push(...exportErrors.map((error) => `In exports["${exportKey}"]: ${error}`));
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              errors.push(`In exports["${exportKey}"]: Error validating export - ${errorMessage}`);
            }
          }
        }
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
 * @param {string} [options.cwd] - Current working directory for file existence checks (default: process.cwd())
 * @throws {Error} If validation errors are found
 */
export async function validateAndLogPackageJson(packageJson, options = {}) {
  const { warnings, errors } = await validatePackageJson(packageJson, options);

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
    throw new Error('Package.json validation failed. Fix the errors above.');
  }
}

/**
 * Comprehensive package.json linting function to be called at the start of build process
 * @param {Record<string, any>} packageJson - The parsed package.json content
 * @param {string} cwd - Current working directory
 * @throws {Error} If validation fails
 */
export async function lintPackageJson(packageJson, cwd) {
  // Run full validation including overwritable field warnings
  await validateAndLogPackageJson(packageJson, {
    errorOnOverwritable: false,
    cwd,
  });
}
