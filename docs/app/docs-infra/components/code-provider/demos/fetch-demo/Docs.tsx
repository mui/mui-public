import * as React from 'react';
import { CodeProviderGitHub } from './CodeProviderGitHub';
import { DemoCheckboxBasic } from './demo-basic';

export function Docs() {
  return (
    // @focus-start
    <CodeProviderGitHub>
      <DemoCheckboxBasic />
    </CodeProviderGitHub>
    // @focus-end
  );
}
