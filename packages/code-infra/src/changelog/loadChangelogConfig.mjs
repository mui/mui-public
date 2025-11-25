import { pathToFileURL } from 'node:url';
import { access } from 'node:fs/promises';

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
  // Resolve path
  const resolvedPath = configPath.startsWith('/') ? configPath : `${cwd}/${configPath}`;

  // Check if file exists
  try {
    await access(resolvedPath);
  } catch {
    throw new Error(`Changelog config file not found: ${resolvedPath}`);
  }

  // Load config file
  try {
    const fileUrl = pathToFileURL(resolvedPath).href;
    const module = await import(fileUrl);
    const config = module.default;

    if (!config) {
      throw new Error('Config file must export a default object');
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
  // Check required fields
  if (!config.format) {
    throw new Error('Config must include "format" field');
  }

  if (!config.categorization) {
    throw new Error('Config must include "categorization" field');
  }

  if (!config.formatting) {
    throw new Error('Config must include "formatting" field');
  }

  // Validate categorization
  if (!['component', 'package'].includes(config.categorization.strategy)) {
    throw new Error('categorization.strategy must be "component" or "package"');
  }

  if (config.categorization.strategy === 'package' && !config.categorization.packageNaming) {
    throw new Error('categorization.packageNaming is required when strategy is "package"');
  }

  if (config.categorization.packageNaming) {
    if (!config.categorization.packageNaming.mappings) {
      throw new Error('categorization.packageNaming.mappings is required');
    }

    if (typeof config.categorization.packageNaming.mappings !== 'object') {
      throw new Error('categorization.packageNaming.mappings must be an object');
    }
  }

  // Validate formatting
  if (!['breaking-inline', 'component-prefix'].includes(config.formatting.messageFormat)) {
    throw new Error('formatting.messageFormat must be "breaking-inline" or "component-prefix"');
  }
}
