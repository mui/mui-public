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
 * @param {Map<string, string>} [packageVersions] - Map of package name to version
 * @returns {ChangelogSection[]} Ordered sections
 */
export function buildSections(categorizedCommits, categorizationConfig, packageVersions) {
  if (categorizationConfig.strategy === 'component') {
    return buildComponentSections(categorizedCommits, categorizationConfig);
  }

  if (categorizationConfig.strategy === 'package') {
    return buildPackageSections(categorizedCommits, categorizationConfig, packageVersions);
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

    sections.push({
      key: categoryKey,
      level: 3, // ### Component
      commits,
      pkgInfo: null,
    });
  }

  return sections;
}

/**
 * Builds sections for package-first strategy (MUI X style).
 *
 * @param {Map<string, CategorizedCommit[]>} categorizedCommits - Map of category key to commits
 * @param {CategorizationConfig} categorizationConfig - Categorization configuration
 * @param {Map<string, string> | undefined} [packageVersions] - Map of package name to version
 * @returns {ChangelogSection[]} Ordered sections
 */
function buildPackageSections(categorizedCommits, categorizationConfig, packageVersions) {
  /** @type {ChangelogSection[]} */
  const sections = [];

  const scopeMap = categorizationConfig.packageNaming
    ? new Map(
        Array.from(Object.entries(categorizationConfig.packageNaming.mappings)).map(
          ([scope, category]) => [category, scope],
        ),
      )
    : new Map();

  // Get all categories
  const allCategories = new Set(categorizedCommits.keys());

  const includeAllPackages = true;

  if (includeAllPackages && categorizationConfig.packageNaming) {
    // Add base packages from plan mappings (pro/premium variants)
    if (categorizationConfig.packageNaming.plans) {
      for (const planMappings of Object.values(categorizationConfig.packageNaming.plans)) {
        if (planMappings) {
          for (const basePackage of Object.keys(planMappings)) {
            allCategories.add(basePackage);
          }
        }
      }
    }

    // Add packages from explicit mappings (scope -> package name)
    if (categorizationConfig.packageNaming.mappings) {
      for (const packageName of Object.values(categorizationConfig.packageNaming.mappings)) {
        allCategories.add(packageName);
      }
    }
  }
  const planOrder = getPlanOrder(categorizationConfig);
  // Group packages by their base (to handle different plan variants together)
  /** @type {Map<string, Record<string, string>>} */
  const packageGroups = new Map();
  for (const key of allCategories) {
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
        const planPackage = planMappings?.[group.base];
        if (planPackage && !group[planName]) {
          // Add the plan variant even though it has no commits
          group[planName] = planPackage;
        }
      }
    }
  }

  // Build sections following configured order
  const fallbackKey = categorizationConfig.sections.fallbackSection;

  // Add remaining sections (not in order)
  const remaining = Array.from(packageGroups.keys())
    .filter((key) => key !== fallbackKey)
    .sort();

  for (const packageKey of remaining) {
    const group = packageGroups.get(packageKey);
    if (!group) {
      continue;
    }

    // Check if this is a generic scope (no plan variants)
    const isGenericScope = categorizationConfig.packageNaming?.genericScopes?.includes(packageKey);

    if (isGenericScope) {
      // For generic scopes, put commits directly in the section (no subsections)
      const commits = categorizedCommits.get(packageKey) || [];
      if (commits.length > 0) {
        sections.push({
          key: packageKey,
          level: 3,
          commits,
          pkgInfo: null,
        });
      }
    } else {
      // For packages with plan variants, create subsections
      const subsections = buildPackageSubsections(
        group,
        planOrder,
        categorizedCommits,
        packageVersions,
      );

      if (subsections.length > 0) {
        sections.push({
          key: scopeMap.get(packageKey) || packageKey,
          level: 3,
          commits: [],
          pkgInfo: null,
          subsections,
        });
      }
    }
  }

  if (fallbackKey) {
    sections.push({
      key: fallbackKey,
      level: 3,
      commits: categorizedCommits.get(fallbackKey) || [],
      pkgInfo: null,
    });
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
      if (planPackages) {
        for (const [base, planPackage] of Object.entries(planPackages)) {
          if (planPackage === packageKey) {
            return base;
          }
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
      if (planPackages) {
        for (const planPackage of Object.values(planPackages)) {
          if (planPackage === packageKey) {
            return planName;
          }
        }
      }
    }
  }

  return 'base';
}

/**
 * Builds subsections for a package group (base and plan variants).
 *
 * @param {Record<string, string>} group - Package group mapping plan names to package keys
 * @param {string[]} planOrder - Order of plans to process
 * @param {Map<string, CategorizedCommit[]>} categorizedCommits - All categorized commits
 * @param {Map<string, string>} [packageVersions] - Map of package name to version
 * @returns {ChangelogSection[]} Package subsections
 */
function buildPackageSubsections(group, planOrder, categorizedCommits, packageVersions) {
  /** @type {ChangelogSection[]} */
  const subsections = [];

  for (const plan of planOrder) {
    const packageKey = group[plan];
    if (!packageKey) {
      continue;
    }

    const commits = categorizedCommits.get(packageKey) || [];

    // Format title with version if available
    const version = packageVersions?.get(packageKey);

    /** @type {ChangelogSection} */
    const section = {
      key: packageKey,
      pkgInfo: {
        name: packageKey,
        version,
        plan,
      },
      level: 4,
      commits,
    };

    subsections.push(section);
  }

  return subsections;
}
