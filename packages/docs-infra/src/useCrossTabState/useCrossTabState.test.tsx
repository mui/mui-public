/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCrossTabState } from './useCrossTabState';

/** In-memory stand-in for `BroadcastChannel` (jsdom ships none): peers-but-not-self, structured-cloned. */
class FakeBroadcastChannel {
  static groups = new Map<string, Set<FakeBroadcastChannel>>();

  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(public name: string) {
    const group = FakeBroadcastChannel.groups.get(name) ?? new Set();
    group.add(this);
    FakeBroadcastChannel.groups.set(name, group);
  }

  postMessage(data: unknown) {
    const cloned = structuredClone(data);
    for (const peer of FakeBroadcastChannel.groups.get(this.name) ?? []) {
      if (peer !== this) {
        peer.onmessage?.({ data: cloned });
      }
    }
  }

  close() {
    FakeBroadcastChannel.groups.get(this.name)?.delete(this);
  }

  static reset() {
    FakeBroadcastChannel.groups.clear();
  }
}

vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);

afterEach(() => {
  FakeBroadcastChannel.reset();
});

// Restore the real global after this file's tests so the stub never leaks into others.
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('useCrossTabState', () => {
  it('returns [value, setValue] starting at the initial value', () => {
    const { result } = renderHook(() => useCrossTabState('k', 'hello'));
    expect(result.current[0]).toBe('hello');
  });

  it('supports a lazy initializer', () => {
    const { result } = renderHook(() => useCrossTabState('k', () => 'lazy'));
    expect(result.current[0]).toBe('lazy');
  });

  it('mirrors a setValue to another tab on the same key', () => {
    const { result: tabA } = renderHook(() => useCrossTabState('shared', 'a'));
    const { result: tabB } = renderHook(() => useCrossTabState('shared', 'a'));

    act(() => tabA.current[1]('edited'));

    expect(tabA.current[0]).toBe('edited');
    expect(tabB.current[0]).toBe('edited');
  });

  it('mirrors a functional update by its resolved value', () => {
    const { result: tabA } = renderHook(() => useCrossTabState('shared', 1));
    const { result: tabB } = renderHook(() => useCrossTabState('shared', 1));

    act(() => tabA.current[1]((count) => count + 1));

    expect(tabA.current[0]).toBe(2);
    expect(tabB.current[0]).toBe(2);
  });

  it('catches a tab up to the current value when it mounts after a change', () => {
    const { result: tabA } = renderHook(() => useCrossTabState('shared', 'a'));
    act(() => tabA.current[1]('edited'));

    // B starts at its own initial but resumes the shared value from A.
    const { result: tabB } = renderHook(() => useCrossTabState('shared', 'a'));
    expect(tabB.current[0]).toBe('edited');
  });

  it('keeps different keys independent', () => {
    const { result: tabA } = renderHook(() => useCrossTabState('one', 'a'));
    const { result: tabB } = renderHook(() => useCrossTabState('two', 'a'));

    act(() => tabA.current[1]('edited'));

    expect(tabB.current[0]).toBe('a');
  });

  it('does not sync when the key is null', () => {
    const { result: tabA } = renderHook(() => useCrossTabState(null, 'a'));
    const { result: tabB } = renderHook(() => useCrossTabState(null, 'a'));

    act(() => tabA.current[1]('edited'));

    expect(tabB.current[0]).toBe('a');
  });
});
