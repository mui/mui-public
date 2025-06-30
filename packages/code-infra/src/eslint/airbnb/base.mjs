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
  const airbnbConfig = compat.extends('eslint-config-airbnb');
  return /** @type {import('eslint').Linter.Config[]} */ (tseslint.config(airbnbConfig));
}
