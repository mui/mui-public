/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePreload } from './usePreload';
import { PreloadProvider } from './PreloadProvider';

describe('usePreload', () => {
  it('dedups by key within a provider: the factory runs once and the promise is shared', async () => {
    const factory = vi.fn(() => Promise.resolve('module'));
    const { result } = renderHook(() => usePreload(), {
      wrapper: ({ children }) => <PreloadProvider>{children}</PreloadProvider>,
    });

    const first = result.current('helper', factory);
    const second = result.current('helper', factory);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    await expect(first).resolves.toBe('module');
  });

  it('keys are independent: different keys each run their factory', () => {
    const factoryA = vi.fn(() => Promise.resolve('a'));
    const factoryB = vi.fn(() => Promise.resolve('b'));
    const { result } = renderHook(() => usePreload(), {
      wrapper: ({ children }) => <PreloadProvider>{children}</PreloadProvider>,
    });

    result.current('a', factoryA);
    result.current('b', factoryB);

    expect(factoryA).toHaveBeenCalledTimes(1);
    expect(factoryB).toHaveBeenCalledTimes(1);
  });

  it('falls back to calling the factory directly without a provider', () => {
    const factory = vi.fn(() => Promise.resolve('module'));
    const { result } = renderHook(() => usePreload());

    result.current('helper', factory);
    result.current('helper', factory);

    // No dedup without a provider - the browser module cache handles real imports.
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
