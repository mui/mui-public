import { describe, it, expect } from 'vitest';
import { generateImportStatements } from './generateImportStatements';
import type { Externals } from '../../CodeHighlighter/types';

describe('generateImportStatements', () => {
  it('should generate import statements for default imports', () => {
    const externals: Externals = {
      react: [{ name: 'React', type: 'default', isType: false }],
      lodash: [{ name: 'lodash', type: 'default', isType: false }],
    };

    const result = generateImportStatements(externals);

    expect(result).toContain("import React from 'react';");
    expect(result).toContain("import lodash from 'lodash';");
    expect(result).toHaveLength(2);
  });

  it('should generate import statements for named imports', () => {
    const externals: Externals = {
      '@mui/material': [
        { name: 'Button', type: 'named', isType: false },
        { name: 'TextField', type: 'named', isType: false },
      ],
    };

    const result = generateImportStatements(externals);

    expect(result).toContain("import { Button, TextField } from '@mui/material';");
    expect(result).toHaveLength(1);
  });

  it('should generate import statements for namespace imports', () => {
    const externals: Externals = {
      react: [{ name: 'React', type: 'namespace', isType: false }],
    };

    const result = generateImportStatements(externals);

    expect(result).toContain("import * as React from 'react';");
    expect(result).toHaveLength(1);
  });

  it('should handle mixed import types from the same module', () => {
    const externals: Externals = {
      react: [
        { name: 'React', type: 'default', isType: false },
        { name: 'useState', type: 'named', isType: false },
        { name: 'useEffect', type: 'named', isType: false },
      ],
    };

    const result = generateImportStatements(externals);

    expect(result).toContain("import React, { useState, useEffect } from 'react';");
    expect(result).toHaveLength(1);
  });

  it('should handle namespace imports separately', () => {
    const externals: Externals = {
      react: [
        { name: 'React', type: 'default', isType: false },
        { name: 'ReactDOM', type: 'namespace', isType: false },
      ],
    };

    const result = generateImportStatements(externals);

    expect(result).toContain("import React from 'react';");
    expect(result).toContain("import * as ReactDOM from 'react';");
    expect(result).toHaveLength(2);
  });

  it('should skip type-only imports', () => {
    const externals: Externals = {
      react: [
        { name: 'React', type: 'default', isType: false },
        { name: 'ReactNode', type: 'named', isType: true },
      ],
    };

    const result = generateImportStatements(externals);

    expect(result).toContain("import React from 'react';");
    expect(result).not.toContain('ReactNode');
    expect(result).toHaveLength(1);
  });

  it('should skip empty names', () => {
    const externals: Externals = {
      react: [
        { name: 'React', type: 'default', isType: false },
        { name: '', type: 'named', isType: false },
        { name: '   ', type: 'named', isType: false },
      ],
    };

    const result = generateImportStatements(externals);

    expect(result).toContain("import React from 'react';");
    expect(result).toHaveLength(1);
  });

  it('should handle conflicts with unique naming', () => {
    const externals: Externals = {
      lib1: [{ name: 'Button', type: 'named', isType: false }],
      lib2: [{ name: 'Button', type: 'named', isType: false }],
    };

    const result = generateImportStatements(externals);

    expect(result).toContain("import { Button } from 'lib1';");
    expect(result).toContain("import { Button as Button1 } from 'lib2';");
    expect(result).toHaveLength(2);
  });

  it('should handle multiple namespace conflicts', () => {
    const externals: Externals = {
      lib1: [{ name: 'Utils', type: 'namespace', isType: false }],
      lib2: [{ name: 'Utils', type: 'namespace', isType: false }],
    };

    const result = generateImportStatements(externals);

    expect(result).toContain("import * as Utils from 'lib1';");
    expect(result).toContain("import * as Utils1 from 'lib2';");
    expect(result).toHaveLength(2);
  });

  it('should handle empty externals', () => {
    const externals: Externals = {};

    const result = generateImportStatements(externals);

    expect(result).toEqual([]);
  });

  it('should skip duplicate imports', () => {
    const externals: Externals = {
      react: [
        { name: 'React', type: 'default', isType: false },
        { name: 'React', type: 'default', isType: false }, // duplicate
        { name: 'useState', type: 'named', isType: false },
        { name: 'useState', type: 'named', isType: false }, // duplicate
      ],
    };

    const result = generateImportStatements(externals);

    expect(result).toContain("import React, { useState } from 'react';");
    expect(result).toHaveLength(1);
  });
});
