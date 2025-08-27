import { describe, it, expect } from 'vitest';
import { parseFunctionParameters } from './parseFunctionParameters';

describe('parseFunctionParameters', () => {
  it('should split simple comma-separated values', () => {
    const input = 'a, b, c';
    const result = parseFunctionParameters(input);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('should handle nested objects recursively', () => {
    const input = 'a, { x: 1, y: 2 }, c';
    const result = parseFunctionParameters(input);
    expect(result).toEqual(['a', { x: '1', y: '2' }, 'c']);
  });

  it('should handle nested parentheses', () => {
    const input = 'func(a, b), other, func2(x, y)';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([['func', ['a', 'b']], 'other', ['func2', ['x', 'y']]]);
  });

  it('should handle strings with commas', () => {
    const input = '"hello, world", other, \'test, string\'';
    const result = parseFunctionParameters(input);
    expect(result).toEqual(['"hello, world"', 'other', "'test, string'"]);
  });

  it('should handle single-line comments', () => {
    const input = 'a, // comment with, comma\nb, c';
    const result = parseFunctionParameters(input);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('should handle multi-line comments', () => {
    const input = 'a, /* comment with, comma */ b, c';
    const result = parseFunctionParameters(input);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('should handle template literals', () => {
    const input = '`template, with comma`, other, `another, template`';
    const result = parseFunctionParameters(input);
    expect(result).toEqual(['`template, with comma`', 'other', '`another, template`']);
  });

  it('should handle complex nested structures', () => {
    const input =
      'import.meta.url, { Default: BasicDemo as React.ComponentType<{ prop: boolean }>, WithProps }, { name: "My Demo" }';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([
      'import.meta.url',
      {
        Default: ['as', 'React.ComponentType<{ prop: boolean }>', 'BasicDemo'],
        WithProps: 'WithProps',
      },
      {
        name: '"My Demo"',
      },
    ]);
  });

  it('should handle empty input', () => {
    const input = '';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([]);
  });

  it('should handle single parameter', () => {
    const input = 'singleParam';
    const result = parseFunctionParameters(input);
    expect(result).toEqual(['singleParam']);
  });

  it('should handle escaped quotes in strings', () => {
    const input = '"string with \\"escaped\\" quotes", other';
    const result = parseFunctionParameters(input);
    expect(result).toEqual(['"string with \\"escaped\\" quotes"', 'other']);
  });

  it('should handle deeply nested objects', () => {
    const input = '{ a: { b: { c: 1, d: 2 }, f: 3 }, g: 4 }';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([{ a: { b: { c: '1', d: '2' }, f: '3' }, g: '4' }]);
  });

  it('should handle mixed brackets and braces', () => {
    const input = 'func([1, 2, 3]), { key: "value" }, array[0]';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([['func', ['1', '2', '3']], { key: '"value"' }, 'array[0]']);
  });

  it('should handle TypeScript generics with angle brackets', () => {
    const input = 'Component<{ foo: string }>, { bar: number }, value';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([['Component', [{ foo: 'string' }], []], { bar: 'number' }, 'value']);
  });

  it('should handle arrow functions without breaking on => operator', () => {
    const input = '(a) => a + 1, { transform: (x) => x * 2 }, regular';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([[['a'], 'a + 1'], { transform: [['x'], 'x * 2'] }, 'regular']);
  });

  it('should handle complex TypeScript type with generics', () => {
    const input = 'React.ComponentType<{ prop: boolean }>, { name: string }, config';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([
      ['React.ComponentType', [{ prop: 'boolean' }], []],
      { name: 'string' },
      'config',
    ]);
  });

  it('should handle empty objects', () => {
    const input = 'a, {}, b';
    const result = parseFunctionParameters(input);
    expect(result).toEqual(['a', {}, 'b']);
  });

  it('should handle objects with nested arrays', () => {
    const input = '{ items: [1, 2, 3], meta: { count: 3 } }';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([{ items: [['1', '2', '3']], meta: { count: '3' } }]);
  });

  it('should handle whitespace correctly', () => {
    const input = '  a  ,   b   ,  c  ';
    const result = parseFunctionParameters(input);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('should handle complex React component with multiple generics', () => {
    const input =
      'import.meta.url, { Default: Component as React.FC<Props>, Advanced: Component as React.Component<{ data: Data<T> }> }';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([
      'import.meta.url',
      {
        Default: ['as', 'React.FC<Props>', 'Component'],
        Advanced: ['as', 'React.Component<{ data: Data<T> }>', 'Component'],
      },
    ]);
  });

  it('should preserve nested structure integrity', () => {
    const input = 'outer, { inner: { deep: value, other: data }, simple: test }';
    const result = parseFunctionParameters(input);
    expect(result).toEqual(['outer', { inner: { deep: 'value', other: 'data' }, simple: 'test' }]);
  });

  it('should handle function calls with complex parameters', () => {
    const input = 'createDemo({ variant: "default", props: { disabled: true } }), metadata';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([
      ['createDemo', [{ variant: '"default"', props: { disabled: 'true' } }]],
      'metadata',
    ]);
  });

  it('should handle multiple levels of nesting', () => {
    const input = '{ level1: { level2: { level3: "deep" } } }';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([{ level1: { level2: { level3: '"deep"' } } }]);
  });

  it('should handle arrow functions in complex scenarios', () => {
    const input =
      '(evt) => evt.preventDefault(), { transform: (data: string): Promise<string> => Promise.resolve(data) }';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([
      [['evt'], ['evt.preventDefault', []]],
      {
        transform: [['data'], ['string', 'Promise<string>'], ['Promise.resolve', ['data']]],
      },
    ]);
  });

  it('should handle nested structured representations', () => {
    const input = '{ outer: { inner: value }, simple: test }';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([{ outer: { inner: 'value' }, simple: 'test' }]);
  });

  it('should handle TypeScript as type assertions with complex generics', () => {
    const input =
      '{ Complex: ComplexComponent as React.ComponentType<{ data: Array<{ id: string; value: Record<string, any> }>; onSelect: (item: { id: string }) => void; }>, Simple: SimpleComponent }';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([
      {
        Complex: [
          'as',
          'React.ComponentType<{ data: Array<{ id: string; value: Record<string, any> }>; onSelect: (item: { id: string }) => void; }>',
          'ComplexComponent',
        ],
        Simple: 'SimpleComponent',
      },
    ]);
  });

  it('should handle simple as type assertions', () => {
    const input = 'value as string, other, data as number';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([['as', 'string', 'value'], 'other', ['as', 'number', 'data']]);
  });

  it('should handle property access correctly', () => {
    const input = 'import.meta.url, { Default: components.default, Button: lib.components.Button }';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([
      'import.meta.url',
      {
        Default: 'components.default',
        Button: 'lib.components.Button',
      },
    ]);
  });

  it('should handle property access with type assertions and function calls', () => {
    const input = 'components.default as React.FC, namespace.createComponent(), lib.Button';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([
      ['as', 'React.FC', 'components.default'],
      ['namespace.createComponent', []],
      'lib.Button',
    ]);
  });

  it('should handle function calls with property access like require().prop', () => {
    const input = 'require("url").fileURLToPath, import("path").resolve, other.func().prop';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([
      'require("url").fileURLToPath',
      'import("path").resolve',
      'other.func().prop',
    ]);
  });

  it('should handle function calls with bracket notation and chained calls', () => {
    const input = 'func()["key"], obj.method()[0], chain()()';
    const result = parseFunctionParameters(input);
    expect(result).toEqual(['func()["key"]', 'obj.method()[0]', 'chain()()']);
  });

  it('should handle TypeScript optional chaining and non-null assertion', () => {
    const input = 'func()?.prop, method()!.value, chain()?.()';
    const result = parseFunctionParameters(input);
    expect(result).toEqual(['func()?.prop', 'method()!.value', 'chain()?.()']);
  });

  it('should still parse normal function calls without property access', () => {
    const input = 'func(a, b), method(), createComponent({ prop: true })';
    const result = parseFunctionParameters(input);
    expect(result).toEqual([
      ['func', ['a', 'b']],
      ['method', []],
      ['createComponent', [{ prop: 'true' }]],
    ]);
  });
});
