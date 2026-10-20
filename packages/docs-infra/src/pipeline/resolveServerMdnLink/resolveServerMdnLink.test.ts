import { describe, it, expect } from 'vitest';
import { resolveServerMdnLink } from './resolveServerMdnLink';

describe('resolveServerMdnLink', () => {
  it('links interfaces to their MDN page', () => {
    expect(resolveServerMdnLink('HTMLElement')).toBe(
      'https://developer.mozilla.org/docs/Web/API/HTMLElement',
    );
  });

  it('links namespaced objects to their MDN page', () => {
    expect(resolveServerMdnLink('Intl.NumberFormat')).toBe(
      'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat',
    );
  });

  it('links TypeScript-only types to the parameter they describe', () => {
    expect(resolveServerMdnLink('Intl.NumberFormatOptions')).toBe(
      'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat#options',
    );
    expect(resolveServerMdnLink('AddEventListenerOptions')).toBe(
      'https://developer.mozilla.org/docs/Web/API/EventTarget/addEventListener#options',
    );
  });

  it('returns null for names MDN does not document', () => {
    expect(resolveServerMdnLink('Button')).toBeNull();
    expect(resolveServerMdnLink('constructor')).toBeNull();
  });

  describe('with a source', () => {
    it('links types declared in a lib MDN documents', () => {
      expect(resolveServerMdnLink('HTMLElement', { kind: 'lib', files: ['lib.dom.d.ts'] })).toBe(
        'https://developer.mozilla.org/docs/Web/API/HTMLElement',
      );
      expect(
        resolveServerMdnLink('Intl.NumberFormat', {
          kind: 'lib',
          files: ['lib.es2018.intl.d.ts', 'lib.es5.d.ts'],
        }),
      ).toBe(
        'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat',
      );
    });

    it('returns null for package types that share a name with a built-in type', () => {
      expect(resolveServerMdnLink('Range', { kind: 'package', name: 'some-package' })).toBeNull();
    });

    it('returns null for types from libs MDN does not document', () => {
      expect(
        resolveServerMdnLink('Range', { kind: 'lib', files: ['lib.scripthost.d.ts'] }),
      ).toBeNull();
    });
  });
});
