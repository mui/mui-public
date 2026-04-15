import * as React from 'react';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';
import { DemoController } from './DemoController';
import { DemoCheckboxBasic } from './demo-basic';

export function DemoLive() {
  return (
    // @focus-start
    <CodeProvider>
      <DemoController>
        <DemoCheckboxBasic />
      </DemoController>
    </CodeProvider>
    // @focus-end
  );
}
