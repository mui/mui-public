import { startCase } from 'es-toolkit/string';

/**
 * @typedef {import('./types.ts').CategorizedCommit} CategorizedCommit
 * @typedef {import('./types.ts').ChangelogSection} ChangelogSection
 * @typedef {import('./types.ts').CategorizationConfig} CategorizationConfig
 * @typedef {import('./types.ts').PlanInheritanceConfig} PlanInheritanceConfig
 */

/**
 * Builds ordered changelog sections from categorized commits.
 *
 * @param {Map<string, CategorizedCommit[]>} categorizedCommits - Map of category key to commits
 * @param {CategorizationConfig} categorizationConfig - Categorization configuration
 * @param {PlanInheritanceConfig} [planInheritanceConfig] - Plan inheritance configuration
 * @param {Map<string, CategorizedCommit[]>} [allCategorizedCommits] - All commits including filtered ones (to detect internal changes)
 * @param {Map<string, string>} [packageVersions] - Map of package name to version
 * @returns {ChangelogSection[]} Ordered sections
 */
export function buildSections(
  categorizedCommits,
  categorizationConfig,
  planInheritanceConfig,
  allCategorizedCommits,
  packageVersions,
) {
  if (categorizationConfig.strategy === 'component') {
    return buildComponentSections(categorizedCommits, categorizationConfig);
  }

  if (categorizationConfig.strategy === 'package') {
    return buildPackageSections(
      categorizedCommits,
      categorizationConfig,
      planInheritanceConfig,
      allCategorizedCommits,
      packageVersions,
    );
  }

  throw new Error(`Unknown categorization strategy: ${categorizationConfig.strategy}`);
}

/**
 * Builds sections for component-first strategy (Base UI style).
 *
 * @param {Map<string, CategorizedCommit[]>} categorizedCommits - Map of category key to commits
 * @param {CategorizationConfig} config - Categorization configuration
 * @returns {ChangelogSection[]} Ordered sections
 */
function buildComponentSections(categorizedCommits, config) {
  /** @type {ChangelogSection[]} */
  const sections = [];

  // Get all categories
  const allCategories = Array.from(categorizedCommits.keys());

  // Separate fallback from regular categories
  const fallbackKey = config.sections.fallbackSection;
  const regularCategories = allCategories.filter((key) => key !== fallbackKey);

  // Sort regular categories alphabetically (fallback will be first)
  regularCategories.sort();

  // Build ordered category list: fallback first, then alphabetically
  const orderedCategories = [];
  if (allCategories.includes(fallbackKey)) {
    orderedCategories.push(fallbackKey);
  }
  orderedCategories.push(...regularCategories);

  // Build sections
  for (const categoryKey of orderedCategories) {
    const commits = categorizedCommits.get(categoryKey) || [];
    if (commits.length === 0) {
      continue;
    }

    const title =
      categoryKey === config.sections.fallbackSection
        ? categoryKey
        : config.sections.titles?.[categoryKey] ||
          (categoryKey === categoryKey.toLowerCase() ? startCase(categoryKey) : categoryKey);

    sections.push({
      key: categoryKey,
      title,
      level: 3, // ### Component
      commits,
    });
  }

  return sections;
}

/**
 * Builds sections for package-first strategy (MUI X style).
 *
 * @param {Map<string, CategorizedCommit[]>} categorizedCommits - Map of category key to commits
 * @param {CategorizationConfig} categorizationConfig - Categorization configuration
 * @param {PlanInheritanceConfig} [planInheritanceConfig] - Plan inheritance configuration
 * @param {Map<string, CategorizedCommit[]>} [allCategorizedCommits] - All commits including filtered ones
 * @param {Map<string, string>} [packageVersions] - Map of package name to version
 * @returns {ChangelogSection[]} Ordered sections
 */
function buildPackageSections(
  categorizedCommits,
  categorizationConfig,
  planInheritanceConfig,
  allCategorizedCommits,
  packageVersions,
) {
  /** @type {ChangelogSection[]} */
  const sections = [];

  // Get all package/section keys from BOTH filtered and all commits
  // This ensures packages with internal-only changes are still included
  const keysFromFiltered = Array.from(categorizedCommits.keys());
  const keysFromAll = allCategorizedCommits ? Array.from(allCategorizedCommits.keys()) : [];
  const allKeys = Array.from(new Set([...keysFromFiltered, ...keysFromAll]));

  // Get plan order (base first, then other plans in config order)
  const planOrder = getPlanOrder(categorizationConfig);

  // Group packages by their base (to handle different plan variants together)
  /** @type {Map<string, Record<string, string>>} */
  const packageGroups = new Map();

  for (const key of allKeys) {
    const basePackage = getBasePackage(key, categorizationConfig);
    if (!packageGroups.has(basePackage)) {
      packageGroups.set(basePackage, {});
    }

    const group = packageGroups.get(basePackage);
    if (!group) {
      continue;
    }
    const plan = getPackagePlan(key, categorizationConfig);
    group[plan] = key;

    // Ensure the base package is present in the group even if it has no commits
    if (!group.base) {
      group.base = plan === 'base' ? key : basePackage;
    }
  }

  // Fill in missing plan variants for each package group
  // If a base package exists, ensure all configured plan variants are included
  for (const [basePackage, group] of packageGroups.entries()) {
    // Skip generic scopes
    if (categorizationConfig.packageNaming?.genericScopes?.includes(basePackage)) {
      continue;
    }

    // If this group has a base package, add all plan variants
    if (group.base && categorizationConfig.packageNaming?.plans) {
      for (const [planName, planMappings] of Object.entries(
        categorizationConfig.packageNaming.plans,
      )) {
        // Check if this plan has a variant for this base package
        const planPackage = planMappings[group.base];
        if (planPackage && !group[planName]) {
          // Add the plan variant even though it has no commits
          group[planName] = planPackage;
        }
      }
    }
  }

  // Build sections following configured order
  const order = categorizationConfig.sections.order;
  const fallbackKey = categorizationConfig.sections.fallbackSection;

  // Process sections in order
  for (const orderKey of order) {
    const group = packageGroups.get(orderKey);
    if (!group) {
      continue;
    }

    const sectionTitle = categorizationConfig.sections.titles?.[orderKey] || orderKey;

    // Check if this is a generic scope (no plan variants)
    const isGenericScope = categorizationConfig.packageNaming?.genericScopes?.includes(orderKey);

    if (isGenericScope) {
      // For generic scopes, put commits directly in the section (no subsections)
      const commits = categorizedCommits.get(orderKey) || [];
      if (commits.length > 0) {
        sections.push({
          key: orderKey,
          title: sectionTitle,
          level: 3,
          commits,
        });
      }
    } else {
      // For packages with plan variants, create subsections
      const subsections = buildPackageSubsections(
        group,
        planOrder,
        categorizationConfig,
        categorizedCommits,
        planInheritanceConfig,
        allCategorizedCommits,
        packageVersions,
      );

      if (subsections.length > 0) {
        sections.push({
          key: orderKey,
          title: sectionTitle,
          level: 3, // ### Data Grid
          commits: [],
          subsections,
        });
      }
    }

    // Remove from map so we can process remaining later
    packageGroups.delete(orderKey);
  }

  // Add remaining sections (not in order)
  const remaining = Array.from(packageGroups.keys())
    .filter((key) => key !== fallbackKey)
    .sort();

  for (const packageKey of remaining) {
    const group = packageGroups.get(packageKey);
    if (!group) {
      continue;
    }

    const sectionTitle = categorizationConfig.sections.titles?.[packageKey] || packageKey;

    // Check if this is a generic scope (no plan variants)
    const isGenericScope = categorizationConfig.packageNaming?.genericScopes?.includes(packageKey);

    if (isGenericScope) {
      // For generic scopes, put commits directly in the section (no subsections)
      const commits = categorizedCommits.get(packageKey) || [];
      if (commits.length > 0) {
        sections.push({
          key: packageKey,
          title: sectionTitle,
          level: 3,
          commits,
        });
      }
    } else {
      // For packages with plan variants, create subsections
      const subsections = buildPackageSubsections(
        group,
        planOrder,
        categorizationConfig,
        categorizedCommits,
        planInheritanceConfig,
        allCategorizedCommits,
        packageVersions,
      );

      if (subsections.length > 0) {
        sections.push({
          key: packageKey,
          title: sectionTitle,
          level: 3,
          commits: [],
          subsections,
        });
      }
    }
  }

  // Add fallback section last
  if (packageGroups.has(fallbackKey)) {
    const group = packageGroups.get(fallbackKey);
    if (!group) {
      return sections;
    }
    const commits = categorizedCommits.get(group.base || fallbackKey) || [];

    if (commits.length > 0) {
      sections.push({
        key: fallbackKey,
        title: fallbackKey,
        level: 3,
        commits,
      });
    }
  }

  return sections;
}

/**
 * Gets the order of plans (base first, then other plans in the order they appear in config).
 *
 * @param {CategorizationConfig} config - Categorization configuration
 * @returns {string[]} Plan order
 */
function getPlanOrder(config) {
  const plans = ['base'];

  if (config.packageNaming?.plans) {
    plans.push(...Object.keys(config.packageNaming.plans));
  }

  return plans;
}

/**
 * Builds subsections for a package group (base and plan variants).
 *
 * @param {Record<string, string>} group - Package group mapping plan names to package keys
 * @param {string[]} planOrder - Order of plans to process
 * @param {CategorizationConfig} categorizationConfig - Categorization configuration
 * @param {Map<string, CategorizedCommit[]>} categorizedCommits - All categorized commits
 * @param {PlanInheritanceConfig} [planInheritanceConfig] - Plan inheritance configuration
 * @param {Map<string, CategorizedCommit[]>} [allCategorizedCommits] - All commits including filtered ones
 * @param {Map<string, string>} [packageVersions] - Map of package name to version
 * @returns {ChangelogSection[]} Package subsections
 */
function buildPackageSubsections(
  group,
  planOrder,
  categorizationConfig,
  categorizedCommits,
  planInheritanceConfig,
  allCategorizedCommits,
  packageVersions,
) {
  /** @type {ChangelogSection[]} */
  const subsections = [];

  // Track which packages have internal changes only
  /** @type {Set<string>} */
  const internalChangesPackages = new Set();

  // Track if any package in the group has visible commits
  let groupHasVisibleCommits = false;

  // First pass: identify packages with internal changes
  for (const plan of planOrder) {
    const packageKey = group[plan];
    if (!packageKey) {
      continue;
    }

    const commits = categorizedCommits.get(packageKey) || [];
    const allCommits = allCategorizedCommits?.get(packageKey) || [];
    const hasInternalChanges = allCommits.length > 0 && commits.length === 0;

    if (commits.length > 0) {
      groupHasVisibleCommits = true;
    }

    if (hasInternalChanges) {
      internalChangesPackages.add(packageKey);
    }
  }

  // Second pass: build subsections
  for (const plan of planOrder) {
    const packageKey = group[plan];
    if (!packageKey) {
      continue;
    }

    const commits = categorizedCommits.get(packageKey) || [];
    const allCommits = allCategorizedCommits?.get(packageKey) || [];
    const hasInternalChanges = allCommits.length > 0 && commits.length === 0;

    const badge = plan !== 'base' ? categorizationConfig.packageNaming?.badges?.[plan] : undefined;

    // Format title with version if available
    const version = packageVersions?.get(packageKey);
    const title = version ? `${packageKey}@${version}` : packageKey;

    /** @type {ChangelogSection} */
    const section = {
      key: packageKey,
      title,
      level: 4, // #### @mui/x-data-grid@8.19.0
      commits,
      badge,
    };

    // Check if we should show inheritance message (only for non-base plans)
    if (plan !== 'base' && planInheritanceConfig?.enabled) {
      // Find the previous plan that has a package in this group
      let inheritFrom = null;
      const planIndex = planOrder.indexOf(plan);
      for (let i = planIndex - 1; i >= 0; i -= 1) {
        const prevPlan = planOrder[i];
        if (group[prevPlan]) {
          inheritFrom = group[prevPlan];
          break;
        }
      }

      if (inheritFrom) {
        // Format inheritFrom with version if available
        const inheritFromVersion = packageVersions?.get(inheritFrom);
        const inheritFromWithVersion = inheritFromVersion
          ? `${inheritFrom}@${inheritFromVersion}`
          : inheritFrom;

        // Determine inheritance type based on whether this package has its own commits
        if (commits.length > 0) {
          // Plus additional changes
          section.inheritance = {
            type: 'plus',
            from: inheritFromWithVersion,
          };
        } else {
          // Same changes only (no commits of its own)
          section.inheritance = {
            type: 'same',
            from: inheritFromWithVersion,
          };
        }
      }
    } else if (plan === 'base') {
      // Mark base plan section as having internal changes only when appropriate
      if (
        hasInternalChanges ||
        (groupHasVisibleCommits && commits.length === 0 && allCommits.length === 0)
      ) {
        section.internalChangesOnly = true;
      }
    }

    subsections.push(section);
  }

  return subsections;
}

/**
 * Gets the base package name for a package key.
 *
 * @param {string} packageKey - Package key
 * @param {CategorizationConfig} config - Categorization configuration
 * @returns {string} Base package name
 */
function getBasePackage(packageKey, config) {
  // Check if it's a generic scope
  if (config.packageNaming?.genericScopes?.includes(packageKey)) {
    return packageKey;
  }

  // Check if it's a plan variant
  if (config.packageNaming?.plans) {
    for (const planPackages of Object.values(config.packageNaming.plans)) {
      for (const [base, planPackage] of Object.entries(planPackages)) {
        if (planPackage === packageKey) {
          return base;
        }
      }
    }
  }

  // It's a base package
  return packageKey;
}

/**
 * Gets the plan for a package key.
 *
 * @param {string} packageKey - Package key
 * @param {CategorizationConfig} config - Categorization configuration
 * @returns {string} Package plan ('base' or plan name from config)
 */
function getPackagePlan(packageKey, config) {
  // Check each plan
  if (config.packageNaming?.plans) {
    for (const [planName, planPackages] of Object.entries(config.packageNaming.plans)) {
      for (const planPackage of Object.values(planPackages)) {
        if (planPackage === packageKey) {
          return planName;
        }
      }
    }
  }

  return 'base';
}
