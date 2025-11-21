import { describe, it, expect } from 'vitest';
import { externalsToPackages } from './externalsToPackages';

describe('externalsToPackages', () => {
  it('should handle basic package names', () => {
    const externals = ['react', 'react-dom', 'lodash'];
    const result = externalsToPackages(externals);

    expect(result).toEqual({
      react: true,
      'react-dom': true,
      lodash: true,
    });
  });

  it('should extract package names from scoped packages', () => {
    const externals = [
      '@mui/internal-docs-infra/CodeHighlighter',
      '@mui/internal-docs-infra/pipeline/parseSource',
      '@mui/material/Button',
      '@types/node',
    ];
    const result = externalsToPackages(externals);

    expect(result).toEqual({
      '@mui/internal-docs-infra': true,
      '@mui/material': true,
      '@types/node': true,
    });
  });

  it('should extract package names from submodule imports', () => {
    const externals = ['lodash/get', 'lodash/map', 'ramda/src/map', 'date-fns/format'];
    const result = externalsToPackages(externals);

    expect(result).toEqual({
      lodash: true,
      ramda: true,
      'date-fns': true,
    });
  });

  it('should handle mixed import types as described in the example', () => {
    const externals = [
      'react',
      'react-dom',
      '@mui/internal-docs-infra/CodeHighlighter',
      '@mui/internal-docs-infra/pipeline/parseSource',
      '@mui/internal-docs-infra/pipeline/transformTypescriptToJavascript',
      '@mui/internal-docs-infra/useCode',
    ];
    const result = externalsToPackages(externals);

    expect(result).toEqual({
      react: true,
      'react-dom': true,
      '@mui/internal-docs-infra': true,
    });
  });

  it('should deduplicate package names', () => {
    const externals = [
      'react',
      'react/jsx-runtime',
      'lodash/get',
      'lodash/map',
      '@mui/material/Button',
      '@mui/material/TextField',
    ];
    const result = externalsToPackages(externals);

    expect(result).toEqual({
      react: true,
      lodash: true,
      '@mui/material': true,
    });
  });

  it('should handle empty array', () => {
    const externals: string[] = [];
    const result = externalsToPackages(externals);

    expect(result).toEqual({});
  });

  it('should handle empty strings and invalid inputs', () => {
    const externals = ['', 'react', '', 'lodash/get'];
    const result = externalsToPackages(externals);

    expect(result).toEqual({
      react: true,
      lodash: true,
    });
  });

  it('should handle malformed scoped package names', () => {
    const externals = ['@', '@scope', '@scope/package', '@scope/package/submodule'];
    const result = externalsToPackages(externals);

    expect(result).toEqual({
      '@scope/package': true,
    });
  });

  it('should handle deep nested imports', () => {
    const externals = [
      'some-package/lib/utils/helper',
      '@company/toolkit/components/Button/variants/primary',
      'lodash/fp/map',
    ];
    const result = externalsToPackages(externals);

    expect(result).toEqual({
      'some-package': true,
      '@company/toolkit': true,
      lodash: true,
    });
  });

  it('should handle relative path-like imports (though they should not be externals)', () => {
    const externals = ['./relative', '../parent', 'actual-package', 'actual-package/submodule'];
    const result = externalsToPackages(externals);

    expect(result).toEqual({
      '.': true,
      '..': true,
      'actual-package': true,
    });
  });

  it('should handle complex real-world example', () => {
    const externals = [
      'react',
      'react/jsx-runtime',
      'react-dom',
      '@mui/material/Button',
      '@mui/material/TextField',
      '@mui/system/styled',
      '@emotion/react',
      '@emotion/styled',
      'lodash/debounce',
      'date-fns/format',
      'clsx',
      'prop-types',
    ];
    const result = externalsToPackages(externals);

    expect(result).toEqual({
      react: true,
      'react-dom': true,
      '@mui/material': true,
      '@mui/system': true,
      '@emotion/react': true,
      '@emotion/styled': true,
      lodash: true,
      'date-fns': true,
      clsx: true,
      'prop-types': true,
    });
  });

  it('should filter out path aliases that start with @/', () => {
    const externals = [
      'react',
      '@/components/Button',
      '@/utils/helpers',
      '@mui/material/Button',
      '@/src/types',
      'lodash/get',
      '@/lib/constants',
    ];
    const result = externalsToPackages(externals);

    expect(result).toEqual({
      react: true,
      '@mui/material': true,
      lodash: true,
    });
  });
});
