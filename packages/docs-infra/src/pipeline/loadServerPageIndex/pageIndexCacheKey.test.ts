import { describe, it, expect } from 'vitest';
import { pageIndexCacheKey } from './pageIndexCacheKey';

describe('pageIndexCacheKey', () => {
  const root = '/root';

  it('strips a leading src/app and uses the route directory', () => {
    expect(pageIndexCacheKey('/root/src/app/components/page.mdx', root)).toBe('components');
  });

  it('strips a leading app and nests deeper routes', () => {
    expect(pageIndexCacheKey('/root/app/utilities/parsing/page.mdx', root)).toBe(
      'utilities/parsing',
    );
  });

  it('uses "index" for the root index', () => {
    expect(pageIndexCacheKey('/root/app/page.mdx', root)).toBe('index');
  });

  it('drops Next.js route groups', () => {
    expect(pageIndexCacheKey('/root/app/(public)/components/page.mdx', root)).toBe('components');
  });
});
