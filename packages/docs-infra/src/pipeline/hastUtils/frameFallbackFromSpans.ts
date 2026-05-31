import type { ElementContent } from 'hast';
import { stripHighlightingSpans } from './stripHighlightingSpans';

/**
 * Derive the lightweight per-frame fallback nodes from a frame's child spans.
 *
 * Runs {@link stripHighlightingSpans} over the frame's children — unwrapping
 * syntax-highlight spans while preserving `.collapse` placeholders and merging
 * adjacent text — and returns the resulting nodes. This is the canonical way to
 * produce a frame's `data.fallback` from its live hast: a frame with no collapse
 * collapses to a single text node (matching `addLineGutters`), while a collapsed
 * frame keeps its placeholder so the fallback render's height stays in sync with
 * the highlighted render.
 *
 * Shared by the renderer (`Pre`, which derives this lazily for an
 * un-highlighted frame) and `applyCodeTransform` (which regenerates it for a
 * frame a transform rewrote), so the precomputed and lazy fallbacks are
 * byte-identical.
 */
export function frameFallbackFromSpans(spans: ElementContent[]): ElementContent[] {
  return stripHighlightingSpans({ type: 'root', children: spans }).children as ElementContent[];
}
