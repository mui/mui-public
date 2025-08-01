/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLocalStorage } from './useLocalStorage';

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

describe('useLocalStorage - comprehensive tests', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('should return initial value when localStorage is empty', () => {
    const { result } = renderHook(() =>
      useLocalStorage({ initialValue: 'default', storageKey: 'test-key' })
    );

    expect(result.current.value).toBe('default');
    expect(result.current.hasSynced).toBe(true);
  });

  it('should sync from localStorage on mount when value exists', () => {
    localStorageMock.setItem('test-key', JSON.stringify('stored-value'));

    const { result } = renderHook(() =>
      useLocalStorage({ initialValue: 'default', storageKey: 'test-key' })
    );

    expect(result.current.value).toBe('stored-value');
    expect(result.current.hasSynced).toBe(true);
  });

  it('should update value with setValueAsUserSelection and save to localStorage', () => {
    const { result } = renderHook(() =>
      useLocalStorage({ initialValue: 'default', storageKey: 'test-key' })
    );

    act(() => {
      result.current.setValueAsUserSelection('user-value');
    });

    expect(result.current.value).toBe('user-value');
    expect(localStorageMock.getItem('test-key')).toBe(JSON.stringify('user-value'));
  });

  it('should update value with setValue but not save to localStorage', () => {
    const { result } = renderHook(() =>
      useLocalStorage({ initialValue: 'default', storageKey: 'test-key' })
    );

    act(() => {
      result.current.setValue('new-value');
    });

    expect(result.current.value).toBe('new-value');
    expect(localStorageMock.getItem('test-key')).toBeNull();
  });

  it('should handle null storageKey', () => {
    const { result } = renderHook(() =>
      useLocalStorage({ initialValue: 'default', storageKey: null })
    );

    expect(result.current.value).toBe('default');
    expect(result.current.hasSynced).toBe(true);

    act(() => {
      result.current.setValueAsUserSelection('new-value');
    });

    expect(result.current.value).toBe('new-value');
    expect(localStorageMock.getItem('test-key')).toBeNull();
  });

  it('should work with boolean values', () => {
    localStorageMock.clear();
    const { result } = renderHook(() =>
      useLocalStorage({ initialValue: false, storageKey: 'bool-test-key' })
    );

    act(() => {
      result.current.setValueAsUserSelection(true);
    });

    expect(result.current.value).toBe(true);
    expect(localStorageMock.getItem('bool-test-key')).toBe('true');
  });

  it('should handle validation correctly', () => {
    const isValidNumber = (value: number) => typeof value === 'number' && value >= 0;
    
    localStorageMock.setItem('test-key', JSON.stringify(-5));

    const { result } = renderHook(() =>
      useLocalStorage({ 
        initialValue: 10, 
        storageKey: 'test-key',
        isValidValue: isValidNumber
      })
    );

    // Should use initial value when stored value is invalid
    expect(result.current.value).toBe(10);
  });

  it('should handle custom serialization', () => {
    localStorageMock.clear();
    interface CustomType {
      name: string;
      count: number;
    }

    const customSerialize = (value: CustomType) => `${value.name}:${value.count}`;
    const customDeserialize = (value: string): CustomType | null => {
      const [name, countStr] = value.split(':');
      const count = parseInt(countStr, 10);
      return name && !Number.isNaN(count) ? { name, count } : null;
    };

    const { result } = renderHook(() =>
      useLocalStorage({ 
        initialValue: { name: 'test', count: 0 },
        storageKey: 'custom-test-key',
        serialize: customSerialize,
        deserialize: customDeserialize
      })
    );

    act(() => {
      result.current.setValueAsUserSelection({ name: 'custom', count: 42 });
    });

    expect(result.current.value).toEqual({ name: 'custom', count: 42 });
    expect(localStorageMock.getItem('custom-test-key')).toBe('custom:42');
  });

  it('should handle JSON parsing errors gracefully', () => {
    localStorageMock.setItem('test-key', 'invalid-json{');

    const { result } = renderHook(() =>
      useLocalStorage({ initialValue: 'default', storageKey: 'test-key' })
    );

    expect(result.current.value).toBe('default');
  });

  it('should handle invalid deserialized values', () => {
    const isValidValue = (value: string) => value.length > 3;
    
    localStorageMock.setItem('test-key', JSON.stringify('hi'));

    const { result } = renderHook(() =>
      useLocalStorage({ 
        initialValue: 'default-value', 
        storageKey: 'test-key',
        isValidValue
      })
    );

    // Should use initial value when stored value fails validation
    expect(result.current.value).toBe('default-value');
  });

  it('should prevent infinite loops when syncing from localStorage', () => {
    localStorageMock.clear();
    const { result } = renderHook(() =>
      useLocalStorage({ initialValue: 'initial', storageKey: 'loop-test-key' })
    );

    // Set a value as user selection
    act(() => {
      result.current.setValueAsUserSelection('user-value');
    });

    expect(result.current.value).toBe('user-value');
    expect(localStorageMock.getItem('loop-test-key')).toBe('"user-value"');

    // Simulate another tab setting the same value - should not cause infinite loops
    const currentValue = result.current.value;
    
    act(() => {
      // Manually trigger the same value being set again
      localStorageMock.setItem('loop-test-key', '"user-value"');
    });

    // Should not cause infinite loops - value should remain the same
    expect(result.current.value).toBe(currentValue);
    expect(result.current.value).toBe('user-value');
  });
});
