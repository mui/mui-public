'use client';
import * as React from 'react';
import { SearchBar } from '@/components/SearchBar';

export function Search() {
  return <SearchBar sitemap={() => import('./sitemap')} />;
}
