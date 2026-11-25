import type { Octokit } from '@octokit/rest';
// eslint-disable-next-line import/extensions
import type { RepoInfo } from '../utils/git.mjs';

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
  prTitle: string;
  prBody: string;
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
   * Example: "A big thanks to the {{contributorCount}} contributors who made this release possible."
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

export type GitHubRepository = Pick<RepoInfo, 'owner' | 'repo'>;

export interface ReleaseRef {
  /**
   * The ref as given. A local `HEAD` is replaced by its SHA.
   */
  ref: string;
  sha: string;
}

export interface ChangelogAuthor {
  /**
   * `null` for a commit author without a linked GitHub account.
   */
  login: string | null;
  /**
   * Git author name. Only known for direct commits.
   */
  name: string | null;
  association: 'team' | 'community' | 'first-timer';
}

/**
 * A merged pull request, or a commit that landed without one.
 */
export interface ChangelogChange {
  /**
   * Subject of the commit, without the references that the other fields already carry: the pull
   * request it belongs to and, for a cherry-pick, the original pull request and its author.
   */
  title: string;
  /**
   * Full commit message.
   */
  message: string;
  sha: string;
  /**
   * Page of the pull request, or of the commit when there is none.
   */
  url: string;
  labels: string[];
  /**
   * Whether the pull request has the `breaking change` label.
   */
  isBreakingChange: boolean;
  pullRequest: { number: number; title: string; body: string } | null;
  /**
   * `null` when the GitHub account was deleted.
   */
  author: ChangelogAuthor | null;
  /**
   * When the pull request was opened, or the commit authored. ISO 8601.
   */
  createdAt: string | null;
  /**
   * When the pull request was merged, or the commit committed. ISO 8601.
   */
  mergedAt: string | null;
}

export interface ChangelogPackage {
  name: string;
  version: string | null;
  /**
   * Whether the package can't be published: marked as private, or without a version.
   */
  private: boolean;
  /**
   * Directory relative to the workspace root, with `/` separators. `.` for the root package.
   */
  path: string;
  /**
   * Whether the version differs from the previous release. `true` for a new package, `null` when the
   * previous release isn't available locally.
   */
  changed: boolean | null;
}

/**
 * What happened in a release, as JSON-serializable data.
 */
export interface ChangelogData {
  repository: GitHubRepository;
  previous: ReleaseRef;
  release: ReleaseRef;
  version: string;
  /**
   * ISO 8601.
   */
  date: string;
  /**
   * Oldest first.
   */
  changes: ChangelogChange[];
  /**
   * Named packages in the working tree, sorted by path. Without a workspace, only the root package.
   */
  packages: ChangelogPackage[];
}

export interface FetchChangelogDataOptions {
  /**
   * A directory of the released workspace.
   * @default process.cwd()
   */
  cwd?: string;
  /**
   * Repository name. Defaults to the one the checkout's remote points at.
   */
  repo?: string;
  /**
   * @default 'mui'
   */
  org?: string;
  /**
   * Ref of the previous release. Defaults to the closest version tag before `release`.
   */
  lastRelease?: string;
  /**
   * Ref of the release.
   * @default 'HEAD'
   */
  release?: string;
  /**
   * Defaults to the version `release` is a tag of, else the version of the root package.
   */
  version?: string;
  /**
   * Defaults to the commit date when `release` is a version tag, else now.
   */
  date?: Date | string;
  /**
   * Include commits that landed without a pull request.
   * @default false
   */
  includeDirectCommits?: boolean;
  /**
   * GitHub client. Defaults to one authenticated as the developer running it.
   */
  octokit?: Octokit;
}

/**
 * Title of a change, split into its leading `[prefixes]` and the rest.
 */
export interface ChangelogTitle {
  prefixes: string[];
  text: string;
}

/**
 * Authors to credit, once each.
 */
export interface ChangelogCredits {
  all: ChangelogAuthor[];
  team: ChangelogAuthor[];
  community: ChangelogAuthor[];
}

export type MarkdownInline = string | false | null | undefined;

export type MarkdownBlock = MarkdownInline | readonly MarkdownBlock[];
