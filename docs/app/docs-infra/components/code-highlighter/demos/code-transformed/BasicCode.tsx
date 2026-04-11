import * as React from 'react';
import { Code } from './Code';

export function BasicCode() {
  return (
    // @highlight @focus
    <Code fileName="example.ts">{`const x: number = 1;\ninterface Props { name: string; }`}</Code>
  );
}
