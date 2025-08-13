import * as React from 'react';
import { DemoController } from './DemoController';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';
import { DemoCheckboxBasic } from './demo-basic';

export function DemoLive() {
  return (
    <CodeProvider>
      <DemoController>
        <DemoCheckboxBasic />
      </DemoController>
    </CodeProvider>
  );
}
