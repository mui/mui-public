import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { evalCode } from './evalCode';

describe('evalCode', () => {
  it('binds scope values as locals and returns the evaluated result', () => {
    expect(evalCode('return base + 2;', { base: 40 })).toBe(42);
  });

  it('always injects React, even when it is absent from scope', () => {
    expect(evalCode('return React;', {})).toBe(React);
  });

  it('exposes scope.import through the injected require', () => {
    expect(evalCode("return require('dep');", { import: { dep: 7 } })).toBe(7);
  });

  it('writes module exports into a scope-provided exports object', () => {
    const exports: Record<string, unknown> = {};
    evalCode('exports.value = base * 2;', { base: 21, exports });
    expect(exports.value).toBe(42);
  });

  it('ignores the reserved keys (import, default) that cannot be parameters', () => {
    expect(() => evalCode('return 1;', { import: { a: 1 }, default: 'x' })).not.toThrow();
  });

  it('injects React and require with precedence over same-named scope entries', () => {
    // A scope `React`/`require` must NOT shadow the injected bindings: JSX compiles
    // to `React.*` and transpiled imports call the `require` shim.
    expect(evalCode('return React;', { React: { fake: true } })).toBe(React);
    expect(
      evalCode("return require('dep');", { import: { dep: 7 }, require: () => 'hijacked' }),
    ).toBe(7);
  });
});
