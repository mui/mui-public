'use client';

import * as React from 'react';

export interface UseContentFrameResult {
  /** Whether a `ContentFrame` surrounds this content and renders the preview. */
  framed: boolean;
}

const UNFRAMED: UseContentFrameResult = { framed: false };
const FRAMED: UseContentFrameResult = { framed: true };

const ContentFrameContext = React.createContext<UseContentFrameResult>(UNFRAMED);

/**
 * Marks the `Content` and `ContentLoading` of one `CodeHighlighter` as framed or not,
 * so a nested `CodeHighlighter` never inherits the flag of the one around it.
 */
export function ContentFrameProvider(props: { framed: boolean; children: React.ReactNode }) {
  return (
    <ContentFrameContext.Provider value={props.framed ? FRAMED : UNFRAMED}>
      {props.children}
    </ContentFrameContext.Provider>
  );
}

/**
 * Hook for `Content` and `ContentLoading` components to detect a surrounding
 * `ContentFrame`. When `framed` is `true`, the frame renders the preview, so the
 * component should render only its chrome.
 *
 * @example
 * ```tsx
 * function MyContentLoading(props: ContentLoadingProps<{}>) {
 *   const fallback = useCodeFallback(props);
 *   const { framed } = useContentFrame();
 *   return (
 *     <div>
 *       {!framed && props.component}
 *       {fallback.code}
 *     </div>
 *   );
 * }
 * ```
 */
export function useContentFrame(): UseContentFrameResult {
  return React.useContext(ContentFrameContext);
}
