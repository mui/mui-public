import { describe, expect, it } from 'vitest';
import { parseCreateFactoryCall } from '../parseCreateFactoryCall';
import { injectGeneratedExternals } from './injectGeneratedExternals';

const SOURCE = `'use client';

import { createDemoClient } from './createDemoClient';

export const Demo = createDemoClient(import.meta.url);`;

describe('injectGeneratedExternals', () => {
  it('preserves the existing client output shape', async () => {
    const demoCall = await parseCreateFactoryCall(SOURCE, 'file:///client.ts', {
      metadataOnly: true,
    });
    if (!demoCall) {
      throw new Error('Expected a client factory call');
    }

    const result = injectGeneratedExternals(SOURCE, demoCall, {
      dependencies: ['file:///Example.tsx'],
      externals: {
        react: [{ name: 'React', type: 'namespace' }],
        '@mui/material': [{ name: 'Button', type: 'named' }],
      },
      imports: ["import * as React from 'react';", "import { Button } from '@mui/material';"],
      valueExpression: '{ react: React, "@mui/material": { Button } }',
    });

    expect(result).toMatchInlineSnapshot(`
      "'use client';

      import * as React from 'react';
      import { Button } from '@mui/material';

      import { createDemoClient } from './createDemoClient';

      export const Demo = createDemoClient(import.meta.url, { precompute: { externals: { react: React, "@mui/material": { Button } } } });"
    `);
  });
});
