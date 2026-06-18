'use client';

import * as React from 'react';
import { DemoRunner } from '@mui/internal-docs-infra/CodeRunner';
import { CodeControllerContext } from '@mui/internal-docs-infra/CodeControllerContext';
import type { ControlledCode } from '@mui/internal-docs-infra/CodeHighlighter/types';

export function DemoController({ children }: { children: React.ReactNode }) {
  // @focus-start @padding 1
  const [code, setCode] = React.useState<ControlledCode | undefined>(undefined);
  const [errors, setErrors] = React.useState<Record<string, string | null>>({});

  const components = React.useMemo(
    () =>
      code
        ? Object.keys(code).reduce(
            (acc, cur) => {
              const variant = code[cur];
              if (!variant?.source) {
                return acc;
              }

              // `DemoRunner` resolves externals + sibling `extraFiles` (including
              // `*.module.css`) and runs the source, reporting errors per variant.
              acc[cur] = (
                <DemoRunner
                  code={variant.source}
                  extraFiles={variant.extraFiles}
                  onError={(message) => setErrors((prev) => ({ ...prev, [cur]: message }))}
                />
              );
              return acc;
            },
            {} as Record<string, React.ReactNode>,
          )
        : undefined,
    [code],
  );

  // Errors flow through the controller context, so a demo can read the selected
  // variant's error from `useDemo().error` and render it.
  const contextValue = React.useMemo(
    () => ({ code, setCode, components, errors }),
    [code, setCode, components, errors],
  );

  return (
    <CodeControllerContext.Provider value={contextValue}>{children}</CodeControllerContext.Provider>
  );
  // @focus-end
}
