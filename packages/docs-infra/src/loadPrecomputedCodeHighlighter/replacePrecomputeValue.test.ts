import { describe, it, expect } from 'vitest';
import { replacePrecomputeValue } from './replacePrecomputeValue';

describe('replacePrecomputeValue', () => {
  it('should replace simple precompute: true with data object', () => {
    const source = `
export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: true }
);
`;

    const data = {
      Component: {
        fileName: 'Component.tsx',
        source: { type: 'root', children: [] },
      },
    };

    const result = replacePrecomputeValue(source, data);

    expect(result).toContain('precompute: {');
    expect(result).toContain('"Component": {');
    expect(result).toContain('"fileName": "Component.tsx"');
    expect(result).not.toContain('precompute: true');
  });

  it('should handle multiple spaces around colon and true', () => {
    const source = `
export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute   :   true }
);
`;

    const data = { test: 'value' };
    const result = replacePrecomputeValue(source, data);

    expect(result).toContain('precompute: {');
    expect(result).toContain('"test": "value"');
    expect(result).not.toContain('precompute   :   true');
  });

  it('should handle tabs and mixed whitespace', () => {
    const source = `
export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute\t:\ttrue }
);
`;

    const data = { test: 'value' };
    const result = replacePrecomputeValue(source, data);

    expect(result).toContain('precompute: {');
    expect(result).not.toContain('precompute\t:\ttrue');
  });

  it('should replace multiple occurrences of precompute: true', () => {
    const source = `
export const demo1 = createDemo(
  import.meta.url,
  { Component1 },
  { precompute: true }
);

export const demo2 = createDemo(
  import.meta.url,
  { Component2 },
  { precompute: true }
);
`;

    const data = { shared: 'data' };
    const result = replacePrecomputeValue(source, data);

    const matches = result.match(/precompute: \{/g);
    expect(matches).toHaveLength(2);
    expect(result).not.toContain('precompute: true');
  });

  it('should not replace precompute: false', () => {
    const source = `
export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: false }
);
`;

    const data = { test: 'value' };
    const result = replacePrecomputeValue(source, data);

    expect(result).toContain('precompute: false');
    expect(result).not.toContain('precompute: {');
  });

  it('should not replace other properties with true value', () => {
    const source = `
export const demo = createDemo(
  import.meta.url,
  { Component },
  { 
    precompute: true,
    someOtherFlag: true,
    enabled: true
  }
);
`;

    const data = { test: 'value' };
    const result = replacePrecomputeValue(source, data);

    expect(result).toContain('someOtherFlag: true');
    expect(result).toContain('enabled: true');
    expect(result).toContain('precompute: {');
    expect(result).not.toContain('precompute: true');
  });

  it('should handle complex nested data structures', () => {
    const source = `
export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: true }
);
`;

    const data = {
      Component: {
        fileName: 'Component.tsx',
        source: {
          type: 'root',
          children: [{ type: 'element', tagName: 'div' }],
        },
        extraFiles: {
          'styles.css': {
            fileName: 'styles.css',
            source: { type: 'root', children: [] },
          },
        },
        transforms: {
          js: {
            fileName: 'Component.js',
            source: { type: 'root', children: [] },
          },
        },
      },
    };

    const result = replacePrecomputeValue(source, data);

    expect(result).toContain('"Component": {');
    expect(result).toContain('"fileName": "Component.tsx"');
    expect(result).toContain('"extraFiles": {');
    expect(result).toContain('"transforms": {');
    expect(result).toContain('"styles.css": {');
    expect(result).not.toContain('precompute: true');
  });

  it('should handle empty data object', () => {
    const source = `
export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: true }
);
`;

    const data = {};
    const result = replacePrecomputeValue(source, data);

    expect(result).toContain('precompute: {}');
    expect(result).not.toContain('precompute: true');
  });

  it('should format JSON with proper indentation', () => {
    const source = `
export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: true }
);
`;

    const data = {
      Component: {
        nested: {
          deeply: {
            value: 'test',
          },
        },
      },
    };

    const result = replacePrecomputeValue(source, data);

    // Check that the JSON is properly formatted with 2-space indentation
    expect(result).toContain('{\n  "Component": {\n    "nested": {');
    expect(result).toContain('      "deeply": {\n        "value": "test"');
  });

  it('should preserve surrounding code exactly', () => {
    const source = `import { createDemo } from '@/functions/createDemo';
import Component from './Component';

// This is a comment
export const CodeDemo = createDemo(
  import.meta.url,
  { Component },
  {
    name: 'Basic Code Block',
    slug: 'code',
    precompute: true,
    description: 'A simple demo'
  },
);

// Another comment
export default CodeDemo;`;

    const data = { Component: { test: 'value' } };
    const result = replacePrecomputeValue(source, data);

    // Check that imports are preserved
    expect(result).toContain("import { createDemo } from '@/functions/createDemo';");
    expect(result).toContain("import Component from './Component';");

    // Check that comments are preserved
    expect(result).toContain('// This is a comment');
    expect(result).toContain('// Another comment');

    // Check that other properties are preserved
    expect(result).toContain("name: 'Basic Code Block'");
    expect(result).toContain("slug: 'code'");
    expect(result).toContain("description: 'A simple demo'");

    // Check that export is preserved
    expect(result).toContain('export default CodeDemo;');

    // Check that precompute was replaced
    expect(result).toContain('precompute: {');
    expect(result).not.toContain('precompute: true');
  });

  it('should handle source with no precompute: true', () => {
    const source = `
export const demo = createDemo(
  import.meta.url,
  { Component },
  { name: 'test' }
);
`;

    const data = { test: 'value' };
    const result = replacePrecomputeValue(source, data);

    // Source should remain unchanged
    expect(result).toBe(source);
  });
});
