import { describe, it, expect } from 'vitest';
import type { Code } from '../../CodeHighlighter/types';
import { detectFileTypes } from './detectFileTypes';

describe('detectFileTypes', () => {
  it('detects js from the main file extension', () => {
    expect(detectFileTypes({ Default: { fileName: 'App.tsx' } } as Code)).toEqual({
      js: true,
      css: false,
    });
  });

  it.each(['index.js', 'index.mjs', 'index.jsx', 'index.ts', 'index.tsx'])(
    'treats %s as js',
    (fileName) => {
      expect(detectFileTypes({ Default: { fileName } } as Code).js).toBe(true);
    },
  );

  it('detects css from an extra file', () => {
    const code = {
      Default: { fileName: 'App.tsx', extraFiles: { 'styles.css': { source: '' } } },
    } as Code;
    expect(detectFileTypes(code)).toEqual({ js: true, css: true });
  });

  it('counts a module CSS extra (ends in .css)', () => {
    const code = {
      Default: { fileName: 'App.tsx', extraFiles: { 'theme.module.css': { source: '' } } },
    } as Code;
    expect(detectFileTypes(code).css).toBe(true);
  });

  it('reports neither for a non-js, non-css file', () => {
    expect(detectFileTypes({ Default: { fileName: 'data.json' } } as Code)).toEqual({
      js: false,
      css: false,
    });
  });

  it('aggregates across variants', () => {
    const code = {
      A: { fileName: 'A.tsx' },
      B: { fileName: 'B.css' },
    } as Code;
    expect(detectFileTypes(code)).toEqual({ js: true, css: true });
  });

  it('ignores bare-string and undefined variants', () => {
    const code = { A: 'const x = 1;', B: undefined } as unknown as Code;
    expect(detectFileTypes(code)).toEqual({ js: false, css: false });
  });
});
