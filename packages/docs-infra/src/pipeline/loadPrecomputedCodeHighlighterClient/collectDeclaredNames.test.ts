import { describe, it, expect } from 'vitest';
import { collectDeclaredNames } from './collectDeclaredNames';

describe('collectDeclaredNames', () => {
  it('collects default, namespace and named imports', () => {
    const source = `
      import React from 'react';
      import * as ReactDOM from 'react-dom';
      import { Button, TextField as Field } from '@mui/material';
    `;
    const names = collectDeclaredNames(source);
    expect(names.has('React')).toBe(true);
    expect(names.has('ReactDOM')).toBe(true);
    expect(names.has('Button')).toBe(true);
    expect(names.has('Field')).toBe(true);
    // The original (pre-alias) name should not block reuse
    expect(names.has('TextField')).toBe(false);
  });

  it('collects type-only named imports', () => {
    const source = `import { type Foo, Bar } from './x';`;
    const names = collectDeclaredNames(source);
    expect(names.has('Foo')).toBe(true);
    expect(names.has('Bar')).toBe(true);
  });

  it('collects const, let, var declarations including destructuring', () => {
    const source = `
      const a = 1;
      let b = 2, c = 3;
      var { d, e: renamed } = obj;
      const [f, g] = arr;
      export const h = 4;
    `;
    const names = collectDeclaredNames(source);
    for (const expected of ['a', 'b', 'c', 'd', 'renamed', 'f', 'g', 'h']) {
      expect(names.has(expected)).toBe(true);
    }
  });

  it('collects function and class declarations', () => {
    const source = `
      function foo() {}
      async function bar() {}
      function* gen() {}
      class Baz {}
      export default class Qux {}
      export function quux() {}
    `;
    const names = collectDeclaredNames(source);
    for (const expected of ['foo', 'bar', 'gen', 'Baz', 'Qux', 'quux']) {
      expect(names.has(expected)).toBe(true);
    }
  });

  it('returns an empty set for empty source', () => {
    expect(collectDeclaredNames('')).toEqual(new Set());
  });
});
