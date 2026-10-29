import { describe, it, expect } from 'vitest';
import { getMdnTypeLink } from './mdnTypeLinks';

describe('getMdnTypeLink', () => {
  it('links DOM types to their MDN page', () => {
    expect(getMdnTypeLink('HTMLElement', { kind: 'lib', files: ['lib.dom.d.ts'] })).toBe(
      'https://developer.mozilla.org/docs/Web/API/HTMLElement',
    );
  });

  it('links JavaScript types declared across several lib files', () => {
    expect(
      getMdnTypeLink('Intl.NumberFormat', {
        kind: 'lib',
        files: ['lib.es2018.intl.d.ts', 'lib.es5.d.ts'],
      }),
    ).toBe(
      'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat',
    );
  });

  it('links TypeScript-only types to the section that describes them', () => {
    expect(
      getMdnTypeLink('Intl.LocalesArgument', { kind: 'lib', files: ['lib.es2020.intl.d.ts'] }),
    ).toBe(
      'https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl#locales_argument',
    );
  });

  it('does not link a package type that shares a name with a built-in type', () => {
    expect(getMdnTypeLink('Event', { kind: 'package', name: 'some-package' })).toBeUndefined();
  });

  it('does not link types from libs MDN does not document', () => {
    expect(
      getMdnTypeLink('Event', { kind: 'lib', files: ['lib.scripthost.d.ts'] }),
    ).toBeUndefined();
  });

  it('does not link types missing from the list', () => {
    expect(getMdnTypeLink('GPUDevice', { kind: 'lib', files: ['lib.dom.d.ts'] })).toBeUndefined();
    expect(getMdnTypeLink('toString', { kind: 'lib', files: ['lib.es5.d.ts'] })).toBeUndefined();
  });
});
