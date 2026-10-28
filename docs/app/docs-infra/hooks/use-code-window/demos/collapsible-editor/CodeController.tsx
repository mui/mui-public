'use client';

import * as React from 'react';
import { CodeControllerContext } from '@mui/internal-docs-infra/CodeControllerContext';
import type { ControlledCode } from '@mui/internal-docs-infra/CodeHighlighter/types';

/**
 * Minimal controlled-code provider so the collapsible block below becomes
 * editable: `useCode` enables `setSource` whenever a `CodeControllerContext`
 * with `setCode` is present.
 */
export function CodeController({ children }: { children: React.ReactNode }) {
  // @focus-start @padding 1
  const [code, setCode] = React.useState<ControlledCode | null>(null);
  const contextValue = React.useMemo(() => ({ code, setCode }), [code, setCode]);
  return (
    <CodeControllerContext.Provider value={contextValue}>{children}</CodeControllerContext.Provider>
  );
  // @focus-end
}
