'use client';
import * as React from 'react';
import type { Root as HastRoot, Element as HastElement } from 'hast';
import { decompressHast, hastToJsx } from '../pipeline/hastUtils';
import { useCodeComponents } from '../useCode/CodeComponentsContext';
import type { FallbackNode } from '../pipeline/hastUtils/fallbackFormat';
import { fallbackToHast, fallbackToText } from '../pipeline/hastUtils/fallbackFormat';

type HighlightAt = 'hydration' | 'idle' | 'visible';

interface TypeCodeProps {
  /** JSON-serialized HAST tree (root > pre > code > children). */
  hastJson?: string;
  /** DEFLATE-compressed, base64-encoded HAST tree. */
  hastCompressed?: string;
  /** When to replace the fallback with the fully-highlighted version. */
  highlightAt: HighlightAt;
  /**
   * Links-only fallback (code children with highlighting spans stripped),
   * in compact `FallbackNode[]` format.
   * Serves two purposes:
   * 1. Rendered as the initial display until the full highlight is ready.
   * 2. Its text content is used as a DEFLATE dictionary for decompression
   *    when `hastCompressed` was compressed with that same text dictionary.
   */
  fallback?: FallbackNode[];
  /** Props for the `<code>` element wrapper (className, etc.). */
  codeProps?: Record<string, unknown>;
}

/**
 * Find the children of the first `<code>` element in a parsed HAST tree.
 */
function findCodeChildren(node: HastRoot | HastElement): HastRoot['children'] | null {
  if (node.type === 'element' && node.tagName === 'code') {
    return node.children;
  }
  for (const child of node.children) {
    if (child.type === 'element') {
      const found = findCodeChildren(child as HastElement);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * Renders a links-only fallback on the server and replaces it with the
 * fully syntax-highlighted version on the client at the configured time.
 *
 * When `fallback` is provided, it is converted to HAST and rendered for the
 * initial display. Its text content is derived (via `fallbackToText`) to serve
 * as the DEFLATE dictionary for decompressing `hastCompressed`.
 *
 * - `'hydration'`: parse immediately on mount.
 * - `'idle'`: defer to `requestIdleCallback` regardless of visibility.
 * - `'visible'`: wait until the element enters the viewport (IntersectionObserver),
 *   then defer to `requestIdleCallback` to avoid blocking scroll or paint.
 */
export function TypeCode({
  hastJson,
  hastCompressed,
  highlightAt,
  fallback,
  codeProps,
}: TypeCodeProps) {
  const components = useCodeComponents();
  // Determine the effective mode: fall back to 'idle' when IntersectionObserver
  // is unavailable (progressive enhancement for older browsers/runtimes).
  const effectiveMode =
    highlightAt === 'visible' && typeof IntersectionObserver === 'undefined' ? 'idle' : highlightAt;

  const [hast, setHast] = React.useState<HastRoot | null>(null);
  const [isVisible, setIsVisible] = React.useState(effectiveMode !== 'visible');
  const [codeElement, setCodeElement] = React.useState<HTMLElement | null>(null);

  // Synchronize visibility state when the effective mode changes.
  React.useEffect(() => {
    setIsVisible(effectiveMode !== 'visible');
  }, [effectiveMode]);

  // Convert compact fallback to HAST for rendering.
  const fallbackHastRoot = React.useMemo(
    () => (fallback ? fallbackToHast(fallback) : undefined),
    [fallback],
  );

  // Derive text dictionary from fallback for decompression.
  const textDictionary = React.useMemo(
    () => (fallback ? fallbackToText(fallback) : undefined),
    [fallback],
  );

  // Render fallback HAST as JSX for initial display.
  const fallbackJsx = React.useMemo(
    () => (fallbackHastRoot ? hastToJsx(fallbackHastRoot, components) : null),
    [fallbackHastRoot, components],
  );

  // Observe visibility for 'visible' mode — decompress when scrolled into view,
  // release expanded HAST when scrolled away to reduce memory pressure.
  React.useEffect(() => {
    if (effectiveMode !== 'visible' || !codeElement) {
      return undefined;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
        setHast(null);
      }
    });

    observer.observe(codeElement);
    return () => observer.disconnect();
  }, [effectiveMode, codeElement]);

  // Parse and decompress once visible.
  React.useEffect(() => {
    if (!isVisible) {
      return undefined;
    }

    const parse = () => {
      const raw = hastCompressed ? decompressHast(hastCompressed, textDictionary) : hastJson!;
      const parsed = JSON.parse(raw);

      // Extract code element's children from the full tree.
      const root: HastRoot =
        parsed.type === 'root'
          ? parsed
          : { type: 'root', children: Array.isArray(parsed) ? parsed : [parsed] };
      const codeChildren = findCodeChildren(root);
      const hastRoot: HastRoot = { type: 'root', children: codeChildren ?? root.children };
      setHast(hastRoot);
    };

    if (effectiveMode === 'hydration') {
      parse();
      return undefined;
    }

    // 'idle' and 'visible' both defer to idle time to avoid blocking the main thread.
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(parse);
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(parse, 0);
    return () => clearTimeout(id);
  }, [isVisible, hastJson, hastCompressed, effectiveMode, textDictionary]);

  const highlighted = React.useMemo(
    () => (hast !== null ? hastToJsx(hast, components) : null),
    [hast, components],
  );

  const content = highlighted ?? fallbackJsx;

  // 'hydration' and 'idle' parse without visibility gating — no observer needed.
  if (effectiveMode !== 'visible') {
    return React.createElement('code', codeProps, content);
  }

  return React.createElement('code', { ...codeProps, ref: setCodeElement }, content);
}
