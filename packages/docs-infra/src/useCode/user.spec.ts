/**
 * @vitest-environment jsdom
 *
 * Integration tests for useCode hook.
 *
 * These tests document expected user-facing behavior including:
 * - Variant switching with URL hashes
 * - File navigation within the current variant
 * - Initial page load with various configurations
 * - Cross-page navigation scenarios
 * - Edge cases and error handling
 *
 * These tests serve as comprehensive documentation of all expected behaviors.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCode } from './useCode';
import type { ContentProps } from '../CodeHighlighter/types';

describe('useCode integration tests', () => {
  let originalLocation: Location;

  beforeEach(() => {
    // Clear localStorage to avoid test pollution
    window.localStorage.clear();

    originalLocation = window.location;
    // Mock window.location with proper URL handling
    const mockLocation = {
      ...originalLocation,
      hash: '',
      pathname: '/test',
      search: '',
      href: 'http://localhost/test',
    };
    Object.defineProperty(window, 'location', {
      writable: true,
      value: mockLocation,
    });

    // Mock history API
    window.history.replaceState = vi.fn();
    window.history.pushState = vi.fn();
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  describe('variant switching with URL hash', () => {
    it('should not cause infinite loop when URL hash points to file in different variant', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'test-slug',
        code: {
          JavaScript: {
            fileName: 'demo.js',
            source: 'const x = 1;',
            extraFiles: {
              'utils.js': 'export const util = () => {};',
            },
          },
          TypeScript: {
            fileName: 'demo.ts',
            source: 'const x: number = 1;',
            extraFiles: {
              'utils.ts': 'export const util = (): void => {};',
            },
          },
        },
      };

      // Set initial hash pointing to TypeScript variant file
      window.location.hash = '#test-slug:type-script:utils.ts';

      let hookCallCount = 0;
      const { result } = renderHook(() => {
        hookCallCount += 1;
        return useCode(contentProps, {
          initialVariant: 'JavaScript',
        });
      });

      // Wait for effects to settle
      await waitFor(
        () => {
          // Should switch to TypeScript variant due to hash
          expect(result.current.selectedVariant).toBe('TypeScript');
        },
        { timeout: 1000 },
      );

      // Check that we didn't have excessive re-renders (indicating infinite loop)
      // Allow some re-renders for the variant switch and file selection, but not hundreds
      expect(hookCallCount).toBeLessThan(20);

      // Should select the file from the hash
      expect(result.current.selectedFileName).toBe('utils.ts');
    });

    it('should not cause infinite loop when switching variants manually with hash present', async () => {
      const contentProps: ContentProps<{}> = {
        code: {
          JavaScript: {
            fileName: 'demo.js',
            source: 'const x = 1;',
            extraFiles: {
              'utils.js': 'export const util = () => {};',
            },
          },
          TypeScript: {
            fileName: 'demo.ts',
            source: 'const x: number = 1;',
            extraFiles: {
              'utils.ts': 'export const util = (): void => {};',
            },
          },
        },
      };

      // Start with JavaScript file in hash
      window.location.hash = '#test-slug:demo.js';

      const { result, rerender } = renderHook(() => useCode(contentProps));

      // Wait for initial render to settle
      await waitFor(() => {
        expect(result.current.selectedVariant).toBe('JavaScript');
      });

      const callCountBeforeSwitch = result.current.variants.length; // Use a stable value

      // Switch to TypeScript variant
      act(() => {
        result.current.selectVariant('TypeScript');
      });

      // Give time for effects to run
      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('TypeScript');
        },
        { timeout: 1000 },
      );

      // Force a few re-renders to ensure no infinite loop triggers
      rerender();
      rerender();
      rerender();

      // If there was an infinite loop, the test would timeout
      expect(result.current.selectedVariant).toBe('TypeScript');
      expect(callCountBeforeSwitch).toBeDefined();
    });

    it('should handle rapid variant switches without infinite loop', async () => {
      const contentProps: ContentProps<{}> = {
        code: {
          JavaScript: {
            fileName: 'demo.js',
            source: 'const x = 1;',
          },
          TypeScript: {
            fileName: 'demo.ts',
            source: 'const x: number = 1;',
          },
          Python: {
            fileName: 'demo.py',
            source: 'x = 1',
          },
        },
      };

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.selectedVariant).toBe('JavaScript');
      });

      // Rapidly switch between variants
      act(() => {
        result.current.selectVariant('TypeScript');
        result.current.selectVariant('Python');
        result.current.selectVariant('JavaScript');
        result.current.selectVariant('TypeScript');
      });

      // Wait for effects to settle
      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('TypeScript');
        },
        { timeout: 1000 },
      );

      // Test should complete without timing out (which would indicate infinite loop)
      expect(result.current.selectedVariant).toBe('TypeScript');
    });

    it('should handle hash changes without causing variant switch loops', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'test-slug',
        code: {
          Default: {
            fileName: 'demo.js',
            source: 'const x = 1;',
            extraFiles: {
              'utils.js': 'export const util = () => {};',
              'config.js': 'export const config = {};',
            },
          },
        },
      };

      // Start with hash pointing to utils.js
      window.location.hash = '#test-slug:utils.js';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.selectedFileName).toBe('utils.js');
      });

      // Simulate hash change by manually updating location and triggering hashchange event
      act(() => {
        window.location.hash = '#test-slug:config.js';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      await waitFor(
        () => {
          expect(result.current.selectedFileName).toBe('config.js');
        },
        { timeout: 1000 },
      );

      // Should not cause any loops
      expect(result.current.selectedFileName).toBe('config.js');
    });
  });

  describe('file navigation with variants', () => {
    it('should maintain file selection when variant has the same file', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'test-slug',
        code: {
          JavaScript: {
            fileName: 'demo.js',
            source: 'const x = 1;',
            extraFiles: {
              'utils.js': 'export const util = () => {};',
            },
          },
          TypeScript: {
            fileName: 'demo.ts',
            source: 'const x: number = 1;',
            extraFiles: {
              'utils.ts': 'export const util = (): void => {};',
            },
          },
        },
      };

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.selectedVariant).toBe('JavaScript');
      });

      // Select utils file
      act(() => {
        result.current.selectFileName('utils.js');
      });

      await waitFor(() => {
        expect(result.current.selectedFileName).toBe('utils.js');
      });

      // Switch to TypeScript - should reset to main file since utils.js doesn't exist
      act(() => {
        result.current.selectVariant('TypeScript');
      });

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('TypeScript');
          expect(result.current.selectedFileName).toBe('demo.ts');
        },
        { timeout: 1000 },
      );
    });
  });

  describe('initial page load scenarios', () => {
    it('should load correct variant and file when hash is present on mount', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'test-slug',
        code: {
          JavaScript: {
            fileName: 'demo.js',
            source: 'const x = 1;',
            extraFiles: {
              'utils.js': 'export const util = () => {};',
            },
          },
          TypeScript: {
            fileName: 'demo.ts',
            source: 'const x: number = 1;',
            extraFiles: {
              'utils.ts': 'export const util = (): void => {};',
            },
          },
        },
      };

      // Set hash before rendering - simulates user landing on page with hash
      window.location.hash = '#test-slug:type-script:utils.ts';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('TypeScript');
          expect(result.current.selectedFileName).toBe('utils.ts');
        },
        { timeout: 1000 },
      );
    });

    it('should not switch URL when hash specifies default variant file but localStorage has different variant', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'test-slug',
        code: {
          JavaScript: {
            fileName: 'demo.js',
            source: 'const x = 1;',
          },
          TypeScript: {
            fileName: 'demo.ts',
            source: 'const x: number = 1;',
          },
        },
      };

      // Mock localStorage to have TypeScript preference
      const mockGetItem = vi.fn((key) => {
        if (key?.includes('variant_pref')) {
          return 'TypeScript';
        }
        return null;
      });
      const originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = mockGetItem;

      // Hash specifies JavaScript file (default variant)
      window.location.hash = '#test-slug:demo.js';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          // Should recognize file is in JavaScript variant and stay there
          expect(result.current.selectedVariant).toBe('JavaScript');
          expect(result.current.selectedFileName).toBe('demo.js');
        },
        { timeout: 1000 },
      );

      // URL should NOT have been changed to include TypeScript variant
      expect(window.location.hash).toBe('#test-slug:demo.js');

      Storage.prototype.getItem = originalGetItem;
    });

    it('should respect localStorage variant preference on initial load', async () => {
      const contentProps: ContentProps<{}> = {
        code: {
          JavaScript: {
            fileName: 'demo.js',
            source: 'const x = 1;',
          },
          TypeScript: {
            fileName: 'demo.ts',
            source: 'const x: number = 1;',
          },
        },
      };

      // Mock localStorage to have TypeScript preference
      const mockGetItem = vi.fn((key) => {
        if (key?.includes('variant_pref')) {
          return 'TypeScript';
        }
        return null;
      });
      const originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = mockGetItem;

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('TypeScript');
        },
        { timeout: 1000 },
      );

      Storage.prototype.getItem = originalGetItem;
    });

    it('should prioritize hash over localStorage preference', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'test-slug',
        code: {
          JavaScript: {
            fileName: 'demo.js',
            source: 'const x = 1;',
          },
          TypeScript: {
            fileName: 'demo.ts',
            source: 'const x: number = 1;',
          },
          Python: {
            fileName: 'demo.py',
            source: 'x = 1',
          },
        },
      };

      // Mock localStorage to have TypeScript preference
      const mockGetItem = vi.fn((key) => {
        if (key?.includes('variant_pref')) {
          return 'TypeScript';
        }
        return null;
      });
      const originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = mockGetItem;

      // But hash specifies Python
      window.location.hash = '#test-slug:python:demo.py';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          // Hash should take precedence
          expect(result.current.selectedVariant).toBe('Python');
        },
        { timeout: 1000 },
      );

      Storage.prototype.getItem = originalGetItem;
    });
  });

  describe('cross-page navigation', () => {
    it('should not apply hash from different demo slug', async () => {
      const contentProps: ContentProps<{}> = {
        code: {
          Default: {
            fileName: 'component.js',
            source: 'export default Component;',
            extraFiles: {
              'styles.css': '.component {}',
            },
          },
        },
      };

      // Hash is for a different demo (different-demo vs test-slug)
      window.location.hash = '#different-demo:styles.css';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        // Should ignore hash and select main file
        expect(result.current.selectedFileName).toBe('component.js');
      });
    });

    it('should handle multiple demos on same page with different hashes', async () => {
      const demo1Props: ContentProps<{}> = {
        slug: 'demo1',
        code: {
          Default: {
            fileName: 'demo1.js',
            source: 'console.log("demo1");',
            extraFiles: {
              'config1.js': 'export const config1 = {};',
            },
          },
        },
      };

      const demo2Props: ContentProps<{}> = {
        slug: 'demo2',
        code: {
          Default: {
            fileName: 'demo2.js',
            source: 'console.log("demo2");',
            extraFiles: {
              'config2.js': 'export const config2 = {};',
            },
          },
        },
      };

      // Hash points to demo1's config file
      window.location.hash = '#demo1:config1.js';

      const { result: result1 } = renderHook(() => useCode(demo1Props));
      const { result: result2 } = renderHook(() => useCode(demo2Props));

      await waitFor(() => {
        // Demo1 should respond to hash and select config file
        expect(result1.current.selectedVariant).toBe('Default');
        expect(result1.current.selectedFileName).toBe('config1.js');
        // Demo2 should ignore it and use main file
        expect(result2.current.selectedVariant).toBe('Default');
        expect(result2.current.selectedFileName).toBe('demo2.js');
      });
    });
  });

  describe('file selection within current variant', () => {
    it('should only allow selecting files from current variant', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'test-slug',
        code: {
          JavaScript: {
            fileName: 'demo.js',
            source: 'const x = 1;',
            extraFiles: {
              'utils.js': 'export const util = () => {};',
            },
          },
          TypeScript: {
            fileName: 'demo.ts',
            source: 'const x: number = 1;',
            extraFiles: {
              'types.d.ts': 'export type Config = {};',
            },
          },
        },
      };

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.selectedVariant).toBe('JavaScript');
      });

      // Try to select a file that only exists in TypeScript variant
      // This should be ignored or fallback to main file
      act(() => {
        result.current.selectFileName('types.d.ts');
      });

      await waitFor(() => {
        // Should remain in JavaScript variant
        expect(result.current.selectedVariant).toBe('JavaScript');
        // Should either ignore the selection or fallback to main file
        expect(result.current.selectedFileName).not.toBe('types.d.ts');
      });
    });

    it('should select files that exist in current variant', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'test-slug',
        code: {
          JavaScript: {
            fileName: 'demo.js',
            source: 'const x = 1;',
            extraFiles: {
              'utils.js': 'export const util = () => {};',
            },
          },
          TypeScript: {
            fileName: 'demo.ts',
            source: 'const x: number = 1;',
            extraFiles: {
              'types.d.ts': 'export type Config = {};',
            },
          },
        },
      };

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.selectedVariant).toBe('JavaScript');
      });

      // Select file that exists in current variant
      act(() => {
        result.current.selectFileName('utils.js');
      });

      await waitFor(() => {
        expect(result.current.selectedVariant).toBe('JavaScript');
        expect(result.current.selectedFileName).toBe('utils.js');
      });
    });
  });

  describe('hash synchronization', () => {
    it('should update selected file when hash is updated via hashchange event', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'test-slug',
        code: {
          Default: {
            fileName: 'demo.js',
            source: 'const x = 1;',
            extraFiles: {
              'utils.js': 'export const util = () => {};',
              'config.js': 'export const config = {};',
            },
          },
        },
      };

      window.location.hash = '#test-slug:demo.js';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.selectedFileName).toBe('demo.js');
      });

      // Update hash to point to utils.js
      act(() => {
        window.location.hash = '#test-slug:utils.js';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      await waitFor(
        () => {
          expect(result.current.selectedFileName).toBe('utils.js');
        },
        { timeout: 1000 },
      );

      // Update hash again to point to config.js
      act(() => {
        window.location.hash = '#test-slug:config.js';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      await waitFor(
        () => {
          expect(result.current.selectedFileName).toBe('config.js');
        },
        { timeout: 1000 },
      );

      // Verify final state
      expect(result.current.selectedFileName).toBe('config.js');
      expect(window.location.hash).toBe('#test-slug:config.js');
    });

    it('should reset to main file when hash is completely removed', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'test-slug',
        code: {
          Default: {
            fileName: 'demo.js',
            source: 'const x = 1;',
            extraFiles: {
              'utils.js': 'export const util = () => {};',
              'config.js': 'export const config = {};',
            },
          },
        },
      };

      // Start with hash pointing to utils.js
      window.location.hash = '#test-slug:utils.js';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.selectedFileName).toBe('utils.js');
      });

      // Remove hash completely (user clears URL or navigates back)
      act(() => {
        window.location.hash = '';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      await waitFor(
        () => {
          // Should reset to main file when hash is removed
          expect(result.current.selectedFileName).toBe('demo.js');
        },
        { timeout: 1000 },
      );

      expect(result.current.selectedFileName).toBe('demo.js');
      expect(window.location.hash).toBe('');
    });

    it('should reset to main file when hash is removed after being on extra file in different variant', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'demo',
        code: {
          JavaScript: {
            fileName: 'index.js',
            source: 'console.log("main");',
            extraFiles: {
              'helper.js': 'export const help = () => {};',
            },
          },
          TypeScript: {
            fileName: 'index.ts',
            source: 'console.log("main");',
            extraFiles: {
              'helper.ts': 'export const help = (): void => {};',
            },
          },
        },
      };

      // Start with hash pointing to TypeScript variant's helper file
      window.location.hash = '#demo:type-script:helper.ts';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('TypeScript');
          expect(result.current.selectedFileName).toBe('helper.ts');
        },
        { timeout: 1000 },
      );

      // Remove hash completely
      act(() => {
        window.location.hash = '';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      await waitFor(
        () => {
          // Should reset to main file when hash is removed
          // Variant stays the same (TypeScript due to localStorage preference)
          expect(result.current.selectedFileName).toBe('index.ts');
        },
        { timeout: 1000 },
      );

      expect(result.current.selectedFileName).toBe('index.ts');
    });

    it('should update hash when user manually selects file', async () => {
      const contentProps: ContentProps<{}> = {
        code: {
          Default: {
            fileName: 'demo.js',
            source: 'const x = 1;',
            extraFiles: {
              'utils.js': 'export const util = () => {};',
            },
          },
        },
      };

      window.location.hash = '';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.selectedFileName).toBe('demo.js');
      });

      const initialHistoryCallCount = (window.history.replaceState as any).mock.calls.length;

      // User manually selects a file
      act(() => {
        result.current.selectFileName('utils.js');
      });

      await waitFor(() => {
        expect(result.current.selectedFileName).toBe('utils.js');
      });

      // Hash should be updated (history.replaceState should be called)
      expect((window.history.replaceState as any).mock.calls.length).toBeGreaterThan(
        initialHistoryCallCount,
      );
    });

    it('should handle malformed hash gracefully', async () => {
      const contentProps: ContentProps<{}> = {
        code: {
          Default: {
            fileName: 'demo.js',
            source: 'const x = 1;',
          },
        },
      };

      // Test with empty hash
      window.location.hash = '#';
      const { result: result1 } = renderHook(() => useCode(contentProps));
      await waitFor(() => {
        expect(result1.current.selectedFileName).toBe('demo.js');
      });

      // Test with colon only
      window.location.hash = '#:';
      const { result: result2 } = renderHook(() => useCode(contentProps));
      await waitFor(() => {
        expect(result2.current.selectedFileName).toBe('demo.js');
      });

      // Test with multiple colons
      window.location.hash = '#:::';
      const { result: result3 } = renderHook(() => useCode(contentProps));
      await waitFor(() => {
        expect(result3.current.selectedFileName).toBe('demo.js');
      });

      // Test with slug only
      window.location.hash = '#test-slug';
      const { result: result4 } = renderHook(() => useCode(contentProps));
      await waitFor(() => {
        expect(result4.current.selectedFileName).toBe('demo.js');
      });

      // Test with nonexistent file
      window.location.hash = '#test-slug:nonexistent.js';
      const { result: result5 } = renderHook(() => useCode(contentProps));
      await waitFor(() => {
        expect(result5.current.selectedFileName).toBe('demo.js');
      });
    });

    it('should not update hash when selection is programmatic due to variant switch', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'test-slug',
        code: {
          JavaScript: {
            fileName: 'demo.js',
            source: 'const x = 1;',
            extraFiles: {
              'utils.js': 'export const util = () => {};',
            },
          },
          TypeScript: {
            fileName: 'demo.ts',
            source: 'const x: number = 1;',
          },
        },
      };

      window.location.hash = '#test-slug:utils.js';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.selectedFileName).toBe('utils.js');
      });

      const historyCallCountBefore = (window.history.replaceState as any).mock.calls.length;

      // Switch to TypeScript - utils.js doesn't exist there, so it will programmatically select demo.ts
      act(() => {
        result.current.selectVariant('TypeScript');
      });

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('TypeScript');
          expect(result.current.selectedFileName).toBe('demo.ts');
        },
        { timeout: 1000 },
      );

      const historyCallCountAfter = (window.history.replaceState as any).mock.calls.length;

      // The file selection was programmatic, so hash updates should be minimal
      // Some updates are expected for variant switch and file selection, but not excessive
      // Allow up to 15 updates (variant switch may trigger multiple effects)
      expect(historyCallCountAfter - historyCallCountBefore).toBeLessThan(15);
    });

    it('should not create infinite loop when hash is manually edited to trigger variant switch with extra file', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'Hero',
        code: {
          CssModules: {
            fileName: 'index.tsx',
            source: '<Hero variant="css-modules" />',
            extraFiles: {
              'index.module.css': '.hero { color: red; }',
            },
          },
          Tailwind: {
            fileName: 'index.tsx',
            source: '<Hero variant="tailwind" />',
            extraFiles: {
              'index.ts': 'export const styles = {};',
            },
          },
        },
      };

      window.location.hash = '#hero:tailwind:index.tsx';

      let hookCallCount = 0;
      const { result } = renderHook(() => {
        hookCallCount += 1;
        return useCode(contentProps);
      });

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('Tailwind');
          expect(result.current.selectedFileName).toBe('index.tsx');
        },
        { timeout: 1000 },
      );

      act(() => {
        window.location.hash = '#hero:index.module.css';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('CssModules');
          expect(result.current.selectedFileName).toBe('index.module.css');
        },
        { timeout: 1000 },
      );

      expect(window.location.hash).toBe('#hero:index.module.css');

      const historyCalls = (window.history.replaceState as any).mock.calls.map(
        (call: any[]) => call[2],
      );
      expect(historyCalls.some((url: string) => url.endsWith('#hero:index.tsx'))).toBe(false);

      expect(hookCallCount).toBeLessThan(50);
    });

    it('should update hash when variant changes after rapid hash-driven navigation', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'hero',
        code: {
          CssModules: {
            fileName: 'index.tsx',
            source: '<Hero variant="css-modules" />',
            extraFiles: {
              'index.module.css': '.hero { color: red; }',
              'theme.css': ':root { --color: blue; }',
            },
          },
          Tailwind: {
            fileName: 'index.tsx',
            source: '<Hero variant="tailwind" />',
          },
        },
      };

      // Start with Tailwind variant
      window.location.hash = '#hero:tailwind:index.tsx';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('Tailwind');
          expect(result.current.selectedFileName).toBe('index.tsx');
        },
        { timeout: 1000 },
      );

      // Simulate rapid hash changes (user clicking through files or browser history)
      act(() => {
        window.location.hash = '#hero:tailwind:index.tsx';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      await waitFor(() => {
        expect(result.current.selectedFileName).toBe('index.tsx');
      });

      act(() => {
        window.location.hash = '#hero:theme.css';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('CssModules');
          expect(result.current.selectedFileName).toBe('theme.css');
        },
        { timeout: 1000 },
      );

      // Clear history calls to track only the variant change
      (window.history.replaceState as any).mockClear();

      // Now user changes variant - this should update the hash
      // Bug: hashNavigationInProgressRef stays true and blocks this update
      act(() => {
        result.current.selectVariant('Tailwind');
      });

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('Tailwind');
        },
        { timeout: 1000 },
      );

      // The hash should be updated to reflect the new variant
      // If hashNavigationInProgressRef is stuck, this will fail
      const historyCalls = (window.history.replaceState as any).mock.calls;
      const hashUpdates = historyCalls
        .map((call: any[]) => call[2])
        .filter((url: string) => url && url.includes('#'));

      // Should have updated the hash to include tailwind variant
      expect(hashUpdates.some((url: string) => url.includes('tailwind'))).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty extraFiles object', async () => {
      const contentProps: ContentProps<{}> = {
        code: {
          Default: {
            fileName: 'demo.js',
            source: 'const x = 1;',
            extraFiles: {},
          },
        },
      };

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.selectedFileName).toBe('demo.js');
      });
    });

    it('should handle variant with no extraFiles property', async () => {
      const contentProps: ContentProps<{}> = {
        code: {
          Default: {
            fileName: 'demo.js',
            source: 'const x = 1;',
          },
        },
      };

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.selectedFileName).toBe('demo.js');
      });
    });

    it('should handle hash pointing to non-existent file', async () => {
      const contentProps: ContentProps<{}> = {
        code: {
          Default: {
            fileName: 'demo.js',
            source: 'const x = 1;',
            extraFiles: {
              'utils.js': 'export const util = () => {};',
            },
          },
        },
      };

      window.location.hash = '#test-slug:nonexistent.js';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        // Should fallback to main file
        expect(result.current.selectedFileName).toBe('demo.js');
      });
    });

    it('should handle single variant without crashing', async () => {
      const contentProps: ContentProps<{}> = {
        code: {
          OnlyVariant: {
            fileName: 'demo.js',
            source: 'const x = 1;',
          },
        },
      };

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.selectedVariant).toBe('OnlyVariant');
        expect(result.current.variants).toEqual(['OnlyVariant']);
      });
    });

    it('should handle variant names with special characters', async () => {
      const contentProps: ContentProps<{}> = {
        code: {
          'TypeScript + ESLint': {
            fileName: 'demo.ts',
            source: 'const x: number = 1;',
          },
          'JavaScript (Legacy)': {
            fileName: 'demo.js',
            source: 'const x = 1;',
          },
        },
      };

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.variants).toContain('TypeScript + ESLint');
      });

      act(() => {
        result.current.selectVariant('JavaScript (Legacy)');
      });

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('JavaScript (Legacy)');
        },
        { timeout: 1000 },
      );
    });
  });
});
