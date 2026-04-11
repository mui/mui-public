import * as React from 'react';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';
import { DemoController } from './DemoController';
import { DemoCheckboxBasic } from './demo-basic';

export function DemoLive() {
  return (
    // @highlight-start @focus
    <CodeProvider>
      <DemoController>
        <DemoCheckboxBasic />
      </DemoController>
    </CodeProvider>
    // @highlight-end
  );
}
