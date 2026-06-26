import { describe, it, expect } from 'vitest';
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
});
