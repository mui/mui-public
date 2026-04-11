import * as React from 'react';
import { CodeProviderGitHub } from './CodeProviderGitHub';
import { DemoCheckboxBasic } from './demo-basic';

export function Docs() {
  return (
    // @highlight-start @focus
    <CodeProviderGitHub>
      <DemoCheckboxBasic />
    </CodeProviderGitHub>
    // @highlight-end
  );
}
