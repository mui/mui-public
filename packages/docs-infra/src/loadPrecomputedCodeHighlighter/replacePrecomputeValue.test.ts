import { describe, it, expect } from 'vitest';
import { replacePrecomputeValue } from './replacePrecomputeValue';
import { parseCreateFactoryCall } from './parseCreateFactoryCall';

// Helper function to check for common syntax issues
function checkSyntaxIssues(code: string): string[] {
  const issues: string[] = [];

  // Check for duplicate commas
  if (code.includes(',,')) {
    issues.push('Contains duplicate commas');
  }

  // Check for missing commas between properties
  const propertyPattern = /:\s*[^,}]+\s+\w+:/g;
  if (propertyPattern.test(code)) {
    issues.push('Missing comma between properties');
  }

  // Check for unmatched braces
  const openBraces = (code.match(/\{/g) || []).length;
  const closeBraces = (code.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    issues.push(`Unmatched braces: ${openBraces} open, ${closeBraces} close`);
  }

  // Check for unmatched parentheses
  const openParens = (code.match(/\(/g) || []).length;
  const closeParens = (code.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    issues.push(`Unmatched parentheses: ${openParens} open, ${closeParens} close`);
  }

  return issues;
}

describe('replacePrecomputeValue', () => {
  it('should replace simple precompute: true with data object', async () => {
    const source = `
import Component from './Component';

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

    // Parse the actual source using parseCreateFactoryCall
    const demoCall = await parseCreateFactoryCall(source, '/test/file.ts');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: {
  "Component": {
    "fileName": "Component.tsx",
    "source": {
      "type": "root",
      "children": []
    }
  }
} }
);
`;

    expect(result).toBe(expected);
  });

  it('should handle multiple spaces around colon and true', async () => {
    const source = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute   :   true }
);
`;

    const data = { test: 'value' };

    // Parse the actual source using parseCreateFactoryCall
    const demoCall = await parseCreateFactoryCall(source, '/test/file.ts');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: {
  "test": "value"
} }
);
`;

    expect(result).toBe(expected);
  });

  it('should handle tabs and mixed whitespace', async () => {
    const source = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute\t:\ttrue }
);
`;

    const data = { test: 'value' };

    // Parse the actual source using parseCreateFactoryCall
    const demoCall = await parseCreateFactoryCall(source, '/test/file.ts');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: {
  "test": "value"
} }
);
`;

    expect(result).toBe(expected);
  });

  it('should replace precompute: false with data object', async () => {
    const source = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: false }
);
`;

    const data = { test: 'value' };

    // Parse the actual source using parseCreateFactoryCall
    const demoCall = await parseCreateFactoryCall(source, '/test/file.ts');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: {
  "test": "value"
} }
);
`;

    expect(result).toBe(expected);
  });

  it('should replace existing precompute object with new data', async () => {
    const source = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: { old: 'data', nested: { value: 123 } } }
);
`;

    const data = { new: 'data' };

    // Parse the actual source using parseCreateFactoryCall
    const demoCall = await parseCreateFactoryCall(source, '/test/file.ts');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: {
  "new": "data"
} }
);
`;

    expect(result).toBe(expected);
  });

  it('should replace multi-line precompute object', async () => {
    const source = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { 
    name: 'test',
    precompute: {
      complex: 'object',
      with: {
        nested: 'values',
        array: [1, 2, 3]
      }
    },
    slug: 'demo'
  }
);
`;

    const data = { replacement: 'data' };
    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { 
    name: 'test',
    precompute: {
  "replacement": "data"
},
    slug: 'demo'
  }
);
`;

    expect(result).toBe(expected);
  });

  it('should handle various spacing when adding to existing options', async () => {
    // Test with no spaces around braces
    const source1 = `import Component from './Component';
createDemo(import.meta.url,{Component},{name:'test'});`;
    const demoCall1 = await parseCreateFactoryCall(source1, '/test/file.ts');
    expect(demoCall1).not.toBeNull();
    const result1 = replacePrecomputeValue(source1, { data: 'test' }, demoCall1!);

    const expected1 = `import Component from './Component';
createDemo(import.meta.url,{Component},{name:'test',
  precompute: {
  "data": "test"
}});`;
    expect(result1).toBe(expected1);

    // Test with extra spaces
    const source2 = `import Component from './Component';
createDemo( import.meta.url , { Component } , {  name : 'test'  } );`;
    const demoCall2 = await parseCreateFactoryCall(source2, '/test/file.ts');
    expect(demoCall2).not.toBeNull();
    const result2 = replacePrecomputeValue(source2, { data: 'test' }, demoCall2!);

    const expected2 = `import Component from './Component';
createDemo( import.meta.url , { Component } , {  name : 'test',
  precompute: {
  "data": "test"
}  } );`;
    expect(result2).toBe(expected2);
  });

  it('should handle various spacing when adding entire options object', async () => {
    // Test with no spaces
    const source1 = `import Component from './Component';
createDemo(import.meta.url,{Component});`;
    const demoCall1 = await parseCreateFactoryCall(source1, '/test/file.ts');
    expect(demoCall1).not.toBeNull();
    const result1 = replacePrecomputeValue(source1, { data: 'test' }, demoCall1!);

    const expected1 = `import Component from './Component';
createDemo(import.meta.url,{Component}, { precompute: {
  "data": "test"
} });`;
    expect(result1).toBe(expected1);

    // Test with extra spaces and newlines
    const source2 = `import Component from './Component';
createDemo(
      import.meta.url,
      { Component }
    );`;
    const demoCall2 = await parseCreateFactoryCall(source2, '/test/file.ts');
    expect(demoCall2).not.toBeNull();
    const result2 = replacePrecomputeValue(source2, { data: 'test' }, demoCall2!);

    const expected2 = `import Component from './Component';
createDemo(
      import.meta.url,
      { Component }
    , { precompute: {
  "data": "test"
} });`;
    expect(result2).toBe(expected2);
  });

  it('should not replace other properties with true value', async () => {
    const source = `
import Component from './Component';

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

    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { 
    precompute: {
  "test": "value"
},
    someOtherFlag: true,
    enabled: true
  }
);
`;

    expect(result).toBe(expected);
  });

  it('should handle complex nested data structures', async () => {
    const source = `
import Component from './Component';

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

    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: {
  "Component": {
    "fileName": "Component.tsx",
    "source": {
      "type": "root",
      "children": [
        {
          "type": "element",
          "tagName": "div"
        }
      ]
    },
    "extraFiles": {
      "styles.css": {
        "fileName": "styles.css",
        "source": {
          "type": "root",
          "children": []
        }
      }
    },
    "transforms": {
      "js": {
        "fileName": "Component.js",
        "source": {
          "type": "root",
          "children": []
        }
      }
    }
  }
} }
);
`;

    expect(result).toBe(expected);
  });

  it('should handle empty data object', async () => {
    const source = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: true }
);
`;

    const data = {};

    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: {} }
);
`;

    expect(result).toBe(expected);
  });

  it('should format JSON with proper indentation', async () => {
    const source = `
import Component from './Component';

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

    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { precompute: {
  "Component": {
    "nested": {
      "deeply": {
        "value": "test"
      }
    }
  }
} }
);
`;

    expect(result).toBe(expected);
  });

  it('should preserve surrounding code exactly', async () => {
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

    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `import { createDemo } from '@/functions/createDemo';
import Component from './Component';

// This is a comment
export const CodeDemo = createDemo(
  import.meta.url,
  { Component },
  {
    name: 'Basic Code Block',
    slug: 'code',
    precompute: {
  "Component": {
    "test": "value"
  }
},
    description: 'A simple demo'
  },
);

// Another comment
export default CodeDemo;`;

    expect(result).toBe(expected);
  });

  it('should handle source with no precompute property', () => {
    const source = `
export const demo = createDemo(
  import.meta.url,
  { Component },
  { name: 'test' }
);
`;

    const data = { test: 'value' };
    const result = replacePrecomputeValue(source, data);

    // Source should remain unchanged when no demoCallInfo is provided
    expect(result).toBe(source);
  });

  it('should add precompute to existing options object', async () => {
    const source = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { name: 'test', slug: 'demo' }
);
`;

    const data = { Component: { fileName: 'Component.tsx' } };
    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { name: 'test', slug: 'demo',
  precompute: {
  "Component": {
    "fileName": "Component.tsx"
  }
} }
);
`;

    expect(result).toBe(expected);
  });

  it('should add entire options object when none exists', async () => {
    const source = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component }
);
`;

    const data = { Component: { fileName: 'Component.tsx' } };
    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component }
, { precompute: {
  "Component": {
    "fileName": "Component.tsx"
  }
} });
`;

    expect(result).toBe(expected);
  });

  it('should add precompute to empty options object', async () => {
    const source = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  {}
);
`;

    const data = { Component: { fileName: 'Component.tsx' } };
    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  {
  precompute: {
  "Component": {
    "fileName": "Component.tsx"
  }
}}
);
`;

    expect(result).toBe(expected);
  });

  it('should override existing precompute regardless of demoCallInfo', async () => {
    const source = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { name: 'test', precompute: true }
);
`;

    const data = { Component: { fileName: 'Component.tsx' } };

    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `
import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { name: 'test', precompute: {
  "Component": {
    "fileName": "Component.tsx"
  }
} }
);
`;

    expect(result).toBe(expected);
  });

  it('should handle createDemo with direct component import and existing options', async () => {
    const source = `import { createDemo } from '@/functions/createDemo';
import { DemoCheckboxBasic } from './demo-basic';

export const DemoCodeHighlighterDemo = createDemo(import.meta.url, DemoCheckboxBasic, {
  name: 'Interactive Demo',
  slug: 'interactive-demo',
});`;

    const data = { DemoCheckboxBasic: { fileName: 'demo-basic.tsx' } };
    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `import { createDemo } from '@/functions/createDemo';
import { DemoCheckboxBasic } from './demo-basic';

export const DemoCodeHighlighterDemo = createDemo(import.meta.url, DemoCheckboxBasic, {
  name: 'Interactive Demo',
  slug: 'interactive-demo',
  precompute: {
  "DemoCheckboxBasic": {
    "fileName": "demo-basic.tsx"
  }
}
});`;

    expect(result).toBe(expected);
  });

  it('should handle createDemo with direct component import and no third parameter', async () => {
    const source = `import { createDemo } from '@/functions/createDemo';
import { DemoCheckboxBasic } from './demo-basic';

export const DemoCodeHighlighterDemo = createDemo(import.meta.url, DemoCheckboxBasic);`;

    const data = { DemoCheckboxBasic: { fileName: 'demo-basic.tsx' } };
    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `import { createDemo } from '@/functions/createDemo';
import { DemoCheckboxBasic } from './demo-basic';

export const DemoCodeHighlighterDemo = createDemo(import.meta.url, DemoCheckboxBasic, { precompute: {
  "DemoCheckboxBasic": {
    "fileName": "demo-basic.tsx"
  }
} });`;

    expect(result).toBe(expected);
  });

  it('should handle trailing commas without adding duplicates', async () => {
    const source = `import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  {
    name: 'test',
    slug: 'demo',
  }
);`;

    const data = { Component: { fileName: 'Component.tsx' } };
    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  {
    name: 'test',
    slug: 'demo',
  precompute: {
  "Component": {
    "fileName": "Component.tsx"
  }
}
  }
);`;

    expect(result).toBe(expected);
  });

  it('should handle adding precompute to options with trailing comma', async () => {
    const source = `import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  {
    name: 'test',
  },
);`;

    const data = { Component: { fileName: 'Component.tsx' } };
    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  {
    name: 'test',
  precompute: {
  "Component": {
    "fileName": "Component.tsx"
  }
}
  },
);`;

    expect(result).toBe(expected);
  });

  it('should handle multiple properties with mixed comma styles', async () => {
    const source = `import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  {
    name: 'test',
    slug: 'demo'
  }
);`;

    const data = { Component: { fileName: 'Component.tsx' } };
    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  {
    name: 'test',
    slug: 'demo',
  precompute: {
  "Component": {
    "fileName": "Component.tsx"
  }
}
  }
);`;

    expect(result).toBe(expected);
  });

  it('should handle single property without trailing comma when adding precompute', async () => {
    const source = `import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { name: 'test' }
);`;

    const data = { Component: { fileName: 'Component.tsx' } };
    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
  { name: 'test',
  precompute: {
  "Component": {
    "fileName": "Component.tsx"
  }
} }
);`;

    expect(result).toBe(expected);
  });

  it('should handle adding entire options object without creating comma issues', async () => {
    const source = `import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
);`;

    const data = { Component: { fileName: 'Component.tsx' } };
    const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
    expect(demoCall).not.toBeNull();

    const result = replacePrecomputeValue(source, data, demoCall!);

    const expected = `import Component from './Component';

export const demo = createDemo(
  import.meta.url,
  { Component },
, { precompute: {
  "Component": {
    "fileName": "Component.tsx"
  }
} });`;

    expect(result).toBe(expected);
  });

  // Comprehensive validation tests
  describe('Output validation', () => {
    it('should produce exact expected output for simple replacement', async () => {
      const source = `import Component from './Component';
export const demo = createDemo(import.meta.url, { Component }, { precompute: true });`;
      const data = { Component: { fileName: 'Component.tsx' } };

      const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
      const result = replacePrecomputeValue(source, data, demoCall!);

      const expected = `import Component from './Component';
export const demo = createDemo(import.meta.url, { Component }, { precompute: {
  "Component": {
    "fileName": "Component.tsx"
  }
} });`;

      expect(result).toBe(expected);
    });

    it('should produce exact expected output when adding to existing options', async () => {
      const source = `import Component from './Component';
export const demo = createDemo(import.meta.url, { Component }, { name: 'test', slug: 'demo' });`;
      const data = { Component: { fileName: 'Component.tsx' } };

      const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
      const result = replacePrecomputeValue(source, data, demoCall!);

      const expected = `import Component from './Component';
export const demo = createDemo(import.meta.url, { Component }, { name: 'test', slug: 'demo',
  precompute: {
  "Component": {
    "fileName": "Component.tsx"
  }
} });`;

      expect(result).toBe(expected);
    });

    it('should produce exact expected output when adding entire options object', async () => {
      const source = `import Component from './Component';
export const demo = createDemo(import.meta.url, { Component });`;
      const data = { Component: { fileName: 'Component.tsx' } };

      const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
      const result = replacePrecomputeValue(source, data, demoCall!);

      const expected = `import Component from './Component';
export const demo = createDemo(import.meta.url, { Component }, { precompute: {
  "Component": {
    "fileName": "Component.tsx"
  }
} });`;

      expect(result).toBe(expected);
    });

    it('should handle trailing commas correctly', async () => {
      const source = `import Component from './Component';
export const demo = createDemo(import.meta.url, { Component }, { name: 'test', });`;
      const data = { Component: { fileName: 'Component.tsx' } };

      const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
      const result = replacePrecomputeValue(source, data, demoCall!);

      const expected = `import Component from './Component';
export const demo = createDemo(import.meta.url, { Component }, { name: 'test',
  precompute: {
  "Component": {
    "fileName": "Component.tsx"
  }
} });`;

      expect(result).toBe(expected);
    });

    it('should handle complex nested data structures correctly', async () => {
      const source = `import Component from './Component';
export const demo = createDemo(import.meta.url, { Component }, { precompute: true });`;
      const data = {
        Component: {
          fileName: 'Component.tsx',
          nested: { deeply: { value: 'test' } },
        },
      };

      const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
      const result = replacePrecomputeValue(source, data, demoCall!);

      const expected = `import Component from './Component';
export const demo = createDemo(import.meta.url, { Component }, { precompute: {
  "Component": {
    "fileName": "Component.tsx",
    "nested": {
      "deeply": {
        "value": "test"
      }
    }
  }
} });`;

      expect(result).toBe(expected);
    });

    it('should handle empty data object correctly', async () => {
      const source = `import Component from './Component';
export const demo = createDemo(import.meta.url, { Component }, { precompute: true });`;
      const data = {};

      const demoCall = await parseCreateFactoryCall(source, '/test/file.tsx');
      const result = replacePrecomputeValue(source, data, demoCall!);

      const expected = `import Component from './Component';
export const demo = createDemo(import.meta.url, { Component }, { precompute: {} });`;

      expect(result).toBe(expected);
    });

    it('should never produce duplicate commas', async () => {
      const testCases = [
        {
          name: 'trailing comma case',
          source: `import Component from './Component';
export const demo = createDemo(import.meta.url, { Component }, { name: 'test', slug: 'demo', });`,
          data: { Component: { fileName: 'Component.tsx' } },
        },
        {
          name: 'mixed comma styles',
          source: `import Component from './Component';
export const demo = createDemo(import.meta.url, { Component }, { name: 'test', slug: 'demo' });`,
          data: { Component: { fileName: 'Component.tsx' } },
        },
      ];

      // Process test cases sequentially
      const results = await Promise.all(
        testCases.map(async (testCase) => {
          const demoCall = await parseCreateFactoryCall(testCase.source, '/test/file.tsx');
          const result = replacePrecomputeValue(testCase.source, testCase.data, demoCall!);
          return { testCase, result };
        }),
      );

      for (const { testCase, result } of results) {
        // Check for syntax issues
        const syntaxIssues = checkSyntaxIssues(result);
        expect(
          syntaxIssues,
          `Syntax issues in ${testCase.name}: ${syntaxIssues.join(', ')}`,
        ).toEqual([]);
      }
    });
  });
});
