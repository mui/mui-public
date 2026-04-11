'use client';

import * as React from 'react';
import { CodeControllerContext } from '@mui/internal-docs-infra/CodeControllerContext';
import type { ControlledCode } from '@mui/internal-docs-infra/CodeHighlighter/types';

export function CodeController({ children }: { children: React.ReactNode }) {
  // @highlight-start @focus
  const [code, setCode] = React.useState<ControlledCode | undefined>(undefined);

  const contextValue = React.useMemo(() => ({ code, setCode }), [code, setCode]);

  return (
    <CodeControllerContext.Provider value={contextValue}>{children}</CodeControllerContext.Provider>
  );
  // @highlight-end
}
