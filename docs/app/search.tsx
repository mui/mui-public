'use client';
import * as React from 'react';
import { Search as SearchComponent } from '@/components/Search';

const sitemap = () => import('./sitemap');

export function Search({
  enableKeyboardShortcut = false,
  containedScroll = false,
}: {
  enableKeyboardShortcut?: boolean;
  containedScroll?: boolean;
}) {
  return (
    <SearchComponent
      sitemap={sitemap}
      enableKeyboardShortcut={enableKeyboardShortcut}
      containedScroll={containedScroll}
    />
  );
}
