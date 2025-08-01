import { describe, it, expect } from 'vitest';
import { mergeExternals } from './mergeExternals';

describe('mergeExternals', () => {
  it('should merge externals from multiple sources without duplicates', () => {
    const externals1 = {
      react: [{ name: 'React', type: 'default' as const }],
      lodash: [{ name: 'map', type: 'named' as const }],
    };

    const externals2 = {
      react: [{ name: 'useState', type: 'named' as const }],
      axios: [{ name: 'axios', type: 'default' as const }],
    };

    const result = mergeExternals([externals1, externals2]);

    expect(result).toEqual({
      react: [
        { name: 'React', type: 'default' },
        { name: 'useState', type: 'named' },
      ],
      lodash: [{ name: 'map', type: 'named' }],
      axios: [{ name: 'axios', type: 'default' }],
    });
  });

  it('should deduplicate identical imports', () => {
    const externals1 = {
      react: [
        { name: 'React', type: 'default' as const },
        { name: 'useState', type: 'named' as const },
      ],
    };

    const externals2 = {
      react: [
        { name: 'useState', type: 'named' as const }, // Duplicate
        { name: 'useEffect', type: 'named' as const },
      ],
    };

    const result = mergeExternals([externals1, externals2]);

    expect(result).toEqual({
      react: [
        { name: 'React', type: 'default' },
        { name: 'useState', type: 'named' },
        { name: 'useEffect', type: 'named' },
      ],
    });
  });

  it('should handle empty externals objects', () => {
    const externals1 = {};
    const externals2 = {
      react: [{ name: 'React', type: 'default' as const }],
    };
    const externals3 = {};

    const result = mergeExternals([externals1, externals2, externals3]);

    expect(result).toEqual({
      react: [{ name: 'React', type: 'default' }],
    });
  });

  it('should handle empty array', () => {
    const result = mergeExternals([]);
    expect(result).toEqual({});
  });

  it('should handle single externals object', () => {
    const externals = {
      react: [{ name: 'React', type: 'default' as const }],
      '@mui/material': [{ name: 'Button', type: 'named' as const }],
    };

    const result = mergeExternals([externals]);

    expect(result).toEqual(externals);
  });

  it('should handle multiple imports from same module across multiple sources', () => {
    const externals1 = {
      '@mui/material': [{ name: 'Button', type: 'named' as const }],
    };

    const externals2 = {
      '@mui/material': [{ name: 'TextField', type: 'named' as const }],
    };

    const externals3 = {
      '@mui/material': [{ name: 'Box', type: 'named' as const }],
    };

    const result = mergeExternals([externals1, externals2, externals3]);

    expect(result).toEqual({
      '@mui/material': [
        { name: 'Button', type: 'named' },
        { name: 'TextField', type: 'named' },
        { name: 'Box', type: 'named' },
      ],
    });
  });

  it('should handle different import types for same name', () => {
    const externals1 = {
      lodash: [{ name: 'default', type: 'default' as const }],
    };

    const externals2 = {
      lodash: [{ name: 'default', type: 'named' as const }], // Same name, different type
    };

    const result = mergeExternals([externals1, externals2]);

    expect(result).toEqual({
      lodash: [
        { name: 'default', type: 'default' },
        { name: 'default', type: 'named' },
      ],
    });
  });

  it('should handle namespace imports', () => {
    const externals1 = {
      react: [{ name: 'React', type: 'namespace' as const }],
    };

    const externals2 = {
      react: [{ name: 'useState', type: 'named' as const }],
    };

    const result = mergeExternals([externals1, externals2]);

    expect(result).toEqual({
      react: [
        { name: 'React', type: 'namespace' },
        { name: 'useState', type: 'named' },
      ],
    });
  });

  it('should preserve order of first occurrence', () => {
    const externals1 = {
      react: [
        { name: 'useState', type: 'named' as const },
        { name: 'useEffect', type: 'named' as const },
      ],
    };

    const externals2 = {
      react: [
        { name: 'useRef', type: 'named' as const },
        { name: 'useState', type: 'named' as const }, // Duplicate, should be ignored
      ],
    };

    const result = mergeExternals([externals1, externals2]);

    expect(result).toEqual({
      react: [
        { name: 'useState', type: 'named' },
        { name: 'useEffect', type: 'named' },
        { name: 'useRef', type: 'named' },
      ],
    });
  });

  it('should preserve isType flags when merging externals', () => {
    const externals1 = {
      react: [
        { name: 'React', type: 'default' as const },
        { name: 'FC', type: 'named' as const, isType: true },
        { name: 'ReactNode', type: 'named' as const, isType: true },
      ],
    };

    const externals2 = {
      react: [
        { name: 'useState', type: 'named' as const },
        { name: 'ComponentType', type: 'named' as const, isType: true },
      ],
    };

    const result = mergeExternals([externals1, externals2]);

    expect(result).toEqual({
      react: [
        { name: 'React', type: 'default' },
        { name: 'FC', type: 'named', isType: true },
        { name: 'ReactNode', type: 'named', isType: true },
        { name: 'useState', type: 'named' },
        { name: 'ComponentType', type: 'named', isType: true },
      ],
    });
  });

  it('should deduplicate identical imports with isType flags', () => {
    const externals1 = {
      react: [
        { name: 'FC', type: 'named' as const, isType: true },
        { name: 'useState', type: 'named' as const },
      ],
    };

    const externals2 = {
      react: [
        { name: 'FC', type: 'named' as const, isType: true }, // Exact duplicate
        { name: 'useEffect', type: 'named' as const },
      ],
    };

    const result = mergeExternals([externals1, externals2]);

    expect(result).toEqual({
      react: [
        { name: 'FC', type: 'named', isType: true },
        { name: 'useState', type: 'named' },
        { name: 'useEffect', type: 'named' },
      ],
    });
  });

  it('should treat same name with different isType flags as different imports', () => {
    const externals1 = {
      react: [
        { name: 'Component', type: 'named' as const }, // Runtime import
      ],
    };

    const externals2 = {
      react: [
        { name: 'Component', type: 'named' as const, isType: true }, // Type import
      ],
    };

    const result = mergeExternals([externals1, externals2]);

    expect(result).toEqual({
      react: [
        { name: 'Component', type: 'named' },
        { name: 'Component', type: 'named', isType: true },
      ],
    });
  });

  it('should handle mixed type and runtime imports from multiple modules', () => {
    const externals1 = {
      react: [
        { name: 'React', type: 'default' as const },
        { name: 'FC', type: 'named' as const, isType: true },
      ],
      '@mui/material': [{ name: 'Button', type: 'named' as const }],
    };

    const externals2 = {
      react: [
        { name: 'useState', type: 'named' as const },
        { name: 'ReactNode', type: 'named' as const, isType: true },
      ],
      '@mui/material': [{ name: 'ButtonProps', type: 'named' as const, isType: true }],
      typescript: [{ name: 'TSConfig', type: 'named' as const, isType: true }],
    };

    const result = mergeExternals([externals1, externals2]);

    expect(result).toEqual({
      react: [
        { name: 'React', type: 'default' },
        { name: 'FC', type: 'named', isType: true },
        { name: 'useState', type: 'named' },
        { name: 'ReactNode', type: 'named', isType: true },
      ],
      '@mui/material': [
        { name: 'Button', type: 'named' },
        { name: 'ButtonProps', type: 'named', isType: true },
      ],
      typescript: [{ name: 'TSConfig', type: 'named', isType: true }],
    });
  });

  it('should handle complex scenarios with aliases and isType flags', () => {
    const externals1 = {
      react: [{ name: 'Component', type: 'named' as const, alias: 'ReactComponent', isType: true }],
    };

    const externals2 = {
      react: [
        { name: 'Component', type: 'named' as const, alias: 'ReactComponent', isType: true }, // Exact duplicate
        { name: 'Component', type: 'named' as const, alias: 'Comp' }, // Different alias, no isType
      ],
    };

    const result = mergeExternals([externals1, externals2]);

    expect(result).toEqual({
      react: [
        { name: 'Component', type: 'named', alias: 'ReactComponent', isType: true },
        { name: 'Component', type: 'named', alias: 'Comp' },
      ],
    });
  });
});
