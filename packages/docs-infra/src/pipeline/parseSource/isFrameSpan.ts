import type { Element as HastElement } from 'hast';

/**
 * Returns `true` when a HAST element carries the given class name.
 *
 * `className` is always the array shape (`['frame']`): it is what the
 * highlighter, `fallbackToHast` and any HAST that round-trips through
 * serialization produce, and what the compression dictionary encodes.
 */
export function hasClassName(element: HastElement, name: string): boolean {
  return element.properties?.className?.includes(name) ?? false;
}

/**
 * Returns `true` when a HAST element is a code frame span — its `className`
 * includes `'frame'` (see {@link hasClassName}).
 */
export function isFrameSpan(element: HastElement): boolean {
  return hasClassName(element, 'frame');
}
