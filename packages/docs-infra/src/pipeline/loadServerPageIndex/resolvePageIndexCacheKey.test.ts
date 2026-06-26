import { describe, it, expect } from 'vitest';
import { resolvePageIndexCacheKey } from './resolvePageIndexCacheKey';

describe('resolvePageIndexCacheKey', () => {
  const root = '/root';

  it('strips a leading src/app and uses the route directory', () => {
    expect(resolvePageIndexCacheKey('/root/src/app/components/page.mdx', root)).toBe('components');
  });

  it('strips a leading app and nests deeper routes', () => {
    expect(resolvePageIndexCacheKey('/root/app/utilities/parsing/page.mdx', root)).toBe(
      'utilities/parsing',
    );
  });

  it('uses "index" for the root index', () => {
    expect(resolvePageIndexCacheKey('/root/app/page.mdx', root)).toBe('index');
  });

  it('drops Next.js route groups', () => {
    expect(resolvePageIndexCacheKey('/root/app/(public)/components/page.mdx', root)).toBe(
      'components',
    );
  });
});
