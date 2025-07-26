'use client';

import * as React from 'react';
import { useRunner } from 'react-runner';
import { CodeControllerContext } from '@mui/internal-docs-infra/CodeControllerContext';
import { ControlledCode } from '@mui/internal-docs-infra/CodeHighlighter';
import { Checkbox } from '@/components/Checkbox';

function Runner({ code, scope }: { code: string; scope: Record<string, any> }) {
  const { element, error } = useRunner({ code, scope });

  if (error) {
    return <div>{error}</div>;
  }

  return element;
}

export function DemoController({ children }: { children: React.ReactNode }) {
  const [code, setCode] = React.useState<ControlledCode | undefined>(undefined);
  const scope = React.useMemo(() => {
    return {
      import: {
        react: React,
        '@/components/Checkbox': { Checkbox },
      },
    };
  }, []);

  const components = React.useMemo(
    () =>
      code
        ? Object.keys(code).reduce(
            (acc, cur) => {
              const source = code[cur]?.source;
              if (!source) {
                return acc;
              }

              acc[cur] = <Runner code={source} scope={scope} />;
              return acc;
            },
            {} as Record<string, React.ReactNode>,
          )
        : undefined,
    [code, setCode],
  );

  return (
    <CodeControllerContext.Provider value={{ code, setCode, components }}>
      {children}
    </CodeControllerContext.Provider>
  );
}
