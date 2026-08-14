import { describe, expect, it } from 'vitest';
import { getLanguageCapabilitiesFromScope, isJavascriptSource } from './languageCapabilities';

describe('isJavascriptSource', () => {
  it('recognizes the JavaScript extensions', () => {
    for (const fileName of ['Button.js', 'Button.jsx', 'setup.mjs', 'setup.cjs']) {
      expect(isJavascriptSource(fileName)).toBe(true);
    }
  });

  it('does not recognize the TypeScript extensions', () => {
    for (const fileName of ['Button.ts', 'Button.tsx', 'types.d.ts']) {
      expect(isJavascriptSource(fileName)).toBe(false);
    }
  });

  it('prefers an explicit language over the file name', () => {
    expect(isJavascriptSource('Button.tsx', 'js')).toBe(true);
    expect(isJavascriptSource('Button.js', 'tsx')).toBe(false);
  });

  it('reads a language with no file name', () => {
    expect(isJavascriptSource(undefined, 'javascript')).toBe(true);
    expect(isJavascriptSource(undefined, 'typescript')).toBe(false);
    expect(isJavascriptSource()).toBe(false);
  });
});

describe('getLanguageCapabilitiesFromScope', () => {
  it('reports types for TypeScript', () => {
    expect(getLanguageCapabilitiesFromScope('source.tsx', { fileName: 'Button.tsx' })).toEqual({
      supportsTypes: true,
      supportsJsx: true,
      semantics: 'js',
    });
  });

  it('withholds types from JavaScript sharing the TypeScript grammar', () => {
    // `string` and `number` are ordinary variable names in JavaScript, so
    // type-only styling would mark them wrongly.
    expect(getLanguageCapabilitiesFromScope('source.tsx', { fileName: 'Button.js' })).toEqual({
      supportsTypes: false,
      supportsJsx: true,
      semantics: 'js',
    });
  });

  it('withholds types from a JSX file too', () => {
    expect(
      getLanguageCapabilitiesFromScope('source.tsx', { fileName: 'Button.jsx' }).supportsTypes,
    ).toBe(false);
  });

  it('keeps JSX support while withholding types', () => {
    expect(getLanguageCapabilitiesFromScope('source.tsx', { fileName: 'Button.js' })).toMatchObject(
      {
        supportsJsx: true,
      },
    );
  });

  it('reports types when no file is given', () => {
    expect(getLanguageCapabilitiesFromScope('source.tsx').supportsTypes).toBe(true);
  });

  it('leaves the other scopes alone', () => {
    expect(getLanguageCapabilitiesFromScope('source.css', { fileName: 'a.css' })).toEqual({
      supportsTypes: false,
      supportsJsx: false,
      semantics: 'css',
    });
    expect(
      getLanguageCapabilitiesFromScope('source.mdx', { fileName: 'a.mdx' }).supportsTypes,
    ).toBe(true);
  });
});
