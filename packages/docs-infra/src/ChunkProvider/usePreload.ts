'use client';

import * as React from 'react';
import { PreloadContext, type PreloadFn } from './PreloadContext';

/**
 * Calls the factory directly when there is no `PreloadProvider`. The browser's
 * module cache still dedups identical `import()`s, so this only loses the
 * cross-instance memo of the factory's own work.
 */
const fallbackPreload: PreloadFn = (_key, factory) => factory();

/**
 * Returns the cross-instance `PreloadFn` from the surrounding
 * `PreloadProvider`, or a direct-call fallback when there is none. Use it inside
 * a `CoordinatedLazy` `preload(hoisted)` callback to start importing helpers the
 * hoisted data implies, deduped across every instance on the page.
 */
export function usePreload(): PreloadFn {
  return React.useContext(PreloadContext) ?? fallbackPreload;
}
