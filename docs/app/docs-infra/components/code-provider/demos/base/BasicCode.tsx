import * as React from 'react';
import { Code } from '../../../code-highlighter/demos/CodeBlock';

export function BasicCode() {
  return (
    // @focus
    <Code fileName="example.js">{`console.log('Hello, world!');`}</Code>
  );
}
