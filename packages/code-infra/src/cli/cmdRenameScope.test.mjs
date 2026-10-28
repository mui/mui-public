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
    // Extra segments are rejected rather than silently dropped.
    expect(() => parseAlias('@a:@b:@c:@d')).toThrow(/Invalid scope mapping/);
  });

  it('rejects a scope holding a path segment, which would build an invalid name', () => {
    // Would otherwise rename `@acme/pkg` to `@acme/private/pkg`.
    expect(() => parseAlias('@acme:@acme/private')).toThrow(/Invalid scope mapping/);
  });

  it('rejects a mapping whose source and target are the same', () => {
    // Renaming a scope onto itself only rewrites every manifest to itself.
    expect(() => parseAlias('@acme:@acme')).toThrow(/source and target scope are the same/);
  });
});
