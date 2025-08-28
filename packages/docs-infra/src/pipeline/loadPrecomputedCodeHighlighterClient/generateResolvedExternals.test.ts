import { describe, it, expect } from 'vitest';
import { generateResolvedExternals } from './generateResolvedExternals';
import type { Externals } from '../../CodeHighlighter/types';

describe('generateResolvedExternals', () => {
  it('should generate resolved externals for default imports', () => {
    const externals: Externals = {
      react: [{ name: 'React', type: 'default', isType: false }],
    };

    const { imports, resolvedExternals } = generateResolvedExternals(externals);

    expect(imports).toEqual(["import React from 'react';"]);
    expect(resolvedExternals).toEqual({ react: 'React' });
  });

  it('should generate resolved externals for named imports', () => {
    const externals: Externals = {
      '@mui/material': [
        { name: 'Button', type: 'named', isType: false },
        { name: 'TextField', type: 'named', isType: false },
      ],
    };

    const { imports, resolvedExternals } = generateResolvedExternals(externals);

    expect(imports).toEqual(["import { Button, TextField } from '@mui/material';"]);
    expect(resolvedExternals).toEqual({ '"@mui/material"': '{ Button, TextField }' });
  });

  it('should generate resolved externals for single named import', () => {
    const externals: Externals = {
      '@mui/system': [{ name: 'styled', type: 'named', isType: false }],
    };

    const { imports, resolvedExternals } = generateResolvedExternals(externals);

    expect(imports).toEqual(["import { styled } from '@mui/system';"]);
    expect(resolvedExternals).toEqual({ '"@mui/system"': '{ styled }' });
  });

  it('should generate resolved externals for namespace imports', () => {
    const externals: Externals = {
      lodash: [{ name: 'lodash', type: 'namespace', isType: false }],
    };

    const { imports, resolvedExternals } = generateResolvedExternals(externals);

    expect(imports).toEqual(["import * as lodash from 'lodash';"]);
    expect(resolvedExternals).toEqual({ lodash: 'lodash' });
  });

  it('should generate resolved externals for mixed imports', () => {
    const externals: Externals = {
      react: [{ name: 'React', type: 'default', isType: false }],
      '@mui/material': [
        { name: 'Button', type: 'named', isType: false },
        { name: 'TextField', type: 'named', isType: false },
      ],
    };

    const { imports, resolvedExternals } = generateResolvedExternals(externals);

    expect(imports).toEqual([
      "import React from 'react';",
      "import { Button, TextField } from '@mui/material';",
    ]);
    expect(resolvedExternals).toEqual({
      react: 'React',
      '"@mui/material"': '{ Button, TextField }',
    });
  });

  it('should skip type-only imports', () => {
    const externals: Externals = {
      react: [
        { name: 'React', type: 'default', isType: false },
        { name: 'FC', type: 'named', isType: true },
      ],
    };

    const { imports, resolvedExternals } = generateResolvedExternals(externals);

    expect(imports).toEqual(["import React from 'react';"]);
    expect(resolvedExternals).toEqual({ react: 'React' });
  });

  it('should handle scoped packages', () => {
    const externals: Externals = {
      '@mui/material': [{ name: 'Button', type: 'named', isType: false }],
      '@emotion/styled': [{ name: 'styled', type: 'default', isType: false }],
      '@types/react': [{ name: 'FC', type: 'named', isType: true }],
    };

    const { imports, resolvedExternals } = generateResolvedExternals(externals);

    expect(imports).toEqual([
      "import { Button } from '@mui/material';",
      "import styled from '@emotion/styled';",
    ]);
    expect(resolvedExternals).toEqual({
      '"@mui/material"': '{ Button }',
      '"@emotion/styled"': 'styled',
    });
  });

  it('should handle empty externals object', () => {
    const externals: Externals = {};

    const { imports, resolvedExternals } = generateResolvedExternals(externals);

    expect(imports).toEqual([]);
    expect(resolvedExternals).toEqual({});
  });

  it('should handle modules with empty import arrays', () => {
    const externals: Externals = {
      'side-effect-module': [],
    };

    const { imports, resolvedExternals } = generateResolvedExternals(externals);

    expect(imports).toEqual([]);
    expect(resolvedExternals).toEqual({});
  });

  it('should filter out empty names completely', () => {
    const externals: Externals = {
      react: [
        { name: 'React', type: 'default', isType: false },
        { name: '', type: 'named', isType: false }, // Empty name
        { name: '   ', type: 'named', isType: false }, // Whitespace only
        { name: 'useState', type: 'named', isType: false },
      ],
      lodash: [
        { name: '', type: 'default', isType: false }, // Empty default name
        { name: 'map', type: 'named', isType: false },
      ],
      'empty-module': [
        { name: '', type: 'named', isType: false },
        { name: '  ', type: 'namespace', isType: false },
      ],
    };

    const { imports, resolvedExternals } = generateResolvedExternals(externals);

    expect(imports).toEqual([
      "import React, { useState } from 'react';",
      "import { map } from 'lodash';",
    ]);
    expect(resolvedExternals).toEqual({ react: 'React', lodash: '{ map }' });
  });

  it('should handle duplicate imports without generating duplicate statements', () => {
    const externals: Externals = {
      react: [
        { name: 'React', type: 'default', isType: false },
        { name: 'React', type: 'default', isType: false }, // Duplicate default
        { name: 'useState', type: 'named', isType: false },
        { name: 'useState', type: 'named', isType: false }, // Duplicate named
        { name: 'ReactUtils', type: 'namespace', isType: false },
        { name: 'ReactUtils', type: 'namespace', isType: false }, // Duplicate namespace
      ],
    };

    const { imports, resolvedExternals } = generateResolvedExternals(externals);

    expect(imports).toEqual([
      "import React, { useState } from 'react';",
      "import * as ReactUtils from 'react';",
    ]);
    expect(resolvedExternals).toEqual({ react: 'React' });
  });

  it('should handle large-scale merged externals from multiple variant files', () => {
    const externals: Externals = {
      react: [
        { name: 'React', type: 'default', isType: false },
        { name: 'useState', type: 'named', isType: false },
        { name: 'useEffect', type: 'named', isType: false },
        { name: 'useCallback', type: 'named', isType: false },
        { name: 'useMemo', type: 'named', isType: false },
        { name: 'useRef', type: 'named', isType: false },
      ],
      '@mui/material': [
        { name: 'Button', type: 'named', isType: false },
        { name: 'TextField', type: 'named', isType: false },
        { name: 'Box', type: 'named', isType: false },
        { name: 'Typography', type: 'named', isType: false },
        { name: 'Card', type: 'named', isType: false },
        { name: 'CardContent', type: 'named', isType: false },
      ],
      '@mui/icons-material': [
        { name: 'Add', type: 'named', isType: false },
        { name: 'Delete', type: 'named', isType: false },
        { name: 'Edit', type: 'named', isType: false },
      ],
      lodash: [
        { name: 'map', type: 'named', isType: false },
        { name: 'filter', type: 'named', isType: false },
        { name: 'reduce', type: 'named', isType: false },
        { name: 'debounce', type: 'named', isType: false },
      ],
      axios: [{ name: 'axios', type: 'default', isType: false }],
      'date-fns': [
        { name: 'format', type: 'named', isType: false },
        { name: 'parseISO', type: 'named', isType: false },
      ],
    };

    const { imports, resolvedExternals } = generateResolvedExternals(externals);

    expect(imports).toEqual([
      "import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';",
      "import { Button, TextField, Box, Typography, Card, CardContent } from '@mui/material';",
      "import { Add, Delete, Edit } from '@mui/icons-material';",
      "import { map, filter, reduce, debounce } from 'lodash';",
      "import axios from 'axios';",
      "import { format, parseISO } from 'date-fns';",
    ]);
    expect(resolvedExternals).toEqual({
      react: 'React',
      '"@mui/material"': '{ Button, TextField, Box, Typography, Card, CardContent }',
      '"@mui/icons-material"': '{ Add, Delete, Edit }',
      lodash: '{ map, filter, reduce, debounce }',
      axios: 'axios',
      '"date-fns"': '{ format, parseISO }',
    });
  });

  it('should handle complex real-world scenario with all edge cases', () => {
    // This simulates what parseImports might actually produce from a real file
    const externals: Externals = {
      react: [
        { name: 'React', type: 'default', isType: false },
        { name: '', type: 'named', isType: false }, // Empty name from parseImports
        { name: 'useState', type: 'named', isType: false },
        { name: 'ComponentType', type: 'named', isType: true }, // Type-only
        { name: 'React', type: 'default', isType: false }, // Duplicate
      ],
      '@mui/material': [
        { name: '  ', type: 'named', isType: false }, // Whitespace name
        { name: 'Button', type: 'named', isType: false },
        { name: 'ButtonProps', type: 'named', isType: true }, // Type-only
      ],
      '@types/react': [
        { name: 'FC', type: 'named', isType: true }, // All type-only module
        { name: 'PropsWithChildren', type: 'named', isType: true },
      ],
      'side-effect-only': [], // Empty imports array
    };

    const { imports, resolvedExternals } = generateResolvedExternals(externals);

    expect(imports).toEqual([
      "import React, { useState } from 'react';",
      "import { Button } from '@mui/material';",
    ]);
    expect(resolvedExternals).toEqual({ react: 'React', '"@mui/material"': '{ Button }' });
  });

  it('should handle mixed import types from same module', () => {
    const externals: Externals = {
      react: [
        { name: 'React', type: 'default', isType: false },
        { name: 'useState', type: 'named', isType: false },
        { name: 'useEffect', type: 'named', isType: false },
        { name: 'ReactNamespace', type: 'namespace', isType: false },
      ],
    };

    const { imports, resolvedExternals } = generateResolvedExternals(externals);

    expect(imports).toEqual([
      "import React, { useState, useEffect } from 'react';",
      "import * as ReactNamespace from 'react';",
    ]);
    expect(resolvedExternals).toEqual({ react: 'React' });
  });
});
