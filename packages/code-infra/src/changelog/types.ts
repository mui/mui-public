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
  scope: {
    prefix: string;
    required: boolean;
  };
  component: {
    prefix: string;
    required: boolean;
  };
  plan: {
    prefix: string;
    values: string[];
  };
  breaking: {
    value: string;
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
}

/**
 * Package naming configuration for package-first strategy.
 */
export interface PackageNamingConfig {
  /**
   * Explicit mapping from scope label value to package name.
   * Example: { 'data-grid': '@mui/x-data-grid', 'charts': '@mui/x-charts' }
   */
  mappings: Record<string, string>;

  /**
   * Scope values that represent generic sections (not packages).
   * These scopes won't go through package name resolution and will be used as-is for sections.
   * Example: ['docs', 'code-infra', 'docs-infra']
   */
  genericScopes?: string[];

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
   * Badges to display next to package names for different plans.
   * Example: {
   *   'pro': '[![pro](https://...)](...)',
   *   'premium': '[![premium](https://...)](...)'
   * }
   */
  badges?: Record<string, string>;
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
     * Ordered list of section keys (component names or package names).
     */
    order: string[];

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
 * Configuration for formatting changelog messages.
 */
export interface FormattingConfig {
  /**
   * Message format style.
   * - 'breaking-inline': Breaking changes inline with bold prefix (Base UI)
   * - 'component-prefix': Component name as prefix in brackets (MUI X)
   */
  messageFormat: 'breaking-inline' | 'component-prefix';

  /**
   * Component prefix configuration (for 'component-prefix' format).
   */
  componentPrefix?: {
    enabled: boolean;
    format: string;
  };

  /**
   * Breaking change formatting configuration.
   */
  breakingChange?: {
    bold: boolean;
    prefix: string;
  };

  /**
   * Format for PR and author attribution.
   * Use {pr} for PR number and {author} for author username.
   */
  prAuthorFormat: string;
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
   * Use {version} placeholder.
   */
  version: string;

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
}

/**
 * Configuration for intro section.
 */
export interface IntroConfig {
  enabled: boolean;
  highlightsPrefix?: string;
  thanksMessage?: boolean;
}

/**
 * Configuration for contributors section.
 */
export interface ContributorsConfig {
  enabled: boolean;
  splitByType: boolean;
  message?: string;
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
  excludeAuthors?: (RegExp | string)[];

  /**
   * Exclude commits that have any of these labels.
   * Example: ['skip-changelog', 'internal']
   */
  excludeLabels?: (RegExp | string)[];

  /**
   * Custom filter function for advanced filtering.
   * Return false to exclude a commit from the changelog.
   */
  customFilter?: (commit: FetchedCommitDetails) => boolean;
}

/**
 * Complete changelog configuration.
 */
export interface ChangelogConfig {
  format: FormatConfig;
  intro?: IntroConfig;
  contributors?: ContributorsConfig;
  categorization: CategorizationConfig;
  formatting: FormattingConfig;
  planInheritance?: PlanInheritanceConfig;
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
   * Display title for the section.
   */
  title: string;

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

  /**
   * Badge to display (for pro/premium).
   */
  badge?: string;

  /**
   * Inheritance information (for pro/premium packages).
   */
  inheritance?: {
    type: 'same' | 'plus';
    from: string;
  };
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
  };
}
