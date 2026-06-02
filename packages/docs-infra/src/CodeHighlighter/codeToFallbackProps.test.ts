import { describe, it, expect } from 'vitest';
import {
  codeToFallbackProps,
  deriveFallbacksFromCode,
  stripFallbackHastsFromCode,
} from './codeToFallbackProps';
import type { Code, HastRoot } from './types';
import type { FallbackNode } from './fallbackFormat';

/** Minimal HAST root for testing */
function hast(text: string): HastRoot {
  return { type: 'root', children: [{ type: 'text', value: text }] };
}

/** Minimal compact fallback for testing */
function fb(text: string): FallbackNode[] {
  return [text];
}

describe('codeToFallbackProps', () => {
  describe('basic functionality', () => {
    it('should return empty object for missing or string variant', () => {
      expect(codeToFallbackProps('missing', {})).toEqual({});
      expect(codeToFallbackProps('string', { string: 'highlighted html' })).toEqual({});
    });

    it('should derive source from variant HastRoot when no allFallbackHasts provided', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: hast('const App = () => <div>Hello</div>;'),
        },
      };

      const result = codeToFallbackProps('javascript', code);

      expect(result).toEqual({
        fileNames: ['App.js'],
        source: fb('const App = () => <div>Hello</div>;'),
        language: 'javascript',
      });
    });

    it('should derive a plain-text fallback from a raw string source', () => {
      // `<CodeHighlighter>{code}</CodeHighlighter>` (no precompute) keeps the
      // source as a string; the fallback must still render the raw code so the
      // first render isn't blank before client-side highlighting.
      const code: Code = {
        javascript: {
          fileName: 'large-file.js',
          source: 'const a = 1;\nconst b = 2;',
        },
      };

      const result = codeToFallbackProps('javascript', code);

      expect(result).toEqual({
        fileNames: ['large-file.js'],
        source: ['const a = 1;\nconst b = 2;'],
        language: 'javascript',
      });
    });

    it('should prefer the variant fallback field over deriving from HastRoot source', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: hast('full'),
          fallback: fb('fallback'),
        },
      };

      const result = codeToFallbackProps('javascript', code);

      // The pre-extracted variant `fallback` is preferred over re-deriving it.
      expect(result.source).toEqual(fb('fallback'));
    });

    it('should handle variant without fileName', () => {
      const code: Code = {
        javascript: {
          fileName: undefined,
          source: hast('const App = () => <div>Hello</div>;'),
        },
      };

      const result = codeToFallbackProps('javascript', code);

      expect(result).toEqual({
        fileNames: [],
        source: fb('const App = () => <div>Hello</div>;'),
      });
    });

    it('should derive source from hastJson format (precomputed loader output)', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: { hastJson: JSON.stringify(hast('precomputed content')) },
        },
      };

      const result = codeToFallbackProps('javascript', code);

      expect(result).toEqual({
        fileNames: ['App.js'],
        source: fb('precomputed content'),
        language: 'javascript',
      });
    });

    it('should return no source for hastCompressed format (needs dictionary)', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: { hastCompressed: 'base64data' },
        },
      };

      const result = codeToFallbackProps('javascript', code);

      expect(result).toEqual({
        fileNames: ['App.js'],
      });
    });

    it('should derive extraSource from hastJson format', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: { hastJson: JSON.stringify(hast('app')) },
          extraFiles: {
            'utils.js': { source: { hastJson: JSON.stringify(hast('utils')) } },
          },
        },
      };

      const result = codeToFallbackProps('javascript', code, undefined, true);

      expect(result.source).toEqual(fb('app'));
      expect(result.extraSource).toEqual({ 'utils.js': fb('utils') });
    });
  });

  describe('fileNames include extra files', () => {
    it('should list extra file names', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: hast('app'),
          extraFiles: {
            'utils.js': { source: hast('utils') },
          },
        },
      };

      const result = codeToFallbackProps('javascript', code, undefined, true);

      expect(result.fileNames).toEqual(['App.js', 'utils.js']);
      // extraSource derived from extra file HastRoot when no allFallbackHasts
      expect(result.extraSource).toEqual({ 'utils.js': fb('utils') });
    });
  });

  describe('needsAllVariants handling', () => {
    it('should include extraVariants with fileNames only', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: hast('hello js'),
          extraFiles: {
            'utils.js': { source: hast('js utils') },
          },
        },
        typescript: {
          fileName: 'App.ts',
          source: hast('hello ts'),
          extraFiles: {
            'utils.ts': { source: hast('ts utils') },
          },
        },
      };

      const result = codeToFallbackProps('javascript', code, undefined, false, true);

      expect(result).toEqual({
        fileNames: ['App.js', 'utils.js'],
        source: fb('hello js'),
        language: 'javascript',
        extraSource: { 'utils.js': fb('js utils') },
        extraVariants: {
          typescript: {
            fileNames: ['App.ts', 'utils.ts'],
            source: fb('hello ts'),
            language: 'typescript',
            extraSource: { 'utils.ts': fb('ts utils') },
          },
        },
      });
    });

    it('should not include main variant in extraVariants', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: hast('hello js'),
        },
        typescript: {
          fileName: 'App.ts',
          source: hast('hello ts'),
        },
      };

      const result = codeToFallbackProps('javascript', code, undefined, false, true);

      expect(result.extraVariants).toEqual({
        typescript: {
          fileNames: ['App.ts'],
          source: fb('hello ts'),
          language: 'typescript',
        },
      });
      expect(result.extraVariants).not.toHaveProperty('javascript');
    });
  });

  describe('language hint', () => {
    it('should emit language for the main variant derived from the file extension', () => {
      const code: Code = {
        typescript: {
          fileName: 'Button.ts',
          source: hast('const Button = 1;'),
        },
      };

      const result = codeToFallbackProps('typescript', code);

      expect(result.language).toBe('typescript');
    });

    it('should derive language from a css file extension', () => {
      const code: Code = {
        styles: {
          fileName: 'Button.css',
          source: hast('.button { color: red; }'),
        },
      };

      const result = codeToFallbackProps('styles', code);

      expect(result.language).toBe('css');
    });

    it('should prefer an explicit variant language over the file extension', () => {
      const code: Code = {
        javascript: {
          fileName: 'Button.js',
          source: hast('const Button = 1;'),
          language: 'tsx',
        },
      };

      const result = codeToFallbackProps('javascript', code);

      // The explicit `language` wins even though `.js` would map to `javascript`.
      expect(result.language).toBe('tsx');
    });

    it('should emit language for each extra variant under needsAllVariants', () => {
      const code: Code = {
        javascript: {
          fileName: 'Button.js',
          source: hast('const Button = 1;'),
        },
        typescript: {
          fileName: 'Button.ts',
          source: hast('const Button = 1;'),
        },
      };

      const result = codeToFallbackProps('javascript', code, undefined, false, true);

      expect(result.language).toBe('javascript');
      expect(result.extraVariants?.typescript?.language).toBe('typescript');
    });

    it('should omit language when no source is derivable (hastCompressed without allFallbackHasts)', () => {
      const code: Code = {
        javascript: {
          fileName: 'Button.js',
          source: { hastCompressed: 'base64data' },
        },
      };

      const result = codeToFallbackProps('javascript', code);

      // `language` is gated on a present `source`; an undecodable compressed
      // payload yields no source here, so no language hint either.
      expect(result.source).toBeUndefined();
      expect(result.language).toBeUndefined();
    });

    it('should omit language when the file name has no recognizable extension', () => {
      const code: Code = {
        javascript: {
          fileName: 'myFunction',
          source: hast('const myFunction = () => {};'),
        },
      };

      const result = codeToFallbackProps('javascript', code);

      // Source is present, but `myFunction` has no extension to derive from.
      expect(result.source).toEqual(fb('const myFunction = () => {};'));
      expect(result.language).toBeUndefined();
    });
  });
});

describe('stripFallbackHastsFromCode', () => {
  it('should strip main variant fallback and return it separately', () => {
    const fallback = fb('fallback');
    const code: Code = {
      javascript: {
        fileName: 'App.js',
        source: { hastCompressed: 'abc' },
        fallback,
      },
    };

    const { strippedCode, allFallbackHasts } = stripFallbackHastsFromCode(code, 'javascript');

    // fallback should be removed from Code
    const variant = strippedCode.javascript;
    expect(variant).toBeDefined();
    expect(typeof variant === 'object' && variant !== null && 'fallback' in variant).toBe(false);

    // Should be in the extracted map
    expect(allFallbackHasts).toEqual({
      javascript: { 'App.js': fallback },
    });
  });

  it('should strip extra files when fallbackUsesExtraFiles is true', () => {
    const fbMain = fb('main');
    const fbExtra = fb('extra');
    const code: Code = {
      javascript: {
        fileName: 'App.js',
        source: { hastCompressed: 'abc' },
        fallback: fbMain,
        extraFiles: {
          'utils.js': {
            source: { hastCompressed: 'def' },
            fallback: fbExtra,
          },
        },
      },
    };

    const { strippedCode, allFallbackHasts } = stripFallbackHastsFromCode(
      code,
      'javascript',
      true, // fallbackUsesExtraFiles
    );

    const variant = strippedCode.javascript as any;
    expect(variant.fallback).toBeUndefined();
    expect(variant.extraFiles['utils.js'].fallback).toBeUndefined();
    expect(variant.extraFiles['utils.js'].source).toEqual({ hastCompressed: 'def' });

    expect(allFallbackHasts).toEqual({
      javascript: {
        'App.js': fbMain,
        'utils.js': fbExtra,
      },
    });
  });

  it('should strip all variants when fallbackUsesAllVariants is true', () => {
    const fbJs = fb('js');
    const fbTs = fb('ts');
    const code: Code = {
      javascript: {
        fileName: 'App.js',
        source: { hastCompressed: 'abc' },
        fallback: fbJs,
      },
      typescript: {
        fileName: 'App.ts',
        source: { hastCompressed: 'def' },
        fallback: fbTs,
      },
    };

    const { strippedCode, allFallbackHasts } = stripFallbackHastsFromCode(
      code,
      'javascript',
      false,
      true, // fallbackUsesAllVariants
    );

    expect((strippedCode.javascript as any).fallback).toBeUndefined();
    expect((strippedCode.typescript as any).fallback).toBeUndefined();

    expect(allFallbackHasts).toEqual({
      javascript: { 'App.js': fbJs },
      typescript: { 'App.ts': fbTs },
    });
  });

  it('should leave variants without fallback unchanged', () => {
    const code: Code = {
      javascript: {
        fileName: 'App.js',
        source: 'const x = 1;',
      },
    };

    const { strippedCode, allFallbackHasts } = stripFallbackHastsFromCode(code, 'javascript');

    expect(strippedCode).toEqual(code);
    expect(allFallbackHasts).toEqual({});
  });
});

describe('deriveFallbacksFromCode', () => {
  it('reads the main + extra file fallbacks off the variant', () => {
    const fbMain = fb('main');
    const fbExtra = fb('extra');
    const code: Code = {
      javascript: {
        fileName: 'App.js',
        source: { hastCompressed: 'abc' },
        fallback: fbMain,
        extraFiles: {
          'utils.js': {
            source: { hastCompressed: 'def' },
            fallback: fbExtra,
          },
        },
      },
    };

    expect(deriveFallbacksFromCode(code, 'javascript')).toEqual({
      'App.js': fbMain,
      'utils.js': fbExtra,
    });
  });

  it('returns undefined when the variant fallback was stripped (ContentLoading case)', () => {
    // After `stripFallbackHastsFromCode` the fallback lives on ContentLoading
    // props instead, so deriving from Code must find nothing and defer to the
    // hoisted copy.
    const code: Code = {
      javascript: {
        fileName: 'App.js',
        source: { hastCompressed: 'abc' },
      },
    };

    expect(deriveFallbacksFromCode(code, 'javascript')).toBeUndefined();
  });

  it('returns undefined for a string variant or a missing variant', () => {
    const code: Code = { javascript: 'const x = 1;' };

    expect(deriveFallbacksFromCode(code, 'javascript')).toBeUndefined();
    expect(deriveFallbacksFromCode(code, 'typescript')).toBeUndefined();
    expect(deriveFallbacksFromCode(undefined, 'javascript')).toBeUndefined();
  });

  it('omits extra files that have no fallback of their own', () => {
    const fbMain = fb('main');
    const code: Code = {
      javascript: {
        fileName: 'App.js',
        source: { hastCompressed: 'abc' },
        fallback: fbMain,
        extraFiles: {
          'utils.js': { source: { hastCompressed: 'def' } },
        },
      },
    };

    expect(deriveFallbacksFromCode(code, 'javascript')).toEqual({ 'App.js': fbMain });
  });
});
