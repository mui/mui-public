/**
 * @typedef {import('./types.ts').ChangelogConfig} ChangelogConfig
 */

/**
 * Validates changelog configuration.
 *
 * @param {ChangelogConfig} config - Configuration to validate
 * @throws {Error} If configuration is invalid
 */
export function validateChangelogConfig(config) {
  const errors = [];

  if (!config.categorization) {
    errors.push('Config must include "categorization" field');
  }

  // Validate categorization
  if (config.categorization) {
    if (!['component', 'package', 'flat'].includes(config.categorization.strategy)) {
      errors.push('categorization.strategy must be "component", "package", or "flat"');
    }

    if (config.categorization.strategy === 'package' && !config.categorization.packageNaming) {
      errors.push('categorization.packageNaming is required when strategy is "package"');
    }

    if (config.categorization.packageNaming) {
      if (!config.categorization.packageNaming.mappings) {
        errors.push('categorization.packageNaming.mappings is required');
      }

      if (typeof config.categorization.packageNaming.mappings !== 'object') {
        errors.push('categorization.packageNaming.mappings must be an object');
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid changelog config:\n  - ${errors.join('\n  - ')}`);
  }
}
