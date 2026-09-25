import { describe, it, expect } from 'vitest';
import { mergeConfig } from './loadTypescriptConfig';

describe('mergeConfig', () => {
  it('merges flat properties from source into target', () => {
    const target = { foo: 1, bar: 2 };
    const source = { bar: 3, baz: 4 };

    const result = mergeConfig(target, source);

    expect(result).toEqual({ foo: 1, bar: 3, baz: 4 });
  });

  it('recursively merges nested objects', () => {
    const target = { compilerOptions: { target: 'es5', strict: true } };
    const source = { compilerOptions: { target: 'es2020', module: 'esnext' } };

    const result = mergeConfig(target, source);

    expect(result).toEqual({
      compilerOptions: { target: 'es2020', strict: true, module: 'esnext' },
    });
  });

  it('overwrites arrays rather than merging them', () => {
    const target = { include: ['src'] };
    const source = { include: ['lib', 'test'] };

    const result = mergeConfig(target, source);

    expect(result).toEqual({ include: ['lib', 'test'] });
  });

  it('does not pollute Object.prototype via __proto__ key', () => {
    const target: Record<string, unknown> = {};
    const source = JSON.parse('{"__proto__": {"polluted": true}}');

    mergeConfig(target, source);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('does not pollute Object.prototype via constructor.prototype key', () => {
    const target: Record<string, unknown> = {};
    const source = JSON.parse('{"constructor": {"prototype": {"polluted": true}}}');

    mergeConfig(target, source);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('does not assign a prototype key from source', () => {
    const target: Record<string, unknown> = {};
    const source = JSON.parse('{"prototype": {"polluted": true}}');

    mergeConfig(target, source);

    expect(target).not.toHaveProperty('prototype');
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
