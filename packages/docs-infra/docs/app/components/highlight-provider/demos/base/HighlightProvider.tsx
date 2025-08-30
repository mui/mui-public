import * as React from 'react';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';
import { Code } from '../../../code-highlighter/demos/Code';

export default function HighlightProvider() {
  return (
    <CodeProvider>
      <Code>{`console.log('Hello, world!');`}</Code>
    </CodeProvider>
  );
}
