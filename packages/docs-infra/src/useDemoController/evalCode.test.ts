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

  it('binds a host-supplied global, so a demo mentioning it does not throw', () => {
    // `LiveDemoProvider`'s `globals` land in the scope, so `process` resolves to
    // the host's object instead of a ReferenceError.
    expect(evalCode('return typeof process;', { process: {} })).toBe('object');
    expect(
      evalCode('return process.env.NODE_ENV;', { process: { env: { NODE_ENV: 'test' } } }),
    ).toBe('test');
  });

  it('throws on a property the supplied global does not carry', () => {
    // A host that passes `{ process: {} }` deliberately exposes nothing; reaching
    // through it fails at eval, which the runner reports as the variant's error
    // rather than taking the page down.
    expect(() => evalCode('return process.env.NODE_ENV;', { process: {} })).toThrow(TypeError);
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
