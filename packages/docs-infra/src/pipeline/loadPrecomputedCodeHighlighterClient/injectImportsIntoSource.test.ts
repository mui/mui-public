import { describe, it, expect } from 'vitest';
import { injectImportsIntoSource } from './injectImportsIntoSource';

describe('injectImportsIntoSource', () => {
  it('should inject imports after use client directive', () => {
    const source = `'use client';

import { createDemoClient } from './createDemoClient';

export const Demo = createDemoClient(import.meta.url);`;

    const importLines = ["import React from 'react';", "import { Button } from '@mui/material';"];

    const result = injectImportsIntoSource(source, importLines);

    expect(result).toBe(`'use client';

import React from 'react';
import { Button } from '@mui/material';

import { createDemoClient } from './createDemoClient';

export const Demo = createDemoClient(import.meta.url);`);
  });

  it('should inject imports at the beginning when no use client directive', () => {
    const source = `import { createDemoClient } from './createDemoClient';

export const Demo = createDemoClient(import.meta.url);`;

    const importLines = ["import React from 'react';", "import { Button } from '@mui/material';"];

    const result = injectImportsIntoSource(source, importLines);

    expect(result).toBe(`import React from 'react';
import { Button } from '@mui/material';

import { createDemoClient } from './createDemoClient';

export const Demo = createDemoClient(import.meta.url);`);
  });

  it('should return source unchanged when no imports to inject', () => {
    const source = `'use client';

import { createDemoClient } from './createDemoClient';

export const Demo = createDemoClient(import.meta.url);`;

    const importLines: string[] = [];

    const result = injectImportsIntoSource(source, importLines);

    expect(result).toBe(source);
  });

  it('should handle use client with double quotes', () => {
    const source = `"use client";

export const Demo = createDemoClient(import.meta.url);`;

    const importLines = ["import React from 'react';"];

    const result = injectImportsIntoSource(source, importLines);

    expect(result).toBe(`"use client";

import React from 'react';

export const Demo = createDemoClient(import.meta.url);`);
  });

  it('should handle use client with extra whitespace', () => {
    const source = `'use client';   

export const Demo = createDemoClient(import.meta.url);`;

    const importLines = ["import React from 'react';"];

    const result = injectImportsIntoSource(source, importLines);

    expect(result).toBe(`'use client';   

import React from 'react';

export const Demo = createDemoClient(import.meta.url);`);
  });
});
