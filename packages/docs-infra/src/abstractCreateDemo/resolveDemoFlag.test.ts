import { describe, it, expect } from 'vitest';
import { resolveDemoFlag } from './resolveDemoFlag';

describe('resolveDemoFlag', () => {
  it('defaults to false with no overrides anywhere', () => {
    expect(resolveDemoFlag([undefined, undefined], undefined)).toBe(false);
    expect(resolveDemoFlag([{}, {}], false)).toBe(false);
  });

  it('uses the factory default when no layer overrides it', () => {
    expect(resolveDemoFlag([{}, {}], true)).toBe(true);
    expect(resolveDemoFlag([undefined, undefined], true)).toBe(true);
  });

  it('lets a meta `off` override the factory `on`', () => {
    expect(resolveDemoFlag([undefined, { off: true }], true)).toBe(false);
  });

  it('lets a meta `on` turn it on without a factory default', () => {
    expect(resolveDemoFlag([undefined, { on: true }], false)).toBe(true);
  });

  it('lets a meta `on: false` override the factory default', () => {
    expect(resolveDemoFlag([undefined, { on: false }], true)).toBe(false);
  });

  it('lets the instance layer override meta and factory', () => {
    expect(resolveDemoFlag([{ off: true }, { on: true }], true)).toBe(false);
    expect(resolveDemoFlag([{ on: true }, undefined], false)).toBe(true);
    expect(resolveDemoFlag([{ on: false }, { on: true }], true)).toBe(false);
  });

  it('prefers `off` over `on` within the same layer', () => {
    expect(resolveDemoFlag([{ on: true, off: true }, undefined], false)).toBe(false);
  });
});
