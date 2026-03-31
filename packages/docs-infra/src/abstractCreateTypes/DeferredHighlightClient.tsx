'use client';
import * as React from 'react';
import type { Root as HastRoot, Element as HastElement } from 'hast';
import { decompressHast, hastToJsx } from '../pipeline/hastUtils';

type HighlightAt = 'hydration' | 'idle';

interface DeferredHighlightClientProps {
  /** JSON-serialized HAST tree (root > pre > code > children). */
  hastJson?: string;
  /** DEFLATE-compressed, base64-encoded HAST tree. */
  hastCompressed?: string;
  /** When to replace the fallback with the fully-highlighted version. */
  highlightAt: HighlightAt;
  /** Server-rendered links-only fallback. */
  children?: React.ReactNode;
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
 * Receives the full HAST tree (root > pre > code > children) and extracts
 * the code element's children for rendering. The outer `<pre>` / `TypePre`
 * wrapper stays server-rendered.
 */
export function DeferredHighlightClient({
  hastJson,
  hastCompressed,
  highlightAt,
  children,
}: DeferredHighlightClientProps) {
  const [highlighted, setHighlighted] = React.useState<React.ReactNode | null>(null);

  React.useEffect(() => {
    const render = () => {
      const raw = hastCompressed ? decompressHast(hastCompressed) : hastJson!;
      const parsed = JSON.parse(raw);

      // Extract code element's children from the full tree.
      const root: HastRoot =
        parsed.type === 'root'
          ? parsed
          : { type: 'root', children: Array.isArray(parsed) ? parsed : [parsed] };
      const codeChildren = findCodeChildren(root);
      const hast: HastRoot = { type: 'root', children: codeChildren ?? root.children };
      setHighlighted(hastToJsx(hast));
    };

    if (highlightAt === 'hydration') {
      render();
      return undefined;
    }

    // 'idle' — defer until the browser is idle
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(render);
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(render, 0);
    return () => clearTimeout(id);
  }, [hastJson, hastCompressed, highlightAt]);

  if (highlighted !== null) {
    return highlighted;
  }

  return children;
}
