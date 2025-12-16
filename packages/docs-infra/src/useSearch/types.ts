import { ElapsedTime, Orama, SearchParams } from '@orama/orama';
import type {
  Sitemap,
  SitemapPage,
  SitemapSection,
  SitemapPart,
  SitemapExport,
  SitemapSectionData,
} from '../createSitemap/types';

/**
 * Base search result structure that can be extended by consumers
 */
export interface BaseSearchResult {
  id?: string;
  title?: string;
  description?: string;
  slug: string;
  path: string;
  sectionTitle: string;
  prefix: string;
  keywords?: string;
  score?: number;
  group?: string;
}

/**
 * Page search result (top-level documentation page)
 */
export interface PageSearchResult extends BaseSearchResult {
  type: 'page';
  page?: string;
  pageKeywords?: string;
  sections?: string;
  subsections?: string;
}

/**
 * Part search result (component part with API documentation)
 */
export interface PartSearchResult extends BaseSearchResult {
  type: 'part';
  part: string;
  export: string;
  props?: string;
  dataAttributes?: string;
  cssVariables?: string;
}

/**
 * Export search result (exported function/component with API documentation)
 */
export interface ExportSearchResult extends BaseSearchResult {
  type: 'export';
  export: string;
  props?: string;
  dataAttributes?: string;
  cssVariables?: string;
}

/**
 * Section search result (top-level heading within a page)
 */
export interface SectionSearchResult extends BaseSearchResult {
  type: 'section';
  section: string;
}

/**
 * Subsection search result (nested heading within a page)
 */
export interface SubsectionSearchResult extends BaseSearchResult {
  type: 'subsection';
  subsection: string;
}

/**
 * Union type of all common search result variants
 */
export type SearchResult =
  | PageSearchResult
  | PartSearchResult
  | ExportSearchResult
  | SectionSearchResult
  | SubsectionSearchResult;

// Re-export sitemap types for convenience
export type {
  SitemapPage,
  SitemapSection,
  SitemapPart,
  SitemapExport,
  SitemapSectionData,
  Sitemap,
};

export type SearchResults = { group: string; items: SearchResult[] }[];

/**
 * Options for configuring search behavior
 */
export interface UseSearchOptions {
  /** Function that returns a promise resolving to sitemap data */
  sitemap: () => Promise<{ sitemap?: Sitemap }>;
  /** Maximum number of default results to show */
  maxDefaultResults?: number;
  /** Search tolerance for fuzzy matching */
  tolerance?: number;
  /** Maximum number of search results */
  limit?: number;
  /** Enable stemming and stopwords (uses English by default) */
  enableStemming?: boolean;
  /** Boost values for different result types and fields */
  boost?: Partial<Record<string, number>>;
  /** Include page categories in groups: "Overview Pages" vs "Pages" */
  includeCategoryInGroup?: boolean;
  /**
   * When true, excludes `sections` and `subsections` fields from page-type results.
   * The individual section and subsection entries are still created.
   * @default false
   */
  excludeSections?: boolean;
  /**
   * Custom function to convert heading text to URL-friendly slugs.
   * Use this to match your site's slug generation (e.g., rehype-slug).
   * Only applied to section/subsection slugs from the sitemap.
   *
   * If not provided, the original slugs from the sitemap are used as-is.
   *
   * The second parameter `parentTitles` contains the original text of parent headings,
   * useful for pages that concatenate parent context into child heading IDs
   * (e.g., Releases pages: `v1.0.0-rc.0-autocomplete` where the version is prepended).
   *
   * @example
   * ```ts
   * // Simple generateSlug (ignores parent context)
   * generateSlug: (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-')
   *
   * // generateSlug with parent concatenation for subsections (e.g., Releases page)
   * generateSlug: (text, parentTitles) => {
   *   const slug = stringToUrl(text);
   *   // If parent is a semver version, prepend it to match rehypeConcatHeadings
   *   if (parentTitles?.[0]?.match(/^v\d+\.\d+\.\d+/)) {
   *     return `${parentTitles[0]}-${slug}`;
   *   }
   *   return slug;
   * }
   * ```
   */
  generateSlug?: (text: string, parentTitles?: string[]) => string;
  /** Custom function to flatten sitemap pages into search results */
  flattenPage?: (page: SitemapPage, sectionData: SitemapSectionData) => SearchResult[];
  /** Custom function to format Orama search hits into typed results */
  formatResult?: <TDocument = unknown>(
    hit: import('@orama/orama').Result<TDocument>,
  ) => SearchResult;
}

export type SearchBy<T> = Pick<
  SearchParams<Orama<T>>,
  'facets' | 'groupBy' | 'limit' | 'offset' | 'where'
>;

/**
 * Return value from useSearch hook
 */
export interface UseSearchResult<T> {
  /**
   * Current search results
   */
  results: { results: SearchResults; count: number; elapsed: ElapsedTime };

  /**
   * Whether the search index is ready
   */
  isReady: boolean;

  /**
   * Function to update search value and get new results
   */
  search: (value: string, by?: SearchBy<T>) => Promise<void>;

  /**
   * Default results shown when search is empty
   */
  defaultResults: { results: SearchResults; count: number; elapsed: ElapsedTime };

  /**
   * Build a URL from a search result
   * Handles path normalization and hash fragments for different result types
   */
  buildResultUrl: (result: SearchResult) => string;
}
