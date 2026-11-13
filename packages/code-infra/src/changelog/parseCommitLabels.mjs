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
  const scopePrefixes = labelConfig.scope?.prefix ?? [LABEL_PREFIX.scope];
  const componentPrefixes = labelConfig.component?.prefix ?? [LABEL_PREFIX.component];

  /** @param {string} label */
  function scopeOf(label) {
    const prefix = scopePrefixes.find((value) => label.startsWith(value));
    return prefix ? label.slice(prefix.length).trim() : undefined;
  }

  /** @param {string} label */
  function planOf(label) {
    if (!label.startsWith(LABEL_PREFIX.plan)) {
      return undefined;
    }
    const value = label.slice(LABEL_PREFIX.plan.length).trim().toLowerCase();
    return labelConfig.plan?.values.includes(value) ? value : undefined;
  }

  const titleGroups = titleTags.map(
    (tag) => mappings.find(([name]) => name.toLowerCase() === tag.toLowerCase())?.[1] ?? [],
  );
  const titleLabels = [
    ...(labelConfig.extractLabelsFromTitle?.(heading) ?? []),
    ...titleGroups.flatMap((group) =>
      group.some((label) => scopeOf(label) !== undefined)
        ? group.filter((label) => !label.startsWith(LABEL_PREFIX.plan))
        : group,
    ),
  ];
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
      const planValue = planOf(label);
      if (planValue) {
        parsed.plan = planValue;
      }
      continue;
    }

    // Only add to flags if explicitly configured
    if (labelConfig.flags && Object.hasOwn(labelConfig.flags, label)) {
      parsed.flags.push(label);
    }
  }

  if (!liveCategories.has('plan')) {
    const scopePlans = Object.fromEntries(
      titleGroups.flatMap((group) => {
        const plan = group.map(planOf).find((value) => value !== undefined);
        if (!plan) {
          return [];
        }
        return group.flatMap((label) => {
          const scope = scopeOf(label)?.toLowerCase();
          return scope && parsed.scopes.some((value) => value.toLowerCase() === scope)
            ? [[scope, plan]]
            : [];
        });
      }),
    );
    if (Object.keys(scopePlans).length > 0) {
      parsed.scopePlans = scopePlans;
      const commonPlan = scopePlans[parsed.scopes[0].toLowerCase()];
      if (
        !parsed.plan &&
        parsed.scopes.every((scope) => scopePlans[scope.toLowerCase()] === commonPlan)
      ) {
        parsed.plan = commonPlan;
      }
    }
  }

  if (labelConfig.titleMappings) {
    const remaining = new Set(labels.map((label) => label.toLowerCase()));
    const prefixes = titleTags.filter(
      (tag) => !mappings.some(([name]) => name.toLowerCase() === tag.toLowerCase()),
    );
    // Composite aliases, e.g. DataGridPro, consume both scope and tier.
    for (const [name, mappedLabels] of [...mappings].sort((a, b) => b[1].length - a[1].length)) {
      const scopes = mappedLabels.flatMap((label) => {
        const scope = scopeOf(label);
        return scope === undefined ? [] : [scope.toLowerCase()];
      });
      const matches = mappedLabels.every((label) => {
        if (label.startsWith(LABEL_PREFIX.plan) && scopes.length > 0) {
          const plan = planOf(label);
          return (
            plan !== undefined &&
            scopes.every((scope) => (parsed.scopePlans?.[scope] ?? parsed.plan) === plan)
          );
        }
        return remaining.has(label.toLowerCase());
      });
      if (mappedLabels.length === 0 || !matches) {
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
      } else if (planOf(label) && planOf(label) === parsed.plan) {
        prefixes.push(label.slice(LABEL_PREFIX.plan.length).trim());
      }
    }
    parsed.titlePrefixes = [...new Set(prefixes)];
  }

  return parsed;
}
