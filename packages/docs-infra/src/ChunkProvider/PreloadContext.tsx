'use client';

import * as React from 'react';

/**
 * Memoize a preload by key: the first call with a given `key` runs `factory`
 * and caches its promise; later calls with the same key return that promise. So
 * many instances that need the same helper share one dynamic `import()` (and
 * one round of any work the factory does) instead of each kicking off their own.
 */
export type PreloadFn = <T>(key: string, factory: () => Promise<T>) => Promise<T>;

/**
 * Provides the cross-instance {@link PreloadFn}. `undefined` outside a
 * `PreloadProvider` - `usePreload` then falls back to calling the factory
 * directly (the browser's module cache still dedups identical `import()`s).
 */
export const PreloadContext = React.createContext<PreloadFn | undefined>(undefined);
