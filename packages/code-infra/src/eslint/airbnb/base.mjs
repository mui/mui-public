import { FlatCompat } from '@eslint/eslintrc';
import * as tseslint from 'typescript-eslint';

/**
 * @param {Object} options - Configuration options.
 * @param {string} [options.baseDirectory] - The base directory for the configuration.
 * @returns {import('eslint').Linter.Config[]}
 */
export function createAirbnbConfig({ baseDirectory } = {}) {
  if (!baseDirectory) {
    throw new Error('"baseDirectory" option is required for Airbnb configuration.');
  }
  const compat = new FlatCompat({
    baseDirectory,
  });
  /**
   * Get the ESLint configuration for a specific Airbnb preset.
   * @param {string} name - The name of the Airbnb preset.
   */
  const extendsConfig = (name) => compat.extends(name);
  const airbnbConfig = extendsConfig('airbnb');
  return tseslint.config(airbnbConfig);
}
