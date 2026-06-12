import { describe, it, expect } from 'vitest';
import type { Code } from '../../CodeHighlighter/types';
import { detectGrammarScopes } from './detectGrammarScopes';

describe('detectGrammarScopes', () => {
  it('detects the scope from a single variant main file extension', () => {
    const code: Code = { Default: { fileName: 'Button.tsx', source: '' } };
    expect(detectGrammarScopes(code)).toEqual(['source.tsx']);
  });

  it('detects scopes across all variants and their extra files', () => {
    const code: Code = {
      Default: {
        fileName: 'Button.tsx',
        source: '',
        extraFiles: { 'styles.css': '' },
      },
      Alternate: { fileName: 'config.yaml', source: '' },
    };
    expect(detectGrammarScopes(code).sort()).toEqual(
      ['source.css', 'source.tsx', 'source.yaml'].sort(),
    );
  });

  it('prefers an explicit language prop over the file extension', () => {
    const code: Code = { Default: { fileName: 'snippet.txt', language: 'tsx', source: '' } };
    expect(detectGrammarScopes(code)).toEqual(['source.tsx']);
  });

  it('reads the language prop from an extra-file object', () => {
    const code: Code = {
      Default: {
        fileName: 'Button.tsx',
        source: '',
        extraFiles: { snippet: { source: '', language: 'css' } },
      },
    };
    expect(detectGrammarScopes(code).sort()).toEqual(['source.css', 'source.tsx'].sort());
  });

  it('dedupes scopes shared across files and variants', () => {
    const code: Code = {
      Default: { fileName: 'Button.tsx', source: '', extraFiles: { 'Checkbox.tsx': '' } },
      Alternate: { fileName: 'Switch.tsx', source: '' },
    };
    expect(detectGrammarScopes(code)).toEqual(['source.tsx']);
  });

  it('skips string and undefined variants and unsupported extensions', () => {
    const code: Code = {
      StringVariant: 'just source, no metadata',
      Empty: undefined,
      Unknown: { fileName: 'data.bin', source: '' },
      Real: { fileName: 'Button.tsx', source: '' },
    };
    expect(detectGrammarScopes(code)).toEqual(['source.tsx']);
  });

  it('returns an empty array for code with no detectable scopes', () => {
    const code: Code = { Default: { fileName: 'data.bin', source: '' } };
    expect(detectGrammarScopes(code)).toEqual([]);
  });
});
