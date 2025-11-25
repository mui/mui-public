/**
 * @typedef {import('./types.ts').FetchedCommitDetails} FetchedCommitDetails
 * @typedef {import('./types.ts').ParsedLabels} ParsedLabels
 * @typedef {import('./types.ts').LabelConfig} LabelConfig
 */

/**
 * Parses labels from a commit and extracts scopes, components, plan, category overrides, and flags.
 * Supports multiple scope and component labels - the commit will appear in all matching sections.
 *
 * @param {FetchedCommitDetails} commit - The commit to parse labels from
 * @param {LabelConfig} labelConfig - Configuration for label parsing
 * @returns {ParsedLabels} Parsed label information
 */
export function parseCommitLabels(commit, labelConfig) {
  /** @type {ParsedLabels} */
  const parsed = {
    scopes: [],
    components: [],
    flags: [],
  };

  for (const label of commit.labels) {
    // Check for category overrides first
    if (labelConfig.categoryOverrides && labelConfig.categoryOverrides[label]) {
      parsed.categoryOverride = labelConfig.categoryOverrides[label];
      continue;
    }

    // Parse scope (collect all scopes)
    if (label.startsWith(labelConfig.scope.prefix)) {
      const scopeValue = label.slice(labelConfig.scope.prefix.length).trim();
      parsed.scopes.push(scopeValue);
      continue;
    }

    // Parse component (collect all components)
    if (label.startsWith(labelConfig.component.prefix)) {
      const componentValue = label.slice(labelConfig.component.prefix.length).trim();
      parsed.components.push(componentValue);
      continue;
    }

    // Parse plan
    if (label.startsWith(labelConfig.plan.prefix)) {
      const planValue = label.slice(labelConfig.plan.prefix.length).trim().toLocaleLowerCase();
      if (labelConfig.plan.values.includes(planValue)) {
        parsed.plan = planValue;
      }
      continue;
    }

    // Only add to flags if explicitly configured
    if (labelConfig.flags && Object.hasOwn(labelConfig.flags, label)) {
      parsed.flags.push(labelConfig.flags[label].name);
    }
  }

  return parsed;
}
