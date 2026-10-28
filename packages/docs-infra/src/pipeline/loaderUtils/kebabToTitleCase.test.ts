import { describe, it, expect } from 'vitest';
import { kebabToTitleCase } from './kebabToTitleCase';

describe('kebabToTitleCase', () => {
  it('title-cases a kebab-case string', () => {
    expect(kebabToTitleCase('alert-dialog')).toBe('Alert Dialog');
  });

  it('title-cases a single word', () => {
    expect(kebabToTitleCase('overview')).toBe('Overview');
  });

  it('splits on underscores as well as hyphens', () => {
    expect(kebabToTitleCase('getting_started')).toBe('Getting Started');
  });

  it('lowercases word interiors', () => {
    expect(kebabToTitleCase('myWORD')).toBe('Myword');
  });

  it('applies brand-name overrides', () => {
    expect(kebabToTitleCase('typescript')).toBe('TypeScript');
    expect(kebabToTitleCase('javascript-utils')).toBe('JavaScript Utils');
  });
});
