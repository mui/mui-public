'use client';

import * as React from 'react';
import { CodeControllerContext } from '@mui/internal-docs-infra/CodeControllerContext';
import type { CodeControllerProps } from '@mui/internal-docs-infra/CodeControllerContext';
import { useCrossTabState } from '@mui/internal-docs-infra/useCrossTabState';
import type { ControlledCode } from '@mui/internal-docs-infra/CodeHighlighter/types';

export function CodeController({ children, url }: CodeControllerProps) {
  // @focus-start @padding 1
  // `useCrossTabState` owns the controlled code and mirrors it across same-origin tabs
  // (e.g. a split view). The demo's `url` names the channel so each demo syncs on its own.
  const [code, setCode] = useCrossTabState<ControlledCode | null>(url ?? null, null);

  const contextValue = React.useMemo(() => ({ code, setCode }), [code, setCode]);

  return (
    <CodeControllerContext.Provider value={contextValue}>{children}</CodeControllerContext.Provider>
  );
  // @focus-end
}
