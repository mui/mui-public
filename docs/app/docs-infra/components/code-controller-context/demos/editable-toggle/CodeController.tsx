'use client';

import * as React from 'react';
import {
  CodeControllerContext,
  type CodeControllerProps,
} from '@mui/internal-docs-infra/CodeControllerContext';
import { useCrossTabState } from '@mui/internal-docs-infra/useCrossTabState';
import type { ControlledCode } from '@mui/internal-docs-infra/CodeHighlighter/types';

export function CodeController({ children, url }: CodeControllerProps) {
  // `useCrossTabState` owns the controlled code and mirrors it across same-origin tabs.
  // The demo's `url` names the channel so each demo syncs on its own.
  // @focus-start @padding 1
  const [code, setCode] = useCrossTabState<ControlledCode | undefined>(url ?? null, undefined);

  const contextValue = React.useMemo(() => ({ code, setCode }), [code, setCode]);

  return (
    <CodeControllerContext.Provider value={contextValue}>{children}</CodeControllerContext.Provider>
  );
  // @focus-end
}
