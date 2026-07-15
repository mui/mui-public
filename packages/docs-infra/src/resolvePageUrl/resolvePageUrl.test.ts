import { describe, it, expect } from 'vitest';
import { resolvePageUrl } from './resolvePageUrl';

describe('resolvePageUrl', () => {
  it('resolves a flat source path under the section prefix', () => {
    expect(resolvePageUrl('./quick-start/page.mdx', '/react/')).toBe('/react/quick-start');
  });

  it('drops the Next.js route-group segment so grouped pages resolve correctly', () => {
    // The route group lives in the stored source path (so the index can be grouped into
    // sections) but is URL-transparent, so it must not appear in the browser URL.
    expect(resolvePageUrl('./(overview)/quick-start/page.mdx', '/react/')).toBe(
      '/react/quick-start',
    );
  });

  it('drops multiple consecutive route-group segments', () => {
    expect(resolvePageUrl('./(components)/(inputs)/checkbox/page.mdx', '/react/')).toBe(
      '/react/checkbox',
    );
  });

  it('keeps a segment that only contains parentheses but is not a whole route group', () => {
    // `(draft)notes` is a real folder, not a route group (it does not wrap the whole segment),
    // so it stays in the URL — matching how the index groups it.
    expect(resolvePageUrl('./(draft)notes/page.mdx', '/react/')).toBe('/react/(draft)notes');
  });

  it('resolves a route-group-only path to the section root without a trailing slash', () => {
    // A section's landing page (`app/react/(overview)/page.mdx`) has only a route-group segment,
    // so every segment is stripped. It must resolve to the section root (`/react`), not a bare
    // trailing slash (`/react/`).
    expect(resolvePageUrl('./(overview)/page.mdx', '/react/')).toBe('/react');
  });

  it('resolves a route-group-only path under the root prefix to the root', () => {
    expect(resolvePageUrl('./(overview)/page.mdx', '/')).toBe('/');
  });

  it('resolves a bare index page path to the section root', () => {
    // `./page.mdx` (the index page itself, no leaf segment) resolves to the section root.
    expect(resolvePageUrl('./page.mdx', '/react/')).toBe('/react');
  });

  it('returns an absolute path unchanged', () => {
    expect(resolvePageUrl('/llms.txt', '/react/')).toBe('/llms.txt');
  });

  it('leaves parentheses in an absolute path untouched (already a final URL)', () => {
    expect(resolvePageUrl('/external/(keep)/page', '/react/')).toBe('/external/(keep)/page');
  });
});
