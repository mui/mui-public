'use client';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { useRouter } from 'next/navigation';
import { useSearch } from '@mui/internal-docs-infra/useSearch';
import type { SearchResult, Sitemap } from '@mui/internal-docs-infra/useSearch/types';
import { Autocomplete } from '@base-ui-components/react/autocomplete';
import { SearchButton } from './SearchButton';
import { SearchDialog } from './SearchDialog';
import styles from './SearchDialog.module.css';

export function Search({
  sitemap: sitemapImport,
  enableKeyboardShortcut = false,
  containedScroll = false,
}: {
  sitemap: () => Promise<{ sitemap?: Sitemap }>;
  enableKeyboardShortcut?: boolean;
  containedScroll?: boolean;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const openingRef = React.useRef(false);
  const closingRef = React.useRef(false);

  // Use the generic search hook with Base UI specific configuration
  const { results, search, defaultResults, buildResultUrl, isReady } = useSearch({
    sitemap: sitemapImport,
    maxDefaultResults: 10,
    tolerance: 1,
    limit: 20,
    enableStemming: true,
  });

  const [searchResults, setSearchResults] =
    React.useState<ReturnType<typeof useSearch>['results']>(defaultResults);

  // Update search results when hook results change
  React.useEffect(() => {
    const updateResults = () => {
      setSearchResults(results);
    };

    // Delay empty results to avoid flashing "No results" while typing
    if (results.results.length === 0) {
      const timeoutId = setTimeout(updateResults, 400);
      return () => clearTimeout(timeoutId);
    }

    updateResults();
    return undefined;
  }, [results]);

  const handleOpenDialog = React.useCallback(() => {
    // Prevent double-opening across all instances
    if (openingRef.current) {
      return;
    }
    openingRef.current = true;

    if ('startViewTransition' in document) {
      const transition = (document as any).startViewTransition(() => {
        ReactDOM.flushSync(() => {
          setDialogOpen(true);
        });
      });

      transition.finished.then(() => {
        if (popupRef.current) {
          popupRef.current.className = popupRef.current?.className.replace(
            styles.popup,
            `${styles.popup} ${styles.popup}-active`,
          );
        }
      });
    } else {
      setDialogOpen(true);
    }

    // Reset after a short delay
    setTimeout(() => {
      openingRef.current = false;
    }, 100);
  }, []);

  const handleCloseDialog = React.useCallback(
    (open: boolean) => {
      if (!open) {
        // Prevent double-closing across all instances
        if (closingRef.current) {
          return;
        }
        closingRef.current = true;

        if (popupRef.current) {
          popupRef.current.className = popupRef.current?.className.replace(
            `${styles.popup}-active `,
            '',
          );
        }

        if ('startViewTransition' in document) {
          const transition = (document as any).startViewTransition(() => {
            ReactDOM.flushSync(() => {
              setDialogOpen(false);
            });
          });

          transition.finished.then(() => {
            setSearchResults(defaultResults);
          });
        } else {
          setDialogOpen(false);
          queueMicrotask(() => {
            setSearchResults(defaultResults);
          });
        }

        // Reset after a short delay
        setTimeout(() => {
          closingRef.current = false;
        }, 100);
      } else {
        handleOpenDialog();
      }
    },
    [handleOpenDialog, defaultResults],
  );

  const handleAutocompleteEscape = React.useCallback(
    (open: boolean, eventDetails: Autocomplete.Root.ChangeEventDetails) => {
      if (!open && eventDetails.reason === 'escape-key') {
        handleCloseDialog(false);
      }
    },
    [handleCloseDialog],
  );

  const handleEscapeButtonClick = React.useCallback(() => {
    handleCloseDialog(false);
  }, [handleCloseDialog]);

  React.useEffect(() => {
    // Only enable keyboard shortcut if explicitly requested (for desktop version)
    if (!enableKeyboardShortcut) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        event.stopPropagation();

        // Only open if not already open or in the process of opening/closing
        if (!dialogOpen && !openingRef.current && !closingRef.current) {
          handleOpenDialog();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [handleOpenDialog, enableKeyboardShortcut, dialogOpen]);

  const handleValueChange = React.useCallback(
    async (value: string) => {
      if (!isReady) {
        return;
      }
      await search(value, { groupBy: { properties: ['group'], maxResult: 5 } });
    },
    [search, isReady],
  );

  const handleItemClick = React.useCallback(
    (result: SearchResult) => {
      const url = buildResultUrl(result);
      handleCloseDialog(false);
      document.documentElement.dataset.navigating = '';
      // Clean up after view transition completes
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          delete document.documentElement.dataset.navigating;
        });
      });
      router.push(url);
    },
    [router, handleCloseDialog, buildResultUrl],
  );

  return (
    <React.Fragment>
      <SearchButton
        onClick={handleOpenDialog}
        isDialogOpen={dialogOpen}
        enableKeyboardShortcut={enableKeyboardShortcut}
      />
      <SearchDialog
        open={dialogOpen}
        onOpenChange={handleCloseDialog}
        popupRef={popupRef}
        inputRef={inputRef}
        containedScroll={containedScroll}
        results={searchResults}
        onValueChange={handleValueChange}
        onAutocompleteEscape={handleAutocompleteEscape}
        onEscapeClick={handleEscapeButtonClick}
        onItemClick={handleItemClick}
        enableKeyboardShortcut={enableKeyboardShortcut}
      />
    </React.Fragment>
  );
}
