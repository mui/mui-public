import { describe, it, expect } from 'vitest';
import { toKebabCase, generateFileSlug } from './generateFileSlug';

describe('toKebabCase', () => {
  it('normalizes component and file names', () => {
    expect(toKebabCase('myComponent')).toBe('my-component');
    expect(toKebabCase('Some Name_here')).toBe('some-name-here');
    expect(toKebabCase('file.name')).toBe('file.name');
    expect(toKebabCase('__weird__')).toBe('weird');
  });
});

describe('generateFileSlug', () => {
  it('preserves extensions and adds non-default variants', () => {
    expect(generateFileSlug('demo', 'MyComponent.tsx', 'Default')).toBe('demo:my-component.tsx');
    expect(generateFileSlug('demo', 'MyComponent.tsx', 'DarkMode')).toBe(
      'demo:dark-mode:my-component.tsx',
    );
    expect(generateFileSlug('', 'MyComponent.tsx', 'DarkMode')).toBe('my-component.tsx');
  });
});
