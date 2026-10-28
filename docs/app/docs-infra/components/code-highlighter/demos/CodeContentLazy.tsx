'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { LazyContent } from '@mui/internal-docs-infra/CoordinatedLazy';

/**
 * Client wrapper that code-splits the heavy {@link CodeContent} (the syntax
 * highlighter, tabs, action menu, ...) out of the initial bundle. It is
 * dynamically imported through `LazyContent` and rendered once the chunk loads,
 * so the host shows its loading/fallback state while the content streams in.
 *
 * The import thunk lives in this `'use client'` module deliberately: a dynamic
 * import is a function and cannot cross the server->client boundary as a prop,
 * so the lazy boundary has to be defined on the client.
 */
export function CodeContentLazy(props: ContentProps<object>) {
  // @focus-start
  return (
    <LazyContent<ContentProps<object>>
      content={() => import('./CodeContent').then((mod) => ({ default: mod.CodeContent }))}
      props={props}
    />
  );
  // @focus-end
}
