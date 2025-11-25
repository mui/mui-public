import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @typedef {import('./types.ts').ChangelogConfig} ChangelogConfig
 */

/**
 * Loads changelog configuration from a file.
 *
 * @param {string} configPath - Path to config file (relative or absolute)
 * @param {string} [cwd] - Current working directory
 * @returns {Promise<ChangelogConfig>} Loaded configuration
 * @throws {Error} If config file doesn't exist or is invalid
 */
export async function loadChangelogConfig(configPath, cwd = process.cwd()) {
  const ext = path.extname(configPath);
  if (ext !== '.mjs' && ext !== '.js') {
    throw new Error(
      'Changelog config file must have .mjs or .js extension. TypeScript files are not supported.',
    );
  }
  // Resolve path
  const resolvedPath = configPath.startsWith('/') ? configPath : path.join(cwd, configPath);

  // Check if file exists
  try {
    await fs.access(resolvedPath);
  } catch {
    throw new Error(`Changelog config file not found: ${resolvedPath}`);
  }

  // Load config file
  try {
    const fileUrl = pathToFileURL(resolvedPath).href;
    const module = await import(fileUrl);
    const config = module.default ?? module.config;

    if (!config) {
      throw new Error('Config file must export a default object or a named "config" export');
    }

    // Validate config
    validateConfig(config);

    return config;
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load changelog config: ${message}`);
  }
}

/**
 * Validates changelog configuration.
 *
 * @param {ChangelogConfig} config - Configuration to validate
 * @throws {Error} If configuration is invalid
 */
function validateConfig(config) {
  const errors = [];

  // Check required fields
  if (!config.format) {
    errors.push('Config must include "format" field');
  }

  if (!config.categorization) {
    errors.push('Config must include "categorization" field');
  }

  // Validate categorization
  if (config.categorization) {
    if (!['component', 'package'].includes(config.categorization.strategy)) {
      errors.push('categorization.strategy must be "component" or "package"');
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
