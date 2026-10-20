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
});
