import { describe, it, expect } from 'vitest';
import { resolveCssImports } from './resolveCssImports';
import type { CssModuleToResolve } from './resolveCssImports';

/** Builds a module descriptor with the shape `compileCssModule` produces. */
function mod(
  fileName: string,
  exports: Record<string, string>,
  imports: Record<string, Record<string, string>> = {},
): CssModuleToResolve {
  return { key: `./${fileName}`, fileName, exports, imports };
}

describe('resolveCssImports', () => {
  it('passes exports through unchanged when there are no cross-file imports', () => {
    const resolved = resolveCssImports([mod('a.module.css', { btn: 'btn-h1' })]);
    expect(resolved.get('./a.module.css')).toEqual({ btn: 'btn-h1' });
  });

  it('swaps a placeholder for the sibling class it composes from', () => {
    const resolved = resolveCssImports([
      mod('a.module.css', { btn: 'btn-h1 __p0' }, { './b.module.css': { __p0: 'foo' } }),
      mod('b.module.css', { foo: 'foo-h2' }),
    ]);
    expect(resolved.get('./a.module.css')).toEqual({ btn: 'btn-h1 foo-h2' });
    expect(resolved.get('./b.module.css')).toEqual({ foo: 'foo-h2' });
  });

  it('resolves a multi-class `composes ... from`', () => {
    const resolved = resolveCssImports([
      mod('a.module.css', { x: 'x-h1 __p0 __p1' }, { './b.module.css': { __p0: 'a', __p1: 'b' } }),
      mod('b.module.css', { a: 'a-h2', b: 'b-h2' }),
    ]);
    expect(resolved.get('./a.module.css')).toEqual({ x: 'x-h1 a-h2 b-h2' });
  });

  it('resolves a transitive chain (a composes from b composes from c)', () => {
    const resolved = resolveCssImports([
      mod('a.module.css', { x: 'x-h1 __pa' }, { './b.module.css': { __pa: 'y' } }),
      mod('b.module.css', { y: 'y-h2 __pb' }, { './c.module.css': { __pb: 'z' } }),
      mod('c.module.css', { z: 'z-h3' }),
    ]);
    expect(resolved.get('./a.module.css')).toEqual({ x: 'x-h1 y-h2 z-h3' });
  });

  it('resolves a composed value pulled from the sibling, not just the placeholder line', () => {
    // The imported class itself composes locally, so its export holds two names —
    // both must flow through to the importer.
    const resolved = resolveCssImports([
      mod('a.module.css', { btn: 'btn-h1 __p0' }, { './b.module.css': { __p0: 'foo' } }),
      mod('b.module.css', { base: 'base-h2', foo: 'foo-h2 base-h2' }),
    ]);
    expect(resolved.get('./a.module.css')).toEqual({ btn: 'btn-h1 foo-h2 base-h2' });
  });

  it('resolves a path that walks up a directory with `../`', () => {
    const resolved = resolveCssImports([
      mod('nested/a.module.css', { x: 'x-h1 __p0' }, { '../b.module.css': { __p0: 'foo' } }),
      mod('b.module.css', { foo: 'foo-h2' }),
    ]);
    expect(resolved.get('./nested/a.module.css')).toEqual({ x: 'x-h1 foo-h2' });
  });

  it('preserves a `../` that points above the importing file (not flattened to a sibling)', () => {
    // A root-level module composing from `../shared/...` must resolve to a key that
    // keeps the leading `..`; dropping it (popping past the base) would mis-resolve
    // to `shared/...` and silently drop the composed class.
    const resolved = resolveCssImports([
      mod('a.module.css', { btn: 'btn-h1 __p0' }, { '../shared/base.module.css': { __p0: 'foo' } }),
      mod('../shared/base.module.css', { foo: 'foo-h2' }),
    ]);
    expect(resolved.get('./a.module.css')).toEqual({ btn: 'btn-h1 foo-h2' });
  });

  it('drops a placeholder whose sibling module is missing', () => {
    const resolved = resolveCssImports([
      mod('a.module.css', { btn: 'btn-h1 __p0' }, { './gone.module.css': { __p0: 'foo' } }),
    ]);
    expect(resolved.get('./a.module.css')).toEqual({ btn: 'btn-h1' });
  });

  it('drops a placeholder whose name is absent from the sibling', () => {
    const resolved = resolveCssImports([
      mod('a.module.css', { btn: 'btn-h1 __p0' }, { './b.module.css': { __p0: 'missing' } }),
      mod('b.module.css', { foo: 'foo-h2' }),
    ]);
    expect(resolved.get('./a.module.css')).toEqual({ btn: 'btn-h1' });
  });

  it('does not hang on a composes cycle (best-effort, no throw)', () => {
    const resolved = resolveCssImports([
      mod('a.module.css', { x: 'x-h1 __pa' }, { './b.module.css': { __pa: 'y' } }),
      mod('b.module.css', { y: 'y-h2 __pb' }, { './a.module.css': { __pb: 'x' } }),
    ]);
    // Both resolve without throwing; the cycle edge contributes nothing further.
    expect(resolved.get('./a.module.css')?.x.startsWith('x-h1')).toBe(true);
    expect(resolved.get('./b.module.css')?.y.startsWith('y-h2')).toBe(true);
  });
});
