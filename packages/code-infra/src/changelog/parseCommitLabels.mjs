import { parseTitle } from './parseTitle.mjs';

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
 * Leaves source labels unchanged so filtering and subsequent renders remain independent.
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

  const { tags: titleTags } = parseTitle(heading);
  const mappings = Object.entries(labelConfig.titleMappings ?? {});
  const titleLabels = [
    ...(labelConfig.extractLabelsFromTitle?.(heading) ?? []),
    ...titleTags.flatMap(
      (tag) => mappings.find(([name]) => name.toLowerCase() === tag.toLowerCase())?.[1] ?? [],
    ),
  ];
  const scopePrefixes = labelConfig.scope?.prefix ?? [LABEL_PREFIX.scope];
  const componentPrefixes = labelConfig.component?.prefix ?? [LABEL_PREFIX.component];
  /** @param {string} label */
  function category(label) {
    if (scopePrefixes.some((prefix) => label.startsWith(prefix))) {
      return 'scope';
    }
    if (componentPrefixes.some((prefix) => label.startsWith(prefix))) {
      return 'component';
    }
    if (label.startsWith(LABEL_PREFIX.plan)) {
      return 'plan';
    }
    if (labelConfig.categoryOverrides?.[label]) {
      return 'override';
    }
    return label;
  }

  // Title hints fill missing categories; they never override live GitHub labels.
  const liveCategories = new Set(commit.labels.map(category));
  const labels = [
    ...new Set([
      ...commit.labels,
      ...titleLabels.filter((label) => !liveCategories.has(category(label))),
    ]),
  ];

  if (labelConfig.titleMappings) {
    const remaining = new Set(labels.map((label) => label.toLowerCase()));
    const prefixes = titleTags.filter(
      (tag) => !mappings.some(([name]) => name.toLowerCase() === tag.toLowerCase()),
    );
    // Composite aliases, e.g. DataGridPro, consume both scope and tier.
    for (const [name, mappedLabels] of [...mappings].sort((a, b) => b[1].length - a[1].length)) {
      if (
        mappedLabels.length === 0 ||
        !mappedLabels.every((label) => remaining.has(label.toLowerCase()))
      ) {
        continue;
      }
      prefixes.push(name);
      mappedLabels.forEach((label) => remaining.delete(label.toLowerCase()));
    }
    // A composite alias may stop matching only one category; retain its other fields.
    for (const label of labels) {
      if (!remaining.has(label.toLowerCase())) {
        continue;
      }
      const prefix = [...scopePrefixes, ...componentPrefixes].find((value) =>
        label.startsWith(value),
      );
      if (prefix) {
        prefixes.push(label.slice(prefix.length).trim());
      } else if (
        label.startsWith(LABEL_PREFIX.plan) &&
        labelConfig.plan?.values.includes(
          label.slice(LABEL_PREFIX.plan.length).trim().toLowerCase(),
        )
      ) {
        prefixes.push(label.slice(LABEL_PREFIX.plan.length).trim());
      }
    }
    parsed.titlePrefixes = [...new Set(prefixes)];
  }

  for (const label of labels) {
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
      if (labelConfig.plan?.values.includes(planValue)) {
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
