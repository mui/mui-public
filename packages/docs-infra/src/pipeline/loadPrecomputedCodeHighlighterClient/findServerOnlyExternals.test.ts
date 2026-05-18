import { describe, it, expect } from 'vitest';
import { findServerOnlyExternals, isServerOnlyModule } from './findServerOnlyExternals';
import type { Externals } from '../../CodeHighlighter/types';

describe('isServerOnlyModule', () => {
  it('flags the `server-only` package', () => {
    expect(isServerOnlyModule('server-only')).toBe(true);
  });

  it('flags any `node:` prefixed import', () => {
    expect(isServerOnlyModule('node:fs')).toBe(true);
    expect(isServerOnlyModule('node:fs/promises')).toBe(true);
    expect(isServerOnlyModule('node:custom-thing')).toBe(true);
  });

  it('flags unprefixed Node built-ins', () => {
    expect(isServerOnlyModule('fs')).toBe(true);
    expect(isServerOnlyModule('path')).toBe(true);
    expect(isServerOnlyModule('child_process')).toBe(true);
    expect(isServerOnlyModule('fs/promises')).toBe(true);
  });

  it('does not flag client-safe packages', () => {
    expect(isServerOnlyModule('react')).toBe(false);
    expect(isServerOnlyModule('@mui/material')).toBe(false);
    expect(isServerOnlyModule('lodash')).toBe(false);
    // Subpath of a regular package — only exact built-in matches are flagged.
    expect(isServerOnlyModule('some-pkg/path')).toBe(false);
  });
});

describe('findServerOnlyExternals', () => {
  it('returns an empty list when externals are client-safe', () => {
    const externals: Externals = {
      react: [{ name: 'React', type: 'default', isType: false }],
      '@mui/material': [{ name: 'Button', type: 'named', isType: false }],
    };
    expect(findServerOnlyExternals(externals)).toEqual([]);
  });

  it('collects every server-only module path', () => {
    const externals: Externals = {
      react: [{ name: 'React', type: 'default', isType: false }],
      fs: [{ name: 'readFile', type: 'named', isType: false }],
      'node:path': [{ name: 'path', type: 'default', isType: false }],
      'server-only': [],
    };
    expect(findServerOnlyExternals(externals).sort()).toEqual(
      ['fs', 'node:path', 'server-only'].sort(),
    );
  });

  it('detects a side-effect `server-only` import (empty names array)', () => {
    // Mirrors what the parser produces for `import 'server-only';` once it
    // flows through loadServerSource: the module key is preserved with no
    // imported names. We must check externals BEFORE filterRuntimeExternals
    // drops empty-names entries.
    const externals: Externals = {
      'server-only': [],
      react: [{ name: 'React', type: 'default', isType: false }],
    };
    expect(findServerOnlyExternals(externals)).toEqual(['server-only']);
  });
});
