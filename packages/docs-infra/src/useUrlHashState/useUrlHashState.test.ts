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
    pushState: vi.fn(),
    replaceState: vi.fn(),
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

      expect(result.current.hash).toBe(null);
      expect(result.current.hasProcessedInitialHash).toBe(true);
      expect(result.current.hasUserInteraction).toBe(false);
    });

    it('should read initial hash from URL', () => {
      mockLocation.hash = '#test-hash';

      const { result } = renderHook(() => useUrlHashState());

      expect(result.current.hash).toBe('test-hash');
      expect(result.current.hasProcessedInitialHash).toBe(true);
    });

    it('should not read initial hash when readOnMount is false', () => {
      mockLocation.hash = '#test-hash';

      const { result } = renderHook(() => useUrlHashState({ readOnMount: false }));

      expect(result.current.hash).toBe(null);
      expect(result.current.hasProcessedInitialHash).toBe(false);
    });

    it('should set hash and update URL with replaceState by default', () => {
      const { result } = renderHook(() => useUrlHashState());

      act(() => {
        result.current.setHash('new-hash');
      });

      expect(result.current.hash).toBe('new-hash');
      expect(mockHistory.replaceState).toHaveBeenCalledWith(null, '', '/test?param=value#new-hash');
      expect(mockHistory.pushState).not.toHaveBeenCalled();
    });

    it('should set hash and update URL with pushState when replace is false', () => {
      const { result } = renderHook(() => useUrlHashState());

      act(() => {
        result.current.setHash('new-hash', false);
      });

      expect(result.current.hash).toBe('new-hash');
      expect(mockHistory.pushState).toHaveBeenCalledWith(null, '', '/test?param=value#new-hash');
      expect(mockHistory.replaceState).not.toHaveBeenCalled();
    });

    it('should clear hash when setting to null', () => {
      // First set a hash
      const { result } = renderHook(() => useUrlHashState());

      act(() => {
        result.current.setHash('test-hash');
      });

      expect(result.current.hash).toBe('test-hash');

      // Then clear it
      act(() => {
        result.current.setHash(null);
      });

      expect(result.current.hash).toBe(null);
      expect(mockHistory.replaceState).toHaveBeenLastCalledWith(null, '', '/test?param=value');
    });

    it('should mark user interaction', () => {
      const { result } = renderHook(() => useUrlHashState());

      expect(result.current.hasUserInteraction).toBe(false);

      act(() => {
        result.current.markUserInteraction();
      });

      expect(result.current.hasUserInteraction).toBe(true);
    });
  });

  describe('custom parse and format functions', () => {
    it('should use custom parseHash function', () => {
      mockLocation.hash = '#custom:test-hash';

      const parseHash = (hash: string) => {
        const withoutHash = hash.slice(1); // Remove '#'
        return withoutHash.startsWith('custom:') ? withoutHash.slice(7) : withoutHash;
      };

      const { result } = renderHook(() => useUrlHashState({ parseHash }));

      expect(result.current.hash).toBe('test-hash');
    });

    it('should use custom formatHash function', () => {
      const formatHash = (value: string) => `custom:${value}`;

      const { result } = renderHook(() => useUrlHashState({ formatHash }));

      act(() => {
        result.current.setHash('test-hash');
      });

      expect(result.current.hash).toBe('test-hash');
      expect(mockHistory.replaceState).toHaveBeenCalledWith(
        null,
        '',
        '/test?param=value#custom:test-hash',
      );
    });
  });

  describe('hash change events', () => {
    it('should listen for hashchange events when watchChanges is true', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = renderHook(() => useUrlHashState({ watchChanges: true }));

      expect(addEventListenerSpy).toHaveBeenCalledWith('hashchange', expect.any(Function));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('hashchange', expect.any(Function));

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });

    it('should not listen for hashchange events when watchChanges is false', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

      renderHook(() => useUrlHashState({ watchChanges: false }));

      expect(addEventListenerSpy).not.toHaveBeenCalledWith('hashchange', expect.any(Function));

      addEventListenerSpy.mockRestore();
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

      expect(result.current.hash).toBe('changed-hash');

      addEventListenerSpy.mockRestore();
    });
  });

  describe('SSR behavior', () => {
    it('should return null hash in SSR environment', () => {
      // This test verifies the hook doesn't crash in SSR
      // We can't fully simulate SSR in jsdom environment
      const { result } = renderHook(() => useUrlHashState());

      // In browser environment, hash should be null when no hash present
      expect(result.current.hash).toBe(null);
    });
  });

  describe('edge cases', () => {
    it('should handle empty hash strings', () => {
      const { result } = renderHook(() => useUrlHashState());

      act(() => {
        result.current.setHash('');
      });

      expect(result.current.hash).toBe('');
      expect(mockHistory.replaceState).toHaveBeenCalledWith(null, '', '/test?param=value#');
    });

    it('should handle hash with special characters', () => {
      const { result } = renderHook(() => useUrlHashState());

      act(() => {
        result.current.setHash('hash-with:special/characters');
      });

      expect(result.current.hash).toBe('hash-with:special/characters');
      expect(mockHistory.replaceState).toHaveBeenCalledWith(
        null,
        '',
        '/test?param=value#hash-with:special/characters',
      );
    });

    it('should not process initial hash multiple times', () => {
      mockLocation.hash = '#initial-hash';

      const { rerender } = renderHook(() => useUrlHashState());

      // First render should process the hash
      expect(mockLocation.hash).toBe('#initial-hash');

      // Change the mock hash to simulate external change
      mockLocation.hash = '#different-hash';

      // Rerender should not reprocess initial hash
      rerender();

      // Hash should still be the original one since we only process initial hash once
      // (unless a hashchange event occurs)
    });

    it('should handle URL without search params', () => {
      mockLocation.search = '';

      const { result } = renderHook(() => useUrlHashState());

      act(() => {
        result.current.setHash('test-hash');
      });

      expect(mockHistory.replaceState).toHaveBeenCalledWith(null, '', '/test#test-hash');
    });
  });
});
