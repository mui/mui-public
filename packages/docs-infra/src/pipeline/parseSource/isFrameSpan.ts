import type { Element as HastElement } from 'hast';

/**
 * Returns `true` when a HAST element carries the given class name, accepting
 * both shapes `className` can take:
 *
 * - the string form (`className: 'frame'`), used by freshly parsed / live HAST
 *   (e.g. `createFrame`), and
 * - the array form (`className: ['frame']`), produced by `fallbackToHast` and by
 *   any HAST that round-trips through serialization.
 *
 * Matching only the string silently skips real fallback frames, so class checks
 * on HAST that may come from either path must go through this helper.
 */
export function hasClassName(element: HastElement, name: string): boolean {
  const className = element.properties?.className;
  return className === name || (Array.isArray(className) && className.includes(name));
}

/**
 * Returns `true` when a HAST element is a code frame span — its `className`
 * includes `'frame'` in either the string or array shape (see {@link hasClassName}).
 */
export function isFrameSpan(element: HastElement): boolean {
  return hasClassName(element, 'frame');
}
