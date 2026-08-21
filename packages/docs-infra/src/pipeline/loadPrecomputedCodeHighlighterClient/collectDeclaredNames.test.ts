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

  it('handles whitespace-heavy adversarial input in linear time', () => {
    // Inputs crafted to expose the previously polynomial regex behavior
    // (many leading newlines/spaces, dangling `import {{`, etc.). They
    // should each return quickly and not collect any meaningful names.
    const inputs = [
      `${'\n'.repeat(20000)}`,
      `${'import {{'.repeat(5000)}`,
      `import ${' '.repeat(20000)}`,
      `let${' '.repeat(20000)}`,
    ];
    for (const input of inputs) {
      const start = performance.now();
      const result = collectDeclaredNames(input);
      const elapsedMs = performance.now() - start;
      // Generous bound — polynomial behavior would blow well past this.
      expect(elapsedMs).toBeLessThan(1000);
      expect(result).toBeInstanceOf(Set);
    }
  });

  it('ignores `import` substrings inside identifiers', () => {
    const source = `
      const myImporter = 1;
      const importable = 2;
    `;
    const names = collectDeclaredNames(source);
    expect(names.has('myImporter')).toBe(true);
    expect(names.has('importable')).toBe(true);
  });

  it('handles type-only default imports', () => {
    const source = `import type Foo from './x';`;
    const names = collectDeclaredNames(source);
    expect(names.has('Foo')).toBe(true);
  });

  it('handles default + named combo', () => {
    const source = `import Default, { Named } from './x';`;
    const names = collectDeclaredNames(source);
    expect(names.has('Default')).toBe(true);
    expect(names.has('Named')).toBe(true);
  });
});
