import { describe, it, expect } from 'vitest';
import { codeToFallbackProps, stripFallbackHastsFromCode } from './codeToFallbackProps';
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
      });
    });

    it('should derive source from variant HastRoot even when fallback field exists', () => {
      const code: Code = {
        javascript: {
          fileName: 'App.js',
          source: hast('full'),
          fallback: fb('fallback'),
        },
      };

      const result = codeToFallbackProps('javascript', code);

      // Without allFallbackHasts, source is derived from variant.source
      expect(result.source).toEqual(fb('full'));
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
        extraSource: { 'utils.js': fb('js utils') },
        extraVariants: {
          typescript: {
            fileNames: ['App.ts', 'utils.ts'],
            source: fb('hello ts'),
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
        },
      });
      expect(result.extraVariants).not.toHaveProperty('javascript');
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
