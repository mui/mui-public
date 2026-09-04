import { describe, expect, it, vi } from 'vitest';
import type { Externals, LoadSource } from '../../CodeHighlighter/types';
import { generateDemoExternalsModule } from './generateDemoExternalsModule';

const MATERIAL_DEMO_URL = new URL('../precomputeDemo/fixtures/material-demo/', import.meta.url);

describe('generateDemoExternalsModule', () => {
  it('generates imports for a file-backed demo', async () => {
    const result = await generateDemoExternalsModule({
      entries: [
        {
          name: 'Default',
          url: new URL('BasicButtons.tsx', MATERIAL_DEMO_URL).href,
        },
      ],
    });

    expect(result.imports).toEqual(["import * as React from 'react';"]);
    expect(result.valueExpression).toBe('{ react: React }');
    expect(result.externals).toEqual({
      react: [{ isType: undefined, name: 'React', type: 'namespace' }],
    });
    expect(result.dependencies.map((dependency) => new URL(dependency).pathname)).toEqual([
      new URL('BasicButtons.tsx', MATERIAL_DEMO_URL).pathname,
      new URL('helper.ts', MATERIAL_DEMO_URL).pathname,
      new URL('nested/data.ts', MATERIAL_DEMO_URL).pathname,
    ]);
  });

  it('supports default, named, namespace, aliased, and type-only imports', async () => {
    const externals: Externals = {
      react: [
        { name: 'React', type: 'default' },
        { name: 'useId', type: 'named' },
        { name: 'ComponentProps', type: 'named', isType: true },
      ],
      '@mui/material': [{ name: 'Button', type: 'named' }],
      lodash: [{ name: 'lodash', type: 'namespace' }],
      '@scope/package': [{ name: 'Original', type: 'named' }],
    };
    const loadSource = vi.fn<LoadSource>(async () => ({ source: '', externals }));

    const result = await generateDemoExternalsModule({
      entries: [{ name: 'Default', url: 'file:///demo.tsx' }],
      existingNames: ['Button'],
      loadSource,
    });

    expect(result.imports).toEqual([
      "import React, { useId } from 'react';",
      "import { Button as Buttonmuimaterial } from '@mui/material';",
      "import * as lodash from 'lodash';",
      "import { Original } from '@scope/package';",
    ]);
    expect(result.valueExpression).toBe(
      '{ react: React, "@mui/material": { Button: Buttonmuimaterial }, lodash: lodash, "@scope/package": { Original } }',
    );
    expect(result.externals).toEqual({
      react: [
        { name: 'React', type: 'default' },
        { name: 'useId', type: 'named' },
      ],
      '@mui/material': [{ name: 'Button', type: 'named' }],
      lodash: [{ name: 'lodash', type: 'namespace' }],
      '@scope/package': [{ name: 'Original', type: 'named' }],
    });
  });

  it('deduplicates dependencies from multiple entries', async () => {
    const loadSource = vi.fn<LoadSource>(async (url) => {
      if (url.endsWith('shared.ts')) {
        return { source: '' };
      }
      return {
        source: '',
        extraDependencies: ['file:///shared.ts'],
        extraFiles: { 'shared.ts': 'file:///shared.ts' },
      };
    });

    const result = await generateDemoExternalsModule({
      entries: [
        { name: 'First', url: 'file:///First.tsx' },
        { name: 'Second', url: 'file:///Second.tsx' },
      ],
      loadSource,
    });

    expect(result.dependencies).toEqual([
      'file:///First.tsx',
      'file:///shared.ts',
      'file:///Second.tsx',
    ]);
  });

  it('rejects server-only imports before generating client code', async () => {
    const loadSource = vi.fn<LoadSource>(async () => ({
      source: '',
      externals: {
        react: [{ name: 'React', type: 'namespace' }],
        'node:fs': [{ name: 'readFile', type: 'named' }],
        'server-only': [],
      },
    }));

    const promise = generateDemoExternalsModule({
      entries: [{ name: 'Default', url: 'file:///demo.tsx' }],
      loadSource,
    });

    await expect(promise).rejects.toMatchObject({
      dependencies: ['file:///demo.tsx'],
      modules: ['node:fs', 'server-only'],
      name: 'ServerOnlyDemoExternalError',
    });
  });

  it('rejects duplicate entry names before loading source', async () => {
    const loadSource = vi.fn<LoadSource>(async () => ({ source: '' }));

    await expect(
      generateDemoExternalsModule({
        entries: [
          { name: 'Default', url: 'file:///First.tsx' },
          { name: 'Default', url: 'file:///Second.tsx' },
        ],
        loadSource,
      }),
    ).rejects.toThrow('Duplicate demo entry name: Default');
    expect(loadSource).not.toHaveBeenCalled();
  });
});
