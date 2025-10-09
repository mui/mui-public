/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import useLocalStorageState from './useLocalStorageState';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('useLocalStorageState - comprehensive tests', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('should return initial value when localStorage is empty', () => {
    const { result } = renderHook(() => useLocalStorageState('test-key', () => 'default'));

    expect(result.current[0]).toBe('default');
  });

  it('should sync from localStorage on mount when value exists', () => {
    localStorageMock.setItem('test-key', 'stored-value');

    const { result } = renderHook(() => useLocalStorageState('test-key', () => 'default'));

    expect(result.current[0]).toBe('stored-value');
  });

  it('should update value and save to localStorage', () => {
    const { result } = renderHook(() => useLocalStorageState('test-key', () => 'default'));

    act(() => {
      result.current[1]('user-value');
    });

    expect(result.current[0]).toBe('user-value');
    expect(localStorageMock.getItem('test-key')).toBe('user-value');
  });

  it('should support function updates like useState', () => {
    const { result } = renderHook(() => useLocalStorageState('test-key', () => 'initial'));

    act(() => {
      result.current[1]((prev) => `${prev}-updated`);
    });

    expect(result.current[0]).toBe('initial-updated');
    expect(localStorageMock.getItem('test-key')).toBe('initial-updated');
  });

  it('should handle null storageKey by not persisting', () => {
    const { result } = renderHook(() => useLocalStorageState(null, () => 'default'));

    expect(result.current[0]).toBe('default');

    act(() => {
      result.current[1]('new-value');
    });

    expect(result.current[0]).toBe('new-value');
    // Should not have added any keys to localStorage when storageKey is null
    expect(localStorageMock.getItem('test-key')).toBeNull();
    expect(localStorageMock.getItem('new-value')).toBeNull();
  });

  it('should handle null values by removing from localStorage and falling back to initial', () => {
    const { result } = renderHook(() => useLocalStorageState('test-key', () => 'default'));

    // First set a value
    act(() => {
      result.current[1]('some-value');
    });

    expect(localStorageMock.getItem('test-key')).toBe('some-value');

    // Then set to null - this should remove the item and fall back to initial value
    act(() => {
      result.current[1](null);
    });

    expect(result.current[0]).toBe('default'); // Falls back to initial value
    expect(localStorageMock.getItem('test-key')).toBeNull(); // Item is removed
  });

  it('should support initializer function', () => {
    let initializerCallCount = 0;
    const initializer = () => {
      initializerCallCount += 1;
      return 'computed-initial';
    };

    const { result } = renderHook(() => useLocalStorageState('test-key', initializer));

    expect(result.current[0]).toBe('computed-initial');
    expect(initializerCallCount).toBe(1);
  });
});
