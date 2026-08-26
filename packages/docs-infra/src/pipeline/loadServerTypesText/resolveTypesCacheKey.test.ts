import { describe, it, expect } from 'vitest';
import { CACHE_SCHEMA_VERSION } from '../cacheUtils';
import { resolveTypesCacheKey, buildTypesTextCacheContent } from './resolveTypesCacheKey';

describe('resolveTypesCacheKey', () => {
  const root = '/root';

  it('strips a leading src/app and uses the component route', () => {
    expect(resolveTypesCacheKey('/root/src/app/components/accordion/types.md', root)).toBe(
      'components/accordion',
    );
  });

  it('strips a leading app', () => {
    expect(resolveTypesCacheKey('/root/app/components/button/types.md', root)).toBe(
      'components/button',
    );
  });

  it('drops Next.js route groups', () => {
    expect(resolveTypesCacheKey('/root/app/(public)/components/button/types.md', root)).toBe(
      'components/button',
    );
  });
});

describe('buildTypesTextCacheContent', () => {
  it('is identical for identical markdown and ordering', () => {
    expect(buildTypesTextCacheContent('# A\n')).toBe(buildTypesTextCacheContent('# A\n'));
  });

  it('differs when the markdown differs', () => {
    expect(buildTypesTextCacheContent('# A\n')).not.toBe(buildTypesTextCacheContent('# B\n'));
  });

  it('differs when the ordering differs', () => {
    expect(buildTypesTextCacheContent('# A\n')).not.toBe(
      buildTypesTextCacheContent('# A\n', { props: ['a'] }),
    );
  });

  // The parsed value embeds hast, so entries written by an older pipeline must not
  // validate against this one. Without the version in the content, a warm cache
  // (Netlify restores `.next/cache` between builds) would keep serving them.
  it('carries the cache schema version so a bump invalidates existing entries', () => {
    expect(buildTypesTextCacheContent('# A\n')).toContain(`${CACHE_SCHEMA_VERSION}\n`);
  });
});
