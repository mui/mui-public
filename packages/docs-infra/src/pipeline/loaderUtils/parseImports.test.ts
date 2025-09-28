import { describe, expect, it } from 'vitest';
import { parseImports } from './parseImports';

describe('parseImports', () => {
  it('should resolve relative import paths and group by import path', async () => {
    const code = `
      import Component1 from './Component1';
      import { Component2, Component3 } from './components';
      import * as Utils from '../utils';
    `;
    const filePath = '/src/demo.ts';
    const result = await parseImports(code, filePath);

    expect(result).toEqual({
      relative: {
        './Component1': {
          path: '/src/Component1',
          names: [{ name: 'Component1', type: 'default' }],
        },
        './components': {
          path: '/src/components',
          names: [
            { name: 'Component2', type: 'named' },
            { name: 'Component3', type: 'named' },
          ],
        },
        '../utils': {
          path: '/utils',
          names: [{ name: 'Utils', type: 'namespace' }],
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
    const result = await parseImports(code, filePath);

    expect(result).toEqual({
      relative: {
        './Component': { path: '/src/Component', names: [{ name: 'Component', type: 'default' }] },
      },
      externals: {
        react: { names: [{ name: 'React', type: 'default' }] },
        '@mui/material': { names: [{ name: 'Button', type: 'named' }] },
      },
    });
  });

  it('should handle empty code', async () => {
    const code = '';
    const filePath = '/src/demo.ts';
    const result = await parseImports(code, filePath);

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
    const result = await parseImports(code, filePath);

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
    const result = await parseImports(code, filePath);

    expect(result).toEqual({
      relative: {
        './default': {
          path: '/src/default',
          names: [{ name: 'DefaultImport', type: 'default' }],
        },
        './named': {
          path: '/src/named',
          names: [
            { name: 'NamedImport1', type: 'named' },
            { name: 'NamedImport2', type: 'named' },
          ],
        },
        './namespace': {
          path: '/src/namespace',
          names: [{ name: 'NamespaceImport', type: 'namespace' }],
        },
        './aliased': {
          path: '/src/aliased',
          names: [{ name: 'NamedImport3', alias: 'AliasedImport', type: 'named' }],
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
    const result = await parseImports(code, filePath);

    expect(result).toEqual({
      relative: {
        '../../../shared/components/Component': {
          path: '/src/shared/components/Component',
          names: [{ name: 'Component', type: 'default' }],
        },
        '../../utils/helpers': {
          path: '/src/features/utils/helpers',
          names: [{ name: 'Utils', type: 'default' }],
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
    const result = await parseImports(code, filePath);

    // Type imports should have includeTypeDefs: true
    expect(result).toEqual({
      relative: {
        './types': {
          path: '/src/types',
          names: [{ name: 'TypeDef', type: 'named', isType: true }],
          includeTypeDefs: true,
        },
        './defaultTypes': {
          path: '/src/defaultTypes',
          names: [{ name: 'DefaultType', type: 'default', isType: true }],
          includeTypeDefs: true,
        },
        './component': {
          path: '/src/component',
          names: [{ name: 'Component', type: 'named' }],
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
    const result = await parseImports(code, filePath);

    // Should create separate entries for type and value imports
    expect(result).toEqual({
      relative: {
        './Component': {
          path: '/src/Component',
          names: [
            { name: 'Props', type: 'named', isType: true },
            { name: 'Component', type: 'named' },
          ],
          includeTypeDefs: true,
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
    const result = await parseImports(code, filePath);

    expect(result).toEqual({
      relative: {
        './styles.css': {
          path: '/src/styles.css',
          names: [],
        },
        '../utils/polyfills': {
          path: '/utils/polyfills',
          names: [],
        },
      },
      externals: {
        'some-external-module/setup': {
          names: [],
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './empty-exports': {
            path: '/src/empty-exports',
            names: [],
          },
          './comment-only': {
            path: '/src/comment-only',
            names: [],
          },
          './side-effect': {
            path: '/src/side-effect',
            names: [],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

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
        path: '/src/types',
        names: [{ name: 'Types', type: 'namespace', isType: true }],
        includeTypeDefs: true,
      });

      expect(result.relative['./utils']).toEqual({
        path: '/src/utils',
        names: [{ name: 'Utils', type: 'namespace' }],
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
      const result = await parseImports(code, filePath);

      // parseImports should handle the duplicates and produce a consolidated structure
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
      const result = await parseImports(code, filePath);

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
      const result = await parseImports(code, filePath);

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
        path: '/src/empty-types',
        names: [],
        includeTypeDefs: true,
      });

      expect(result.relative['./empty-runtime']).toEqual({
        path: '/src/empty-runtime',
        names: [],
      });

      expect(result.relative['./side-effect.css']).toEqual({
        path: '/src/side-effect.css',
        names: [],
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
      const result = await parseImports(code, filePath);

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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {},
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {},
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {},
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {},
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {},
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {},
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './real-module': {
            path: '/src/real-module',
            names: [{ name: 'AnotherReal', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
          '@mui/material': { names: [{ name: 'RealButton', type: 'named' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './Component': {
            path: '/src/Component',
            names: [{ name: 'Component', type: 'default' }],
          },
          './styles.css': {
            path: '/src/styles.css',
            names: [],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
          '@mui/material': { names: [{ name: 'Button', type: 'named' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './actual': {
            path: '/src/actual',
            names: [{ name: 'ActualComponent', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './real-component': {
            path: '/src/real-component',
            names: [{ name: 'RealComponent', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          'reset.css': {
            path: '/src/styles/reset.css',
            names: [],
          },
          './components/buttons.css': {
            path: '/src/styles/components/buttons.css',
            names: [],
          },
          '../shared/layout.css': {
            path: '/src/shared/layout.css',
            names: [],
          },
        },
        externals: {
          'https://fonts.googleapis.com/css2?family=Roboto': { names: [] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          'normalize.css': {
            path: '/src/styles/normalize.css',
            names: [],
          },
          './variables.css': {
            path: '/src/styles/variables.css',
            names: [],
          },
          '../themes/dark.css': {
            path: '/src/themes/dark.css',
            names: [],
          },
        },
        externals: {
          '//cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css': { names: [] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          'print.css': {
            path: '/src/styles/print.css',
            names: [],
          },
          'mobile.css': {
            path: '/src/styles/mobile.css',
            names: [],
          },
          'desktop.css': {
            path: '/src/styles/desktop.css',
            names: [],
          },
        },
        externals: {
          'https://fonts.googleapis.com/css2?family=Roboto': { names: [] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          'real.css': {
            path: '/src/styles/real.css',
            names: [],
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          'local1.css': {
            path: '/src/components/local1.css',
            names: [],
          },
          './local2.css': {
            path: '/src/components/local2.css',
            names: [],
          },
          './local3.css': {
            path: '/src/components/local3.css',
            names: [],
          },
          'local4.css': {
            path: '/src/components/local4.css',
            names: [],
          },
          '../parent/shared.css': {
            path: '/src/parent/shared.css',
            names: [],
          },
        },
        externals: {
          'https://external.com/style.css': { names: [] },
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
      const result = await parseImports(code, filePath);

      // Should parse as JavaScript, not CSS
      expect(result).toEqual({
        relative: {},
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
        },
      });
    });

    it('should handle empty CSS files', async () => {
      const code = '';
      const filePath = '/src/styles/empty.css';
      const result = await parseImports(code, filePath);

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
      const result = await parseImports(code, filePath);

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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          'reset.css': {
            path: '/src/styles/reset.css',
            names: [],
          },
          './local.css': {
            path: '/src/styles/local.css',
            names: [],
          },
          '../parent.css': {
            path: '/src/parent.css',
            names: [],
          },
        },
        externals: {
          'https://fonts.googleapis.com/css2?family=Inter': { names: [] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          'normalize.css': {
            path: '/src/styles/normalize.css',
            names: [],
          },
          'components/buttons.css': {
            path: '/src/styles/components/buttons.css',
            names: [],
          },
          './local.css': {
            path: '/src/styles/local.css',
            names: [],
          },
          '../parent.css': {
            path: '/src/parent.css',
            names: [],
          },
          'reset.css': {
            path: '/src/styles/reset.css',
            names: [],
          },
          './styles.css': {
            path: '/src/styles/styles.css',
            names: [],
          },
        },
        externals: {
          'https://fonts.googleapis.com/css2?family=Roboto': { names: [] },
          'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css': { names: [] },
          '//fonts.googleapis.com/css2?family=Inter': { names: [] },
          '//cdn.example.com/style.css': { names: [] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          'base.css': {
            path: '/src/styles/base.css',
            names: [],
          },
          'components.css': {
            path: '/src/styles/components.css',
            names: [],
          },
          'utilities.css': {
            path: '/src/styles/utilities.css',
            names: [],
          },
          'grid.css': {
            path: '/src/styles/grid.css',
            names: [],
          },
          'flex.css': {
            path: '/src/styles/flex.css',
            names: [],
          },
          'modern.css': {
            path: '/src/styles/modern.css',
            names: [],
          },
          'print.css': {
            path: '/src/styles/print.css',
            names: [],
          },
          'mobile.css': {
            path: '/src/styles/mobile.css',
            names: [],
          },
          'desktop.css': {
            path: '/src/styles/desktop.css',
            names: [],
          },
          'complex.css': {
            path: '/src/styles/complex.css',
            names: [],
          },
          'external.css': {
            path: '/src/styles/external.css',
            names: [],
          },
        },
        externals: {
          'https://external.com/style.css': { names: [] },
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
      const result = await parseImports(code, filePath);

      // Should treat both string and url() forms identically for the same file
      expect(result.relative['mystyle.css']).toEqual({
        path: '/src/styles/mystyle.css',
        names: [],
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
      expect(result.relative['nested/deeply/buried.css'].path).toBe(
        '/src/styles/nested/deeply/buried.css',
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
      const result = await parseImports(code, filePath);

      // Should parse the valid imports and gracefully handle the invalid ones
      expect(result.relative['valid.css']).toEqual({
        path: '/src/styles/valid.css',
        names: [],
      });
      expect(result.relative['another-valid.css']).toEqual({
        path: '/src/styles/another-valid.css',
        names: [],
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
      const result = await parseImports(code, filePath);

      // All external URLs should be parsed correctly regardless of special characters
      expect(result.externals).toEqual({
        'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500&display=swap': {
          names: [],
        },
        'https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300;0,400;1,300': {
          names: [],
        },
        'https://example.com/style(version=1).css': { names: [] },
        'https://cdn.example.com/fonts(subset=latin).css': { names: [] },
        'https://api.example.com/css?param1=value1;param2=value2&format=css': { names: [] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './real-component': {
            path: '/src/real-component',
            names: [{ name: 'RealComponent', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
          '@mui/material': { names: [{ name: 'Button', type: 'named' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './actual': {
            path: '/src/docs/actual',
            names: [{ name: 'ActualImport', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          '../utils/actual': {
            path: '/src/utils/actual',
            names: [{ name: 'ActualUtil', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
          '@mui/material': { names: [{ name: 'Typography', type: 'named' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './real': {
            path: '/src/real',
            names: [{ name: 'RealImport', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      // In .tsx files, the import inside the "code block" should be parsed
      // because it's not actually a code block, just a template literal
      expect(result).toEqual({
        relative: {
          './should-be-parsed': {
            path: '/src/should-be-parsed',
            names: [{ name: 'ShouldBeParsed', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './actual-component': {
            path: '/src/actual-component',
            names: [{ name: 'ActualComponent', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './real-import': {
            path: '/src/real-import',
            names: [{ name: 'RealImport', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './actual': {
            path: '/src/actual',
            names: [{ name: 'ActualImport', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './valid': {
            path: '/src/valid',
            names: [{ name: 'ValidImport', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './actual': {
            path: '/src/actual',
            names: [{ name: 'Actual', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './real-import': {
            path: '/src/real-import',
            names: [{ name: 'RealImport', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './RealComponent': {
            path: '/src/demo/RealComponent',
            names: [{ name: 'RealComponent', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './actual': {
            path: '/src/actual',
            names: [{ name: 'ActualImport', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './real': {
            path: '/src/real',
            names: [{ name: 'RealImport', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
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
      const result = await parseImports(code, filePath);

      expect(result).toEqual({
        relative: {
          './real-component': {
            path: '/src/real-component',
            names: [{ name: 'RealComponent', type: 'named' }],
          },
        },
        externals: {
          react: { names: [{ name: 'React', type: 'default' }] },
        },
      });
    });
  });
});
