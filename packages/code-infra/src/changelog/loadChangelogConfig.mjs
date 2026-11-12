import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateChangelogConfig } from './validateChangelogConfig.mjs';

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
    validateChangelogConfig(config);

    return config;
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load changelog config: ${message}`);
  }
}
