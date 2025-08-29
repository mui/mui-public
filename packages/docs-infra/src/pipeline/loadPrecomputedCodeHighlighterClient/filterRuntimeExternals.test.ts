import { describe, it, expect } from 'vitest';
import { filterRuntimeExternals } from './filterRuntimeExternals';
import type { Externals } from '../../CodeHighlighter/types';

describe('filterRuntimeExternals', () => {
  it('should filter out type-only imports', () => {
    const externals: Externals = {
      react: [
        { name: 'default', type: 'default', isType: false },
        { name: 'ComponentType', type: 'named', isType: true },
        { name: 'ReactNode', type: 'named', isType: true },
      ],
      '@mui/material': [
        { name: 'Button', type: 'named', isType: false },
        { name: 'ButtonProps', type: 'named', isType: true },
      ],
      'type-only-module': [{ name: 'TypeOnly', type: 'named', isType: true }],
    };

    const result = filterRuntimeExternals(externals);

    expect(result).toEqual({
      react: [{ name: 'default', type: 'default', isType: false }],
      '@mui/material': [{ name: 'Button', type: 'named', isType: false }],
      // 'type-only-module' should be completely removed since it has no runtime imports
    });
  });

  it('should handle externals with no type-only imports', () => {
    const externals: Externals = {
      react: [{ name: 'default', type: 'default', isType: false }],
      '@mui/material': [
        { name: 'Button', type: 'named', isType: false },
        { name: 'TextField', type: 'named', isType: false },
      ],
    };

    const result = filterRuntimeExternals(externals);

    expect(result).toEqual(externals);
  });

  it('should handle empty externals', () => {
    const externals: Externals = {};

    const result = filterRuntimeExternals(externals);

    expect(result).toEqual({});
  });

  it('should handle externals where all imports are type-only', () => {
    const externals: Externals = {
      'type-module': [
        { name: 'TypeA', type: 'named', isType: true },
        { name: 'TypeB', type: 'named', isType: true },
      ],
    };

    const result = filterRuntimeExternals(externals);

    expect(result).toEqual({});
  });

  it('should handle imports without isType flag (defaults to false)', () => {
    const externals: Externals = {
      react: [
        { name: 'default', type: 'default' }, // isType is undefined
        { name: 'useState', type: 'named' }, // isType is undefined
      ],
    };

    const result = filterRuntimeExternals(externals);

    expect(result).toEqual({
      react: [
        { name: 'default', type: 'default' },
        { name: 'useState', type: 'named' },
      ],
    });
  });
});
