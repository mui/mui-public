import { describe, it, expect } from 'vitest';
import { typesCacheKey, typesTextCacheContent } from './typesCacheKey';

describe('typesCacheKey', () => {
  const root = '/root';

  it('strips a leading src/app and uses the component route', () => {
    expect(typesCacheKey('/root/src/app/components/accordion/types.md', root)).toBe(
      'components/accordion',
    );
  });

  it('strips a leading app', () => {
    expect(typesCacheKey('/root/app/components/button/types.md', root)).toBe('components/button');
  });

  it('drops Next.js route groups', () => {
    expect(typesCacheKey('/root/app/(public)/components/button/types.md', root)).toBe(
      'components/button',
    );
  });
});

describe('typesTextCacheContent', () => {
  it('is identical for identical markdown and ordering', () => {
    expect(typesTextCacheContent('# A\n')).toBe(typesTextCacheContent('# A\n'));
  });

  it('differs when the markdown differs', () => {
    expect(typesTextCacheContent('# A\n')).not.toBe(typesTextCacheContent('# B\n'));
  });

  it('differs when the ordering differs', () => {
    expect(typesTextCacheContent('# A\n')).not.toBe(
      typesTextCacheContent('# A\n', { props: ['a'] }),
    );
  });
});
