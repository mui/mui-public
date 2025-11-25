'use client';
import * as React from 'react';
import { useSearch } from '@mui/internal-docs-infra/useSearch';
import type { SearchResult, Sitemap } from '@mui/internal-docs-infra/useSearch/types';
import classes from './SearchBar.module.css';

export function SearchBar({
  sitemap: sitemapImport,
}: {
  sitemap: () => Promise<{ sitemap?: Sitemap }>;
}) {
  const [searchTerm, setSearchTerm] = React.useState('');

  // Use the generic search hook
  const { results, search, defaultResults, buildResultUrl } = useSearch({
    sitemap: sitemapImport,
    maxDefaultResults: 10,
    tolerance: 1,
    limit: 20,
    enableStemming: true,
    boost: {
      type: 3,
      slug: 2,
      path: 2,
      title: 2,
      description: 1.5,
      part: 1.5,
      export: 1.3,
      section: 2,
      subsection: 1.8,
      props: 1.5,
      dataAttributes: 1.5,
      cssVariables: 1.5,
      sections: 0.7,
      subsections: 0.3,
      keywords: 1.7,
    },
  });

  const [searchResults, setSearchResults] = React.useState<SearchResult[]>(defaultResults);

  // Update search results when hook results change
  React.useEffect(() => {
    setSearchResults(results.length > 0 ? results : defaultResults);
  }, [results, defaultResults]);

  const handleInputChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setSearchTerm(value);
      await search(value);
    },
    [search],
  );

  return (
    <div className={classes.wrapper}>
      <div className={classes.container}>
        <form onSubmit={(event) => event.preventDefault()}>
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={handleInputChange}
            className={classes.searchInput}
          />
        </form>
        {searchResults.length > 0 && (
          <div className={classes.results}>
            <div className={classes.resultsSummary}>Found {searchResults.length} results</div>
            {searchResults.map((result: SearchResult, i) => {
              const url = buildResultUrl(result);
              return (
                <div key={result.id || i} className={classes.resultCard}>
                  <div className={classes.resultTitle}>
                    <strong>{result.title}</strong>
                    {process.env.NODE_ENV === 'development' && result.score && (
                      <span className={classes.resultScore}>Score: {result.score.toFixed(2)}</span>
                    )}
                  </div>
                  <div className={classes.resultBreadcrumb}>
                    {result.sectionTitle} → {result.slug}
                  </div>
                  {result.type === 'page' && result.description && (
                    <div className={classes.resultDescription}>{result.description}</div>
                  )}
                  <a href={url} className={classes.resultLink}>
                    {url}
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
