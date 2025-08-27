import { describe, it, expect } from 'vitest';
import { serializeFunctionParameters } from './serializeFunctionParameters';
import { parseFunctionParameters } from './parseFunctionParameters';

describe('serializeFunctionParameters', () => {
  // Test round-trip: parse then serialize should produce equivalent results
  it('should handle simple parameters round-trip', () => {
    const input = 'a, b, c';
    const parsed = parseFunctionParameters(input);
    const serialized = serializeFunctionParameters(parsed);
    expect(serialized).toBe('a, b, c');
  });

  it('should handle objects with JSON.stringify for performance', () => {
    const input = 'import.meta.url, { Default: Component }, { name: "Test", skipPrecompute: true }';
    const parsed = parseFunctionParameters(input);
    const serialized = serializeFunctionParameters(parsed);
    expect(serialized).toBe(
      'import.meta.url, { Default: Component }, { name: "Test", skipPrecompute: true }',
    );
  });

  it('should handle TypeScript type assertions', () => {
    const input = 'Component as React.FC<Props>, { name: "Test" }';
    const parsed = parseFunctionParameters(input);
    const serialized = serializeFunctionParameters(parsed);
    expect(serialized).toBe('Component as React.FC<Props>, { name: "Test" }');
  });

  it('should handle function calls', () => {
    const input = 'import.meta.url, createComponent(), { name: "Test" }';
    const parsed = parseFunctionParameters(input);
    const serialized = serializeFunctionParameters(parsed);
    expect(serialized).toBe('import.meta.url, createComponent(), { name: "Test" }');
  });

  it('should handle generics', () => {
    const input = 'Component<{ foo: string }>, { bar: number }';
    const parsed = parseFunctionParameters(input);
    const serialized = serializeFunctionParameters(parsed);
    // The generic gets parsed and needs to be reconstructed
    expect(serialized).toContain('Component<');
    expect(serialized).toContain('foo: string');
  });

  it('should handle arrow functions', () => {
    const input = '(x) => x + 1, { transform: (data) => data.toUpperCase() }';
    const parsed = parseFunctionParameters(input);
    const serialized = serializeFunctionParameters(parsed);
    expect(serialized).toContain('=>');
  });

  it('should handle shorthand object properties', () => {
    const parsed = ['import.meta.url', { Component: 'Component', Button: 'Button' }];

    const serialized = serializeFunctionParameters(parsed);
    expect(serialized).toBe('import.meta.url, { Component, Button }');
  });

  it('should handle empty objects', () => {
    const parsed = ['import.meta.url', { Default: 'Component' }, {}];
    const serialized = serializeFunctionParameters(parsed);
    expect(serialized).toBe('import.meta.url, { Default: Component }, {}');
  });

  it('should handle mixed parameter types', () => {
    const parsed = [
      'import.meta.url',
      {
        Default: ['as', 'React.FC<Props>', 'Component'],
        Button: 'ButtonComponent',
      },
      {
        name: 'Complex Demo',
        customFunction: [['evt'], 'evt.preventDefault()'],
      },
    ];

    const serialized = serializeFunctionParameters(parsed);
    expect(serialized).toContain('Component as React.FC<Props>');
    expect(serialized).toContain('ButtonComponent');
    expect(serialized).toContain('Complex Demo');
    expect(serialized).toContain('evt => evt.preventDefault()');
  });

  it('should preserve nested structures', () => {
    const parsed = [
      'import.meta.url',
      {
        Complex: ['createComponent', [{ variant: 'primary', disabled: true }]],
      },
    ];

    const serialized = serializeFunctionParameters(parsed);
    expect(serialized).toContain('createComponent(');
    expect(serialized).toContain('variant');
    expect(serialized).toContain('primary');
    expect(serialized).toContain('disabled');
  });

  it('should handle arrays correctly', () => {
    const parsed = ['import.meta.url', { variants: [['Component1', 'Component2', 'Component3']] }];

    const serialized = serializeFunctionParameters(parsed);
    expect(serialized).toBe('import.meta.url, { variants: [Component1, Component2, Component3] }');
  });

  describe('debug array unwrapping', () => {
    it('should unwrap double-wrapped arrays at top level', () => {
      const doubleWrappedArray = [['Component1', 'Component2', 'Component3']];
      const result = serializeFunctionParameters(doubleWrappedArray);
      expect(result).toBe('[Component1, Component2, Component3]');
    });

    it('should unwrap double-wrapped arrays in objects', () => {
      const objectWithDoubleWrappedArray = [
        {
          variants: [['Component1', 'Component2', 'Component3']],
        },
      ];
      const result = serializeFunctionParameters(objectWithDoubleWrappedArray);
      expect(result).toBe('{ variants: [Component1, Component2, Component3] }');
    });

    it('should handle quoted strings correctly', () => {
      const quotedString = ['"Test Demo"'];
      const result = serializeFunctionParameters(quotedString);
      expect(result).toBe('"Test Demo"');
    });
  });
});
