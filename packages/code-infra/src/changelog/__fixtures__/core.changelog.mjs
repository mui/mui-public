// Material UI's changelog as code, as `scripts/changelog.config.mjs` in that repository would hold it.
import { readdirSync } from 'node:fs';
import {
  EntryList,
  Entry,
  Heading,
  PackageHeading,
  creditAuthors,
  formatDate,
  groupBy,
  hasLabel,
  md,
  mentions,
  parseLabels,
  sortEntries,
} from '../index.mjs';

/**
 * @typedef {import('../types.ts').ReleaseEntry} ReleaseEntry
 * @typedef {import('../types.ts').ReleaseFacts} ReleaseFacts
 * @typedef {import('../prepare.mjs').ParsedEntryLabels} ParsedEntryLabels
 * @typedef {ReleaseEntry & { parsed: ParsedEntryLabels }} CoreEntry
 * @typedef {{ title: string; pkg?: { name: string; version: string | null }; entries: CoreEntry[] }} CoreSection
 * @typedef {{ facts: ReleaseFacts; sections: CoreSection[]; contributors: string[] }} CoreRelease
 */

const MATERIAL = '@mui/material';
const SYSTEM = '@mui/system';
const LAB = '@mui/lab';
const CORE = 'Core';
const DOCS = 'Docs';
const BREAKING_CHANGE = 'breaking change';

const PACKAGES = [
  MATERIAL,
  '@mui/icons-material',
  SYSTEM,
  '@mui/utils',
  '@mui/types',
  LAB,
  '@mui/codemod',
  '@mui/material-nextjs',
  '@mui/styled-engine',
  '@mui/styled-engine-sc',
  '@mui/private-theming',
  '@mui/material-pigment-css',
  '@mui/stylis-plugin-rtl',
  '@mui/envinfo',
];

const INFRA = ['code-infra', 'docs-infra', 'support-infra', 'back-infra'];
const OVERRIDES = { docs: DOCS, website: DOCS, examples: DOCS, test: CORE };

/** @param {string} name */
function aliases(name) {
  const spaced = name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();

  return [name, spaced, spaced.replaceAll(' ', '-')];
}

/**
 * @param {URL} root Repository root; component folders route `[Button]` to its package.
 * @returns {import('../types.ts').ChangelogPreset<CoreRelease>}
 */
export function coreChangelog(root) {
  /** @type {Record<string, string>} */
  const components = {};

  for (const pkg of [SYSTEM, MATERIAL, LAB]) {
    const folder = new URL(`packages/mui-${pkg.slice('@mui/'.length)}/src/`, root);
    readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[A-Z]/.test(entry.name))
      .forEach((entry) => {
        components[entry.name] = pkg;
      });
  }

  Object.assign(components, {
    Box: SYSTEM,
    Stack: SYSTEM,
    GlobalStyles: SYSTEM,
    LoadingButton: LAB,
    FocusTrap: MATERIAL,
    Hidden: MATERIAL,
    Transitions: MATERIAL,
    Progress: MATERIAL,
    TransferList: MATERIAL,
    Textarea: MATERIAL,
    Toast: MATERIAL,
    NumberField: MATERIAL,
    ToggleGroup: MATERIAL,
  });
  const names = Object.keys(components).sort((a, b) => a.localeCompare(b));

  /** @type {Record<string, string[]>} */
  const titleMappings = {
    ...Object.fromEntries(
      names.flatMap((name) =>
        aliases(name).map((alias) => [alias, [`scope: ${aliases(name)[1]}`]]),
      ),
    ),
    styles: ['scope: styles'],
    theme: ['scope: styles'],
    icons: ['scope: icons'],
    'material-ui': ['package: material-ui'],
    material: ['package: material-ui'],
    l10n: ['package: material-ui'],
    ...Object.fromEntries(
      PACKAGES.flatMap((pkg) => {
        const name = pkg.slice('@mui/'.length);

        return name === 'material' ? [] : [[name, [`package: ${name}`]]];
      }),
    ),
    ...Object.fromEntries(INFRA.map((name) => [name, [`scope: ${name}`]])),
    infra: ['scope: code-infra'],
    'api-docs-builder': ['scope: docs-infra'],
    'core-docs': ['scope: docs-infra'],
    core: ['scope: all components'],
    docs: ['docs'],
    website: ['website'],
    test: ['test'],
    internal: ['internal'],
    ci: ['internal'],
  };

  /** Scope value -> package; unknown scopes default to Material UI, infra to Core. */
  /** @type {Record<string, string>} */
  const packageOf = {
    ...Object.fromEntries(names.flatMap((name) => aliases(name).map((a) => [a, components[name]]))),
    ...Object.fromEntries(PACKAGES.map((name) => [name.slice('@mui/'.length), name])),
    'material-ui': MATERIAL,
    material: MATERIAL,
    system: SYSTEM,
    icons: '@mui/icons-material',
    ...Object.fromEntries(INFRA.map((name) => [name, CORE])),
  };

  const known = new Set(
    Object.values(titleMappings)
      .flat()
      .filter((label) => label.includes(':'))
      .map((label) => label.slice(label.indexOf(':') + 1).trim()),
  );

  /** @param {CoreEntry} entry */
  function destinations(entry) {
    if (entry.parsed.override) {
      return entry.parsed.override;
    }

    if (entry.parsed.scopes.length === 0) {
      return CORE;
    }

    return entry.parsed.scopes.map((scope) => {
      if (scope === DOCS || scope === CORE) {
        return scope;
      }

      const pkg = packageOf[scope] ?? (known.has(scope) ? MATERIAL : undefined);

      if (!pkg) {
        console.warn(
          `No package mapping found for scope "${scope}" in commit ${entry.pr ?? entry.sha}; using Core.`,
        );
      }

      return pkg ?? CORE;
    });
  }

  const order = [...PACKAGES, DOCS, CORE];
  /** @param {string} key */
  const rank = (key) => Math.max(order.indexOf(key), 0);

  return {
    includeDirectCommits: true,
    prepare(facts) {
      const versions = new Map(
        facts.packages.flatMap((pkg) => (pkg.private ? [] : [[pkg.name, pkg.version]])),
      );

      const entries = facts.entries
        .filter(
          (entry) =>
            !entry.author?.login?.endsWith('[bot]') ||
            entry.author.login.includes('copilot') ||
            hasLabel('cherry-pick')(entry),
        )
        .map((entry) => ({
          ...entry,
          parsed: parseLabels(entry, {
            titleMappings,
            scopePrefixes: ['package: ', 'scope: ', 'component: '],
            overrides: OVERRIDES,
            flags: [BREAKING_CHANGE],
          }),
        }));

      /** @type {CoreSection[]} */
      const sections = [];

      for (const [key, group] of groupBy(entries, destinations)) {
        if (key === DOCS || key === CORE) {
          sections.push({ title: key, entries: group });
          continue;
        }

        if (!versions.has(key)) {
          console.warn(
            `Omitting ${group.length} entries for unavailable package ${key}: ${group.map((entry) => entry.pr ?? entry.sha.slice(0, 7)).join(', ')}.`,
          );
          continue;
        }

        sections.push({
          title: key,
          pkg: { name: key, version: versions.get(key) ?? null },
          entries: group,
        });
      }

      sections.sort((a, b) => rank(a.title) - rank(b.title) || a.title.localeCompare(b.title));

      return {
        facts,
        sections,
        contributors: creditAuthors(sections.flatMap((section) => section.entries)).all,
      };
    },
    view: ({ facts, sections, contributors }) => md`
## ${facts.version}

<!-- generated comparing ${facts.lastRelease}...${facts.release} -->

${formatDate(facts.date)}

A big thanks to the ${contributors.length} contributors who made this release possible. Here are some highlights ✨:

TODO INSERT HIGHLIGHTS

${sections.map((section) => [
  section.pkg ? PackageHeading(3, section.pkg) : Heading(3, section.title),
  Changes(section.entries),
])}

All contributors of this release in alphabetical order: ${mentions(contributors)}
`,
  };
}

/** @param {CoreEntry[]} entries */
function Changes(entries) {
  /** @param {CoreEntry[]} list */
  const items = (list) =>
    EntryList(sortEntries(list, prefixesOf), (entry) => Entry(entry, entry.parsed.prefixes));

  const breaking = entries.filter((entry) => entry.parsed.flags.includes(BREAKING_CHANGE));

  if (breaking.length === 0) {
    return items(entries);
  }

  const rest = entries.filter((entry) => !breaking.includes(entry));

  return [
    Heading(4, 'Breaking Changes'),
    items(breaking),
    rest.length > 0 && [Heading(4, 'Changes'), items(rest)],
  ];
}

/** @param {CoreEntry} entry */
function prefixesOf(entry) {
  return entry.parsed.prefixes;
}
