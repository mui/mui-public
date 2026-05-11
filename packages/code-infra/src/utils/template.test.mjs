import { describe, it, expect } from 'vitest';
import { templateString } from './template.mjs';

describe('templateString', () => {
  it('replaces a single placeholder with a value', () => {
    const result = templateString('Hello {{ name }}', { name: 'Alice' });
    expect(result).toBe('Hello Alice');
  });

  it('replaces multiple placeholders', () => {
    const result = templateString('{{ greeting }}, {{ name }}!', {
      greeting: 'Hello',
      name: 'Bob',
    });
    expect(result).toBe('Hello, Bob!');
  });

  it('handles spacing variations in placeholders', () => {
    const result1 = templateString('{{version}}', { version: '1.0.0' });
    const result2 = templateString('{{ version}}', { version: '1.0.0' });
    const result3 = templateString('{{version }}', { version: '1.0.0' });
    const result4 = templateString('{{ version }}', { version: '1.0.0' });

    expect(result1).toBe('1.0.0');
    expect(result2).toBe('1.0.0');
    expect(result3).toBe('1.0.0');
    expect(result4).toBe('1.0.0');
  });

  it('removes placeholders with undefined values', () => {
    const result = templateString('Version {{ version }}, Author {{ author }}', {
      version: '2.0.0',
    });
    expect(result).toBe('Version 2.0.0, Author ');
  });

  it('removes placeholders for missing keys', () => {
    const result = templateString('Release {{ version }} by {{ author }}', {});
    expect(result).toBe('Release  by ');
  });

  it('handles empty template', () => {
    const result = templateString('', { name: 'Alice' });
    expect(result).toBe('');
  });

  it('handles template with no placeholders', () => {
    const result = templateString('This is plain text', { name: 'Alice' });
    expect(result).toBe('This is plain text');
  });

  it('converts non-string values to strings', () => {
    const result = templateString('Version {{ major }}.{{ minor }}', {
      major: 1,
      minor: 5,
    });
    expect(result).toBe('Version 1.5');
  });

  it('handles null values as empty string', () => {
    const result = templateString('Hello {{ name }}', { name: null });
    expect(result).toBe('Hello null');
  });

  it('handles boolean values', () => {
    const result = templateString('Enabled: {{ enabled }}, Disabled: {{ disabled }}', {
      enabled: true,
      disabled: false,
    });
    expect(result).toBe('Enabled: true, Disabled: false');
  });

  it('does not replace text outside of placeholders', () => {
    const result = templateString('Literal braces { name } and placeholder {{ name }}', {
      name: 'Alice',
    });
    expect(result).toBe('Literal braces { name } and placeholder Alice');
  });

  it('handles consecutive placeholders', () => {
    const result = templateString('{{ first }}{{ second }}{{ third }}', {
      first: 'A',
      second: 'B',
      third: 'C',
    });
    expect(result).toBe('ABC');
  });

  it('handles placeholders with extra whitespace', () => {
    const result = templateString('{{  version  }}', { version: '1.0.0' });
    expect(result).toBe('1.0.0');
  });

  it('handles complex template with mixed content', () => {
    const result = templateString(
      'Release {{ version }} published on {{ date }} by {{ author }} for project {{ project }}',
      {
        version: 'v1.2.0',
        date: 'Jan 19, 2026',
        project: 'MUI X',
      },
    );
    expect(result).toBe('Release v1.2.0 published on Jan 19, 2026 by  for project MUI X');
  });

  it('handles empty object', () => {
    const result = templateString('Hello {{ name }}, version {{ version }}', {});
    expect(result).toBe('Hello , version ');
  });

  it('ignores extra keys in values object', () => {
    const result = templateString('Hello {{ name }}', {
      name: 'Alice',
      extra: 'ignored',
      another: 'also ignored',
    });
    expect(result).toBe('Hello Alice');
  });

  it('handles object values (converts to string)', () => {
    const result = templateString('Object: {{ obj }}', {
      obj: { key: 'value' },
    });
    expect(result).toBe('Object: [object Object]');
  });

  it('handles array values (converts to string)', () => {
    const result = templateString('Array: {{ arr }}', {
      arr: [1, 2, 3],
    });
    expect(result).toBe('Array: 1,2,3');
  });
});
