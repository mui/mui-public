import * as React from 'react';
import { Code } from '../CodeBlock';

export function BasicCode() {
  return (
    // @highlight @focus
    <Code fileName="hello.js">{`console.log('Hello, world!');`}</Code>
  );
}
