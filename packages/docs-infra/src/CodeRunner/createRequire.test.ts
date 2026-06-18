import { describe, it, expect } from 'vitest';
import { createRequire } from './createRequire';

describe('createRequire', () => {
  it('returns a function', () => {
    expect(typeof createRequire()).toBe('function');
  });

  it('resolves a registered module by its exact specifier', () => {
    const requireModule = createRequire({ 'my-lib': { value: 1 } });
    expect(requireModule('my-lib')).toEqual({ value: 1 });
  });

  it('throws a descriptive error for an unregistered specifier', () => {
    const requireModule = createRequire({ known: {} });
    expect(() => requireModule('unknown')).toThrow("Module not found: 'unknown'");
  });

  it('throws for an empty registry', () => {
    expect(() => createRequire()('anything')).toThrow("Module not found: 'anything'");
  });

  it('does not treat inherited Object members as registered modules', () => {
    // `toString` exists on Object.prototype but is not a registered module.
    expect(() => createRequire({})('toString')).toThrow("Module not found: 'toString'");
  });
});
