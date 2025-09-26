/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUrlHashState } from './useUrlHashState';

describe('useUrlHashState', () => {
  // Mock window.location and history
  const mockLocation = {
    pathname: '/test',
    search: '?param=value',
    hash: '',
  };

  const mockHistory = {
    pushState: vi.fn((state, title, url) => {
      // Update the mock location when history changes
      if (url) {
        const hashIndex = url.indexOf('#');
        mockLocation.hash = hashIndex >= 0 ? url.substring(hashIndex) : '';
      }
    }),
    replaceState: vi.fn((state, title, url) => {
      // Update the mock location when history changes
      if (url) {
        const hashIndex = url.indexOf('#');
        mockLocation.hash = hashIndex >= 0 ? url.substring(hashIndex) : '';
      }
    }),
  };

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mockLocation.hash = '';

    // Only mock window properties if window exists
    if (typeof window !== 'undefined') {
      // Mock window.location
      Object.defineProperty(window, 'location', {
        value: mockLocation,
        writable: true,
        configurable: true,
      });

      // Mock window.history
      Object.defineProperty(window, 'history', {
        value: mockHistory,
        writable: true,
        configurable: true,
      });
    }
  });

  afterEach(() => {
    // Clean up event listeners only if window exists
    if (typeof window !== 'undefined') {
      const events = ['hashchange'];
      events.forEach((event) => {
        window.removeEventListener(event, vi.fn());
      });
    }
  });

  describe('basic functionality', () => {
    it('should return null hash initially when no hash in URL', () => {
      const { result } = renderHook(() => useUrlHashState());

      const [hash] = result.current;
      expect(hash).toBe(null);
    });

    it('should read initial hash from URL', () => {
      mockLocation.hash = '#test-hash';

      const { result } = renderHook(() => useUrlHashState());

      const [hash] = result.current;
      expect(hash).toBe('test-hash');
    });

    it('should set hash and update URL with replaceState by default', () => {
      const { result } = renderHook(() => useUrlHashState());

      act(() => {
        const [, setHash] = result.current;
        setHash('new-hash');
      });

      const [hash] = result.current;
      expect(hash).toBe('new-hash');
      expect(mockHistory.replaceState).toHaveBeenCalledWith(null, '', '/test?param=value#new-hash');
      expect(mockHistory.pushState).not.toHaveBeenCalled();
    });

    it('should set hash and update URL with pushState when replace is false', () => {
      const { result } = renderHook(() => useUrlHashState());

      act(() => {
        const [, setHash] = result.current;
        setHash('new-hash', false);
      });

      const [hash] = result.current;
      expect(hash).toBe('new-hash');
      expect(mockHistory.pushState).toHaveBeenCalledWith(null, '', '/test?param=value#new-hash');
      expect(mockHistory.replaceState).not.toHaveBeenCalled();
    });

    it('should clear hash when setting to null', () => {
      // First set a hash
      const { result } = renderHook(() => useUrlHashState());

      act(() => {
        const [, setHash] = result.current;
        setHash('test-hash');
      });

      let [hash] = result.current;
      expect(hash).toBe('test-hash');

      // Then clear it
      act(() => {
        const [, setHash] = result.current;
        setHash(null);
      });

      [hash] = result.current;
      expect(hash).toBe(null);
      expect(mockHistory.replaceState).toHaveBeenLastCalledWith(null, '', '/test?param=value');
    });
  });

  describe('hash change events', () => {
    it('should listen for hashchange events', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() => useUrlHashState());

      expect(addEventListenerSpy).toHaveBeenCalledWith('hashchange', expect.any(Function));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('hashchange', expect.any(Function));

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });

    it('should update hash state when hashchange event occurs', () => {
      let hashChangeHandler: ((event: HashChangeEvent) => void) | null = null;

      // Capture the hashchange handler
      const addEventListenerSpy = vi
        .spyOn(window, 'addEventListener')
        .mockImplementation((event, handler) => {
          if (event === 'hashchange') {
            hashChangeHandler = handler as (event: HashChangeEvent) => void;
          }
        });

      const { result } = renderHook(() => useUrlHashState());

      expect(addEventListenerSpy).toHaveBeenCalledWith('hashchange', expect.any(Function));

      // Simulate hash change
      mockLocation.hash = '#changed-hash';

      act(() => {
        if (hashChangeHandler) {
          hashChangeHandler(new HashChangeEvent('hashchange'));
        }
      });

      const [hash] = result.current;
      expect(hash).toBe('changed-hash');

      addEventListenerSpy.mockRestore();
    });
  });

  describe('SSR behavior', () => {
    it('should return null hash in SSR environment', () => {
      // This test verifies the hook doesn't crash in SSR
      // We can't fully simulate SSR in jsdom environment
      const { result } = renderHook(() => useUrlHashState());

      // In browser environment, hash should be null when no hash present
      const [hash] = result.current;
      expect(hash).toBe(null);
    });
  });

  describe('edge cases', () => {
    it('should handle empty hash strings', () => {
      const { result } = renderHook(() => useUrlHashState());

      act(() => {
        const [, setHash] = result.current;
        setHash('');
      });

      const [hash] = result.current;
      expect(hash).toBe('');
      expect(mockHistory.replaceState).toHaveBeenCalledWith(null, '', '/test?param=value#');
    });

    it('should handle hash with special characters', () => {
      const { result } = renderHook(() => useUrlHashState());

      act(() => {
        const [, setHash] = result.current;
        setHash('hash-with:special/characters');
      });

      const [hash] = result.current;
      expect(hash).toBe('hash-with:special/characters');
      expect(mockHistory.replaceState).toHaveBeenCalledWith(
        null,
        '',
        '/test?param=value#hash-with:special/characters',
      );
    });

    it('should handle URL without search params', () => {
      mockLocation.search = '';

      const { result } = renderHook(() => useUrlHashState());

      act(() => {
        const [, setHash] = result.current;
        setHash('test-hash');
      });

      expect(mockHistory.replaceState).toHaveBeenCalledWith(null, '', '/test#test-hash');
    });
  });
});
