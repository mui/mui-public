import * as React from 'react';
import { Autocomplete } from '@base-ui-components/react/autocomplete';
import { Button } from '@base-ui-components/react/button';
import { Search } from 'lucide-react';
import styles from './SearchInput.module.css';

interface SearchInputProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onEscapeClick: () => void;
  enableKeyboardShortcut: boolean;
}

export function SearchInput({ inputRef, onEscapeClick, enableKeyboardShortcut }: SearchInputProps) {
  return (
    <div className={styles.container}>
      <Search className={styles.icon} />
      <Autocomplete.Input
        id="search-input"
        ref={inputRef}
        placeholder="Search"
        className={styles.input}
      />

      {enableKeyboardShortcut && (
        <Button
          onClick={onEscapeClick}
          className={`expanding-box-content-right ${styles.escapeButton}`}
        >
          <kbd className={styles.kbd}>esc</kbd>
        </Button>
      )}
    </div>
  );
}
