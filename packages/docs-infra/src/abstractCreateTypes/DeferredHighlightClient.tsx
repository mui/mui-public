'use client';
import * as React from 'react';
import type { Root as HastRoot } from 'hast';
import { decompressHast, hastToJsx } from '../pipeline/hastUtils';

type HighlightAt = 'hydration' | 'idle';

interface DeferredHighlightClientProps {
  /** JSON-serialized array of HAST children. Used when data is not compressed. */
  hastJson?: string;
  /** DEFLATE-compressed (with shared dictionary), base64-encoded array of HAST children. */
  hastCompressed?: string;
  /** When to replace the fallback with the fully-highlighted version. */
  highlightAt: HighlightAt;
  /** Server-rendered links-only fallback. */
  children?: React.ReactNode;
}

/**
 * Renders a links-only fallback on the server and replaces it with the
 * fully syntax-highlighted version on the client at the configured time.
 *
 * The component only handles the inner content of a `<code>` element —
 * the outer `<pre>` / `TypePre` wrapper stays server-rendered.
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
      let nodes;
      if (hastCompressed) {
        nodes = JSON.parse(decompressHast(hastCompressed));
      } else {
        nodes = JSON.parse(hastJson!);
      }
      const hast: HastRoot = { type: 'root', children: nodes };
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
