// Module augmentation for the `hast` type definitions. Lets us attach
// strongly-typed metadata to nodes via the user-extensible `Data` interfaces
// (see https://github.com/syntax-tree/hast#types) without scattering `as any`
// casts at every read/write site.

import type { ElementContent } from 'hast';

declare module 'hast' {
  interface ElementData {
    /**
     * Precomputed lightweight hast used as the pre-hydration / SSR fallback
     * for this element. Set by `addLineGutters` on each frame span (single
     * `{ type: 'text' }` node carrying the frame's raw source text) so the
     * renderer can skip running `stripHighlightingSpans` per frame.
     */
    fallback?: ElementContent[];
  }

  interface RootData {
    /** Total number of lines in the source represented by this tree. */
    totalLines?: number;
    /** Lines-per-frame size used when splitting the tree into frame spans. */
    frameSize?: number;
  }
}

// Required to make this file a module so the `declare module` augmentation
// is picked up. The empty export keeps the runtime emit shape unchanged.
export {};
