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

  // Try to extract plan from title if not found in labels
  // @TODO: Temporary workaround for X - remove once all PRs are labeled correctly
  if (!parsed.plan && commit.message && labelConfig.plan.values.length > 0) {
    const planRegex = new RegExp(`(${labelConfig.plan.values.join('|')})\\]`, 'i');
    const titleMatch = planRegex.exec(commit.message);
    if (titleMatch) {
      parsed.plan = titleMatch[1].toLocaleLowerCase();
    }
  }

  for (const label of commit.labels) {
    // Check for category overrides first
    if (labelConfig.categoryOverrides && labelConfig.categoryOverrides[label]) {
      parsed.categoryOverride = labelConfig.categoryOverrides[label];
      continue;
    }

    // Parse scope (collect all scopes)
    const scopeMatchLength = getPrefixMatchLength(label, labelConfig.scope.prefix);
    if (scopeMatchLength !== null) {
      const scopeValue = label.slice(scopeMatchLength).trim();
      parsed.scopes.push(scopeValue);
      continue;
    }

    // Parse component (collect all components)
    const componentMatchLength = getPrefixMatchLength(label, labelConfig.component.prefix);
    if (componentMatchLength !== null) {
      const componentValue = label.slice(componentMatchLength).trim();
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

/**
 * Finds the first matching prefix and returns the matched length.
 * Supports string, regex, or ordered lists of prefixes.
 *
 * @param {string} label - Label to test
 * @param {import('./types.ts').LabelPrefix} prefixes - Prefix or ordered list of prefixes
 * @returns {number | null} Length of matched prefix, or null if no match
 */
function getPrefixMatchLength(label, prefixes) {
  const normalizedPrefixes = Array.isArray(prefixes) ? prefixes : [prefixes];

  for (const prefix of normalizedPrefixes) {
    if (typeof prefix === 'string') {
      if (label.startsWith(prefix)) {
        return prefix.length;
      }
      continue;
    }

    const regex = prefix.global ? new RegExp(prefix.source, prefix.flags.replace('g', '')) : prefix;
    const match = regex.exec(label);

    if (match && match.index === 0) {
      return match[0].length;
    }
  }

  return null;
}
