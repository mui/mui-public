/**
 * Utility to load the bundle-size-checker configuration
 */

import fs from 'fs';
import path from 'path';
import envCi from 'env-ci';

/**
 * Attempts to load and parse a single config file
 * @param {string} configPath - Path to the configuration file
 * @returns {Promise<BundleSizeCheckerConfig | null>} The parsed config or null if file doesn't exist
 * @throws {Error} If the file exists but has invalid format
 */
async function loadConfigFile(configPath) {
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }

    // Dynamic import for ESM
    const configUrl = new URL(`file://${configPath}`);
    const configModule = await import(configUrl.href);
    let config = configModule.default;

    // Handle configs that might be Promise-returning functions
    if (config instanceof Promise) {
      config = await config;
    } else if (typeof config === 'function') {
      config = await config();
    }

    if (!config.entrypoints || !Array.isArray(config.entrypoints)) {
      throw new Error('Configuration must include an entrypoints array');
    }

    // Validate that each entry is either a string or an object with name and code
    for (const entry of config.entrypoints) {
      if (
        typeof entry !== 'string' &&
        (!entry || typeof entry !== 'object' || !entry.name || !entry.code)
      ) {
        throw new Error(
          'Each entry must be either a string or an object with name and code properties',
        );
      }
    }

    return config;
  } catch (error) {
    console.error(`Error loading config from ${configPath}:`, error);
    throw error; // Re-throw to indicate failure
  }
}

/**
 * Validates and normalizes an upload configuration object
 * @param {UploadConfig} uploadConfig - The upload configuration to normalize
 * @param {Object} ciInfo - CI environment information
 * @param {string} [ciInfo.branch] - Branch name from CI environment
 * @param {boolean} [ciInfo.isPr] - Whether this is a pull request from CI environment
 * @param {string} [ciInfo.prBranch] - PR branch name from CI environment
 * @param {string} [ciInfo.slug] - Repository slug from CI environment
 * @returns {NormalizedUploadConfig} - Normalized upload config
 * @throws {Error} If required fields are missing
 */
export function applyUploadConfigDefaults(uploadConfig, ciInfo) {
  const { slug, branch: ciBranch, isPr, prBranch } = ciInfo;

  // Get repo from config or environment
  const repo = uploadConfig.repo || slug;
  if (!repo) {
    throw new Error(
      'Missing required field: upload.repo. Please specify a repository (e.g., "mui/material-ui").',
    );
  }

  // Get branch from config or environment
  const branch = uploadConfig.branch || (isPr ? prBranch : ciBranch);
  if (!branch) {
    throw new Error('Missing required field: upload.branch. Please specify a branch name.');
  }

  // Return the normalized config
  return {
    repo,
    branch,
    isPullRequest:
      uploadConfig.isPullRequest !== undefined
        ? Boolean(uploadConfig.isPullRequest)
        : Boolean(isPr),
  };
}

/**
 * Apply default values to the configuration using CI environment
 * @param {BundleSizeCheckerConfig} config - The loaded configuration
 * @returns {NormalizedBundleSizeCheckerConfig} Configuration with defaults applied
 * @throws {Error} If required fields are missing
 */
function applyConfigDefaults(config) {
  // Get environment CI information
  /** @type {{ branch?: string, isPr?: boolean, prBranch?: string, slug?: string}} */
  const ciInfo = envCi();

  // Clone the config to avoid mutating the original
  /** @type {NormalizedBundleSizeCheckerConfig} */
  const result = {
    entrypoints: config.entrypoints.map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      // Clone object entries to avoid mutation
      return { name: entry.name, code: entry.code };
    }),
    upload: null, // Default to disabled
  };

  // Handle different types of upload value
  if (typeof config.upload === 'boolean') {
    // If upload is false, leave as null
    if (config.upload === false) {
      return result;
    }

    // If upload is true, create empty object and apply defaults
    if (!ciInfo.slug) {
      throw new Error(
        'Upload enabled but repository not found in CI environment. Please specify upload.repo in config.',
      );
    }

    if (!ciInfo.branch && !(ciInfo.isPr && ciInfo.prBranch)) {
      throw new Error(
        'Upload enabled but branch not found in CI environment. Please specify upload.branch in config.',
      );
    }

    // Apply defaults to an empty object
    result.upload = applyUploadConfigDefaults({}, ciInfo);
  } else if (config.upload) {
    // It's an object, apply defaults
    result.upload = applyUploadConfigDefaults(config.upload, ciInfo);
  }

  return result;
}

/**
 * Attempts to load the config file from the given directory
 * @param {string} rootDir - The directory to search for the config file
 * @returns {Promise<NormalizedBundleSizeCheckerConfig>} A promise that resolves to the normalized config object
 */
export async function loadConfig(rootDir) {
  const configPaths = [
    path.join(rootDir, 'bundle-size-checker.config.js'),
    path.join(rootDir, 'bundle-size-checker.config.mjs'),
  ];

  for (const configPath of configPaths) {
    // eslint-disable-next-line no-await-in-loop
    const config = await loadConfigFile(configPath);
    if (config) {
      // Apply defaults and return the config
      return applyConfigDefaults(config);
    }
  }

  // Error out if no config file exists
  throw new Error(
    'No bundle-size-checker configuration file found. Please create a bundle-size-checker.config.js or bundle-size-checker.config.mjs file in your project root.',
  );
}
