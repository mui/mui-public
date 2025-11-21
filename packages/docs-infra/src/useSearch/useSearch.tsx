import * as React from 'react';
import { create, insert, search as oramaSearch, type Orama, type Result } from '@orama/orama';
import { stemmer, language } from '@orama/stemmers/english';
import { stopwords as englishStopwords } from '@orama/stopwords/english';
import type {
  UseSearchOptions,
  UseSearchResult,
  SearchResult,
  SitemapPage,
  SitemapSectionData,
} from './types';

/**
 * Type for our search document structure
 */
interface SearchDocument {
  type: string;
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
  title: 'string',
  description: 'string',
  slug: 'string',
  sectionTitle: 'string',
  prefix: 'string',
  path: 'string',
  keywords: 'string',
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
    title: page.title,
    slug: page.slug,
    path: page.path,
    description: page.description,
    sectionTitle: sectionData.title,
    prefix: sectionData.prefix,
    ...flattened,
  });

  // Add entries for each part
  if (page.parts && Object.keys(page.parts).length > 0) {
    for (const [partName, partData] of Object.entries(page.parts)) {
      results.push({
        type: 'part',
        part: partName,
        export: `${page.slug}.${partName}`,
        slug: partName.toLowerCase(),
        path: page.path,
        title: page.title ? `${page.title} - ${partName}` : partName,
        description: page.description,
        sectionTitle: sectionData.title,
        prefix: sectionData.prefix,
        props: partData.props ? partData.props.join(' ') : '',
        dataAttributes: partData.dataAttributes ? partData.dataAttributes.join(' ') : '',
        cssVariables: partData.cssVariables ? partData.cssVariables.join(' ') : '',
        keywords: page.keywords?.length ? page.keywords.join(' ') : '',
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
        keywords: page.keywords?.length ? page.keywords.join(' ') : '',
      });
    }
  }

  // Add entries for each section
  for (const sectionItem of sections) {
    results.push({
      type: 'section',
      section: sectionItem.title,
      slug: `${page.slug}#${sectionItem.slug}`,
      path: page.path,
      title: page.title ? `${page.title} - ${sectionItem.title}` : sectionItem.title,
      description: page.description,
      sectionTitle: sectionData.title,
      prefix: sectionData.prefix,
      keywords: page.keywords?.length ? page.keywords.join(' ') : '',
    });
  }

  // Add entries for each subsection
  for (const subsectionItem of subsections) {
    const fullTitle = subsectionItem.parentTitles.join(' - ');
    results.push({
      type: 'subsection',
      subsection: fullTitle,
      slug: `${page.slug}#${subsectionItem.slug.toLowerCase()}`,
      path: page.path,
      title: page.title ? `${page.title} - ${fullTitle}` : fullTitle,
      description: page.description,
      sectionTitle: sectionData.title,
      prefix: sectionData.prefix,
      keywords: page.keywords?.length ? page.keywords.join(' ') : '',
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
export function useSearch(options: UseSearchOptions): UseSearchResult {
  const {
    sitemap: sitemapImport,
    maxDefaultResults = 10,
    tolerance = 1,
    limit = 20,
    boost,
    enableStemming = true,
    flattenPage = defaultFlattenPage,
    formatResult = defaultFormatResult,
  } = options;

  const [index, setIndex] = React.useState<Orama<SearchSchema> | null>(null);
  const [defaultResults, setDefaultResults] = React.useState<SearchResult[]>([]);
  const [results, setResults] = React.useState<SearchResult[]>([]);

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
                stopWords: englishStopwords,
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

      await Promise.all(pages.map((page) => insert(searchIndex, page)));

      setIndex(searchIndex);
      setDefaultResults(pageResults);
      setResults(pageResults);
    })();
  }, [sitemapImport, maxDefaultResults, flattenPage, enableStemming]);

  const search = React.useCallback(
    async (value: string) => {
      if (!index || !value.trim()) {
        setResults([]);
        return;
      }

      const searchResults = await oramaSearch(index, {
        term: value,
        limit,
        tolerance,
        boost,
      });

      const formattedResults: SearchResult[] = searchResults.hits.map(formatResult);
      setResults(formattedResults);
    },
    [index, limit, tolerance, boost, formatResult],
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
