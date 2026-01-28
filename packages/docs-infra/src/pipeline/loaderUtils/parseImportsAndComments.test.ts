import { describe, expect, it } from 'vitest';
import { parseImportsAndComments } from './parseImportsAndComments';

describe('parseImportsAndComments', () => {
  it('should resolve relative import paths and group by import path', async () => {
    const code = `
      import Component1 from './Component1';
      import { Component2, Component3 } from './components';
      import * as Utils from '../utils';
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImportsAndComments(code, filePath);

    expect(result).toEqual({
      relative: {
        './Component1': {
          url: 'file:///src/Component1',
          names: [{ name: 'Component1', type: 'default' }],
          positions: [{ start: 30, end: 44 }],
        },
        './components': {
          url: 'file:///src/components',
          names: [
            { name: 'Component2', type: 'named' },
            { name: 'Component3', type: 'named' },
          ],
          positions: [{ start: 91, end: 105 }],
        },
        '../utils': {
          url: 'file:///utils',
          names: [{ name: 'Utils', type: 'namespace' }],
          positions: [{ start: 136, end: 146 }],
        },
      },
      externals: {},
    });
  });

  it('should ignore non-relative imports', async () => {
    const code = `
      import React from 'react';
      import { Button } from '@mui/material';
      import Component from './Component';
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImportsAndComments(code, filePath);

    expect(result).toEqual({
      relative: {
        './Component': {
          url: 'file:///src/Component',
          names: [{ name: 'Component', type: 'default' }],
          positions: [{ start: 108, end: 121 }],
        },
      },
      externals: {
        react: {
          names: [{ name: 'React', type: 'default' }],
          positions: [{ start: 25, end: 32 }],
        },
        '@mui/material': {
          names: [{ name: 'Button', type: 'named' }],
          positions: [{ start: 63, end: 78 }],
        },
      },
    });
  });

  it('should handle empty code', async () => {
    const code = '';
    const filePath = '/src/demo.ts';
    const result = await parseImportsAndComments(code, filePath);

    expect(result).toEqual({
      relative: {},
      externals: {},
    });
  });

  it('should handle code with no imports', async () => {
    const code = `
      const x = 1;
      function test() {
        return 'hello';
      }
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImportsAndComments(code, filePath);

    expect(result).toEqual({
      relative: {},
      externals: {},
    });
  });

  it('should handle mixed import types', async () => {
    const code = `
      import DefaultImport from './default';
      import { NamedImport1, NamedImport2 } from './named';
      import * as NamespaceImport from './namespace';
      import { NamedImport3 as AliasedImport } from './aliased';
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImportsAndComments(code, filePath);

    expect(result).toEqual({
      relative: {
        './default': {
          url: 'file:///src/default',
          names: [{ name: 'DefaultImport', type: 'default' }],
          positions: [{ start: 33, end: 44 }],
        },
        './named': {
          url: 'file:///src/named',
          names: [
            { name: 'NamedImport1', type: 'named' },
            { name: 'NamedImport2', type: 'named' },
          ],
          positions: [{ start: 95, end: 104 }],
        },
        './namespace': {
          url: 'file:///src/namespace',
          names: [{ name: 'NamespaceImport', type: 'namespace' }],
          positions: [{ start: 145, end: 158 }],
        },
        './aliased': {
          url: 'file:///src/aliased',
          names: [{ name: 'NamedImport3', alias: 'AliasedImport', type: 'named' }],
          positions: [{ start: 212, end: 223 }],
        },
      },
      externals: {},
    });
  });

  it('should handle deeply nested paths', async () => {
    const code = `
      import Component from '../../../shared/components/Component';
      import Utils from '../../utils/helpers';
    `;
    const filePath = '/src/features/demo/components/demo.ts';
    const result = await parseImportsAndComments(code, filePath);

    expect(result).toEqual({
      relative: {
        '../../../shared/components/Component': {
          url: 'file:///src/shared/components/Component',
          names: [{ name: 'Component', type: 'default' }],
          positions: [{ start: 29, end: 67 }],
        },
        '../../utils/helpers': {
          url: 'file:///src/features/utils/helpers',
          names: [{ name: 'Utils', type: 'default' }],
          positions: [{ start: 93, end: 114 }],
        },
      },
      externals: {},
    });
  });

  it('should handle type-only imports', async () => {
    const code = `
      import type { TypeDef } from './types';
      import type DefaultType from './defaultTypes';
      import { Component } from './component';
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImportsAndComments(code, filePath);

    // Type imports should have includeTypeDefs: true
    expect(result).toEqual({
      relative: {
        './types': {
          url: 'file:///src/types',
          names: [{ name: 'TypeDef', type: 'named', isType: true }],
          includeTypeDefs: true,
          positions: [{ start: 36, end: 45 }],
        },
        './defaultTypes': {
          url: 'file:///src/defaultTypes',
          names: [{ name: 'DefaultType', type: 'default', isType: true }],
          includeTypeDefs: true,
          positions: [{ start: 82, end: 98 }],
        },
        './component': {
          url: 'file:///src/component',
          names: [{ name: 'Component', type: 'named' }],
          positions: [{ start: 132, end: 145 }],
        },
      },
      externals: {},
    });
  });

  it('should handle mixed type and value imports from same module', async () => {
    const code = `
      import type { Props } from './Component';
      import { Component } from './Component';
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImportsAndComments(code, filePath);

    // Should create separate entries for type and value imports
    expect(result).toEqual({
      relative: {
        './Component': {
          url: 'file:///src/Component',
          names: [
            { name: 'Props', type: 'named', isType: true },
            { name: 'Component', type: 'named' },
          ],
          includeTypeDefs: true,
          positions: [
            { start: 34, end: 47 },
            { start: 81, end: 94 },
          ],
        },
      },
      externals: {},
    });
  });

  it('should handle side-effect imports', async () => {
    const code = `
      import './styles.css';
      import '../utils/polyfills';
      import 'some-external-module/setup';
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImportsAndComments(code, filePath);

    expect(result).toEqual({
      relative: {
        './styles.css': {
          url: 'file:///src/styles.css',
          names: [],
          positions: [{ start: 14, end: 28 }],
        },
        '../utils/polyfills': {
          url: 'file:///utils/polyfills',
          names: [],
          positions: [{ start: 43, end: 63 }],
        },
      },
      externals: {
        'some-external-module/setup': {
          names: [],
          positions: [{ start: 78, end: 106 }],
        },
      },
    });
  });

  // Test cases that would help catch edge cases that cause issues downstream
  describe('Edge case regression tests', () => {
    it('should handle imports with empty or problematic names that could cause downstream issues', async () => {
      // Test a scenario that might produce empty names or cause parsing issues
      const code = `
        import React from 'react';
        import { } from './empty-exports';
        import { /* comment */ } from './comment-only';
        import './side-effect';
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './empty-exports': {
            url: 'file:///src/empty-exports',
            names: [],
            positions: [{ start: 60, end: 77 }],
          },
          './comment-only': {
            url: 'file:///src/comment-only',
            names: [],
            positions: [{ start: 117, end: 133 }],
          },
          './side-effect': {
            url: 'file:///src/side-effect',
            names: [],
            positions: [{ start: 150, end: 165 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle complex mixed type and value imports that could cause consolidation issues', async () => {
      const code = `
        import type { ComponentType, ReactNode } from 'react';
        import React, { useState, useEffect } from 'react';
        import type { ButtonProps } from '@mui/material';
        import { Button, TextField } from '@mui/material';
        import type * as Types from './types';
        import * as Utils from './utils';
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImportsAndComments(code, filePath);

      // This should produce mixed isType flags that the generateExternalsProvider needs to handle
      expect(result.externals.react.names).toEqual([
        { name: 'ComponentType', type: 'named', isType: true },
        { name: 'ReactNode', type: 'named', isType: true },
        { name: 'React', type: 'default' },
        { name: 'useState', type: 'named' },
        { name: 'useEffect', type: 'named' },
      ]);

      expect(result.externals['@mui/material'].names).toEqual([
        { name: 'ButtonProps', type: 'named', isType: true },
        { name: 'Button', type: 'named' },
        { name: 'TextField', type: 'named' },
      ]);

      expect(result.relative['./types']).toEqual({
        url: 'file:///src/types',
        names: [{ name: 'Types', type: 'namespace', isType: true }],
        includeTypeDefs: true,
        positions: [
          {
            end: 286,
            start: 277,
          },
        ],
      });

      expect(result.relative['./utils']).toEqual({
        url: 'file:///src/utils',
        names: [{ name: 'Utils', type: 'namespace' }],
        positions: [
          {
            end: 328,
            start: 319,
          },
        ],
      });
    });

    it('should handle duplicate imports that could cause consolidation problems', async () => {
      const code = `
        import React from 'react';
        import { useState } from 'react';
        import React from 'react';
        import { useState, useEffect } from 'react';
        import { Button } from '@mui/material';
        import { Button, TextField } from '@mui/material';
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImportsAndComments(code, filePath);

      // parseImportsAndComments should handle the duplicates and produce a consolidated structure
      // The exact behavior depends on implementation, but it should not crash
      expect(result.externals.react).toBeDefined();
      expect(result.externals['@mui/material']).toBeDefined();

      // Should contain all the unique imports
      const reactNames = result.externals.react.names.map((n) => n.name);
      expect(reactNames).toContain('React');
      expect(reactNames).toContain('useState');
      expect(reactNames).toContain('useEffect');

      const muiNames = result.externals['@mui/material'].names.map((n) => n.name);
      expect(muiNames).toContain('Button');
      expect(muiNames).toContain('TextField');
    });

    it('should handle malformed or unusual import statements gracefully', async () => {
      const code = `
        import React from 'react';
        import { 
          useState,
          useEffect
        } from 'react';
        import {
          Button,
          // This is a comment
          TextField
        } from '@mui/material';
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImportsAndComments(code, filePath);

      // Should parse multi-line imports correctly
      expect(result.externals.react.names).toEqual([
        { name: 'React', type: 'default' },
        { name: 'useState', type: 'named' },
        { name: 'useEffect', type: 'named' },
      ]);

      expect(result.externals['@mui/material'].names).toEqual([
        { name: 'Button', type: 'named' },
        { name: 'TextField', type: 'named' },
      ]);
    });

    it('should handle files that might produce the exact scenario that caused our bugs', async () => {
      // This simulates a real file that could produce empty names, type-only imports, and duplicates
      const code = `
        import type { FC, ReactNode, ComponentType } from 'react';
        import React, { useState, useEffect } from 'react';
        import type { ButtonProps, TextFieldProps } from '@mui/material';
        import { Button, TextField } from '@mui/material';
        import type { } from './empty-types';
        import { } from './empty-runtime';
        import './side-effect.css';
      `;
      const filePath = '/src/ServerLoadedDemo.tsx';
      const result = await parseImportsAndComments(code, filePath);

      // Should produce the exact kind of mixed data that caused issues:
      // - Type-only imports with isType: true
      // - Empty names arrays
      // - Mixed type and runtime imports from same modules
      expect(result.externals.react.names).toContainEqual({
        name: 'FC',
        type: 'named',
        isType: true,
      });
      expect(result.externals.react.names).toContainEqual({
        name: 'ReactNode',
        type: 'named',
        isType: true,
      });
      expect(result.externals.react.names).toContainEqual({
        name: 'ComponentType',
        type: 'named',
        isType: true,
      });
      expect(result.externals.react.names).toContainEqual({ name: 'React', type: 'default' });
      expect(result.externals.react.names).toContainEqual({ name: 'useState', type: 'named' });
      expect(result.externals.react.names).toContainEqual({ name: 'useEffect', type: 'named' });

      expect(result.externals['@mui/material'].names).toContainEqual({
        name: 'ButtonProps',
        type: 'named',
        isType: true,
      });
      expect(result.externals['@mui/material'].names).toContainEqual({
        name: 'TextFieldProps',
        type: 'named',
        isType: true,
      });
      expect(result.externals['@mui/material'].names).toContainEqual({
        name: 'Button',
        type: 'named',
      });
      expect(result.externals['@mui/material'].names).toContainEqual({
        name: 'TextField',
        type: 'named',
      });

      // Should handle empty imports
      expect(result.relative['./empty-types']).toEqual({
        url: 'file:///src/empty-types',
        names: [],
        includeTypeDefs: true,
        positions: [
          {
            end: 305,
            start: 290,
          },
        ],
      });

      expect(result.relative['./empty-runtime']).toEqual({
        url: 'file:///src/empty-runtime',
        names: [],
        positions: [
          {
            end: 348,
            start: 331,
          },
        ],
      });

      expect(result.relative['./side-effect.css']).toEqual({
        url: 'file:///src/side-effect.css',
        names: [],
        positions: [{ start: 365, end: 384 }],
      });
    });

    it('should handle namespace import and path alias imports', async () => {
      // Test the exact case the user provided
      const code = `
import * as React from 'react';
import { Checkbox } from '@/components/Checkbox';

export default function CheckboxBasic() {
  return (
    <div>
      <Checkbox defaultChecked />
      <p style={{ color: '#CA244D' }}>Type Whatever You Want Below</p>
    </div>
  );
}
      `;
      const filePath = '/src/demos/CheckboxBasic.tsx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result.externals.react.names).toEqual([{ name: 'React', type: 'namespace' }]);

      // Path alias @/components/Checkbox should be treated as external since it's not relative
      expect(result.externals['@/components/Checkbox'].names).toEqual([
        { name: 'Checkbox', type: 'named' },
      ]);

      expect(result.relative).toEqual({});
    });
  });

  // Test cases for ignoring imports in comments, strings, and template literals
  describe('Ignore imports in comments, strings, and template literals', () => {
    it('should ignore imports in single-line comments', async () => {
      const code = `
        import React from 'react';
        // import { Button } from '@mui/material';
        // This is a comment with import './fake-module';
        const x = 1;
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {},
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should ignore imports in multi-line comments', async () => {
      const code = `
        import React from 'react';
        /*
         * import { Button } from '@mui/material';
         * import Component from './Component';
         */
        /* import './styles.css'; */
        const x = 1;
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {},
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should ignore imports in string literals', async () => {
      const code = `
        import React from 'react';
        const fakeImport1 = "import { Button } from '@mui/material';";
        const fakeImport2 = 'import Component from "./Component";';
        const fakeImport3 = "import './styles.css';";
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {},
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should ignore imports in template literals', async () => {
      const code = `
        import React from 'react';
        const fakeImport1 = \`import { Button } from '@mui/material';\`;
        const fakeImport2 = \`
          import Component from "./Component";
          import './styles.css';
        \`;
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {},
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle escaped quotes in strings and not be confused by fake imports', async () => {
      const code = `
        import React from 'react';
        const str1 = "This has \\"quotes\\" and import { fake } from 'fake';";
        const str2 = 'This has \\'quotes\\' and import fake from "fake";';
        const template = \`This has \\\`backticks\\\` and import './fake';\`;
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {},
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should ignore imports in nested comments and strings', async () => {
      const code = `
        import React from 'react';
        /* 
         * This is a comment containing "import { Button } from '@mui/material';"
         * and also 'import Component from "./Component";'
         */
        // This comment has "import './styles.css';" in a string
        const code = \`
          // import { fake } from './fake';
          /* import another from './another'; */
          const str = "import { nested } from './nested';";
        \`;
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {},
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle mixed real and fake imports correctly', async () => {
      const code = `
        import React from 'react'; // Real import
        // import { FakeButton } from '@mui/material'; - This is commented out
        import { RealButton } from '@mui/material'; // Real import
        
        const fakeCode = \`
          import { TemplateButton } from '@mui/template'; // Fake import in template
        \`;
        
        /* 
         * import { CommentButton } from '@mui/comment'; // Fake import in comment
         */
        
        import { AnotherReal } from './real-module'; // Real import
        
        const string = "import { StringButton } from './string-module';"; // Fake import in string
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './real-module': {
            url: 'file:///src/real-module',
            names: [{ name: 'AnotherReal', type: 'named' }],
            positions: [{ start: 490, end: 505 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
          '@mui/material': {
            names: [{ name: 'RealButton', type: 'named' }],
            positions: [{ start: 165, end: 180 }],
          },
        },
      });
    });

    it('should handle imports immediately after comments/strings without being confused', async () => {
      const code = `
        import React from 'react';
        // This is a comment
        import { Button } from '@mui/material';
        /* Multi-line comment */
        import Component from './Component';
        const str = "fake import";
        import './styles.css';
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './Component': {
            url: 'file:///src/Component',
            names: [{ name: 'Component', type: 'default' }],
            positions: [{ start: 176, end: 189 }],
          },
          './styles.css': {
            url: 'file:///src/styles.css',
            names: [],
            positions: [{ start: 241, end: 255 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
          '@mui/material': {
            names: [{ name: 'Button', type: 'named' }],
            positions: [{ start: 96, end: 111 }],
          },
        },
      });
    });

    it('should handle the word "import" appearing in various contexts without being confused', async () => {
      const code = `
        import React from 'react'; // Real import
        
        // The word "import" appears in this comment but should be ignored
        /* We should import this later: import { Future } from './future'; */
        
        const message = "Please import the required modules";
        const instructions = 'To import a component, use import syntax';
        const template = \`
          Instructions: import your dependencies first
          Example: import React from 'react';
        \`;
        
        // This function name contains "import" but should not be confused
        function importantFunction() {
          return "This function is important, not an import";
        }
        
        const importantVariable = "important";
        
        import { ActualComponent } from './actual'; // Real import at the end
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './actual': {
            url: 'file:///src/actual',
            names: [{ name: 'ActualComponent', type: 'named' }],
            positions: [{ start: 796, end: 806 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle complex template literals with embedded expressions', async () => {
      const code = `
        import React from 'react';
        
        const moduleCode = \`
          import { Component } from './fake-component';
          export default function Example() {
            return <div>Fake code in template</div>;
          }
        \`;
        
        const dynamicImport = \`import { \${componentName} } from './\${modulePath}';\`;
        
        import { RealComponent } from './real-component';
      `;
      const filePath = '/src/demo.ts';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './real-component': {
            url: 'file:///src/real-component',
            names: [{ name: 'RealComponent', type: 'named' }],
            positions: [{ start: 393, end: 411 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });
  });

  // Test cases for CSS @import parsing
  describe('CSS @import parsing', () => {
    it('should parse CSS @import statements with url() syntax', async () => {
      const code = `
        /* CSS imports */
        @import url("reset.css");
        @import url('./components/buttons.css');
        @import url("../shared/layout.css");
        @import url("https://fonts.googleapis.com/css2?family=Roboto");
        
        body {
          margin: 0;
        }
      `;
      const filePath = '/src/styles/main.css';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          'reset.css': {
            url: 'file:///src/styles/reset.css',
            names: [],
            positions: [{ start: 47, end: 58 }],
          },
          './components/buttons.css': {
            url: 'file:///src/styles/components/buttons.css',
            names: [],
            positions: [{ start: 81, end: 107 }],
          },
          '../shared/layout.css': {
            url: 'file:///src/shared/layout.css',
            names: [],
            positions: [{ start: 130, end: 152 }],
          },
        },
        externals: {
          'https://fonts.googleapis.com/css2?family=Roboto': {
            names: [],
            positions: [{ start: 175, end: 224 }],
          },
        },
      });
    });

    it('should parse CSS @import statements with direct quotes', async () => {
      const code = `
        @import "normalize.css";
        @import './variables.css';
        @import "../themes/dark.css";
        @import "//cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css";
        
        .container {
          width: 100%;
        }
      `;
      const filePath = '/src/styles/main.css';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          'normalize.css': {
            url: 'file:///src/styles/normalize.css',
            names: [],
            positions: [{ start: 17, end: 32 }],
          },
          './variables.css': {
            url: 'file:///src/styles/variables.css',
            names: [],
            positions: [{ start: 50, end: 67 }],
          },
          '../themes/dark.css': {
            url: 'file:///src/themes/dark.css',
            names: [],
            positions: [{ start: 85, end: 105 }],
          },
        },
        externals: {
          '//cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css': {
            names: [],
            positions: [{ start: 123, end: 190 }],
          },
        },
      });
    });

    it('should parse CSS @import statements with media queries', async () => {
      const code = `
        @import url("print.css") print;
        @import "mobile.css" screen and (max-width: 768px);
        @import url("desktop.css") screen and (min-width: 769px);
        @import url("https://fonts.googleapis.com/css2?family=Roboto") screen;
        
        .header {
          background: blue;
        }
      `;
      const filePath = '/src/styles/main.css';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          'print.css': {
            url: 'file:///src/styles/print.css',
            names: [],
            positions: [{ start: 21, end: 32 }],
          },
          'mobile.css': {
            url: 'file:///src/styles/mobile.css',
            names: [],
            positions: [{ start: 57, end: 69 }],
          },
          'desktop.css': {
            url: 'file:///src/styles/desktop.css',
            names: [],
            positions: [{ start: 121, end: 134 }],
          },
        },
        externals: {
          'https://fonts.googleapis.com/css2?family=Roboto': {
            names: [],
            positions: [{ start: 187, end: 236 }],
          },
        },
      });
    });

    it('should ignore CSS @import statements in comments', async () => {
      const code = `
        @import "real.css";
        /* @import "fake1.css"; */
        // @import "fake2.css";
        /*
         * @import url("fake3.css");
         */
        
        .button {
          padding: 10px;
        }
      `;
      const filePath = '/src/styles/main.css';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          'real.css': {
            url: 'file:///src/styles/real.css',
            names: [],
            positions: [{ start: 17, end: 27 }],
          },
        },
        externals: {},
      });
    });

    it('should handle mixed CSS import formats', async () => {
      const code = `
        @import url("local1.css");
        @import './local2.css';
        @import url('./local3.css');
        @import "local4.css";
        @import url('../parent/shared.css') screen;
        @import url("https://external.com/style.css");
        
        h1 {
          color: red;
        }
      `;
      const filePath = '/src/components/component.css';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          'local1.css': {
            url: 'file:///src/components/local1.css',
            names: [],
            positions: [{ start: 21, end: 33 }],
          },
          './local2.css': {
            url: 'file:///src/components/local2.css',
            names: [],
            positions: [{ start: 52, end: 66 }],
          },
          './local3.css': {
            url: 'file:///src/components/local3.css',
            names: [],
            positions: [{ start: 88, end: 102 }],
          },
          'local4.css': {
            url: 'file:///src/components/local4.css',
            names: [],
            positions: [{ start: 121, end: 133 }],
          },
          '../parent/shared.css': {
            url: 'file:///src/parent/shared.css',
            names: [],
            positions: [{ start: 155, end: 177 }],
          },
        },
        externals: {
          'https://external.com/style.css': { names: [], positions: [{ start: 207, end: 239 }] },
        },
      });
    });

    it('should not parse CSS imports for non-CSS files', async () => {
      const code = `
        @import "should-be-ignored.css";
        import React from 'react';
        
        function Component() {
          return <div>Hello</div>;
        }
      `;
      const filePath = '/src/Component.tsx'; // Not a CSS file
      const result = await parseImportsAndComments(code, filePath);

      // Should parse as JavaScript, not CSS
      expect(result).toEqual({
        relative: {},
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 68, end: 75 }],
          },
        },
      });
    });

    it('should handle empty CSS files', async () => {
      const code = '';
      const filePath = '/src/styles/empty.css';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {},
        externals: {},
      });
    });

    it('should handle CSS files with no imports', async () => {
      const code = `
        .header {
          background: blue;
          color: white;
        }
        
        .footer {
          background: gray;
        }
      `;
      const filePath = '/src/styles/components.css';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {},
        externals: {},
      });
    });

    it('should handle unquoted URLs in CSS imports', async () => {
      const code = `
        @import url(reset.css);
        @import url(./local.css);
        @import url(../parent.css);
        @import url(https://fonts.googleapis.com/css2?family=Inter);
        
        body {
          font-family: Arial;
        }
      `;
      const filePath = '/src/styles/main.css';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          'reset.css': {
            url: 'file:///src/styles/reset.css',
            names: [],
            positions: [{ start: 21, end: 30 }],
          },
          './local.css': {
            url: 'file:///src/styles/local.css',
            names: [],
            positions: [{ start: 53, end: 64 }],
          },
          '../parent.css': {
            url: 'file:///src/parent.css',
            names: [],
            positions: [{ start: 87, end: 100 }],
          },
        },
        externals: {
          'https://fonts.googleapis.com/css2?family=Inter': {
            names: [],
            positions: [{ start: 123, end: 169 }],
          },
        },
      });
    });

    it('should correctly distinguish between relative and external CSS imports', async () => {
      const code = `
        /* Relative imports (no protocol/hostname) */
        @import "normalize.css";
        @import "components/buttons.css";
        @import "./local.css";
        @import "../parent.css";
        @import url(reset.css);
        @import url("./styles.css");
        
        /* External imports (with protocol or hostname) */
        @import "https://fonts.googleapis.com/css2?family=Roboto";
        @import url("https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css");
        @import "//fonts.googleapis.com/css2?family=Inter";
        @import url("//cdn.example.com/style.css");
        
        body { font-family: sans-serif; }
      `;
      const filePath = '/src/styles/main.css';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          'normalize.css': {
            url: 'file:///src/styles/normalize.css',
            names: [],
            positions: [{ start: 71, end: 86 }],
          },
          'components/buttons.css': {
            url: 'file:///src/styles/components/buttons.css',
            names: [],
            positions: [{ start: 104, end: 128 }],
          },
          './local.css': {
            url: 'file:///src/styles/local.css',
            names: [],
            positions: [{ start: 146, end: 159 }],
          },
          '../parent.css': {
            url: 'file:///src/parent.css',
            names: [],
            positions: [{ start: 177, end: 192 }],
          },
          'reset.css': {
            url: 'file:///src/styles/reset.css',
            names: [],
            positions: [{ start: 214, end: 223 }],
          },
          './styles.css': {
            url: 'file:///src/styles/styles.css',
            names: [],
            positions: [{ start: 246, end: 260 }],
          },
        },
        externals: {
          'https://fonts.googleapis.com/css2?family=Roboto': {
            names: [],
            positions: [{ start: 347, end: 396 }],
          },
          'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css': {
            names: [],
            positions: [{ start: 418, end: 491 }],
          },
          '//fonts.googleapis.com/css2?family=Inter': {
            names: [],
            positions: [{ start: 510, end: 552 }],
          },
          '//cdn.example.com/style.css': { names: [], positions: [{ start: 574, end: 603 }] },
        },
      });
    });

    it('should handle CSS @import with layer, supports, and media conditions', async () => {
      const code = `
        /* Layer imports */
        @import "base.css" layer;
        @import "components.css" layer(framework.components);
        @import url("utilities.css") layer(utilities);
        
        /* Supports conditions */
        @import "grid.css" supports(display: grid);
        @import "flex.css" supports((display: flex) and (not (display: grid)));
        @import url("modern.css") supports(display: grid) screen;
        
        /* Media queries */
        @import "print.css" print;
        @import "mobile.css" screen and (max-width: 768px);
        @import "desktop.css" screen and (min-width: 769px);
        
        /* Complex combinations */
        @import url("complex.css") layer(components) supports(display: flex) screen and (max-width: 400px);
        @import "external.css" layer(external) supports(display: grid) print;
        @import url("https://external.com/style.css") layer(cdn) supports(display: flex) screen;
        
        body { margin: 0; }
      `;
      const filePath = '/src/styles/main.css';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          'base.css': {
            url: 'file:///src/styles/base.css',
            names: [],
            positions: [{ start: 45, end: 55 }],
          },
          'components.css': {
            url: 'file:///src/styles/components.css',
            names: [],
            positions: [{ start: 79, end: 95 }],
          },
          'utilities.css': {
            url: 'file:///src/styles/utilities.css',
            names: [],
            positions: [{ start: 145, end: 160 }],
          },
          'grid.css': {
            url: 'file:///src/styles/grid.css',
            names: [],
            positions: [{ start: 239, end: 249 }],
          },
          'flex.css': {
            url: 'file:///src/styles/flex.css',
            names: [],
            positions: [{ start: 291, end: 301 }],
          },
          'modern.css': {
            url: 'file:///src/styles/modern.css',
            names: [],
            positions: [{ start: 375, end: 387 }],
          },
          'print.css': {
            url: 'file:///src/styles/print.css',
            names: [],
            positions: [{ start: 474, end: 485 }],
          },
          'mobile.css': {
            url: 'file:///src/styles/mobile.css',
            names: [],
            positions: [{ start: 509, end: 521 }],
          },
          'desktop.css': {
            url: 'file:///src/styles/desktop.css',
            names: [],
            positions: [{ start: 569, end: 582 }],
          },
          'complex.css': {
            url: 'file:///src/styles/complex.css',
            names: [],
            positions: [{ start: 678, end: 691 }],
          },
          'external.css': {
            url: 'file:///src/styles/external.css',
            names: [],
            positions: [{ start: 782, end: 796 }],
          },
        },
        externals: {
          'https://external.com/style.css': { names: [], positions: [{ start: 864, end: 896 }] },
        },
      });
    });

    it('should handle edge cases in CSS @import parsing according to spec', async () => {
      const code = `
        /* String and URL equivalence - these should be treated identically */
        @import "mystyle.css";
        @import url("mystyle.css");
        
        /* Whitespace handling */
        @import    "spaced.css"   ;
        @import url(   "whitespace.css"   )   layer   (   test   )   ;
        
        /* Complex nested conditions */
        @import "conditions.css" supports((selector(h2 > p)) and (font-tech(color-COLRv1)));
        @import "fallback.css" supports(not (display: flex));
        
        /* Layer variations */
        @import "unnamed1.css" layer();
        @import "unnamed2.css" layer;
        @import "named.css" layer(framework.base.utilities);
        
        /* Media query variations */
        @import "multi-media.css" projection, tv;
        @import "handheld.css" handheld and (max-width: 400px);
        @import "orientation.css" screen and (orientation: landscape);
        
        /* File extension variations */
        @import "no-extension";
        @import "styles.min.css";
        @import "nested/deeply/buried.css";
        
        body { color: black; }
      `;
      const filePath = '/src/styles/main.css';
      const result = await parseImportsAndComments(code, filePath);

      // Should treat both string and url() forms identically for the same file
      expect(result.relative['mystyle.css']).toEqual({
        url: 'file:///src/styles/mystyle.css',
        names: [],
        positions: [
          { start: 96, end: 109 },
          { start: 131, end: 144 },
        ],
      });

      // Should handle all the relative imports
      expect(Object.keys(result.relative)).toContain('spaced.css');
      expect(Object.keys(result.relative)).toContain('whitespace.css');
      expect(Object.keys(result.relative)).toContain('conditions.css');
      expect(Object.keys(result.relative)).toContain('fallback.css');
      expect(Object.keys(result.relative)).toContain('unnamed1.css');
      expect(Object.keys(result.relative)).toContain('unnamed2.css');
      expect(Object.keys(result.relative)).toContain('named.css');
      expect(Object.keys(result.relative)).toContain('multi-media.css');
      expect(Object.keys(result.relative)).toContain('handheld.css');
      expect(Object.keys(result.relative)).toContain('orientation.css');
      expect(Object.keys(result.relative)).toContain('no-extension');
      expect(Object.keys(result.relative)).toContain('styles.min.css');
      expect(Object.keys(result.relative)).toContain('nested/deeply/buried.css');

      // Should properly resolve nested paths
      expect(result.relative['nested/deeply/buried.css'].url).toBe(
        'file:///src/styles/nested/deeply/buried.css',
      );

      // Should have no externals since none have protocols/hostnames
      expect(result.externals).toEqual({});
    });

    it('should handle malformed or incomplete CSS @import statements gracefully', async () => {
      const code = `
        @import "valid.css";
        @import /* missing URL */;
        @import "unclosed-quote.css;
        @import url("unclosed-url.css";
        @import url(unquoted-incomplete
        @import "another-valid.css";
        
        body { margin: 0; }
      `;
      const filePath = '/src/styles/main.css';
      const result = await parseImportsAndComments(code, filePath);

      // Should parse the valid imports and gracefully handle the invalid ones
      expect(result.relative['valid.css']).toEqual({
        url: 'file:///src/styles/valid.css',
        names: [],
        positions: [{ start: 17, end: 28 }],
      });
      expect(result.relative['another-valid.css']).toEqual({
        url: 'file:///src/styles/another-valid.css',
        names: [],
        positions: [{ start: 198, end: 217 }],
      });

      // Should not crash or produce invalid results from malformed imports
      expect(result.externals).toEqual({});
    });

    it('should handle URLs with special characters including semicolons and parentheses', async () => {
      const code = `
        /* URLs with semicolons (common in Google Fonts) */
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&display=swap');
        @import "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300;0,400;1,300";
        
        /* URLs with parentheses (less common but valid) */
        @import url('https://example.com/style(version=1).css');
        @import "https://cdn.example.com/fonts(subset=latin).css";
        
        /* Complex query parameters */
        @import url('https://api.example.com/css?param1=value1;param2=value2&format=css');
        
        body { margin: 0; }
      `;
      const filePath = '/src/styles/main.css';
      const result = await parseImportsAndComments(code, filePath);

      // All external URLs should be parsed correctly regardless of special characters
      expect(result.externals).toEqual({
        'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&display=swap': {
          names: [],
          positions: [{ start: 81, end: 160 }],
        },
        'https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300;0,400;1,300': {
          names: [],
          positions: [{ start: 179, end: 259 }],
        },
        'https://example.com/style(version=1).css': {
          names: [],
          positions: [{ start: 350, end: 392 }],
        },
        'https://cdn.example.com/fonts(subset=latin).css': {
          names: [],
          positions: [{ start: 411, end: 460 }],
        },
        'https://api.example.com/css?param1=value1;param2=value2&format=css': {
          names: [],
          positions: [{ start: 530, end: 598 }],
        },
      });

      expect(result.relative).toEqual({});
    });
  });

  // Test cases for MDX file support (code blocks, inline code, etc.)
  describe('MDX file support', () => {
    it('should ignore imports inside triple backtick code blocks in MDX files', async () => {
      const code = `
        import React from 'react';
        import { Button } from '@mui/material';
        
        # My Component Demo
        
        Here's how to use the component:
        
        \`\`\`tsx
        import { FakeComponent } from './fake-component';
        import { AnotherFake } from '../fake-utils';
        
        export default function Example() {
          return <FakeComponent />;
        }
        \`\`\`
        
        The real import below should be parsed:
        
        import { RealComponent } from './real-component';
      `;
      const filePath = '/src/demo.mdx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './real-component': {
            url: 'file:///src/real-component',
            names: [{ name: 'RealComponent', type: 'named' }],
            positions: [{ start: 521, end: 539 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
          '@mui/material': {
            names: [{ name: 'Button', type: 'named' }],
            positions: [{ start: 67, end: 82 }],
          },
        },
      });
    });

    it('should handle multiple code blocks in MDX files', async () => {
      const code = `
        import React from 'react';
        
        # Component Examples
        
        \`\`\`tsx
        import { Fake1 } from './fake1';
        \`\`\`
        
        Some text between code blocks.
        
        \`\`\`jsx  
        import { Fake2 } from './fake2';
        import * as Fake3 from '../fake3';
        \`\`\`
        
        More documentation.
        
        \`\`\`typescript
        // Even this should be ignored
        import { Fake4 } from '@mui/fake';
        \`\`\`
        
        import { ActualImport } from './actual';
      `;
      const filePath = '/src/docs/examples.mdx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './actual': {
            url: 'file:///src/docs/actual',
            names: [{ name: 'ActualImport', type: 'named' }],
            positions: [{ start: 529, end: 539 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle nested code blocks and complex MDX content', async () => {
      const code = `
        import React from 'react';
        import { Typography } from '@mui/material';
        
        # Demo Documentation
        
        Here's a basic example:
        
        \`\`\`tsx
        // This should be ignored
        import { ComponentA } from './ComponentA';
        import { ComponentB } from '../ComponentB';
        
        export default function Demo() {
          return (
            <div>
              <ComponentA />
              {/* Even comments with imports should be ignored */}
              {/* import { CommentComponent } from './comment'; */}
            </div>
          );
        }
        \`\`\`
        
        You can also do this with CSS:
        
        \`\`\`css
        @import url('./fake-styles.css');
        @import 'fake-theme.css';
        
        .container {
          color: blue;
        }
        \`\`\`
        
        And here's a real import that should be parsed:
        import { ActualUtil } from '../utils/actual';
        
        \`\`\`bash
        # Even shell commands with import-like text should be ignored
        npm import fake-package
        import fake-command
        \`\`\`
      `;
      const filePath = '/src/documentation/demo.mdx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          '../utils/actual': {
            url: 'file:///src/utils/actual',
            names: [{ name: 'ActualUtil', type: 'named' }],
            positions: [{ start: 956, end: 973 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
          '@mui/material': {
            names: [{ name: 'Typography', type: 'named' }],
            positions: [{ start: 71, end: 86 }],
          },
        },
      });
    });

    it('should handle malformed or incomplete code blocks gracefully', async () => {
      const code = `
        import React from 'react';
        
        # Demo with Malformed Code
        
        \`\`\`tsx
        import { Fake1 } from './fake1';
        // Missing closing backticks - this whole section until next triple backticks should be ignored
        
        import { Fake2 } from './fake2';
        
        Some text that looks like it's outside but isn't
        import { Fake3 } from './fake3';
        \`\`\`
        
        This import should be parsed:
        import { RealImport } from './real';
        
        \`\`\`
        // Code block with no language specified
        import { Fake4 } from './fake4';
        \`\`\`
        
        // Another unclosed block
        \`\`\`javascript
        import { Fake5 } from './fake5';
        // This continues to end of file since no closing backticks
        
        import { Fake6 } from './fake6';
      `;
      const filePath = '/src/malformed.mdx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './real': {
            url: 'file:///src/real',
            names: [{ name: 'RealImport', type: 'named' }],
            positions: [{ start: 500, end: 508 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should only apply triple backtick logic to .mdx files, not .tsx/.ts files', async () => {
      const code = `
        import React from 'react';
        
        // In a regular TypeScript file, backticks are template literals
        const templateWithImport = \`
          This looks like an import but is in a template literal:
          import { TemplateComponent } from './template';
        \`;
        
        // These "code blocks" should not be treated specially in .tsx files
        // \`\`\`tsx
        import { ShouldBeParsed } from './should-be-parsed';
        // \`\`\`
        
        const anotherTemplate = \`\`\`
          Multi-line template literal
          import { TemplateFake } from './template-fake';
        \`\`\`;
      `;
      const filePath = '/src/component.tsx'; // Not .mdx
      const result = await parseImportsAndComments(code, filePath);

      // In .tsx files, the import inside the "code block" should be parsed
      // because it's not actually a code block, just a template literal
      expect(result).toEqual({
        relative: {
          './should-be-parsed': {
            url: 'file:///src/should-be-parsed',
            names: [{ name: 'ShouldBeParsed', type: 'named' }],
            positions: [{ start: 433, end: 453 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle code blocks with different language identifiers', async () => {
      const code = `
        import React from 'react';
        
        # Multi-Language Examples
        
        \`\`\`tsx
        import { TSXComponent } from './tsx-fake';
        \`\`\`
        
        \`\`\`jsx
        import { JSXComponent } from './jsx-fake';
        \`\`\`
        
        \`\`\`typescript
        import { TypeScriptUtil } from './ts-fake';
        \`\`\`
        
        \`\`\`javascript
        import { JavaScriptUtil } from './js-fake';
        \`\`\`
        
        \`\`\`js
        import { JSUtil } from './js-util-fake';
        \`\`\`
        
        \`\`\`ts
        import { TSUtil } from './ts-util-fake';
        \`\`\`
        
        \`\`\`python
        # Even non-JS languages should be ignored
        import numpy as np
        from pandas import DataFrame
        \`\`\`
        
        \`\`\`css
        @import url('./css-fake.css');
        \`\`\`
        
        \`\`\`html
        <!-- import './html-fake.js' -->
        \`\`\`
        
        import { ActualComponent } from './actual-component';
      `;
      const filePath = '/src/multi-lang.mdx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './actual-component': {
            url: 'file:///src/actual-component',
            names: [{ name: 'ActualComponent', type: 'named' }],
            positions: [{ start: 966, end: 986 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle code blocks mixed with regular template literals', async () => {
      const code = `
        import React from 'react';
        
        # MDX with Mixed Content
        
        Regular template literal (single backticks):
        const singleTemplate = \`import { SingleFake } from './single-fake';\`;
        
        Code block (triple backticks - should be ignored):
        \`\`\`tsx
        import { CodeBlockFake } from './code-block-fake';
        \`\`\`
        
        Another template literal:
        const multiLine = \`
          import { MultiLineFake } from './multi-line-fake';
          console.log('test');
        \`;
        
        import { RealImport } from './real-import';
      `;
      const filePath = '/src/mixed-content.mdx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './real-import': {
            url: 'file:///src/real-import',
            names: [{ name: 'RealImport', type: 'named' }],
            positions: [{ start: 590, end: 605 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle code blocks with inline code and escaped backticks', async () => {
      const code = `
        import React from 'react';
        
        # Complex MDX Content
        
        Here's some inline code: \`import { InlineImport } from './inline';\`
        
        And a code block:
        \`\`\`tsx
        import { BlockImport } from './block';
        
        // Code with escaped backticks
        const str = "This has backticks in it";
        \`\`\`
        
        More inline code: \`const x = 'import fake';\`
        
        import { ActualImport } from './actual';
      `;
      const filePath = '/src/complex.mdx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './actual': {
            url: 'file:///src/actual',
            names: [{ name: 'ActualImport', type: 'named' }],
            positions: [{ start: 473, end: 483 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle empty code blocks and code blocks with only comments', async () => {
      const code = `
        import React from 'react';
        
        # Examples with Empty Blocks
        
        Empty code block:
        \`\`\`tsx
        \`\`\`
        
        Code block with only comments:
        \`\`\`jsx
        // import { CommentedImport } from './commented';
        /* import { BlockCommentImport } from './block-comment'; */
        \`\`\`
        
        Code block with whitespace:
        \`\`\`typescript
        
           
           
        \`\`\`
        
        import { ValidImport } from './valid';
      `;
      const filePath = '/src/empty-blocks.mdx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './valid': {
            url: 'file:///src/valid',
            names: [{ name: 'ValidImport', type: 'named' }],
            positions: [{ start: 502, end: 511 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle code blocks immediately adjacent to each other', async () => {
      const code = `
        import React from 'react';
        
        \`\`\`tsx
        import { First } from './first';
        \`\`\`
        \`\`\`jsx
        import { Second } from './second';
        \`\`\`
        \`\`\`
        import { Third } from './third';
        \`\`\`
        
        import { Actual } from './actual';
      `;
      const filePath = '/src/adjacent.mdx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './actual': {
            url: 'file:///src/actual',
            names: [{ name: 'Actual', type: 'named' }],
            positions: [{ start: 288, end: 298 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle 4+ backticks containing 3 backticks', async () => {
      const code = `
        import React from 'react';
        
        # Four+ Backticks Tests
        
        Four backticks containing triple backticks:
        \`\`\`\`markdown
        Here's how to show code blocks in markdown:
        \`\`\`tsx
        import { ShowcaseComponent } from './showcase';
        \`\`\`
        \`\`\`\`
        
        Five backticks:
        \`\`\`\`\`typescript
        \`\`\`tsx
        import { FiveBackticks } from './five-backticks';
        \`\`\`
        Even nested \`\`\`js code\`\`\` blocks
        \`\`\`\`\`
        
        Six backticks inline: \`\`\`\`\`\`tsx import { Inline6 } from './inline6'; \`\`\`js nested\`\`\`\`\`\`\`\`\`
        
        import { RealImport } from './real-import';
      `;
      const filePath = '/src/four-plus-backticks.mdx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './real-import': {
            url: 'file:///src/real-import',
            names: [{ name: 'RealImport', type: 'named' }],
            positions: [{ start: 656, end: 671 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle the specific case that caused issues: imports with special characters', async () => {
      const code = `
        import React from 'react';
        
        # Component Demo
        
        \`\`\`tsx
        import { ComponentA } from '../components/ComponentA';
        import { ComponentB } from '../utils/ComponentB';
        import * as helpers from '../shared/helpers';
        \`\`\`
        
        import { RealComponent } from './RealComponent';
      `;
      const filePath = '/src/demo/example.mdx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './RealComponent': {
            url: 'file:///src/demo/RealComponent',
            names: [{ name: 'RealComponent', type: 'named' }],
            positions: [{ start: 328, end: 345 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle inline code blocks (triple backticks on same line)', async () => {
      const code = `
        import React from 'react';
        
        # Component Examples
        
        Here's an inline code block: \`\`\`tsx import { InlineComponent } from './inline';\`\`\`
        
        And another: \`\`\`jsx\nimport { AnotherInline } from './another-inline';\n\`\`\`
        
        Multiple on one line: \`\`\`js import a from './a';\`\`\` and \`\`\`ts import b from './b';\`\`\`
        
        import { ActualImport } from './actual';
      `;
      const filePath = '/src/inline-test.mdx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './actual': {
            url: 'file:///src/actual',
            names: [{ name: 'ActualImport', type: 'named' }],
            positions: [{ start: 414, end: 424 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle mixed inline and multiline code blocks', async () => {
      const code = `
        import React from 'react';
        
        # Mixed Code Block Examples
        
        Inline code: \`\`\`tsx import { Inline } from './inline';\`\`\`
        
        Multiline code:
        \`\`\`jsx
        import { Multiline } from './multiline';
        import { Another } from '../another';
        \`\`\`
        
        Another inline: \`\`\`js import { Final } from './final';\`\`\` followed by text.
        
        \`\`\`typescript
        // Complex multiline
        import * as All from '../all';
        import type { Types } from './types';
        \`\`\`
        
        import { RealImport } from './real';
      `;
      const filePath = '/src/mixed-blocks.mdx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './real': {
            url: 'file:///src/real',
            names: [{ name: 'RealImport', type: 'named' }],
            positions: [{ start: 605, end: 613 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });

    it('should handle code blocks with language specifiers containing numbers and special chars', async () => {
      const code = `
        import React from 'react';
        
        # Various Language Specifiers
        
        \`\`\`typescript-4.5
        import { TypeScript45 } from './ts45-fake';
        \`\`\`
        
        \`\`\`jsx-runtime
        import { Runtime } from './runtime-fake';
        \`\`\`
        
        \`\`\`ts-node
        import { TSNode } from './ts-node-fake';
        \`\`\`
        
        \`\`\`javascript+jsx
        import { JSXPlus } from './jsx-plus-fake';
        \`\`\`
        
        Inline: \`\`\`ts-4.9 import { Version } from './version-fake';\`\`\`
        
        import { RealComponent } from './real-component';
      `;
      const filePath = '/src/lang-specifiers.mdx';
      const result = await parseImportsAndComments(code, filePath);

      expect(result).toEqual({
        relative: {
          './real-component': {
            url: 'file:///src/real-component',
            names: [{ name: 'RealComponent', type: 'named' }],
            positions: [{ start: 590, end: 608 }],
          },
        },
        externals: {
          react: {
            names: [{ name: 'React', type: 'default' }],
            positions: [{ start: 27, end: 34 }],
          },
        },
      });
    });
  });
});

describe('parseImportsAndComments with comment stripping', () => {
  // NOTE about line number correlation in comments:
  // The comments object uses ZERO-BASED line numbers as keys.
  // Each key corresponds to the line number in the OUTPUT CODE (after comment removal).
  // For example: { 0: ['comment content'], 1: ['another comment'] } means:
  // - A notable comment was found that would have appeared at output line 0 (first line)
  // - Another notable comment was found that would have appeared at output line 1 (second line)
  // This allows precise correlation between notable comments and the resulting clean code.

  it('should strip single-line comments with matching prefix on their own line', async () => {
    const code = `console.log('codeA');
// @eslint-ignore some rule
console.log('codeB');`;
    // Line mapping: line 0: console.log('codeA'), line 1: comment (stripped), line 2: console.log('codeB')

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@eslint-ignore'],
    });

    expect(result.code).toBe(`console.log('codeA');
console.log('codeB');`);
    expect(result.comments).toEqual({
      1: ['@eslint-ignore some rule'], // Comment from line 1
    });
  });

  it('should strip multi-line comments with matching prefix on their own lines', async () => {
    const code = `console.log('codeA');
/*
@eslint-ignore
some rule
*/
console.log('codeB');`;
    // Line mapping: line 0: console.log('codeA'), lines 1-4: multi-line comment (stripped), line 5: console.log('codeB')

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@eslint-ignore'],
    });

    expect(result.code).toBe(`console.log('codeA');
console.log('codeB');`);
    expect(result.comments).toEqual({
      1: [
        // Multi-line comment started on line 1 - each non-empty line becomes an array entry
        '@eslint-ignore',
        'some rule',
      ],
    });
  });

  it('should handle inline single-line comments by removing just the comment', async () => {
    const code = `console.log('codeA'); // @eslint-ignore some rule
console.log('codeB');`;
    // Line mapping: line 0: console.log with inline comment (comment stripped), line 1: console.log('codeB')

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@eslint-ignore'],
    });

    expect(result.code).toBe(`console.log('codeA');
console.log('codeB');`);
    expect(result.comments).toEqual({
      0: ['@eslint-ignore some rule'], // Inline comment from line 0
    });
  });

  it('should not strip comments that do not match whitelist prefixes', async () => {
    const code = `console.log('codeA');
// @other-comment
// Regular comment
console.log('codeB');`;

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@eslint-ignore'],
    });

    // No comments match the prefix, so code is not returned (nothing was stripped)
    expect(result.code).toBeUndefined();
    expect(result.comments).toBeUndefined();
  });

  it('should handle multiple prefixes in whitelist', async () => {
    const code = `console.log('codeA');
// @eslint-ignore some rule
// @ts-ignore
console.log('codeB');`;

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@eslint-ignore', '@ts-ignore'],
    });

    expect(result.code).toBe(`console.log('codeA');
console.log('codeB');`);
    expect(result.comments).toEqual({
      1: ['@eslint-ignore some rule', '@ts-ignore'],
    });
  });

  it('should handle multiple comments on separate lines', async () => {
    const code = `console.log('codeA');
/* @eslint-ignore rule1 */
// @ts-ignore type
console.log('codeB');`;
    // Line mapping: line 0: console.log('codeA'), line 1: comment (stripped), line 2: comment (stripped), line 3: console.log('codeB')

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@eslint-ignore', '@ts-ignore'],
    });

    expect(result.code).toBe(`console.log('codeA');
console.log('codeB');`);
    expect(result.comments).toEqual({
      1: ['@eslint-ignore rule1', '@ts-ignore type'], // Both comments correlate to output line 1
    });
  });

  it('should handle multi-line comments that span multiple lines', async () => {
    const code = `console.log('before');
/*
@eslint-ignore
This is a long
multi-line comment
*/
console.log('after');`;

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@eslint-ignore'],
    });

    expect(result.code).toBe(`console.log('before');
console.log('after');`);
    expect(result.comments).toEqual({
      1: ['@eslint-ignore', 'This is a long', 'multi-line comment'],
    });
  });

  it('should not strip comments inside strings', async () => {
    const code = `const str1 = "// @eslint-ignore fake";
const str2 = '/* @eslint-ignore fake */';
// @eslint-ignore real
console.log('test');`;

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@eslint-ignore'],
    });

    expect(result.code).toBe(`const str1 = "// @eslint-ignore fake";
const str2 = '/* @eslint-ignore fake */';
console.log('test');`);
    expect(result.comments).toEqual({
      2: ['@eslint-ignore real'],
    });
  });

  it('should not strip comments inside template literals', async () => {
    const code = `const template = \`
// @eslint-ignore fake
/* @eslint-ignore fake */
\`;
// @eslint-ignore real
console.log('done');`;

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@eslint-ignore'],
    });

    expect(result.code).toBe(`const template = \`
// @eslint-ignore fake
/* @eslint-ignore fake */
\`;
console.log('done');`);
    expect(result.comments).toEqual({
      4: ['@eslint-ignore real'],
    });
  });

  it('should handle the example scenario from the user request', async () => {
    const code = `console.log('codeA');
/*
comment
*/
console.log('codeB');`;

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['comment'],
    });

    expect(result.code).toBe(`console.log('codeA');
console.log('codeB');`);
    expect(result.comments).toEqual({
      1: ['comment'],
    });
  });

  it('should handle complex mixed scenarios with imports and comments', async () => {
    const code = `import React from 'react';
function test() {
  // @eslint-ignore complexity
  if (condition) {
    /* @ts-ignore type issue */
    doSomething();
  }
  return result;
}`;
    // Line mapping: line 0: import, line 1: function, line 2: comment (stripped), line 3: if, line 4: comment (stripped), line 5: doSomething, etc.

    const result = await parseImportsAndComments(code, '/src/test.tsx', {
      removeCommentsWithPrefix: ['@eslint-ignore', '@ts-ignore'],
    });

    expect(result.code).toBe(`import React from 'react';
function test() {
  if (condition) {
    doSomething();
  }
  return result;
}`);
    expect(result.comments).toEqual({
      2: ['@eslint-ignore complexity'], // Comment from output line 2
      3: ['@ts-ignore type issue'], // Comment from output line 3
    });
    expect(result.externals).toEqual({
      react: { names: [{ name: 'React', type: 'default' }], positions: [{ start: 18, end: 25 }] },
    });
  });

  it('should handle whitespace-only lines with comments', async () => {
    const code = `console.log('before');
   // @eslint-ignore with leading spaces
	// @ts-ignore with leading tab
console.log('after');`;

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@eslint-ignore', '@ts-ignore'],
    });

    expect(result.code).toBe(`console.log('before');
console.log('after');`);
    expect(result.comments).toEqual({
      1: ['@eslint-ignore with leading spaces', '@ts-ignore with leading tab'],
    });
  });

  it('should parse imports and strip comments simultaneously', async () => {
    const code = `import React from 'react';
// @eslint-ignore import-order
import { Button } from '@mui/material';
import { Component } from './Component';
// @ts-ignore missing types
const x = 42;`;

    const result = await parseImportsAndComments(code, '/src/test.tsx', {
      removeCommentsWithPrefix: ['@eslint-ignore', '@ts-ignore'],
    });

    expect(result.relative).toEqual({
      './Component': {
        url: 'file:///src/Component',
        names: [{ name: 'Component', type: 'named' }],
        positions: [{ start: 93, end: 106 }],
      },
    });

    expect(result.externals).toEqual({
      react: { names: [{ name: 'React', type: 'default' }], positions: [{ start: 18, end: 25 }] },
      '@mui/material': {
        names: [{ name: 'Button', type: 'named' }],
        positions: [{ start: 50, end: 65 }],
      },
    });

    expect(result.code).toBe(`import React from 'react';
import { Button } from '@mui/material';
import { Component } from './Component';
const x = 42;`);

    expect(result.comments).toEqual({
      1: ['@eslint-ignore import-order'],
      3: ['@ts-ignore missing types'],
    });
  });

  it('should not return code or comments when no whitelist provided', async () => {
    const code = `import React from 'react';
// @eslint-ignore import-order
import { Button } from '@mui/material';`;

    const result = await parseImportsAndComments(code, '/src/test.tsx');

    expect(result.code).toBeUndefined();
    expect(result.comments).toBeUndefined();
    expect(result.externals).toEqual({
      react: { names: [{ name: 'React', type: 'default' }], positions: [{ start: 18, end: 25 }] },
      '@mui/material': {
        names: [{ name: 'Button', type: 'named' }],
        positions: [{ start: 81, end: 96 }],
      },
    });
  });
});

describe('parseImportsAndComments CSS with comment stripping', () => {
  it('should strip single-line CSS comments with matching prefix', async () => {
    const code = `/* @css-ignore some rule */
@import "styles.css";
// @css-ignore another rule
@import url("theme.css");`;
    // Line mapping: line 0: comment (stripped), line 1: @import styles.css, line 2: comment (stripped), line 3: @import theme.css

    const result = await parseImportsAndComments(code, '/src/test.css', {
      removeCommentsWithPrefix: ['@css-ignore'],
    });

    expect(result.code).toBe(`@import "styles.css";
@import url("theme.css");`);
    expect(result.comments).toEqual({
      0: ['@css-ignore some rule'], // Comment correlates to output line 0
      1: ['@css-ignore another rule'], // Comment correlates to output line 1
    });
    expect(result.relative).toEqual({
      'styles.css': {
        url: 'file:///src/styles.css',
        names: [],
        positions: [{ start: 8, end: 20 }],
      },
      'theme.css': { url: 'file:///src/theme.css', names: [], positions: [{ start: 34, end: 45 }] },
    });
  });

  it('should strip multi-line CSS comments with matching prefix', async () => {
    const code = `@import "base.css";
/*
@css-ignore
disable this import temporarily
*/
/* Regular comment */
@import "theme.css";`;

    const result = await parseImportsAndComments(code, '/src/test.css', {
      removeCommentsWithPrefix: ['@css-ignore'],
    });

    expect(result.code).toBe(`@import "base.css";
/* Regular comment */
@import "theme.css";`);
    expect(result.comments).toEqual({
      1: ['@css-ignore', 'disable this import temporarily'],
    });
    expect(result.relative).toEqual({
      'base.css': { url: 'file:///src/base.css', names: [], positions: [{ start: 8, end: 18 }] },
      'theme.css': { url: 'file:///src/theme.css', names: [], positions: [{ start: 50, end: 61 }] },
    });
  });

  it('should handle inline CSS comments', async () => {
    const code = `@import "styles.css"; /* @css-ignore inline comment */
@import "theme.css"; /* keep this comment */`;

    const result = await parseImportsAndComments(code, '/src/test.css', {
      removeCommentsWithPrefix: ['@css-ignore'],
    });

    expect(result.code).toBe(`@import "styles.css";
@import "theme.css"; /* keep this comment */`);
    expect(result.comments).toEqual({
      0: ['@css-ignore inline comment'],
    });
    expect(result.relative).toEqual({
      'styles.css': {
        url: 'file:///src/styles.css',
        names: [],
        positions: [{ start: 8, end: 20 }],
      },
      'theme.css': { url: 'file:///src/theme.css', names: [], positions: [{ start: 30, end: 41 }] },
    });
  });

  it('should not strip CSS comments without matching prefix', async () => {
    const code = `/* Regular comment */
@import "styles.css";
// Another regular comment
@import url("theme.css");`;

    const result = await parseImportsAndComments(code, '/src/test.css', {
      removeCommentsWithPrefix: ['@css-ignore'],
    });

    // No comments match the prefix, so code should not be returned (nothing stripped)
    expect(result.code).toBeUndefined();
    expect(result.comments).toBeUndefined();
    expect(result.relative).toEqual({
      'styles.css': {
        url: 'file:///src/styles.css',
        names: [],
        // Original positions (no stripping)
        positions: [{ start: 30, end: 42 }],
      },
      'theme.css': { url: 'file:///src/theme.css', names: [], positions: [{ start: 83, end: 94 }] },
    });
  });

  it('should work without comment stripping options for CSS', async () => {
    const code = `/* @css-ignore some rule */
@import "styles.css";`;

    const result = await parseImportsAndComments(code, '/src/test.css');

    expect(result.code).toBeUndefined();
    expect(result.comments).toBeUndefined();
    expect(result.relative).toEqual({
      'styles.css': {
        url: 'file:///src/styles.css',
        names: [],
        positions: [{ start: 36, end: 48 }],
      },
    });
  });
});

describe('parseImportsAndComments with notableCommentsPrefix', () => {
  it('should collect only notable comments when notableCommentsPrefix is specified', async () => {
    const code = `console.log('codeA');
// @important this is important
// @eslint-ignore some rule
// @ts-ignore type issue
console.log('codeB');`;

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@eslint-ignore', '@ts-ignore', '@important'],
      notableCommentsPrefix: ['@important'],
    });

    expect(result.code).toBe(`console.log('codeA');
console.log('codeB');`);
    // Only the @important comment should be collected
    expect(result.comments).toEqual({
      1: ['@important this is important'],
    });
  });

  it('should collect all stripped comments when notableCommentsPrefix is not specified', async () => {
    const code = `console.log('codeA');
// @important this is important
// @eslint-ignore some rule
console.log('codeB');`;

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@eslint-ignore', '@important'],
    });

    expect(result.code).toBe(`console.log('codeA');
console.log('codeB');`);
    // All stripped comments should be collected
    expect(result.comments).toEqual({
      1: ['@important this is important', '@eslint-ignore some rule'],
    });
  });

  it('should handle multiple notableCommentsPrefix values', async () => {
    const code = `console.log('codeA');
// @todo implement this later
// @fixme broken implementation
// @eslint-ignore some rule
console.log('codeB');`;

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@todo', '@fixme', '@eslint-ignore'],
      notableCommentsPrefix: ['@todo', '@fixme'],
    });

    expect(result.code).toBe(`console.log('codeA');
console.log('codeB');`);
    // Only @todo and @fixme comments should be collected
    expect(result.comments).toEqual({
      1: ['@todo implement this later', '@fixme broken implementation'],
    });
  });

  it('should handle comments that match notable prefix but are not stripped', async () => {
    const code = `console.log('codeA');
// @important this is important
// @eslint-ignore some rule
// @keep this comment
console.log('codeB');`;

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@eslint-ignore'],
      notableCommentsPrefix: ['@important'],
    });

    expect(result.code).toBe(`console.log('codeA');
// @important this is important
// @keep this comment
console.log('codeB');`);
    // Notable comments should be collected even when they're not stripped
    expect(result.comments).toEqual({
      1: ['@important this is important'],
    });
  });

  it('should handle multi-line notable comments', async () => {
    const code = `console.log('codeA');
/*
@todo
implement this feature
with proper error handling
*/
console.log('codeB');`;

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      removeCommentsWithPrefix: ['@todo'],
      notableCommentsPrefix: ['@todo'],
    });

    expect(result.code).toBe(`console.log('codeA');
console.log('codeB');`);
    expect(result.comments).toEqual({
      1: ['@todo', 'implement this feature', 'with proper error handling'],
    });
  });

  it('should work with imports and notable comments together', async () => {
    const code = `import React from 'react';
// @todo add better prop types
import { Button } from '@mui/material';
// @fixme handle edge case
import { Component } from './Component';`;

    const result = await parseImportsAndComments(code, '/src/test.tsx', {
      removeCommentsWithPrefix: ['@todo', '@fixme'],
      notableCommentsPrefix: ['@todo'],
    });

    expect(result.relative).toEqual({
      './Component': {
        url: 'file:///src/Component',
        names: [{ name: 'Component', type: 'named' }],
        positions: [{ start: 93, end: 106 }],
      },
    });

    expect(result.externals).toEqual({
      react: { names: [{ name: 'React', type: 'default' }], positions: [{ start: 18, end: 25 }] },
      '@mui/material': {
        names: [{ name: 'Button', type: 'named' }],
        positions: [{ start: 50, end: 65 }],
      },
    });

    expect(result.code).toBe(`import React from 'react';
import { Button } from '@mui/material';
import { Component } from './Component';`);

    // Only @todo comments should be collected
    expect(result.comments).toEqual({
      1: ['@todo add better prop types'],
    });
  });

  it('should handle CSS files with notableCommentsPrefix', async () => {
    const code = `/* @todo update colors */
@import "base.css";
/* @fixme broken import */
@import "theme.css";`;

    const result = await parseImportsAndComments(code, '/src/test.css', {
      removeCommentsWithPrefix: ['@todo', '@fixme'],
      notableCommentsPrefix: ['@todo'],
    });

    expect(result.code).toBe(`@import "base.css";
@import "theme.css";`);
    expect(result.comments).toEqual({
      0: ['@todo update colors'],
    });
    expect(result.relative).toEqual({
      'base.css': { url: 'file:///src/base.css', names: [], positions: [{ start: 8, end: 18 }] },
      'theme.css': { url: 'file:///src/theme.css', names: [], positions: [{ start: 28, end: 39 }] },
    });
  });

  it('should collect comments but not return code when notableCommentsPrefix is provided but removeCommentsWithPrefix is not', async () => {
    const code = `console.log('codeA');
// @important this is important
// @todo implement this later
console.log('codeB');`;

    const result = await parseImportsAndComments(code, '/src/test.ts', {
      notableCommentsPrefix: ['@important', '@todo'],
    });

    // Should NOT return code since nothing was stripped
    expect(result.code).toBeUndefined();
    // But SHOULD collect notable comments
    expect(result.comments).toEqual({
      1: ['@important this is important'],
      2: ['@todo implement this later'],
    });
    expect(result.relative).toEqual({});
    expect(result.externals).toEqual({});
  });

  it('should collect CSS comments but not return code when notableCommentsPrefix is provided but removeCommentsWithPrefix is not', async () => {
    const code = `/* @todo update colors */
@import "base.css";
/* @important critical fix */
@import "theme.css";`;

    const result = await parseImportsAndComments(code, '/src/test.css', {
      notableCommentsPrefix: ['@todo', '@important'],
    });

    // Should NOT return code since nothing was stripped
    expect(result.code).toBeUndefined();
    // But SHOULD collect notable comments
    expect(result.comments).toEqual({
      0: ['@todo update colors'],
      2: ['@important critical fix'],
    });
    // Positions should work on the original code (since code is undefined)
    expect(result.relative).toEqual({
      'base.css': { url: 'file:///src/base.css', names: [], positions: [{ start: 34, end: 44 }] },
      'theme.css': { url: 'file:///src/theme.css', names: [], positions: [{ start: 84, end: 95 }] },
    });
    expect(result.externals).toEqual({});
  });

  it('should strip JSX comment syntax {/* comment */} on its own line', async () => {
    const code = `function Component() {
  return (
    <div>
      {/* @highlight-start */}
      <h1>Title</h1>
      {/* @highlight-end */}
    </div>
  );
}`;

    const result = await parseImportsAndComments(code, '/src/test.tsx', {
      removeCommentsWithPrefix: ['@highlight'],
    });

    // JSX comments with braces should be completely stripped when on their own line
    expect(result.code).toBe(`function Component() {
  return (
    <div>
      <h1>Title</h1>
    </div>
  );
}`);
    // Line numbers are in the OUTPUT code (after stripping)
    // Line 3 is where @highlight-start was (now stripped)
    // Line 4 is where @highlight-end was (in output, after first line stripped)
    expect(result.comments).toEqual({
      3: ['@highlight-start'],
      4: ['@highlight-end'],
    });
  });

  it('should keep JSX comment syntax when inline with other content', async () => {
    const code = `function Component() {
  return <h1>{/* @highlight */}Title</h1>;
}`;

    const result = await parseImportsAndComments(code, '/src/test.tsx', {
      removeCommentsWithPrefix: ['@highlight'],
    });

    // Inline JSX comments should strip the comment and surrounding braces
    expect(result.code).toBe(`function Component() {
  return <h1>Title</h1>;
}`);
    expect(result.comments).toEqual({
      1: ['@highlight'],
    });
  });

  it('should keep JSX expression content when stripping inline comment', async () => {
    const code = `function Component() {
  return <h1>{value /* @highlight */}</h1>;
}`;

    const result = await parseImportsAndComments(code, '/src/test.tsx', {
      removeCommentsWithPrefix: ['@highlight'],
    });

    // Should strip only the comment, keeping {value}
    expect(result.code).toBe(`function Component() {
  return <h1>{value}</h1>;
}`);
    expect(result.comments).toEqual({
      1: ['@highlight'],
    });
  });

  it('should strip JSX comment at end of line with element', async () => {
    const code = `function Component() {
  return (
    <div>
      <Footer /> {/* @highlight */}
    </div>
  );
}`;

    const result = await parseImportsAndComments(code, '/src/test.tsx', {
      removeCommentsWithPrefix: ['@highlight'],
    });

    // Should strip the comment AND the braces since they're empty
    expect(result.code).toBe(`function Component() {
  return (
    <div>
      <Footer />
    </div>
  );
}`);
    expect(result.comments).toEqual({
      3: ['@highlight'],
    });
  });

  it('should trim trailing whitespace when stripping single-line comments', async () => {
    const code = `const [data, setData] = useState([]); // @highlight
const x = 42;`;

    const result = await parseImportsAndComments(code, '/src/test.tsx', {
      removeCommentsWithPrefix: ['@highlight'],
    });

    // Should strip the comment AND trailing whitespace before it
    expect(result.code).toBe(`const [data, setData] = useState([]);
const x = 42;`);
    expect(result.comments).toEqual({
      0: ['@highlight'],
    });
  });

  it('should return correct positions when removeCommentsWithPrefix is enabled but no comments exist', async () => {
    const code = `'use client';
import styles from './TextInputCopy.module.css';`;

    const result = await parseImportsAndComments(code, '/src/test.tsx', {
      removeCommentsWithPrefix: ['@highlight'],
    });

    // The positions should correctly extract the import path from the PROCESSED code
    const cssImport = result.relative['./TextInputCopy.module.css'];
    expect(cssImport).toBeDefined();
    const pos = cssImport.positions[0];
    const codeToUse = result.code ?? code;
    const extracted = codeToUse.slice(pos.start, pos.end);
    expect(extracted).toBe("'./TextInputCopy.module.css'");
  });

  it('should return correct positions when comments ARE stripped (JS)', async () => {
    const code = `// @highlight
import { foo } from './foo';
import { bar } from './bar';`;

    const result = await parseImportsAndComments(code, '/src/test.tsx', {
      removeCommentsWithPrefix: ['@highlight'],
    });

    // The comment is stripped, so the processed code is different
    expect(result.code).toBe(`import { foo } from './foo';
import { bar } from './bar';`);

    // Verify positions work correctly in the PROCESSED code
    const fooImport = result.relative['./foo'];
    expect(fooImport).toBeDefined();
    const fooPos = fooImport.positions[0];
    expect(result.code!.slice(fooPos.start, fooPos.end)).toBe("'./foo'");

    const barImport = result.relative['./bar'];
    expect(barImport).toBeDefined();
    const barPos = barImport.positions[0];
    expect(result.code!.slice(barPos.start, barPos.end)).toBe("'./bar'");
  });

  it('should return correct positions when comments ARE stripped (CSS)', async () => {
    const code = `/* @css-ignore */
@import "base.css";
@import "theme.css";`;

    const result = await parseImportsAndComments(code, '/src/test.css', {
      removeCommentsWithPrefix: ['@css-ignore'],
    });

    // The comment is stripped
    expect(result.code).toBe(`@import "base.css";
@import "theme.css";`);

    // Verify positions work correctly in the PROCESSED code
    const baseImport = result.relative['base.css'];
    expect(baseImport).toBeDefined();
    const basePos = baseImport.positions[0];
    expect(result.code!.slice(basePos.start, basePos.end)).toBe('"base.css"');

    const themeImport = result.relative['theme.css'];
    expect(themeImport).toBeDefined();
    const themePos = themeImport.positions[0];
    expect(result.code!.slice(themePos.start, themePos.end)).toBe('"theme.css"');
  });

  it('should return correct positions when notable comments are collected but NOT removed', async () => {
    // notableCommentsPrefix without removeCommentsWithPrefix means comments are collected but kept
    const code = `'use client';
// @highlight this line
import styles from './TextInputCopy.module.css';`;

    const result = await parseImportsAndComments(code, '/src/test.tsx', {
      notableCommentsPrefix: ['@highlight'],
      // Note: no removeCommentsWithPrefix - comments are kept, code unchanged
    });

    // Code shouldn't be returned since nothing changed
    expect(result.code).toBeUndefined();

    // Positions should work on the original code
    const cssImport = result.relative['./TextInputCopy.module.css'];
    expect(cssImport).toBeDefined();
    const pos = cssImport.positions[0];
    expect(code.slice(pos.start, pos.end)).toBe("'./TextInputCopy.module.css'");
  });

  it('should handle both notable and removed comments together', async () => {
    const code = `'use client';
// @highlight this line
// @eslint-ignore some-rule
import styles from './TextInputCopy.module.css';`;

    const result = await parseImportsAndComments(code, '/src/test.tsx', {
      removeCommentsWithPrefix: ['@eslint-ignore'],
      notableCommentsPrefix: ['@highlight'],
    });

    // Code should be returned with @eslint-ignore removed
    expect(result.code).toBe(`'use client';
// @highlight this line
import styles from './TextInputCopy.module.css';`);

    // @highlight is notable so it's collected; @eslint-ignore is stripped but not notable
    expect(result.comments).toEqual({
      1: ['@highlight this line'],
    });

    // Positions should work on the PROCESSED code
    const cssImport = result.relative['./TextInputCopy.module.css'];
    expect(cssImport).toBeDefined();
    const pos = cssImport.positions[0];
    expect(result.code!.slice(pos.start, pos.end)).toBe("'./TextInputCopy.module.css'");
  });

  it('should not return code when removeCommentsWithPrefix is provided but no comments match', async () => {
    const code = `'use client';
// This is a regular comment
import styles from './TextInputCopy.module.css';`;

    const result = await parseImportsAndComments(code, '/src/test.tsx', {
      removeCommentsWithPrefix: ['@eslint-ignore'], // No comments match this prefix
    });

    // Nothing was stripped, so code should not be returned
    expect(result.code).toBeUndefined();

    // Positions should work on the original code
    const cssImport = result.relative['./TextInputCopy.module.css'];
    expect(cssImport).toBeDefined();
    const pos = cssImport.positions[0];
    expect(code.slice(pos.start, pos.end)).toBe("'./TextInputCopy.module.css'");
  });

  it('should not return code when both prefixes provided but no comments match either', async () => {
    const code = `'use client';
// This is a regular comment
import styles from './TextInputCopy.module.css';`;

    const result = await parseImportsAndComments(code, '/src/test.tsx', {
      removeCommentsWithPrefix: ['@eslint-ignore'],
      notableCommentsPrefix: ['@highlight'],
    });

    // Nothing was stripped or collected, so code should not be returned
    expect(result.code).toBeUndefined();
    expect(result.comments).toBeUndefined();

    // Positions should work on the original code
    const cssImport = result.relative['./TextInputCopy.module.css'];
    expect(cssImport).toBeDefined();
    const pos = cssImport.positions[0];
    expect(code.slice(pos.start, pos.end)).toBe("'./TextInputCopy.module.css'");
  });
});
