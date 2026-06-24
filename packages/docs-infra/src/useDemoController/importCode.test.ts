import { describe, it, expect } from 'vitest';
import { importCode } from './importCode';

describe('importCode', () => {
  it('returns the named and default exports of a module', () => {
    const exports = importCode('export const a = 1;\nexport default 2;');
    expect(exports.a).toBe(1);
    expect(exports.default).toBe(2);
  });

  it('strips TypeScript before evaluating', () => {
    const exports = importCode('export const total: number = 40 + 2;');
    expect(exports.total).toBe(42);
  });

  it('lets a module import siblings from the scope registry', () => {
    const exports = importCode("import { base } from 'shared';\nexport const doubled = base * 2;", {
      import: { shared: { base: 21 } },
    });
    expect(exports.doubled).toBe(42);
  });

  it('returns an object even when the module exports nothing', () => {
    expect(typeof importCode('const unused = 1;')).toBe('object');
  });
});
