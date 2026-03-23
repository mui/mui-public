import * as React from 'react';
import type {
  SearchResult,
  SearchResults as SearchResultsType,
} from '@mui/internal-docs-infra/useSearch/types';
import { Autocomplete } from '@base-ui/react/autocomplete';
import { SearchItem } from './SearchItem';
import styles from './SearchResults.module.css';

interface SearchResultsProps {
  results: SearchResultsType;
  onItemClick: (result: SearchResult) => void;
  className?: string;
}

export function SearchResults({ results, onItemClick, className }: SearchResultsProps) {
  if (results.length === 0) {
    return <div className={styles.noResults}>No results found.</div>;
  }

  return (
    <Autocomplete.List className={className}>
      {(group: SearchResultsType[number]) => (
        <Autocomplete.Group key={group.group} items={group.items} className={styles.group}>
          {group.group !== 'Default' && (
            <Autocomplete.GroupLabel
              id={`search-group-${group.group}`}
              className={styles.groupLabel}
            >
              {group.group}
            </Autocomplete.GroupLabel>
          )}
          <Autocomplete.Collection>
            {(result: SearchResult, i) => (
              <Autocomplete.Item
                key={result.id || i}
                value={result}
                onClick={() => onItemClick(result)}
                className={styles.item}
              >
                <SearchItem result={result} />
              </Autocomplete.Item>
            )}
          </Autocomplete.Collection>
        </Autocomplete.Group>
      )}
    </Autocomplete.List>
  );
}
