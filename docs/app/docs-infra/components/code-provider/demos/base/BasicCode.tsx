import * as React from 'react';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';
import { Code } from '../../../code-highlighter/demos/CodeBlock';

export function BasicCode() {
  return (
    // @focus-start
    <CodeProvider>
      <Code fileName="example.js">{`console.log('Hello, world!');`}</Code>
    </CodeProvider>
    // @focus-end
  );
}
