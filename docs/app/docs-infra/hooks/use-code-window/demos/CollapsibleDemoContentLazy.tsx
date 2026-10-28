'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { LazyContent } from '@mui/internal-docs-infra/CoordinatedLazy';

/**
 * Client wrapper that code-splits the heavy {@link CollapsibleDemoContent} out of
 * the initial bundle. It is dynamically imported through `LazyContent` and rendered
 * once the chunk loads; `LazyContent` shows the host's `DemoContentLoading`
 * (inherited via context) while the chunk loads, so the same placeholder covers it.
 *
 * The import thunk lives in this `'use client'` module deliberately: a dynamic
 * import is a function and cannot cross the server->client boundary as a prop,
 * so the lazy boundary has to be defined on the client.
 */
export function CollapsibleDemoContentLazy(props: ContentProps<object>) {
  // @focus-start
  return (
    <LazyContent<ContentProps<object>>
      content={() =>
        import('./CollapsibleDemoContent').then((mod) => ({
          default: mod.CollapsibleDemoContent,
        }))
      }
      props={props}
    />
  );
  // @focus-end
}
