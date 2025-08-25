import { describe, it, expect } from 'vitest';
import {
  generateExternalsProviderContent,
  createExternalsProvider,
} from './generateExternalsProvider';
import { mergeExternals } from '../loaderUtils/mergeExternals';

describe('generateExternalsProviderContent', () => {
  it('should generate provider content for default imports', () => {
    const externals = {
      react: [{ name: 'React', type: 'default' as const }],
      lodash: [{ name: 'lodash', type: 'default' as const }],
    };

    const result = generateExternalsProviderContent(externals);

    expect(result).toContain("'use client';");
    expect(result).toContain("import React from 'react';");
    expect(result).toContain("import lodash from 'lodash';");
    expect(result).toContain(
      "import { CodeExternalsContext } from '@mui/internal-docs-infra/CodeExternalsContext';",
    );
    expect(result).toContain(
      'export function CodeExternalsProvider({ children }: { children: React.ReactNode }) {',
    );
    expect(result).toContain("'react': { default: React }");
    expect(result).toContain("'lodash': { default: lodash }");
    expect(result).toContain('const externals = {');
    expect(result).toContain('<CodeExternalsContext.Provider value={{ externals }}>');
  });

  it('should generate provider content for named imports', () => {
    const externals = {
      react: [
        { name: 'useState', type: 'named' as const },
        { name: 'useEffect', type: 'named' as const },
      ],
      '@mui/material': [{ name: 'Button', type: 'named' as const }],
    };

    const result = generateExternalsProviderContent(externals);

    // Should consolidate named imports from the same module
    expect(result).toContain("import { useState, useEffect } from 'react';");
    expect(result).toContain("import { Button } from '@mui/material';");
    expect(result).toContain("'react': { useState, useEffect }");
    expect(result).toContain("'@mui/material': { Button }");
  });

  it('should generate provider content for namespace imports', () => {
    const externals = {
      react: [{ name: 'React', type: 'namespace' as const }],
      lodash: [{ name: '_', type: 'namespace' as const }],
    };

    const result = generateExternalsProviderContent(externals);

    expect(result).toContain("import * as React from 'react';");
    expect(result).toContain("import * as _ from 'lodash';");
    expect(result).toContain("'react': React");
    expect(result).toContain("'lodash': _");
  });

  it('should handle mixed import types from the same module', () => {
    const externals = {
      react: [
        { name: 'React', type: 'default' as const },
        { name: 'useState', type: 'named' as const },
        { name: 'ReactNamespace', type: 'namespace' as const },
      ],
    };

    const result = generateExternalsProviderContent(externals);

    // Should combine default and named imports, but keep namespace separate
    expect(result).toContain("import React, { useState } from 'react';");
    expect(result).toContain("import * as ReactNamespace from 'react';");
    expect(result).toContain("'react': { default: React, useState, ReactNamespace }");
  });

  it('should handle scoped packages', () => {
    const externals = {
      '@mui/material': [{ name: 'Button', type: 'named' as const }],
      '@emotion/styled': [{ name: 'styled', type: 'default' as const }],
      '@types/react': [{ name: 'FC', type: 'named' as const }],
    };

    const result = generateExternalsProviderContent(externals);

    expect(result).toContain("import { Button } from '@mui/material';");
    expect(result).toContain("import styled from '@emotion/styled';");
    expect(result).toContain("import { FC } from '@types/react';");
    expect(result).toContain("'@mui/material': { Button }");
    expect(result).toContain("'@emotion/styled': { default: styled }");
    expect(result).toContain("'@types/react': { FC }");
  });

  it('should handle empty externals object', () => {
    const externals = {};

    const result = generateExternalsProviderContent(externals);

    expect(result).toContain("'use client';");
    expect(result).toContain(
      "import { CodeExternalsContext } from '@mui/internal-docs-infra/CodeExternalsContext';",
    );
    expect(result).toContain(
      'export function CodeExternalsProvider({ children }: { children: React.ReactNode }) {',
    );
    expect(result).toContain('const externals = {  };');
    expect(result).toContain('<CodeExternalsContext.Provider value={{ externals }}>');
    expect(result).not.toContain('import React');
    expect(result).not.toContain('import { useState');
    expect(result).not.toContain('import * as ');
  });

  it('should handle modules with empty import arrays', () => {
    const externals = {
      'side-effect-module': [],
    };

    const result = generateExternalsProviderContent(externals);

    expect(result).toContain("'use client';");
    expect(result).toContain(
      "import { CodeExternalsContext } from '@mui/internal-docs-infra/CodeExternalsContext';",
    );
    expect(result).toContain(
      'export function CodeExternalsProvider({ children }: { children: React.ReactNode }) {',
    );
    expect(result).toContain('const externals = {  };');
    expect(result).toContain('<CodeExternalsContext.Provider value={{ externals }}>');
    expect(result).not.toContain('side-effect-module');
  });

  it('should consolidate imports to avoid duplicates and empty imports', () => {
    const externals = {
      react: [
        { name: 'React', type: 'default' as const },
        { name: 'useState', type: 'named' as const },
        { name: 'useEffect', type: 'named' as const },
        { name: 'useCallback', type: 'named' as const },
      ],
      '@mui/material': [
        { name: 'Button', type: 'named' as const },
        { name: 'TextField', type: 'named' as const },
        { name: 'Box', type: 'named' as const },
      ],
      lodash: [
        { name: '_', type: 'default' as const },
        { name: 'map', type: 'named' as const },
        { name: 'filter', type: 'named' as const },
      ],
    };

    const result = generateExternalsProviderContent(externals);

    // Should consolidate all named imports from the same module
    expect(result).toContain("import React, { useState, useEffect, useCallback } from 'react';");
    expect(result).toContain("import { Button, TextField, Box } from '@mui/material';");
    expect(result).toContain("import _, { map, filter } from 'lodash';");

    // Should not have duplicate imports
    expect(result).not.toMatch(/import.*from 'react'.*import.*from 'react'/);
    expect(result).not.toMatch(/import.*from '@mui\/material'.*import.*from '@mui\/material'/);

    // Should not have empty imports
    expect(result).not.toContain('import {  } from');
    expect(result).not.toContain('import { } from');
  });

  it('should generate valid React JSX syntax', () => {
    const externals = {
      react: [{ name: 'React', type: 'default' as const }],
    };

    const result = generateExternalsProviderContent(externals);

    // Should be valid JSX component
    expect(result).toContain(
      'export function CodeExternalsProvider({ children }: { children: React.ReactNode }) {',
    );
    expect(result).toContain('return (');
    expect(result).toContain('<CodeExternalsContext.Provider');
    expect(result).toContain('const externals = {');
    expect(result).toContain('value={{ externals }}>');
    expect(result).toContain('{children}');
    expect(result).toContain('</CodeExternalsContext.Provider>');
    expect(result).toContain(');');
    expect(result).toContain('}');
  });

  it('should properly format complex export mappings', () => {
    const externals = {
      react: [
        { name: 'React', type: 'default' as const },
        { name: 'useState', type: 'named' as const },
      ],
      lodash: [{ name: '_', type: 'namespace' as const }],
      '@mui/material': [{ name: 'Button', type: 'named' as const }],
    };

    const result = generateExternalsProviderContent(externals);

    // Should contain all mappings in the externals object
    expect(result).toContain("'react': { default: React, useState }");
    expect(result).toContain("'lodash': _");
    expect(result).toContain("'@mui/material': { Button }");
  });

  it('should handle complex merged externals with multiple imports per module', () => {
    // This simulates what mergeExternals would produce when combining multiple files
    const externals = {
      react: [
        { name: 'React', type: 'default' as const },
        { name: 'useState', type: 'named' as const },
        { name: 'useEffect', type: 'named' as const },
        { name: 'useCallback', type: 'named' as const },
      ],
      '@mui/material': [
        { name: 'Button', type: 'named' as const },
        { name: 'TextField', type: 'named' as const },
        { name: 'Box', type: 'named' as const },
        { name: 'Typography', type: 'named' as const },
      ],
      lodash: [
        { name: 'map', type: 'named' as const },
        { name: 'filter', type: 'named' as const },
        { name: 'reduce', type: 'named' as const },
      ],
    };

    const result = generateExternalsProviderContent(externals);

    // Check consolidated imports are generated correctly
    expect(result).toContain("import React, { useState, useEffect, useCallback } from 'react';");
    expect(result).toContain("import { Button, TextField, Box, Typography } from '@mui/material';");
    expect(result).toContain("import { map, filter, reduce } from 'lodash';");

    // Check exports are generated correctly with proper grouping
    expect(result).toContain("'react': { default: React, useState, useEffect, useCallback }");

    expect(result).toContain("'@mui/material': { Button, TextField, Box, Typography }");

    expect(result).toContain("'lodash': { map, filter, reduce }");
  });

  it('should handle mixed import types within same module from mergeExternals', () => {
    // This tests a realistic scenario where mergeExternals combines different import types
    const externals = {
      react: [
        { name: 'React', type: 'default' as const }, // From main file
        { name: 'useState', type: 'named' as const }, // From helper file
        { name: 'useEffect', type: 'named' as const }, // From utils file
        { name: 'ReactDOMTypes', type: 'namespace' as const }, // From types file
      ],
      '@mui/material': [
        { name: 'Material', type: 'namespace' as const }, // From main file (namespace import)
        { name: 'Button', type: 'named' as const }, // From component file
        { name: 'TextField', type: 'named' as const }, // From form file
      ],
      lodash: [
        { name: '_', type: 'default' as const }, // From legacy file (default import of lodash)
        { name: 'map', type: 'named' as const }, // From utils file (named import)
        { name: 'LodashNS', type: 'namespace' as const }, // From types file (namespace import)
      ],
    };

    const result = generateExternalsProviderContent(externals);

    // Verify consolidated import statements are generated
    expect(result).toContain("import React, { useState, useEffect } from 'react';");
    expect(result).toContain("import * as ReactDOMTypes from 'react';");

    expect(result).toContain("import { Button, TextField } from '@mui/material';");
    expect(result).toContain("import * as Material from '@mui/material';");

    expect(result).toContain("import _, { map } from 'lodash';");
    expect(result).toContain("import * as LodashNS from 'lodash';");

    // Verify all export mappings are generated
    expect(result).toContain("'react': { default: React, useState, useEffect, ReactDOMTypes }");

    expect(result).toContain("'@mui/material': { Button, TextField, Material }");

    expect(result).toContain("'lodash': { default: _, map, LodashNS }");

    // Verify the complete provider structure
    expect(result).toContain(
      'export function CodeExternalsProvider({ children }: { children: React.ReactNode }) {',
    );
    expect(result).toContain('const externals = {');
    expect(result).toContain('<CodeExternalsContext.Provider value={{ externals }}>');
    expect(result).toContain('{children}');
    expect(result).toContain('</CodeExternalsContext.Provider>');
  });

  it('should handle large-scale merged externals from multiple variant files', () => {
    // This simulates a realistic large demo with many merged externals
    const externals = {
      react: [
        { name: 'React', type: 'default' as const },
        { name: 'useState', type: 'named' as const },
        { name: 'useEffect', type: 'named' as const },
        { name: 'useCallback', type: 'named' as const },
        { name: 'useMemo', type: 'named' as const },
        { name: 'useRef', type: 'named' as const },
      ],
      '@mui/material': [
        { name: 'Button', type: 'named' as const },
        { name: 'TextField', type: 'named' as const },
        { name: 'Box', type: 'named' as const },
        { name: 'Typography', type: 'named' as const },
        { name: 'Card', type: 'named' as const },
        { name: 'CardContent', type: 'named' as const },
      ],
      '@mui/icons-material': [
        { name: 'Add', type: 'named' as const },
        { name: 'Delete', type: 'named' as const },
        { name: 'Edit', type: 'named' as const },
      ],
      lodash: [
        { name: 'map', type: 'named' as const },
        { name: 'filter', type: 'named' as const },
        { name: 'reduce', type: 'named' as const },
        { name: 'debounce', type: 'named' as const },
      ],
      axios: [{ name: 'axios', type: 'default' as const }],
      'date-fns': [
        { name: 'format', type: 'named' as const },
        { name: 'parseISO', type: 'named' as const },
      ],
    };

    const result = generateExternalsProviderContent(externals);

    // Verify it generates a valid provider structure
    expect(result).toContain("'use client';");
    expect(result).toContain(
      'export function CodeExternalsProvider({ children }: { children: React.ReactNode }) {',
    );
    expect(result).toContain('return (');
    expect(result).toContain('const externals = {');
    expect(result).toContain('<CodeExternalsContext.Provider value={{ externals }}>');

    // Spot check some key imports and exports
    expect(result).toContain(
      "import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';",
    );
    expect(result).toContain(
      "import { Button, TextField, Box, Typography, Card, CardContent } from '@mui/material';",
    );
    expect(result).toContain("import { Add, Delete, Edit } from '@mui/icons-material';");
    expect(result).toContain("import { map, filter, reduce, debounce } from 'lodash';");
    expect(result).toContain("import axios from 'axios';");
    expect(result).toContain("import { format, parseISO } from 'date-fns';");

    expect(result).toContain(
      "'react': { default: React, useState, useEffect, useCallback, useMemo, useRef }",
    );
    expect(result).toContain(
      "'@mui/material': { Button, TextField, Box, Typography, Card, CardContent }",
    );
    expect(result).toContain("'@mui/icons-material': { Add, Delete, Edit }");
    expect(result).toContain("'lodash': { map, filter, reduce, debounce }");
    expect(result).toContain("'axios': { default: axios }");
    expect(result).toContain("'date-fns': { format, parseISO }");

    // Verify the structure ends correctly
    expect(result).toContain('const externals = {');
    expect(result).toContain('value={{ externals }}>');
    expect(result).toContain('{children}');
    expect(result).toContain('</CodeExternalsContext.Provider>');
    expect(result).toContain(');');
    expect(result).toContain('}');
  });
});

describe('createExternalsProvider', () => {
  it('should create externals provider info when externals exist', () => {
    const externals = {
      react: [{ name: 'React', type: 'default' as const }],
    };
    const resourcePath = '/path/to/demo.tsx';

    const result = createExternalsProvider(externals, resourcePath);

    expect(result).toBeDefined();
    expect(result?.relativePath).toBe('./demo.externals.tsx');
    expect(result?.fileName).toBe('/path/to/demo.externals.tsx');
    expect(result?.content).toContain("import React from 'react';");
  });

  it('should return undefined when no externals exist', () => {
    const externals = {};
    const resourcePath = '/path/to/demo.tsx';

    const result = createExternalsProvider(externals, resourcePath);

    expect(result).toBeUndefined();
  });

  it('should handle different file extensions', () => {
    const externals = {
      react: [{ name: 'React', type: 'default' as const }],
    };

    // Test .tsx file
    let result = createExternalsProvider(externals, '/path/to/demo.tsx');
    expect(result?.relativePath).toBe('./demo.externals.tsx');
    expect(result?.fileName).toBe('/path/to/demo.externals.tsx');

    // Test .ts file
    result = createExternalsProvider(externals, '/path/to/demo.ts');
    expect(result?.relativePath).toBe('./demo.externals.tsx');
    expect(result?.fileName).toBe('/path/to/demo.externals.tsx');

    // Test .js file
    result = createExternalsProvider(externals, '/path/to/demo.js');
    expect(result?.relativePath).toBe('./demo.externals.tsx');
    expect(result?.fileName).toBe('/path/to/demo.externals.tsx');
  });

  it('should handle nested paths correctly', () => {
    const externals = {
      react: [{ name: 'React', type: 'default' as const }],
    };
    const resourcePath = '/deep/nested/path/to/demo.tsx';

    const result = createExternalsProvider(externals, resourcePath);

    expect(result?.relativePath).toBe('./demo.externals.tsx');
    expect(result?.fileName).toBe('/deep/nested/path/to/demo.externals.tsx');
  });

  it('should generate correct provider content', () => {
    const externals = {
      react: [{ name: 'React', type: 'default' as const }],
      '@mui/material': [{ name: 'Button', type: 'named' as const }],
    };
    const resourcePath = '/path/to/demo.tsx';

    const result = createExternalsProvider(externals, resourcePath);

    expect(result).toBeDefined();
    expect(result?.content).toContain("'use client';");
    expect(result?.content).toContain("import React from 'react';");
    expect(result?.content).toContain("import { Button } from '@mui/material';");
    expect(result?.content).toContain(
      'export function CodeExternalsProvider({ children }: { children: React.ReactNode }) {',
    );
    expect(result?.content).toContain("'react': { default: React }");
    expect(result?.content).toContain("'@mui/material': { Button }");
  });

  it('should handle files without extensions', () => {
    const externals = {
      react: [{ name: 'React', type: 'default' as const }],
    };
    const resourcePath = '/path/to/demo';

    const result = createExternalsProvider(externals, resourcePath);

    expect(result?.relativePath).toBe('./demo.externals.tsx');
    expect(result?.fileName).toBe('/path/to/demo.externals.tsx');
  });

  it('should create provider with complex merged externals', () => {
    // Test with externals that would come from mergeExternals utility
    const externals = {
      react: [
        { name: 'React', type: 'default' as const },
        { name: 'useState', type: 'named' as const },
        { name: 'useEffect', type: 'named' as const },
      ],
      '@mui/material': [
        { name: 'Button', type: 'named' as const },
        { name: 'TextField', type: 'named' as const },
        { name: 'Box', type: 'named' as const },
      ],
      lodash: [
        { name: '_', type: 'default' as const },
        { name: 'map', type: 'named' as const },
        { name: 'LodashUtils', type: 'namespace' as const },
      ],
    };
    const resourcePath = '/components/ComplexDemo.tsx';

    const result = createExternalsProvider(externals, resourcePath);

    expect(result).toBeDefined();
    expect(result?.relativePath).toBe('./ComplexDemo.externals.tsx');
    expect(result?.fileName).toBe('/components/ComplexDemo.externals.tsx');

    // Verify the content includes all the complex imports
    const content = result?.content || '';

    // React imports
    expect(content).toContain("import React, { useState, useEffect } from 'react';");
    expect(content).not.toContain("import React from 'react';"); // Should be consolidated
    expect(content).not.toContain("import { useState } from 'react';"); // Should be consolidated
    expect(content).not.toContain("import { useEffect } from 'react';"); // Should be consolidated

    // MUI imports
    expect(content).toContain("import { Button, TextField, Box } from '@mui/material';");

    // Lodash imports
    expect(content).toContain("import _, { map } from 'lodash';");
    expect(content).toContain("import * as LodashUtils from 'lodash';");

    // React exports
    expect(content).toContain("'react': { default: React, useState, useEffect }");

    // MUI exports
    expect(content).toContain("'@mui/material': { Button, TextField, Box }");

    // Lodash exports
    expect(content).toContain("'lodash': { default: _, map, LodashUtils }");

    // Verify proper structure
    expect(content).toContain("'use client';");
    expect(content).toContain(
      'export function CodeExternalsProvider({ children }: { children: React.ReactNode }) {',
    );
    expect(content).toContain('const externals = {');
    expect(content).toContain('<CodeExternalsContext.Provider value={{ externals }}>');
    expect(content).toContain('{children}');
    expect(content).toContain('</CodeExternalsContext.Provider>');
  });
});

describe('generateExternalsProvider integration with mergeExternals', () => {
  it('should correctly generate provider content from mergeExternals output', () => {
    // Simulate externals from multiple variant files, as would be produced by loadVariant
    const mainFileExternals = {
      react: [{ name: 'React', type: 'default' as const }],
      '@mui/material': [{ name: 'Button', type: 'named' as const }],
      lodash: [{ name: 'map', type: 'named' as const }],
    };

    const helperFileExternals = {
      react: [
        { name: 'useState', type: 'named' as const },
        { name: 'useEffect', type: 'named' as const },
      ],
      '@mui/material': [
        { name: 'TextField', type: 'named' as const },
        { name: 'Box', type: 'named' as const },
      ],
      axios: [{ name: 'axios', type: 'default' as const }],
    };

    const utilsFileExternals = {
      react: [{ name: 'useCallback', type: 'named' as const }],
      lodash: [
        { name: 'filter', type: 'named' as const },
        { name: 'reduce', type: 'named' as const },
      ],
      'date-fns': [{ name: 'format', type: 'named' as const }],
    };

    // Use mergeExternals to combine them as would happen in loadPrecomputedCodeHighlighter
    const mergedExternals = mergeExternals([
      mainFileExternals,
      helperFileExternals,
      utilsFileExternals,
    ]);

    // Generate the provider content from the merged result
    const providerContent = generateExternalsProviderContent(mergedExternals);

    // Verify the merged result includes all imports
    expect(mergedExternals).toEqual({
      react: [
        { name: 'React', type: 'default' },
        { name: 'useState', type: 'named' },
        { name: 'useEffect', type: 'named' },
        { name: 'useCallback', type: 'named' },
      ],
      '@mui/material': [
        { name: 'Button', type: 'named' },
        { name: 'TextField', type: 'named' },
        { name: 'Box', type: 'named' },
      ],
      lodash: [
        { name: 'map', type: 'named' },
        { name: 'filter', type: 'named' },
        { name: 'reduce', type: 'named' },
      ],
      axios: [{ name: 'axios', type: 'default' }],
      'date-fns': [{ name: 'format', type: 'named' }],
    });

    // Verify the provider content includes all the merged imports
    // React imports and exports
    expect(providerContent).toContain(
      "import React, { useState, useEffect, useCallback } from 'react';",
    );
    expect(providerContent).toContain(
      "'react': { default: React, useState, useEffect, useCallback }",
    );

    // MUI imports and exports
    expect(providerContent).toContain("import { Button, TextField, Box } from '@mui/material';");
    expect(providerContent).toContain("'@mui/material': { Button, TextField, Box }");

    // Lodash imports and exports
    expect(providerContent).toContain("import { map, filter, reduce } from 'lodash';");
    expect(providerContent).toContain("'lodash': { map, filter, reduce }");

    // Other imports and exports
    expect(providerContent).toContain("import axios from 'axios';");
    expect(providerContent).toContain("import { format } from 'date-fns';");
    expect(providerContent).toContain("'axios': { default: axios }");
    expect(providerContent).toContain("'date-fns': { format }");

    // Verify proper structure
    expect(providerContent).toContain("'use client';");
    expect(providerContent).toContain(
      'export function CodeExternalsProvider({ children }: { children: React.ReactNode }) {',
    );
    expect(providerContent).toContain('const externals = {');
    expect(providerContent).toContain('<CodeExternalsContext.Provider value={{ externals }}>');
    expect(providerContent).toContain('{children}');
    expect(providerContent).toContain('</CodeExternalsContext.Provider>');
  });
});

describe('generateExternalsProvider conflict resolution', () => {
  it('should handle naming conflicts with default imports', () => {
    const externals = {
      react: [{ name: 'Component', type: 'default' as const }],
      vue: [{ name: 'Component', type: 'default' as const }],
      '@angular/core': [{ name: 'Component', type: 'default' as const }],
    };

    const result = generateExternalsProviderContent(externals);

    // Should import with unique names
    expect(result).toContain("import Component from 'react';");
    expect(result).toContain("import Componentvue from 'vue';");
    expect(result).toContain("import Componentangularcore from '@angular/core';");

    // Should export with unique names
    expect(result).toContain("'react': { default: Component }");
    expect(result).toContain("'vue': { default: Componentvue }");
    expect(result).toContain("'@angular/core': { default: Componentangularcore }");
  });

  it('should handle naming conflicts with named imports using aliases', () => {
    const externals = {
      react: [{ name: 'Component', type: 'named' as const }],
      vue: [{ name: 'Component', type: 'named' as const }],
      angular: [{ name: 'Component', type: 'named' as const }],
    };

    const result = generateExternalsProviderContent(externals);

    // Should import with aliases and consolidate
    expect(result).toContain("import { Component } from 'react';");
    expect(result).toContain("import { Component as Componentvue } from 'vue';");
    expect(result).toContain("import { Component as Componentangular } from 'angular';");

    // Should export with proper mapping
    expect(result).toContain("'react': { Component }");
    expect(result).toContain("'vue': { Component: Componentvue }");
    expect(result).toContain("'angular': { Component: Componentangular }");
  });

  it('should handle naming conflicts with namespace imports', () => {
    const externals = {
      react: [{ name: 'Utils', type: 'namespace' as const }],
      lodash: [{ name: 'Utils', type: 'namespace' as const }],
      moment: [{ name: 'Utils', type: 'namespace' as const }],
    };

    const result = generateExternalsProviderContent(externals);

    // Should import with unique names for namespace imports
    expect(result).toContain("import * as Utils from 'react';");
    expect(result).toContain("import * as Utils1 from 'lodash';");
    expect(result).toContain("import * as Utils2 from 'moment';");

    // Should export with unique names
    expect(result).toContain("'react': Utils");
    expect(result).toContain("'lodash': Utils1");
    expect(result).toContain("'moment': Utils2");
  });

  it('should handle mixed import type conflicts', () => {
    const externals = {
      react: [
        { name: 'Component', type: 'default' as const },
        { name: 'Utils', type: 'named' as const },
      ],
      vue: [
        { name: 'Component', type: 'named' as const },
        { name: 'Utils', type: 'namespace' as const },
      ],
      angular: [
        { name: 'Component', type: 'namespace' as const },
        { name: 'Utils', type: 'default' as const },
      ],
    };

    const result = generateExternalsProviderContent(externals);

    // Default and named imports should be consolidated when possible
    expect(result).toContain("import Component, { Utils } from 'react';");
    expect(result).toContain("import Utilsangular from 'angular';");

    // Named imports should get aliases and be consolidated
    expect(result).not.toContain("import Component from 'react';"); // Should be consolidated
    expect(result).not.toContain("import { Utils } from 'react';"); // Should be consolidated
    expect(result).toContain("import { Component as Componentvue } from 'vue';");

    // Namespace imports should get unique names
    expect(result).toContain("import * as Component1 from 'angular';");
    expect(result).toContain("import * as Utils1 from 'vue';");

    // Check exports are correct
    expect(result).toContain("'react': { default: Component, Utils }");
    expect(result).toContain("'vue': { Component: Componentvue, Utils1 }");
    expect(result).toContain("'angular': { default: Utilsangular, Component1 }");
  });

  it('should handle conflicts with special characters in module names', () => {
    const externals = {
      '@mui/material': [{ name: 'Button', type: 'default' as const }],
      '@emotion/styled': [{ name: 'Button', type: 'default' as const }],
      'react-router-dom': [{ name: 'Button', type: 'default' as const }],
    };

    const result = generateExternalsProviderContent(externals);

    // Should generate safe identifiers from module names
    expect(result).toContain("import Button from '@mui/material';");
    expect(result).toContain("import Buttonemotionstyled from '@emotion/styled';");
    expect(result).toContain("import Buttonreactrouterdom from 'react-router-dom';");

    expect(result).toContain("'@mui/material': { default: Button }");
    expect(result).toContain("'@emotion/styled': { default: Buttonemotionstyled }");
    expect(result).toContain("'react-router-dom': { default: Buttonreactrouterdom }");
  });

  it('should handle very long module names by truncating', () => {
    const externals = {
      react: [{ name: 'Component', type: 'default' as const }],
      'very-long-module-name-that-should-be-truncated-for-safety': [
        { name: 'Component', type: 'default' as const },
      ],
    };

    const result = generateExternalsProviderContent(externals);

    expect(result).toContain("import Component from 'react';");
    // Should contain truncated module name (max 20 chars: "verylongmodulenameth")
    expect(result).toContain(
      "import Componentverylongmodulenameth from 'very-long-module-name-that-should-be-truncated-for-safety';",
    );
  });

  it('should handle conflicts when no conflicts are present (baseline)', () => {
    const externals = {
      react: [{ name: 'React', type: 'default' as const }],
      lodash: [{ name: 'map', type: 'named' as const }],
      moment: [{ name: 'Moment', type: 'namespace' as const }],
    };

    const result = generateExternalsProviderContent(externals);

    // Should use original names when no conflicts
    expect(result).toContain("import React from 'react';");
    expect(result).toContain("import { map } from 'lodash';");
    expect(result).toContain("import * as Moment from 'moment';");

    expect(result).toContain("'react': { default: React }");
    expect(result).toContain("'lodash': { map }");
    expect(result).toContain("'moment': Moment");
  });

  it('should handle large number of conflicts with numbered suffixes', () => {
    const externals = {
      lib1: [{ name: 'Utils', type: 'named' as const }],
      lib2: [{ name: 'Utils', type: 'named' as const }],
      lib3: [{ name: 'Utils', type: 'named' as const }],
      lib4: [{ name: 'Utils', type: 'named' as const }],
      lib5: [{ name: 'Utils', type: 'named' as const }],
    };

    const result = generateExternalsProviderContent(externals);

    // Should use numbered suffixes for conflicts and consolidate
    expect(result).toContain("import { Utils } from 'lib1';");
    expect(result).toContain("import { Utils as Utils1 } from 'lib2';");
    expect(result).toContain("import { Utils as Utils2 } from 'lib3';");
    expect(result).toContain("import { Utils as Utils3 } from 'lib4';");
    expect(result).toContain("import { Utils as Utils4 } from 'lib5';");

    expect(result).toContain("'lib1': { Utils }");
    expect(result).toContain("'lib2': { Utils: Utils1 }");
    expect(result).toContain("'lib3': { Utils: Utils2 }");
    expect(result).toContain("'lib4': { Utils: Utils3 }");
    expect(result).toContain("'lib5': { Utils: Utils4 }");
  });

  it('should fix reported issues: duplicate imports, empty imports, consolidation', () => {
    // This test specifically addresses the user's reported issues
    const externals = {
      react: [
        { name: 'React', type: 'namespace' as const },
        { name: 'React', type: 'namespace' as const }, // Duplicate namespace import
      ],
      '@mui/internal-docs-infra/CodeHighlighter': [
        { name: 'CodeHighlighter', type: 'named' as const },
      ],
      '@mui/internal-docs-infra/CodeHighlighter/types': [
        { name: 'ContentProps', type: 'named' as const },
        { name: 'LoadCodeMeta', type: 'named' as const },
        { name: 'LoadSource', type: 'named' as const },
        { name: 'Code', type: 'named' as const },
      ],
    };

    const result = generateExternalsProviderContent(externals);

    // Should NOT have duplicate namespace imports
    const reactNamespaceImports = result.match(/import \* as React\d* from 'react';/g);
    expect(reactNamespaceImports).toHaveLength(1);
    expect(result).toContain("import * as React from 'react';");
    expect(result).not.toContain("import * as React1 from 'react';");

    // Should NOT have empty imports
    expect(result).not.toMatch(/import \{\s*\} from/);
    expect(result).not.toMatch(/import \{ \} from/);

    // Should consolidate named imports from same module
    const typesImports = result.match(
      /import \{[^}]+\} from '@mui\/internal-docs-infra\/CodeHighlighter\/types';/g,
    );
    expect(typesImports).toHaveLength(1);
    expect(result).toContain(
      "import { ContentProps, LoadCodeMeta, LoadSource, Code } from '@mui/internal-docs-infra/CodeHighlighter/types';",
    );

    // Should have proper structure
    expect(result).toContain("'use client';");
    expect(result).toContain('const externals = {');
    expect(result).toContain('<CodeExternalsContext.Provider value={{ externals }}>');
  });

  // Test cases that would have caught the specific bugs we encountered
  describe('Bug regression tests', () => {
    it('should always import CodeExternalsContext even when useCodeExternals is imported from same module', () => {
      const externals = {
        '@mui/internal-docs-infra/CodeExternalsContext': [
          { name: 'useCodeExternals', type: 'named' as const },
        ],
        react: [{ name: 'React', type: 'default' as const }],
      };

      const result = generateExternalsProviderContent(externals);

      // Should import useCodeExternals AND still have the CodeExternalsContext import
      expect(result).toContain(
        "import { useCodeExternals } from '@mui/internal-docs-infra/CodeExternalsContext';",
      );
      expect(result).toContain(
        "import { CodeExternalsContext } from '@mui/internal-docs-infra/CodeExternalsContext';",
      );

      // Should NOT consolidate these into a single import since we need CodeExternalsContext
      // for the provider component itself
      expect(result).not.toContain(
        "import { useCodeExternals, CodeExternalsContext } from '@mui/internal-docs-infra/CodeExternalsContext';",
      );

      // Should provide useCodeExternals in externals but not CodeExternalsContext
      expect(result).toContain(
        "'@mui/internal-docs-infra/CodeExternalsContext': { useCodeExternals }",
      );
      expect(result).not.toContain(
        "'@mui/internal-docs-infra/CodeExternalsContext': { useCodeExternals, CodeExternalsContext }",
      );
    });

    it('should not duplicate CodeExternalsContext import when it is already explicitly imported', () => {
      const externals = {
        '@mui/internal-docs-infra/CodeExternalsContext': [
          { name: 'CodeExternalsContext', type: 'named' as const },
          { name: 'useCodeExternals', type: 'named' as const },
        ],
        react: [{ name: 'React', type: 'default' as const }],
      };

      const result = generateExternalsProviderContent(externals);

      // Should have only one import statement with both exports
      expect(result).toContain(
        "import { CodeExternalsContext, useCodeExternals } from '@mui/internal-docs-infra/CodeExternalsContext';",
      );

      // Should NOT have a duplicate import
      const codeExternalsContextImportCount = (
        result.match(
          /import.*CodeExternalsContext.*from '@mui\/internal-docs-infra\/CodeExternalsContext'/g,
        ) || []
      ).length;
      expect(codeExternalsContextImportCount).toBe(1);

      // Should provide both in externals
      expect(result).toContain(
        "'@mui/internal-docs-infra/CodeExternalsContext': { CodeExternalsContext, useCodeExternals }",
      );
    });

    it('should handle multiple exports from CodeExternalsContext module while adding required import', () => {
      const externals = {
        '@mui/internal-docs-infra/CodeExternalsContext': [
          { name: 'useCodeExternals', type: 'named' as const },
          { name: 'createCodeExternalsContext', type: 'named' as const },
          { name: 'withCodeExternals', type: 'named' as const },
        ],
        react: [{ name: 'React', type: 'default' as const }],
      };

      const result = generateExternalsProviderContent(externals);

      // Should consolidate the externals imports
      expect(result).toContain(
        "import { useCodeExternals, createCodeExternalsContext, withCodeExternals } from '@mui/internal-docs-infra/CodeExternalsContext';",
      );

      // Should still add the separate CodeExternalsContext import
      expect(result).toContain(
        "import { CodeExternalsContext } from '@mui/internal-docs-infra/CodeExternalsContext';",
      );

      // Should provide all the external exports but not CodeExternalsContext
      expect(result).toContain(
        "'@mui/internal-docs-infra/CodeExternalsContext': { useCodeExternals, createCodeExternalsContext, withCodeExternals }",
      );
      expect(result).not.toContain('CodeExternalsContext, useCodeExternals');
    });

    it('should filter out type-only imports completely', () => {
      const externals = {
        react: [
          { name: 'React', type: 'default' as const },
          { name: 'ComponentType', type: 'named' as const, isType: true },
          { name: 'ReactNode', type: 'named' as const, isType: true },
        ],
        '@mui/material': [
          { name: 'ButtonProps', type: 'named' as const, isType: true },
          { name: 'Button', type: 'named' as const },
        ],
        '@types/react': [
          { name: 'FC', type: 'named' as const, isType: true },
          { name: 'PropsWithChildren', type: 'named' as const, isType: true },
        ],
      };

      const result = generateExternalsProviderContent(externals);

      // Should only import non-type imports
      expect(result).toContain("import React from 'react';");
      expect(result).toContain("import { Button } from '@mui/material';");

      // Should NOT import type-only imports
      expect(result).not.toContain('ComponentType');
      expect(result).not.toContain('ButtonProps');
      expect(result).not.toContain('FC');
      expect(result).not.toContain('PropsWithChildren');
      expect(result).not.toContain('@types/react');

      // Verify ReactNode doesn't appear in imports (but allow it in the props type)
      expect(result).not.toMatch(/import.*ReactNode/);
      expect(result).not.toMatch(/'react':.*ReactNode/);

      // Should only have exports for non-type imports
      expect(result).toContain("'react': { default: React }");
      expect(result).toContain("'@mui/material': { Button }");
      expect(result).not.toContain("'@types/react'");
    });

    it('should filter out empty names completely', () => {
      const externals = {
        react: [
          { name: 'React', type: 'default' as const },
          { name: '', type: 'named' as const }, // Empty name
          { name: '   ', type: 'named' as const }, // Whitespace only
          { name: 'useState', type: 'named' as const },
        ],
        lodash: [
          { name: '', type: 'default' as const }, // Empty default name
          { name: 'map', type: 'named' as const },
        ],
        'empty-module': [
          { name: '', type: 'named' as const },
          { name: '  ', type: 'namespace' as const },
        ],
      };

      const result = generateExternalsProviderContent(externals);

      // Should only import non-empty names
      expect(result).toContain("import React, { useState } from 'react';");
      expect(result).toContain("import { map } from 'lodash';");

      // Should NOT import empty names
      expect(result).not.toContain("import { map,  } from 'lodash';");
      expect(result).not.toContain("import React, {  } from 'react';");
      expect(result).not.toContain('empty-module');

      // Should only have exports for non-empty names
      expect(result).toContain("'react': { default: React, useState }");
      expect(result).toContain("'lodash': { map }");
      expect(result).not.toContain("'empty-module'");
    });

    it('should handle duplicate imports without generating duplicate statements', () => {
      const externals = {
        react: [
          { name: 'React', type: 'default' as const },
          { name: 'React', type: 'default' as const }, // Duplicate default
          { name: 'useState', type: 'named' as const },
          { name: 'useState', type: 'named' as const }, // Duplicate named
          { name: 'ReactUtils', type: 'namespace' as const },
          { name: 'ReactUtils', type: 'namespace' as const }, // Duplicate namespace
        ],
      };

      const result = generateExternalsProviderContent(externals);

      // Should only have one import statement for each unique import
      const reactDefaultImports = result.match(/import React/g);
      expect(reactDefaultImports).toHaveLength(1);

      const useStateMatches = result.match(/useState/g);
      expect(useStateMatches).toHaveLength(2); // Once in import, once in export

      const namespaceImports = result.match(/import \* as ReactUtils from 'react'/g);
      expect(namespaceImports).toHaveLength(1);

      // Should consolidate properly
      expect(result).toContain("import React, { useState } from 'react';");
      expect(result).toContain("import * as ReactUtils from 'react';");

      // Should have proper exports (no duplicates)
      expect(result).toContain("'react': { default: React, useState, ReactUtils }");
    });

    it('should handle complex real-world scenario with all edge cases', () => {
      // This simulates what parseImports might actually produce from a real file
      const externals = {
        react: [
          { name: 'React', type: 'default' as const },
          { name: '', type: 'named' as const }, // Empty name from parseImports
          { name: 'useState', type: 'named' as const },
          { name: 'ComponentType', type: 'named' as const, isType: true }, // Type-only
          { name: 'React', type: 'default' as const }, // Duplicate
        ],
        '@mui/material': [
          { name: '  ', type: 'named' as const }, // Whitespace name
          { name: 'Button', type: 'named' as const },
          { name: 'ButtonProps', type: 'named' as const, isType: true }, // Type-only
        ],
        '@types/react': [
          { name: 'FC', type: 'named' as const, isType: true }, // All type-only module
          { name: 'PropsWithChildren', type: 'named' as const, isType: true },
        ],
        'side-effect-only': [], // Empty imports array
      };

      const result = generateExternalsProviderContent(externals);

      // Should only import valid, non-type, non-empty imports
      expect(result).toContain("import React, { useState } from 'react';");
      expect(result).toContain("import { Button } from '@mui/material';");

      // Should NOT import anything problematic
      expect(result).not.toContain('@types/react');
      expect(result).not.toContain('side-effect-only');
      expect(result).not.toContain('ComponentType');
      expect(result).not.toContain('ButtonProps');
      expect(result).not.toContain('FC');
      expect(result).not.toContain('PropsWithChildren');

      // Should have clean, consolidated output
      expect(result).toContain("'react': { default: React, useState }");
      expect(result).toContain("'@mui/material': { Button }");

      // Should not have any invalid entries
      expect(result).not.toContain("'@types/react'");
      expect(result).not.toContain("'side-effect-only'");
    });

    it('should generate valid code that would not cause variable initialization errors', () => {
      // This test ensures we don't have the variable initialization bug
      const externals = {
        react: [
          { name: 'React', type: 'default' as const },
          { name: 'useState', type: 'named' as const },
        ],
        '@mui/material': [{ name: 'Button', type: 'named' as const }],
      };

      const result = generateExternalsProviderContent(externals);

      // The generated code should be syntactically valid and not have
      // variable declaration issues like "Cannot access 'exportMappings' before initialization"

      // Check that the structure is correct
      expect(result).toContain("'use client';");
      expect(result).toContain("import React, { useState } from 'react';");
      expect(result).toContain("import { Button } from '@mui/material';");
      expect(result).toContain(
        'export function CodeExternalsProvider({ children }: { children: React.ReactNode }) {',
      );
      expect(result).toContain('const externals = {');
      expect(result).toContain("'react': { default: React, useState }");
      expect(result).toContain("'@mui/material': { Button }");
      expect(result).toContain('};');
      expect(result).toContain('<CodeExternalsContext.Provider value={{ externals }}>');

      // The code should not have syntax errors - if we can split it into lines
      // and it has the expected structure, the variable scoping should be correct
      const lines = result.split('\n');
      const constExternalsLine = lines.findIndex((line) => line.includes('const externals = {'));
      const exportMappingLines = lines.filter(
        (line) => line.trim().startsWith("'") && line.includes(':'),
      );

      expect(constExternalsLine).toBeGreaterThan(-1);
      expect(exportMappingLines.length).toBeGreaterThan(0);

      // All export mappings should come after the const declaration
      exportMappingLines.forEach((line) => {
        const lineIndex = lines.indexOf(line);
        expect(lineIndex).toBeGreaterThan(constExternalsLine);
      });
    });
  });
});
