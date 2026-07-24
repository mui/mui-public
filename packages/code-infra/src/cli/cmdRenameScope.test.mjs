import { describe, it, expect } from 'vitest';

import { parseAlias } from './cmdRenameScope.mjs';

describe('parseAlias', () => {
  it('splits a mapping into its two scopes', () => {
    expect(parseAlias('@acme:@acme-private')).toEqual(['@acme', '@acme-private']);
  });

  it('rejects a mapping that is not two scopes', () => {
    expect(() => parseAlias('acme:@acme-private')).toThrow(/Invalid scope mapping/);
    expect(() => parseAlias('@acme:acme-private')).toThrow(/Invalid scope mapping/);
    expect(() => parseAlias('@acme')).toThrow(/Invalid scope mapping/);
  });

  it('rejects extra segments rather than silently dropping them', () => {
    expect(() => parseAlias('@a:@b:@c:@d')).toThrow(/Invalid scope mapping/);
  });
});
