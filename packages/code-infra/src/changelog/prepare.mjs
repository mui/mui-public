/**
 * Pure helpers for turning release facts into a view's input.
 */

/**
 * @typedef {import('./types.ts').ReleaseEntry} ReleaseEntry
 * @typedef {string | RegExp} Pattern
 */

const SCOPE = 'scope:';
const COMPONENT = 'component:';
const PLAN = 'plan:';

/**
 * @typedef {Object} LabelOptions
 * @property {Record<string, string[]>} [titleMappings] Bracket prefix -> labels it stands for, e.g. `{ DataGridPro: ['scope: data grid', 'plan: pro'] }`. The first mapping of equal labels is the canonical spelling.
 * @property {string[]} [scopePrefixes] Defaults to `['scope:']`.
 * @property {string[]} [componentPrefixes] Defaults to `['component:']`.
 * @property {string[]} [plans] Recognized `plan:` values.
 * @property {Record<string, string>} [overrides] Label -> destination that replaces scope routing.
 * @property {string[]} [flags] Labels reported in `flags`.
 */

/**
 * @typedef {Object} ParsedEntryLabels
 * @property {string[]} labels Live labels followed by title-derived ones.
 * @property {string[]} scopes
 * @property {string[]} components
 * @property {string} [plan]
 * @property {Record<string, string>} [scopePlans] Title-derived tiers keyed by lowercase scope.
 * @property {string[]} flags
 * @property {string} [override]
 * @property {string[]} prefixes Canonical bracket prefixes; the original ones without `titleMappings`.
 */

/**
 * Read routing labels from live labels and bracket prefixes. Title hints only fill categories
 * (scope, component, plan, override, or a plain label) that live labels leave empty.
 *
 * @param {ReleaseEntry} entry
 * @param {LabelOptions} [options]
 * @returns {ParsedEntryLabels}
 */
export function parseLabels(entry, options = {}) {
  const mappings = Object.entries(options.titleMappings ?? {});
  const scopePrefixes = options.scopePrefixes ?? [SCOPE];
  const componentPrefixes = options.componentPrefixes ?? [COMPONENT];
  const overrides = options.overrides ?? {};

  /** @param {string} label */
  function scopeOf(label) {
    const prefix = scopePrefixes.find((value) => label.startsWith(value));

    return prefix ? label.slice(prefix.length).trim() : undefined;
  }

  /** @param {string} label */
  function componentOf(label) {
    const prefix = componentPrefixes.find((value) => label.startsWith(value));

    return prefix ? label.slice(prefix.length).trim() : undefined;
  }

  /** @param {string} label */
  function planOf(label) {
    if (!label.startsWith(PLAN)) {
      return undefined;
    }

    const value = label.slice(PLAN.length).trim().toLowerCase();

    return options.plans?.includes(value) ? value : undefined;
  }

  /** @param {string} label */
  function category(label) {
    if (overrides[label]) {
      return 'override';
    }

    if (scopeOf(label) !== undefined) {
      return 'scope';
    }

    if (componentOf(label) !== undefined) {
      return 'component';
    }

    if (label.startsWith(PLAN)) {
      return 'plan';
    }

    return label;
  }

  const titleGroups = entry.prefixes.map(
    (tag) => mappings.find(([name]) => name.toLowerCase() === tag.toLowerCase())?.[1] ?? [],
  );

  // A tier in a scoped alias belongs to that scope only; it is applied through `scopePlans`.
  const titleLabels = titleGroups.flatMap((group) =>
    group.some((label) => scopeOf(label) !== undefined)
      ? group.filter((label) => !label.startsWith(PLAN))
      : group,
  );

  const liveCategories = new Set(entry.labels.map(category));

  const labels = [
    ...new Set([
      ...entry.labels,
      ...titleLabels.filter((label) => !liveCategories.has(category(label))),
    ]),
  ];

  /** @type {ParsedEntryLabels} */
  const parsed = { labels, scopes: [], components: [], flags: [], prefixes: entry.prefixes };

  for (const label of labels) {
    if (overrides[label]) {
      parsed.override = overrides[label];
      continue;
    }

    const scope = scopeOf(label);

    if (scope !== undefined) {
      parsed.scopes.push(scope);
      continue;
    }

    const component = componentOf(label);

    if (component !== undefined) {
      parsed.components.push(component);
      continue;
    }

    if (label.startsWith(PLAN)) {
      parsed.plan = planOf(label) ?? parsed.plan;
      continue;
    }

    if (options.flags?.includes(label)) {
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
      const common = scopePlans[parsed.scopes[0].toLowerCase()];

      if (
        !parsed.plan &&
        parsed.scopes.every((scope) => scopePlans[scope.toLowerCase()] === common)
      ) {
        parsed.plan = common;
      }
    }
  }

  if (mappings.length > 0) {
    parsed.prefixes = canonicalPrefixes(entry, labels, mappings, parsed, {
      scopeOf,
      componentOf,
      planOf,
    });
  }

  return parsed;
}

/**
 * Spell prefixes from the resolved labels, so `[data grid]`, `[DataGrid]` and a live
 * `scope: data grid` label all render as the first matching mapping.
 *
 * @param {ReleaseEntry} entry
 * @param {string[]} labels
 * @param {[string, string[]][]} mappings
 * @param {ParsedEntryLabels} parsed
 * @param {{ scopeOf: (label: string) => string | undefined; componentOf: (label: string) => string | undefined; planOf: (label: string) => string | undefined }} readers
 * @returns {string[]}
 */
function canonicalPrefixes(entry, labels, mappings, parsed, { scopeOf, componentOf, planOf }) {
  const remaining = new Set(labels.map((label) => label.toLowerCase()));

  const prefixes = entry.prefixes.filter(
    (tag) => !mappings.some(([name]) => name.toLowerCase() === tag.toLowerCase()),
  );

  // Composite aliases, e.g. DataGridPro, consume both scope and tier.
  for (const [name, mapped] of [...mappings].sort((a, b) => b[1].length - a[1].length)) {
    const scopes = mapped.flatMap((label) => {
      const scope = scopeOf(label);

      return scope === undefined ? [] : [scope.toLowerCase()];
    });

    const matches = mapped.every((label) => {
      if (label.startsWith(PLAN) && scopes.length > 0) {
        const plan = planOf(label);

        return (
          plan !== undefined &&
          scopes.every((scope) => (parsed.scopePlans?.[scope] ?? parsed.plan) === plan)
        );
      }

      return remaining.has(label.toLowerCase());
    });

    if (mapped.length === 0 || !matches) {
      continue;
    }

    prefixes.push(name);
    mapped.forEach((label) => remaining.delete(label.toLowerCase()));
  }

  for (const label of labels) {
    if (!remaining.has(label.toLowerCase())) {
      continue;
    }

    const value = scopeOf(label) ?? componentOf(label);

    if (value !== undefined) {
      prefixes.push(value);
    } else if (planOf(label) && planOf(label) === parsed.plan) {
      prefixes.push(label.slice(PLAN.length).trim());
    }
  }

  return [...new Set(prefixes)];
}

/**
 * Group items by one or more keys each, in first-seen order. Items without a key are dropped.
 *
 * @template T
 * @param {readonly T[]} items
 * @param {(item: T) => string | readonly string[] | null | undefined} keyOf
 * @returns {Map<string, T[]>}
 */
export function groupBy(items, keyOf) {
  /** @type {Map<string, T[]>} */
  const groups = new Map();

  for (const item of items) {
    const key = keyOf(item);
    const keys = typeof key === 'string' ? [key] : new Set(key ?? []);

    for (const value of keys) {
      const group = groups.get(value);

      if (group) {
        group.push(item);
      } else {
        groups.set(value, [item]);
      }
    }
  }

  return groups;
}

/**
 * @param {Pattern} pattern
 * @param {string} value
 */
function matches(pattern, value) {
  return typeof pattern === 'string' ? pattern === value : pattern.test(value);
}

/**
 * Entries with any matching live label. Strings match exactly.
 * @param {...Pattern} patterns
 * @returns {(entry: ReleaseEntry) => boolean}
 */
export function hasLabel(...patterns) {
  return (entry) => entry.labels.some((label) => patterns.some((p) => matches(p, label)));
}

/**
 * Entries with any matching bracket prefix. Strings match case-insensitively.
 * @param {...Pattern} patterns
 * @returns {(entry: ReleaseEntry) => boolean}
 */
export function hasPrefix(...patterns) {
  return (entry) =>
    entry.prefixes.some((prefix) =>
      patterns.some((p) =>
        typeof p === 'string' ? p.toLowerCase() === prefix.toLowerCase() : p.test(prefix),
      ),
    );
}

/**
 * Entries whose author login matches. Strings match exactly.
 * @param {...Pattern} patterns
 * @returns {(entry: ReleaseEntry) => boolean}
 */
export function byAuthor(...patterns) {
  return (entry) => {
    const login = entry.author?.login;

    return !!login && patterns.some((p) => matches(p, login));
  };
}

/**
 * @template T
 * @param {(item: T) => boolean} predicate
 * @returns {(item: T) => boolean}
 */
export function not(predicate) {
  return (item) => !predicate(item);
}

/** @param {string} a @param {string} b */
function byLogin(a, b) {
  return a.toLowerCase().localeCompare(b.toLowerCase());
}

/**
 * Credit the authors of `entries`, sorted case-insensitively. An author who is team anywhere is team.
 *
 * @param {readonly ReleaseEntry[]} entries
 * @param {{ exclude?: Pattern[] }} [options] Logins to leave out; strings match exactly.
 * @returns {{ team: string[]; community: string[]; all: string[] }}
 */
export function creditAuthors(entries, options = {}) {
  const exclude = options.exclude ?? [];
  /** @type {Set<string>} */
  const team = new Set();
  /** @type {Set<string>} */
  const community = new Set();

  for (const entry of entries) {
    const login = entry.author?.login;

    if (!login || exclude.some((pattern) => matches(pattern, login))) {
      continue;
    }

    (entry.author?.association === 'team' ? team : community).add(login);
  }

  const result = {
    team: [...team].sort(byLogin),
    community: [...community].filter((login) => !team.has(login)).sort(byLogin),
  };

  return { ...result, all: [...result.team, ...result.community].sort(byLogin) };
}

/**
 * Order entries by their prefixes, case-insensitively and unprefixed last, then by merge time.
 *
 * @template {ReleaseEntry} T
 * @param {readonly T[]} entries
 * @param {(entry: T) => readonly string[]} [prefixesOf]
 * @returns {T[]}
 */
export function sortEntries(entries, prefixesOf = (entry) => entry.prefixes) {
  /** @param {T} entry */
  const keyOf = (entry) => {
    const prefixes = prefixesOf(entry);

    return prefixes.length === 0 ? '￿' : prefixes.map((p) => p.toLowerCase()).join('\x00');
  };

  /** @param {T} entry */
  const timeOf = (entry) => (entry.mergedAt ? new Date(entry.mergedAt).getTime() : (entry.pr ?? 0));

  return [...entries].sort((a, b) => keyOf(a).localeCompare(keyOf(b)) || timeOf(a) - timeOf(b));
}
