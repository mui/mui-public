'use client';

import * as React from 'react';

function subscribeToHashChange(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

function getHashSnapshot(): string | null {
  return window.location.hash ? window.location.hash.slice(1) : null;
}

function getServerHashSnapshot(): string | null {
  return null;
}

function useUrlHash(): string | null {
  return React.useSyncExternalStore(subscribeToHashChange, getHashSnapshot, getServerHashSnapshot);
}

interface FileSlug {
  fileName: string;
  slug: string;
  variantName: string;
}

interface HashNavigationParams {
  mainSlug: string;
  allFilesSlugs: FileSlug[];
  expanded: boolean;
  setPreferredVariant: (variant: string) => void;
  selectFileName: (name: string | null) => void;
  setExpanded: (expanded: boolean) => void;
}

/** Applies matching demo hash anchors to variant/file state once per hash. */
export function useDemoHashNavigation({
  mainSlug,
  allFilesSlugs,
  expanded,
  setPreferredVariant,
  selectFileName,
  setExpanded,
}: HashNavigationParams): void {
  const hash = useUrlHash();
  const appliedHashRef = React.useRef<string | null>(null);
  const pendingScrollHashRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!hash || !mainSlug || !hash.startsWith(`${mainSlug}:`)) {
      return;
    }
    if (appliedHashRef.current === hash) {
      return;
    }
    const match = allFilesSlugs.find((entry) => entry.slug === hash);
    if (!match) {
      return;
    }
    appliedHashRef.current = hash;
    pendingScrollHashRef.current = hash;
    setPreferredVariant(match.variantName);
    selectFileName(match.fileName);
    setExpanded(true);
  }, [hash, mainSlug, allFilesSlugs, setPreferredVariant, selectFileName, setExpanded]);

  React.useEffect(() => {
    if (pendingScrollHashRef.current == null || !expanded) {
      return;
    }
    const anchor = document.getElementById(pendingScrollHashRef.current);
    pendingScrollHashRef.current = null;
    anchor?.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
}
