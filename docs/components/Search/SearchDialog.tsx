'use client';
import * as React from 'react';
import type {
  SearchResult,
  SearchResults as SearchResultsType,
} from '@mui/internal-docs-infra/useSearch/types';
import { Autocomplete } from '@base-ui-components/react/autocomplete';
import { Dialog } from '@base-ui-components/react/dialog';
import { ScrollArea } from '@base-ui-components/react/scroll-area';
import { ExpandingBox } from '../ExpandingBox';
import { SearchInput } from './SearchInput';
import { SearchResults } from './SearchResults';
import styles from './SearchDialog.module.css';

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  popupRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  containedScroll: boolean;
  results: {
    results: SearchResultsType;
    count: number;
    elapsed: { raw: number; formatted: string };
  };
  onValueChange: (value: string) => Promise<void>;
  onAutocompleteEscape: (open: boolean, eventDetails: Autocomplete.Root.ChangeEventDetails) => void;
  onEscapeClick: () => void;
  onItemClick: (result: SearchResult) => void;
  enableKeyboardShortcut: boolean;
}

export function SearchDialog({
  open,
  onOpenChange,
  popupRef,
  inputRef,
  containedScroll,
  results,
  onValueChange,
  onAutocompleteEscape,
  onEscapeClick,
  onItemClick,
  enableKeyboardShortcut,
}: SearchDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        {containedScroll ? (
          <Dialog.Viewport className={styles.viewportContained}>
            <Dialog.Popup
              ref={popupRef}
              initialFocus={inputRef}
              data-open={open}
              className={`${styles.popup} ${styles.popupContained}`}
            >
              <ExpandingBox isActive={open} className={styles.expandingBoxContained}>
                <Autocomplete.Root
                  items={results.results}
                  onValueChange={onValueChange}
                  onOpenChange={onAutocompleteEscape}
                  open
                  inline
                  itemToStringValue={(item) => (item ? item.title || item.slug : '')}
                  filter={null}
                  autoHighlight
                >
                  <div className={styles.shrink0}>
                    <SearchInput
                      inputRef={inputRef}
                      onEscapeClick={onEscapeClick}
                      enableKeyboardShortcut={enableKeyboardShortcut}
                    />
                  </div>
                  <div className={styles.resultsContainer}>
                    <ScrollArea.Root className={styles.scrollAreaRoot}>
                      <ScrollArea.Viewport className={styles.scrollViewport}>
                        <ScrollArea.Content>
                          <SearchResults
                            results={results.results}
                            onItemClick={onItemClick}
                            className={styles.listOutline}
                          />
                        </ScrollArea.Content>
                      </ScrollArea.Viewport>
                      <ScrollArea.Scrollbar className={styles.scrollbar}>
                        <ScrollArea.Thumb className={styles.scrollThumb} />
                      </ScrollArea.Scrollbar>
                    </ScrollArea.Root>
                  </div>
                  <div className={styles.stats}>
                    <div className={results.elapsed.raw <= 0 ? styles.statsHidden : ''}>
                      Found {results.count} in {results.elapsed.formatted}
                    </div>
                  </div>
                </Autocomplete.Root>
              </ExpandingBox>
            </Dialog.Popup>
          </Dialog.Viewport>
        ) : (
          <Dialog.Viewport className={styles.viewport}>
            <ScrollArea.Root className={styles.outerScrollRoot}>
              <ScrollArea.Viewport className={styles.outerScrollViewport}>
                <ScrollArea.Content className={styles.outerScrollContent}>
                  <Dialog.Popup
                    ref={popupRef}
                    initialFocus={inputRef}
                    data-open={open}
                    className={`${styles.popup} ${styles.popupNonContained}`}
                  >
                    <ExpandingBox isActive={open} className={styles.expandingBox}>
                      <Autocomplete.Root
                        items={results.results}
                        onValueChange={onValueChange}
                        onOpenChange={onAutocompleteEscape}
                        open
                        inline
                        itemToStringValue={(item) => (item ? item.title || item.slug : '')}
                        filter={null}
                        autoHighlight
                      >
                        <SearchInput
                          inputRef={inputRef}
                          onEscapeClick={onEscapeClick}
                          enableKeyboardShortcut={enableKeyboardShortcut}
                        />
                        <div className={styles.innerResultsContainer}>
                          <SearchResults
                            results={results.results}
                            onItemClick={onItemClick}
                            className={styles.list}
                          />
                        </div>
                      </Autocomplete.Root>
                    </ExpandingBox>
                  </Dialog.Popup>
                </ScrollArea.Content>
              </ScrollArea.Viewport>
              <ScrollArea.Scrollbar className={styles.outerScrollbar}>
                <ScrollArea.Thumb className={styles.scrollThumb} />
              </ScrollArea.Scrollbar>
            </ScrollArea.Root>
          </Dialog.Viewport>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
