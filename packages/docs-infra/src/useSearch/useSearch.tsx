import * as React from 'react';
import {
  create,
  ElapsedTime,
  insertMultiple,
  search as oramaSearch,
  type Orama,
  type Result,
} from '@orama/orama';
import { stemmer, language } from '@orama/stemmers/english';
import { stopwords as englishStopwords } from '@orama/stopwords/english';
import type {
  UseSearchOptions,
  UseSearchResult,
  SearchResult,
  SitemapPage,
  SitemapSectionData,
  SearchBy,
  SearchResults,
} from './types';

// https://github.com/oramasearch/orama/blob/main/packages/stopwords/lib/en.js
// Removed words that might be meaningful in a software documentation context
const stopWords = englishStopwords.filter(
  (word) =>
    word !== 'about' &&
    word !== 'between' &&
    word !== 'before' &&
    word !== 'after' &&
    word !== 'above' &&
    word !== 'below' &&
    word !== 'once' &&
    word !== 'then' &&
    word !== 'where' &&
    word !== 'to' &&
    word !== 'from' &&
    word !== 'up' &&
    word !== 'down' &&
    word !== 'in' &&
    word !== 'out' &&
    word !== 'on' &&
    word !== 'off' &&
    word !== 'over' &&
    word !== 'under',
);

/**
 * Type for our search document structure
 */
interface SearchDocument {
  type: string;
  group: string;
  title: string;
  description: string;
  slug: string;
  sectionTitle: string;
  prefix: string;
  path: string;
  keywords?: string;
  part?: string;
  export?: string;
  props?: string;
  dataAttributes?: string;
  cssVariables?: string;
  page?: string;
  pageKeywords?: string;
  section?: string;
  subsection?: string;
  sections?: string;
  subsections?: string;
}

/**
 * Orama schema definition for our search document
 */
const searchSchema = {
  type: 'string',
  group: 'string',
  title: 'string',
  description: 'string',
  slug: 'string',
  sectionTitle: 'string',
  prefix: 'string',
  path: 'string',
  keywords: 'string',
  page: 'string',
  pageKeywords: 'string',
  sections: 'string',
  subsections: 'string',
  part: 'string',
  export: 'string',
  props: 'string',
  dataAttributes: 'string',
  cssVariables: 'string',
  section: 'string',
  subsection: 'string',
} as const;

type SearchSchema = typeof searchSchema;

/**
 * Type for Orama search hit results
 */
type OramaHit = Result<SearchDocument>;

/**
 * Default function to flatten a sitemap page into search results
 */
function defaultFlattenPage(page: SitemapPage, sectionData: SitemapSectionData): SearchResult[] {
  const results: SearchResult[] = [];

  // Extract top-level sections and all subsections with their slugs
  const sections: Array<{ title: string; slug: string }> = [];
  const subsections: Array<{
    title: string;
    slug: string;
    parentSlugs: string[];
    parentTitles: string[];
  }> = [];

  if (page.sections) {
    // Top-level sections are the direct children
    for (const [slug, sectionInfo] of Object.entries(page.sections)) {
      sections.push({ title: sectionInfo.title, slug });

      // Subsections are all nested children (recursively)
      if (sectionInfo.children && Object.keys(sectionInfo.children).length > 0) {
        type SectionHierarchy = Record<
          string,
          { title: string; children?: Record<string, unknown> }
        >;
        const extractWithSlugs = (
          hierarchy: SectionHierarchy,
          parentSlugs: string[],
          parentTitles: string[],
        ): Array<{
          title: string;
          slug: string;
          parentSlugs: string[];
          parentTitles: string[];
        }> => {
          const items: Array<{
            title: string;
            slug: string;
            parentSlugs: string[];
            parentTitles: string[];
          }> = [];
          for (const [childSlug, childData] of Object.entries(hierarchy)) {
            const currentSlugs = [...parentSlugs, childSlug];
            const currentTitles = [...parentTitles, childData.title];
            items.push({
              title: childData.title,
              slug: childSlug,
              parentSlugs: currentSlugs,
              parentTitles: currentTitles,
            });
            if (childData.children && Object.keys(childData.children).length > 0) {
              items.push(
                ...extractWithSlugs(
                  childData.children as SectionHierarchy,
                  currentSlugs,
                  currentTitles,
                ),
              );
            }
          }
          return items;
        };
        subsections.push(...extractWithSlugs(sectionInfo.children, [slug], [sectionInfo.title]));
      }
    }
  }

  const flattened: Record<string, string> = {};
  if (page.keywords?.length) {
    flattened.keywords = page.keywords.join(' ');
  }

  if (sections.length > 0) {
    flattened.sections = sections.map((s) => s.title).join(' ');
  }

  if (subsections.length > 0) {
    flattened.subsections = subsections.map((s) => s.title).join(' ');
  }

  // Add base page result
  results.push({
    type: 'page',
    group: 'Pages',
    page: page.title,
    title: page.title,
    slug: page.slug,
    path: page.path,
    description: page.description,
    sectionTitle: sectionData.title,
    prefix: sectionData.prefix,
    sections: flattened.sections,
    subsections: flattened.subsections,
    pageKeywords: flattened.keywords,
  });

  // Add entries for each part
  if (page.parts && Object.keys(page.parts).length > 0) {
    for (const [partName, partData] of Object.entries(page.parts)) {
      results.push({
        type: 'part',
        group: 'API Reference',
        part: partName,
        export: `${page.slug}.${partName}`,
        slug: partName.toLowerCase(),
        path: page.path,
        title: page.title ? `${page.title} ‣ ${partName}` : partName,
        description: page.description,
        sectionTitle: sectionData.title,
        prefix: sectionData.prefix,
        props: partData.props ? partData.props.join(' ') : '',
        dataAttributes: partData.dataAttributes ? partData.dataAttributes.join(' ') : '',
        cssVariables: partData.cssVariables ? partData.cssVariables.join(' ') : '',
        keywords: flattened.keywords,
      });
    }
  }

  // Add entries for each export
  if (page.exports && Object.keys(page.exports).length > 0) {
    for (const [exportName, exportData] of Object.entries(page.exports)) {
      // If export name matches page slug (case-insensitive), use #api-reference
      const exportSlug =
        exportName.toLowerCase() === page.slug.toLowerCase()
          ? 'api-reference'
          : exportName.toLowerCase();
      results.push({
        type: 'export',
        group: 'API Reference',
        export: exportSlug,
        slug: page.slug,
        path: page.path,
        title: exportName,
        description: page.description,
        sectionTitle: sectionData.title,
        prefix: sectionData.prefix,
        props: exportData.props ? exportData.props.join(' ') : '',
        dataAttributes: exportData.dataAttributes ? exportData.dataAttributes.join(' ') : '',
        cssVariables: exportData.cssVariables ? exportData.cssVariables.join(' ') : '',
        keywords: flattened.keywords,
      });
    }
  }

  // Add entries for each section
  for (const sectionItem of sections) {
    results.push({
      type: 'section',
      group: 'Sections',
      section: sectionItem.title,
      slug: `${page.slug}#${sectionItem.slug}`,
      path: page.path,
      title: page.title ? `${page.title} ‣ ${sectionItem.title}` : sectionItem.title,
      description: page.description,
      sectionTitle: sectionData.title,
      prefix: sectionData.prefix,
      keywords: flattened.keywords,
    });
  }

  // Add entries for each subsection
  for (const subsectionItem of subsections) {
    const fullTitle = subsectionItem.parentTitles.join(' ‣ ');
    results.push({
      type: 'subsection',
      group: 'Sections',
      subsection: fullTitle,
      slug: `${page.slug}#${subsectionItem.slug.toLowerCase()}`,
      path: page.path,
      title: page.title ? `${page.title} ‣ ${fullTitle}` : fullTitle,
      description: page.description,
      sectionTitle: sectionData.title,
      prefix: sectionData.prefix,
      keywords: flattened.keywords,
    });
  }

  return results;
}

/**
 * Default function to format search results
 */
function defaultFormatResult(hit: OramaHit): SearchResult {
  const base = {
    id: hit.id,
    title: hit.document.title,
    description: hit.document.description,
    slug: hit.document.slug,
    sectionTitle: hit.document.sectionTitle,
    prefix: hit.document.prefix,
    path: hit.document.path,
    score: hit.score,
    keywords: hit.document.keywords,
  };

  const type = hit.document.type;

  if (type === 'part') {
    return {
      ...base,
      type: 'part',
      part: hit.document.part!,
      export: hit.document.export!,
      props: hit.document.props,
      dataAttributes: hit.document.dataAttributes,
      cssVariables: hit.document.cssVariables,
    };
  }

  if (type === 'export') {
    return {
      ...base,
      type: 'export',
      export: hit.document.export!,
      props: hit.document.props,
      dataAttributes: hit.document.dataAttributes,
      cssVariables: hit.document.cssVariables,
    };
  }

  if (type === 'section') {
    return {
      ...base,
      type: 'section',
      section: hit.document.section!,
    };
  }

  if (type === 'subsection') {
    return {
      ...base,
      type: 'subsection',
      subsection: hit.document.subsection!,
    };
  }

  // Default to page type
  return {
    ...base,
    type: 'page',
    sections: hit.document.sections,
    subsections: hit.document.subsections,
  };
}

/**
 * Hook for managing search functionality with Orama
 *
 * @param options Configuration options for search behavior
 * @returns Search state and functions
 */
export function useSearch(options: UseSearchOptions): UseSearchResult<SearchSchema> {
  const {
    sitemap: sitemapImport,
    maxDefaultResults = 10,
    tolerance = 1,
    limit: defaultLimit = 20,
    boost,
    enableStemming = true,
    flattenPage = defaultFlattenPage,
    formatResult = defaultFormatResult,
  } = options;

  const [index, setIndex] = React.useState<Orama<SearchSchema> | null>(null);
  const [defaultResults, setDefaultResults] = React.useState<SearchResults>([]);
  const [results, setResults] = React.useState<{
    results: SearchResults;
    count: number;
    elapsed: ElapsedTime;
  }>({ results: [], count: 0, elapsed: { raw: 0, formatted: '0ms' } });

  React.useEffect(() => {
    (async () => {
      const { sitemap } = await sitemapImport();
      if (!sitemap) {
        console.error('Sitemap is undefined');
        return;
      }

      const searchIndex = await create({
        schema: searchSchema,
        components: enableStemming
          ? {
              tokenizer: {
                stemming: true,
                language,
                stemmer,
                stemmerSkipProperties: [
                  'type',
                  'group',
                  'slug',
                  'sectionTitle',
                  'page',
                  'part',
                  'export',
                  'dataAttributes',
                  'cssVariables',
                  'props',
                ],
                stopWords,
              },
            }
          : undefined,
      });

      // Flatten the sitemap data structure to a single array of pages
      const pages: SearchResult[] = [];
      const pageResults: SearchResult[] = [];

      Object.entries(sitemap.data).forEach(([_sectionKey, sectionData]) => {
        (sectionData.pages || []).forEach((page: SitemapPage) => {
          const flattened = flattenPage(page, sectionData);
          pages.push(...flattened);

          // Add the first result (page type) to default results
          if (pageResults.length < maxDefaultResults && flattened.length > 0) {
            pageResults.push(flattened[0]);
          }
        });
      });

      insertMultiple(searchIndex, pages);

      const pageResultsGrouped = [{ group: 'Default', items: pageResults }];

      setIndex(searchIndex);
      setDefaultResults(pageResultsGrouped);
      setResults({
        results: pageResultsGrouped,
        count: pageResults.length,
        elapsed: { raw: 0, formatted: '0ms' },
      });
    })();
  }, [sitemapImport, maxDefaultResults, flattenPage, enableStemming]);

  const search = React.useCallback(
    async (
      value: string,
      { facets, groupBy, limit = defaultLimit, where }: SearchBy<SearchSchema> = {},
    ) => {
      if (!index || !value.trim()) {
        setResults({
          results: defaultResults,
          count: defaultResults.length,
          elapsed: { raw: 0, formatted: '0ms' },
        });
        return;
      }

      const searchResults = await oramaSearch(index, {
        term: value,
        facets,
        groupBy,
        where,
        limit,
        tolerance,
        boost,
        sortBy: ([_, aScore, aDocument], [__, bScore, bDocument]) => {
          // Prioritize exact matches
          const aExact =
            aDocument.title.toLowerCase() === value.toLowerCase() ||
            aDocument.slug.toLowerCase() === value.toLowerCase();
          const bExact =
            bDocument.title.toLowerCase() === value.toLowerCase() ||
            bDocument.slug.toLowerCase() === value.toLowerCase();

          if (aExact && !bExact) {
            return -1;
          }
          if (!aExact && bExact) {
            return 1;
          }

          // Then sort by score descending
          return bScore - aScore;
        },
      });
      const count = searchResults.count;
      const elapsed = searchResults.elapsed;

      if (searchResults.groups) {
        const groupedResults: SearchResults = searchResults.groups.map((group) => ({
          group: group.values.join(' '),
          items: group.result.map(formatResult),
        }));
        setResults({ results: groupedResults, count, elapsed });
        return;
      }

      const formattedResults: SearchResult[] = searchResults.hits.map(formatResult);
      setResults({ results: [{ group: 'Default', items: formattedResults }], count, elapsed });
    },
    [index, defaultLimit, defaultResults, tolerance, boost, formatResult],
  );

  /**
   * Build a URL from a search result
   * Handles path normalization and hash fragments for different result types
   */
  const buildResultUrl = React.useCallback((result: SearchResult): string => {
    let url = result.path.startsWith('./')
      ? `${result.prefix}${result.path.replace(/^\.\//, '').replace(/\/page\.mdx$/, '')}`
      : result.path;

    // Add hash for non-page types
    if ('type' in result && result.type !== 'page') {
      let hash: string;
      if (result.type === 'section' || result.type === 'subsection') {
        // For sections and subsections, extract hash from the slug field
        // which already contains the page slug + hash (e.g., "button#api-reference")
        const hashIndex = result.slug.indexOf('#');
        hash = hashIndex !== -1 ? result.slug.substring(hashIndex + 1) : '';
      } else if (result.type === 'part') {
        hash = result.part.toLowerCase();
      } else if (result.type === 'export') {
        hash = result.export; // already lowercase or api-reference
      } else {
        hash = '';
      }
      if (hash) {
        url += `#${hash}`;
      }
    }

    return url;
  }, []);

  return {
    results,
    isReady: index !== null,
    search,
    defaultResults,
    buildResultUrl,
  };
}
