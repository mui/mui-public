import { parseCommitLabels } from './parseCommitLabels.mjs';

/**
 * @typedef {import('./types.ts').FetchedCommitDetails} FetchedCommitDetails
 * @typedef {import('./types.ts').CategorizedCommit} CategorizedCommit
 * @typedef {import('./types.ts').CategorizationConfig} CategorizationConfig
 */

/**
 * Categorizes commits based on the configuration strategy.
 * A commit with multiple scope/component labels will appear in multiple sections.
 *
 * @param {FetchedCommitDetails[]} commits - Commits to categorize
 * @param {CategorizationConfig} config - Categorization configuration
 * @returns {Map<string, CategorizedCommit[]>} Map of category key to commits
 * @throws {Error} If a required label is missing or package mapping not found
 */
export function categorizeCommits(commits, config) {
  /** @type {Map<string, CategorizedCommit[]>} */
  const categories = new Map();

  for (const commit of commits) {
    const parsed = parseCommitLabels(commit, config.labels);

    /** @type {CategorizedCommit} */
    const categorizedCommit = {
      ...commit,
      parsed,
    };

    // Get all category keys for this commit (may be multiple)
    const categoryKeys = getCategoryKeys(categorizedCommit, config);

    // Add commit to all relevant categories
    for (const categoryKey of categoryKeys) {
      const cKey = typeof categoryKey === 'string' ? categoryKey : categoryKey.category;
      if (!categories.has(cKey)) {
        categories.set(cKey, []);
      }

      categories.get(cKey)?.push(categorizedCommit);
    }
  }

  return categories;
}

/**
 * Determines all category keys for a commit based on the strategy.
 * A commit can have multiple category keys if it has multiple scope/component labels.
 *
 * @param {CategorizedCommit} commit - Commit to categorize
 * @param {CategorizationConfig} config - Categorization configuration
 * @returns {(string|{scope: string; category: string})[]} Array of category keys
 * @throws {Error} If required labels are missing or mappings not found
 */
function getCategoryKeys(commit, config) {
  // Check for category override first (e.g., 'all components' -> 'General changes')
  if (commit.parsed.categoryOverride) {
    return [commit.parsed.categoryOverride];
  }

  if (config.strategy === 'component') {
    return getCategoryKeysForComponent(commit, config);
  }

  if (config.strategy === 'package') {
    return getCategoryKeysForPackage(commit, config);
  }

  throw new Error(`Unknown categorization strategy: ${config.strategy}`);
}

/**
 * Gets category keys for component-first strategy (Base UI style).
 * Returns multiple keys if commit has multiple component/scope labels.
 *
 * @param {CategorizedCommit} commit - Commit to categorize
 * @param {CategorizationConfig} config - Categorization configuration
 * @returns {string[]} Array of component names or fallback section
 */
function getCategoryKeysForComponent(commit, config) {
  const keys = [];

  // Use components if available
  if (commit.parsed.components.length > 0) {
    keys.push(...commit.parsed.components);
  }

  if (keys.length === 0) {
    keys.push(config.sections.fallbackSection);
  }

  return keys;
}

/**
 * Gets category keys for package-first strategy (MUI X style).
 * Returns multiple keys if commit has multiple scope labels.
 *
 * @param {CategorizedCommit} commit - Commit to categorize
 * @param {CategorizationConfig} config - Categorization configuration
 * @returns {(string|{scope: string; category: string})[]} Array of package names or generic section names
 * @throws {Error} If scope is required but missing, or mapping not found
 */
function getCategoryKeysForPackage(commit, config) {
  const { scopes, plan } = commit.parsed;

  // If no scopes, use fallback
  if (scopes.length === 0) {
    return [config.sections.fallbackSection];
  }

  // Get package naming config
  if (!config.packageNaming) {
    throw new Error('Package naming configuration is required for package-first strategy');
  }

  const keys = [];

  // Process each scope
  for (const scope of scopes) {
    // Check if this is a generic scope (like 'docs', 'code-infra')
    if (config.packageNaming.genericScopes?.includes(scope)) {
      // Use scope value directly as section name
      keys.push(scope);
      continue;
    }

    // Look up base package name from mappings
    const basePackage = config.packageNaming.mappings[scope];
    if (!basePackage) {
      throw new Error(
        `No package mapping found for scope "${scope}" in commit #${commit.prNumber}. ` +
          `Available mappings: ${Object.keys(config.packageNaming.mappings).join(', ')}`,
      );
    }

    // Apply plan if specified
    if (plan && config.packageNaming.plans && config.packageNaming.plans[plan]) {
      const planPackage = config.packageNaming.plans[plan][basePackage];
      if (!planPackage) {
        throw new Error(
          `No ${plan} plan package mapping found for base package "${basePackage}" in commit #${commit.prNumber}`,
        );
      }
      keys.push({
        scope,
        category: planPackage,
      });
    } else {
      keys.push({
        scope,
        category: basePackage,
      });
    }
  }

  return keys;
}
