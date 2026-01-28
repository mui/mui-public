/**
 * Commit details fetched from GitHub including PR information and labels.
 */
export interface FetchedCommitDetails {
  sha: string;
  message: string;
  labels: string[];
  prNumber: number;
  html_url: string;
  author: {
    login: string;
    association: 'team' | 'first_timer' | 'contributor';
  } | null;
  mergedAt: string | null;
  createdAt: string | null;
}

/**
 * Parsed label information from a commit.
 */
export interface ParsedLabels {
  /**
   * Scope values from labels (e.g., from 'scope: data-grid', 'scope: charts').
   * Multiple scopes mean the commit should appear in multiple sections.
   */
  scopes: string[];
  /**
   * Component values from labels (e.g., from 'component: checkbox', 'component: radio').
   * Multiple components mean the commit should appear in multiple sections.
   */
  components: string[];
  plan?: string;
  flags: string[];
  /**
   * Category override from a label (e.g., 'all components' -> 'General changes').
   * This overrides the normal categorization logic.
   */
  categoryOverride?: string;
}

/**
 * A commit with parsed label information.
 */
export interface CategorizedCommit extends FetchedCommitDetails {
  parsed: ParsedLabels;
}

/**
 * Configuration for label parsing.
 */
export interface LabelConfig {
  plan: {
    values: string[];
  };
  scope?: {
    prefix: string[];
  };
  component?: {
    prefix: string[];
  };
  /**
   * Category overrides - labels that override normal categorization.
   * Maps label to section name.
   * Example: { 'all components': 'General changes', 'docs': 'Docs' }
   */
  categoryOverrides?: Record<string, string>;
  /**
   * Explicit list of flag labels.
   * Only labels in this list will be treated as flags.
   * Example: ['breaking change', 'enhancement', 'bug']
   */
  flags?: Record<
    string,
    {
      name: string;
      prefix?: string;
      suffix?: string;
    }
  >;
  extractLabelsFromTitle?: (commitMessage: string) => string[];
}

/**
 * Package naming configuration for package-first strategy.
 */
export interface PackageNamingConfig {
  /**
   * Explicit mapping from scope label value to package name.
   * Example: { 'data grid': '@mui/x-data-grid', 'charts': '@mui/x-charts' }
   */
  mappings: Record<string, string>;

  /**
   * Mappings for different plan variants.
   * Maps plan name to a mapping of base package to plan-specific package.
   * Example: {
   *   'pro': { '@mui/x-charts': '@mui/x-charts-pro' },
   *   'premium': { '@mui/x-charts': '@mui/x-charts-premium' },
   *   'enterprise': { '@mui/x-charts': '@mui/x-charts-enterprise' }
   * }
   */
  plans?: Record<string, Record<string, string>>;

  /**
   * Scope values that represent generic sections (not packages).
   * These scopes won't go through package name resolution and will be used as-is for sections.
   * Example: ['docs', 'code-infra', 'docs-infra']
   */
  genericScopes?: string[];
}

/**
 * Configuration for categorizing commits into sections.
 */
export interface CategorizationConfig {
  /**
   * Primary categorization strategy.
   * - 'component': Group by component name (For new repos with 1 or 2 packages)
   * - 'package': Group by package name (For established repos with multiple packages)
   */
  strategy: 'component' | 'package';

  /**
   * Label configuration for parsing commit labels.
   */
  labels: LabelConfig;

  /**
   * Package naming configuration (required for 'package' strategy).
   */
  packageNaming?: PackageNamingConfig;

  /**
   * Section ordering and titles.
   */
  sections: {
    /**
     * Section ordering priority by title.
     * Maps section title to order index (lower values appear first).
     * Sections not in this map default to order index 0.
     * When two sections have the same order index, they are sorted alphabetically by title.
     */
    order?: Record<string, number>;

    /**
     * Optional custom titles for sections.
     * Maps section key to display title.
     */
    titles?: Record<string, string>;

    /**
     * Section name for commits that don't match any category.
     */
    fallbackSection: string;
  };

  /**
   * Optional mapping from component label value to display name.
   * Example: { 'pie': 'PieChart', 'bar': 'BarChart' }
   */
  componentNameMapping?: Record<string, string>;
}

/**
 * Configuration for plan inheritance (pro/premium packages).
 */
export interface PlanInheritanceConfig {
  enabled: boolean;
  messages: {
    same: string;
    plus: string;
  };
}

/**
 * Configuration for version and date formatting.
 */
export interface FormatConfig {
  /**
   * Version format template.
   * Use {{version}} placeholder, the value will be picked from workspace package.json.
   *
   * @default 'v{{version}}'
   * @example `Release v{{version}}`
   */
  version?: string;

  /**
   * Date format (using common format tokens). Only the four tokens below are supported:
   * - MMM: abbreviated month name (e.g., Jan, Feb, Mar)
   * - MMMM: full month name (e.g., January, February)
   * - DD: day of month (01 to 31)
   * - YYYY: four-digit year (e.g., 2025)
   *
   * @default 'MMM DD, YYYY' (e.g., 'Aug 15 2025')
   */
  dateFormat?: string;

  /**
   * Format for PR and author attribution. Available placeholders:
   * - {{message}}: Commit message (cleaned up first line)
   * - {{rawMessage}}: Raw commit message (without cleanup and only the first line)
   * - {{prNumber}}: Pull request number
   * - {{prUrl}}: Pull request URL
   * - {{author}}: Author username
   * - {{scope}}: Scope value
   * - {{plan}}: Plan value
   *
   * @example '{{message}} (#[{{prNumber}}]({{prUrl}}) by @{{author}})'
   */
  changelogMessage?: string | ((commit: CategorizedCommit) => string);
  sectionTitle?: {
    forPackage?: string;
  };
  planMessage?: {
    same: string;
    plus: string;
  };
  planBadge?: Record<string, string>;
  showInternalChangesMessage?: boolean;
}

/**
 * Configuration for intro section.
 * The intro section appears after the version and date, before the changelog sections.
 * It can include a thank you message and/or a highlights section with a placeholder for manual curation.
 */
export interface IntroConfig {
  /**
   * Thank you message to show at the start of the intro section.
   * Supports placeholders:
   * - {{contributorCount}}: Total number of contributors (team + community)
   * - {{teamCount}}: Number of team members
   * - {{communityCount}}: Number of community contributors
   *
   * Example: "We'd like to extend a big thank you to the {{contributorCount}} contributors who made this release possible"
   *
   * Set to `false` or omit to disable the thank you message.
   */
  thanksMessage?: string;

  /**
   * Optional prefix text for the highlights section.
   * When provided, adds a highlights section with placeholder comments for manual curation.
   *
   * Example: "Here are some highlights ✨:"
   */
  highlightsPrefix?: string;
}

export type PluralizedMessage =
  | string
  | {
      many: string;
      one: string;
    };

/**
 * Configuration for contributors section.
 */
export interface ContributorsConfig {
  /**
   * Disable the contributors section entirely.
   * @default false
   */
  disabled?: boolean;
  /**
   * Custom message template for the contributors section (when splitByType is false).
   * Supports {contributors} placeholder.
   * Example: "All contributors of this release in alphabetical order: {contributors}"
   */
  message?: {
    contributors?: PluralizedMessage;
    team?: PluralizedMessage;
    community?: PluralizedMessage;
  };

  /**
   * Add contributors list after the intro section instead of at the end.
   * If true, contributors appear immediately after the intro (before changelog sections).
   * If false (default), contributors appear at the end (after all changelog sections).
   *
   * @default false
   */
  addContributorsToIntro?: boolean;
}

/**
 * Configuration for filtering commits.
 */
export interface FilterConfig {
  /**
   * Exclude commits where author username matches any of these patterns.
   * Supports string matching and regular expressions.
   * Example: ['[bot]', 'dependabot'] will exclude any author ending with [bot] or named dependabot.
   */
  excludeCommitByAuthors?: (RegExp | string)[];

  /**
   * Exclude these authors from being shown in the intro thank you message.
   * Supports string matching and regular expressions.
   */
  excludeAuthorsFromContributors?: (RegExp | string)[];

  /**
   * Exclude commits that have any of these labels.
   * Example: ['skip-changelog', 'internal']
   */
  excludeCommitWithLabels?: (RegExp | string)[];

  /**
   * Custom filter function for advanced filtering.
   * Return false to exclude a commit from the changelog.
   */
  customFilter?: (commit: FetchedCommitDetails) => boolean;

  /**
   * Show "Internal changes." for packages where all commits were filtered out.
   * When true, packages with filtered commits will appear in the changelog with "Internal changes." message.
   * When false (default), packages with all commits filtered are omitted entirely.
   *
   * @default false
   */
  showFilteredPackages?: boolean;
}

/**
 * Complete changelog configuration.
 */
export interface ChangelogConfig {
  format?: FormatConfig;
  intro?: IntroConfig;
  contributors?: ContributorsConfig;
  categorization: CategorizationConfig;
  filter?: FilterConfig;
}

/**
 * A section in the changelog.
 */
export interface ChangelogSection {
  /**
   * Section key (package name or component name).
   */
  key: string;

  /**
   * Package version (if applicable).
   */
  pkgInfo: {
    name: string;
    version?: string;
    plan?: string;
  } | null;

  /**
   * Heading level (2 for top-level, 3 for packages, 4 for sub-sections).
   */
  level: number;

  /**
   * Commits in this section.
   */
  commits: CategorizedCommit[];

  /**
   * Sub-sections (for package-first with pro/premium).
   */
  subsections?: ChangelogSection[];
}

/**
 * Options for generating a changelog.
 */
export interface GenerateChangelogOptions {
  /**
   * Repository name (e.g., 'mui-x').
   */
  repo: string;

  /**
   * GitHub organization name (default: 'mui').
   */
  org?: string;

  /**
   * Last release tag or commit ref.
   */
  lastRelease: string;

  /**
   * Current release tag or commit ref.
   */
  release: string;

  /**
   * Version string for the changelog (e.g., '8.19.0').
   */
  version: string;

  /**
   * Release date (will be formatted according to config).
   */
  date: Date;

  /**
   * Changelog configuration (if not loading from file).
   */
  config: ChangelogConfig;
  /**
   * Current working directory to run commands in.
   */
  cwd?: string;
}

/**
 * Result of changelog generation.
 */
export interface GenerateChangelogResult {
  /**
   * Formatted changelog markdown.
   */
  markdown: string;

  /**
   * Categorized sections.
   */
  sections: ChangelogSection[];

  /**
   * All contributors (for contributors section).
   */
  contributors: {
    team: string[];
    community: string[];
    all: string[];
  };
}
