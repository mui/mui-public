'use client';

import * as React from 'react';
import {
  CodeControllerContext,
  type CodeControllerProps,
} from '@mui/internal-docs-infra/CodeControllerContext';
import type { ControlledCode } from '@mui/internal-docs-infra/CodeHighlighter/types';

export function CodeController({ children }: CodeControllerProps) {
  // @focus-start @padding 1
  const [code, setCode] = React.useState<ControlledCode | undefined>(undefined);

  const contextValue = React.useMemo(() => ({ code, setCode }), [code, setCode]);

  return (
    <CodeControllerContext.Provider value={contextValue}>{children}</CodeControllerContext.Provider>
  );
  // @focus-end
}
