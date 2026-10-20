import { describe, it, expect } from 'vitest';
import { resolveMdnLink } from './resolveMdnLink';

describe('resolveMdnLink', () => {
  it('links interfaces to their MDN page', () => {
    expect(resolveMdnLink('HTMLElement')).toBe(
      'https://developer.mozilla.org/docs/Web/API/HTMLElement',
    );
  });

  it('links namespaced objects to their MDN page', () => {
    expect(resolveMdnLink('Intl.NumberFormat')).toBe(
      'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat',
    );
  });

  it('links TypeScript-only types to the parameter they describe', () => {
    expect(resolveMdnLink('Intl.NumberFormatOptions')).toBe(
      'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat#options',
    );
    expect(resolveMdnLink('Intl.LocalesArgument')).toBe(
      'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl#locales_argument',
    );
  });

  it('returns null for names MDN does not document', () => {
    expect(resolveMdnLink('Button')).toBeNull();
    expect(resolveMdnLink('constructor')).toBeNull();
  });

  describe('with a source', () => {
    it('links types declared in a lib MDN documents', () => {
      expect(resolveMdnLink('HTMLElement', { kind: 'lib', files: ['lib.dom.d.ts'] })).toBe(
        'https://developer.mozilla.org/docs/Web/API/HTMLElement',
      );
      expect(
        resolveMdnLink('Intl.NumberFormat', {
          kind: 'lib',
          files: ['lib.es2018.intl.d.ts', 'lib.es5.d.ts'],
        }),
      ).toBe(
        'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat',
      );
    });

    it('returns null for package types that share a name with a built-in type', () => {
      expect(resolveMdnLink('Event', { kind: 'package', name: 'some-package' })).toBeNull();
    });

    it('returns null for types from libs MDN does not document', () => {
      expect(resolveMdnLink('Event', { kind: 'lib', files: ['lib.scripthost.d.ts'] })).toBeNull();
    });
  });
});
