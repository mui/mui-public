/**
 * @typedef {import('./types.ts').FetchedCommitDetails} FetchedCommitDetails
 * @typedef {import('./types.ts').ParsedLabels} ParsedLabels
 * @typedef {import('./types.ts').LabelConfig} LabelConfig
 */

const LABEL_PREFIX = {
  scope: 'scope:',
  component: 'component:',
  plan: 'plan:',
};

/**
 * Parses labels from a commit and extracts scopes, components, plan, category overrides, and flags.
 * Supports multiple scope and component labels - the commit will appear in all matching sections.
 * Mutates the commit's labels to include any extracted from the title.
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

  const heading = commit.message.split('\n')[0].trim();

  const titleLabels =
    typeof labelConfig.extractLabelsFromTitle === 'function'
      ? labelConfig.extractLabelsFromTitle(heading)
      : [];
  if (titleLabels.length > 0) {
    commit.labels = Array.from(new Set([...commit.labels, ...titleLabels]));
  }

  for (const label of commit.labels) {
    // Check for category overrides first
    if (labelConfig.categoryOverrides && labelConfig.categoryOverrides[label]) {
      parsed.categoryOverride = labelConfig.categoryOverrides[label];
      continue;
    }

    const scopePrefixes = labelConfig.scope?.prefix || [LABEL_PREFIX.scope];
    const scopePrefixMatched = scopePrefixes.find((prefix) => label.startsWith(prefix));

    if (scopePrefixMatched) {
      const scopeValue = label.slice(scopePrefixMatched.length).trim();
      parsed.scopes.push(scopeValue);
      continue;
    }
    const componentPrefixes = labelConfig.component?.prefix || [LABEL_PREFIX.component];
    const componentPrefixMatched = componentPrefixes.find((prefix) => label.startsWith(prefix));

    if (componentPrefixMatched) {
      const componentValue = label.slice(componentPrefixMatched.length).trim();
      parsed.components.push(componentValue);
      continue;
    }
    if (label.startsWith(LABEL_PREFIX.plan)) {
      const planValue = label.slice(LABEL_PREFIX.plan.length).trim().toLowerCase();
      if (labelConfig.plan.values.includes(planValue)) {
        parsed.plan = planValue;
      }
      continue;
    }

    // Only add to flags if explicitly configured
    if (labelConfig.flags && Object.hasOwn(labelConfig.flags, label)) {
      parsed.flags.push(label);
    }
  }

  return parsed;
}
