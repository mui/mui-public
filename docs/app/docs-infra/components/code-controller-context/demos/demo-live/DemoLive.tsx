import * as React from 'react';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';
import { DemoCheckboxBasic } from './demo-basic';

export function DemoLive() {
  return (
    // @focus-start
    <CodeProvider>
      <DemoCheckboxBasic />
    </CodeProvider>
    // @focus-end
  );
}
