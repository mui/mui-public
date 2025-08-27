/**
 * Utility to load the bundle-size-checker configuration
 */

import fs from 'node:fs';
import path from 'node:path';
import envCi from 'env-ci';

/**
 * Attempts to load and parse a single config file
 * @param {string} configPath - Path to the configuration file
 * @returns {Promise<BundleSizeCheckerConfigObject | null>} The parsed config or null if file doesn't exist
 * @throws {Error} If the file exists but has invalid format
 */
async function loadConfigFile(configPath) {
  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }

    // Dynamic import for ESM
    const configUrl = new URL(`file://${configPath}`);
    const { default: config } = await import(configUrl.href);

    /** @type {BundleSizeCheckerConfigObject | null} */
    let resolvedConfig = null;
    // Handle configs that might be Promise-returning functions
    if (config instanceof Promise) {
      resolvedConfig = await config;
    } else if (typeof config === 'function') {
      resolvedConfig = await config();
    } else {
      // Handle plain config objects
      resolvedConfig = config;
    }

    return resolvedConfig;
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
 * Normalizes entries to ensure they have a consistent format and ids are unique
 * @param {EntryPoint[]} entries - The array of entries from the config
 * @returns {ObjectEntry[]} - Normalized entries with uniqueness enforced
 */
function normalizeEntries(entries) {
  const usedIds = new Set();

  return entries.map((entry) => {
    if (typeof entry === 'string') {
      // Transform string entries into object entries
      const [importSrc, importName] = entry.split('#');
      if (importName) {
        // For entries like '@mui/material#Button', create an object with import and importedNames
        entry = {
          id: entry,
          import: importSrc,
          importedNames: [importName],
        };
      } else {
        // For entries like '@mui/material', create an object with import only
        entry = {
          id: entry,
          import: importSrc,
        };
      }
    }

    if (!entry.id) {
      throw new Error('Object entries must have an id property');
    }

    if (!entry.code && !entry.import) {
      throw new Error(`Entry "${entry.id}" must have either code or import property defined`);
    }

    if (usedIds.has(entry.id)) {
      throw new Error(`Duplicate entry id found: "${entry.id}". Entry ids must be unique.`);
    }

    usedIds.add(entry.id);

    return entry;
  });
}

/**
 * Apply default values to the configuration using CI environment
 * @param {BundleSizeCheckerConfigObject} config - The loaded configuration
 * @returns {NormalizedBundleSizeCheckerConfig} Configuration with defaults applied
 * @throws {Error} If required fields are missing
 */
function applyConfigDefaults(config) {
  // Get environment CI information
  /** @type {{ branch?: string, isPr?: boolean, prBranch?: string, slug?: string}} */
  const ciInfo = envCi();

  // Basic validation to ensure entries have the required structure
  // More detailed validation will be done in the worker
  for (const entry of config.entrypoints) {
    if (typeof entry !== 'string' && (!entry || typeof entry !== 'object')) {
      throw new Error('Each entry must be either a string or an object');
    }
  }

  // Clone the config to avoid mutating the original
  /** @type {NormalizedBundleSizeCheckerConfig} */
  const result = {
    entrypoints: normalizeEntries(config.entrypoints),
    upload: null, // Default to disabled
    comment: config.comment !== undefined ? config.comment : true, // Default to enabled
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
