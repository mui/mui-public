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
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useCode } from './useCode';
import type { ContentProps } from '../CodeHighlighter/types';

describe('useCode integration tests', () => {
  let originalLocation: Location;

  beforeEach(() => {
    // Clear localStorage to avoid test pollution
    window.localStorage.clear();

    originalLocation = window.location;

    // Create a mock location object that we can update
    let mockHash = '';
    const mockLocation: any = {
      ...originalLocation,
      get hash() {
        return mockHash;
      },
      set hash(value: string) {
        // Ensure hash includes the # if provided
        if (value.startsWith('#')) {
          mockHash = value;
        } else if (value) {
          mockHash = `#${value}`;
        } else {
          mockHash = '';
        }
      },
      pathname: '/test',
      search: '',
      href: 'http://localhost/test',
    };

    Object.defineProperty(window, 'location', {
      writable: true,
      value: mockLocation,
    });

    // Mock history API to actually update mock location hash
    window.history.replaceState = vi.fn((state, title, url) => {
      if (url) {
        const hashIndex = url.indexOf('#');
        mockLocation.hash = hashIndex >= 0 ? url.substring(hashIndex) : '';
      }
    });
    window.history.pushState = vi.fn((state, title, url) => {
      if (url) {
        const hashIndex = url.indexOf('#');
        mockLocation.hash = hashIndex >= 0 ? url.substring(hashIndex) : '';
      }
    });
  });

  afterEach(async () => {
    // Clear the hash BEFORE cleanup so components see the empty hash
    window.location.hash = '';

    // Ensure all hooks are unmounted
    cleanup();

    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });

    // Wait for all async effects to complete
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
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
          expect(result.current.selectedFileName).toBe('demo.py');
        },
        { timeout: 1000 },
      );

      Storage.prototype.getItem = originalGetItem;
    });

    it('should switch to hash variant even when localStorage has default variant', async () => {
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

      // Mock localStorage to have JavaScript (default) preference
      const mockGetItem = vi.fn((key) => {
        if (key?.includes('variant_pref')) {
          return 'JavaScript';
        }
        return null;
      });
      const originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = mockGetItem;

      // But hash specifies TypeScript with extra file
      window.location.hash = '#test-slug:type-script:utils.ts';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          // Hash should take precedence - should switch to TypeScript and select utils.ts
          expect(result.current.selectedVariant).toBe('TypeScript');
          expect(result.current.selectedFileName).toBe('utils.ts');
        },
        { timeout: 1000 },
      );

      Storage.prototype.getItem = originalGetItem;
    });

    it('should not clear hash when initial mount has both localStorage and hash', async () => {
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

      // Mock localStorage to have JavaScript preference
      const mockGetItem = vi.fn((key) => {
        if (key?.includes('variant_pref')) {
          return 'JavaScript';
        }
        return null;
      });
      const originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = mockGetItem;

      // Hash points to TypeScript variant with extra file
      window.location.hash = '#test-slug:type-script:utils.ts';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          // Should switch to TypeScript as specified in hash
          expect(result.current.selectedVariant).toBe('TypeScript');
          expect(result.current.selectedFileName).toBe('utils.ts');
          // Hash should still be present (not cleared)
          expect(window.location.hash).toBe('#test-slug:type-script:utils.ts');
        },
        { timeout: 1000 },
      );

      Storage.prototype.getItem = originalGetItem;
    });

    it('should switch variants on mount even with fileHashAfterRead remove and localStorage', async () => {
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

      // Mock localStorage to have JavaScript preference
      const mockGetItem = vi.fn((key) => {
        if (key?.includes('variant_pref')) {
          return 'JavaScript';
        }
        return null;
      });
      const originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = mockGetItem;

      // Hash points to TypeScript variant with extra file
      window.location.hash = '#test-slug:type-script:utils.ts';

      const { result } = renderHook(() => useCode(contentProps, { fileHashAfterRead: 'remove' }));

      await waitFor(
        () => {
          // Should switch to TypeScript and select the file even though fileHashAfterRead is 'remove'
          expect(result.current.selectedVariant).toBe('TypeScript');
          expect(result.current.selectedFileName).toBe('utils.ts');
        },
        { timeout: 1000 },
      );

      Storage.prototype.getItem = originalGetItem;
    });

    it('should respect hash variant on mount with avoidMutatingAddressBar and localStorage preference', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'hero',
        code: {
          CssModules: {
            fileName: 'index.tsx',
            source: 'const x = 1;',
          },
          Tailwind: {
            fileName: 'index.tsx',
            source: 'const x: number = 1;',
          },
        },
      };

      // Mock localStorage to have CssModules preference (matching real scenario)
      const mockGetItem = vi.fn((key) => {
        if (key?.includes('variant_pref')) {
          return 'CssModules';
        }
        return null;
      });
      const originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = mockGetItem;

      // Hash points to Tailwind variant (using kebab-case as it appears in URL)
      window.location.hash = '#hero:tailwind:index.tsx';

      const { result } = renderHook(() => useCode(contentProps, { avoidMutatingAddressBar: true }));

      // Hash should take precedence over localStorage - should load Tailwind, not CssModules
      // With avoidMutatingAddressBar, hash should be cleaned to just #hero after loading
      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('Tailwind');
          expect(result.current.selectedFileName).toBe('index.tsx');
          // Hash should be cleaned to just the slug with avoidMutatingAddressBar
          expect(window.location.hash).toBe('#hero');
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

    it('should update hash when user manually changes variant', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'test-demo',
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

      // Start with a hash pointing to the main file of the default variant
      // This simulates a user who navigated to this page with a specific file
      window.location.hash = '#test-demo:demo.js';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.selectedVariant).toBe('JavaScript');
        expect(result.current.selectedFileName).toBe('demo.js');
      });

      // User manually selects a different variant
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

      // Hash should be updated to reflect the new variant
      // Since we started with a hash, variant changes should update it
      const historyCalls = (window.history.replaceState as any).mock.calls;
      const hashUpdates = historyCalls
        .map((call: any[]) => call[2])
        .filter((url: string) => url && url.includes('#'));

      // Should have updated the hash to include the new variant
      expect(hashUpdates.length).toBeGreaterThan(0);
      expect(hashUpdates.some((url: string) => url.includes('type-script'))).toBe(true);
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

  describe('avoidMutatingAddressBar flag', () => {
    it('should read hash with file and clean it to remove file portion', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'advanced',
        code: {
          Default: {
            fileName: 'index.tsx',
            source: 'export default Component;',
            extraFiles: {
              'index.module.css': '.component { color: red; }',
              'utils.ts': 'export const util = () => {};',
            },
          },
        },
      };

      // Start with hash including file name
      window.location.hash = '#advanced:index.module.css';

      const { result } = renderHook(() => useCode(contentProps, { avoidMutatingAddressBar: true }));

      await waitFor(
        () => {
          // Should read the hash and update state to select the file
          expect(result.current.selectedFileName).toBe('index.module.css');
        },
        { timeout: 1000 },
      );

      // Hash should be cleaned to remove file portion
      await waitFor(
        () => {
          expect(window.location.hash).toBe('#advanced');
        },
        { timeout: 1000 },
      );
    });

    it('should clean hash when variant is included in URL', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'demo',
        code: {
          JavaScript: {
            fileName: 'index.js',
            source: 'const x = 1;',
            extraFiles: {
              'helper.js': 'export const help = () => {};',
            },
          },
          TypeScript: {
            fileName: 'index.ts',
            source: 'const x: number = 1;',
            extraFiles: {
              'helper.ts': 'export const help = (): void => {};',
            },
          },
        },
      };

      // Hash includes variant and file
      window.location.hash = '#demo:type-script:helper.ts';

      const { result } = renderHook(() => useCode(contentProps, { avoidMutatingAddressBar: true }));

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('TypeScript');
          expect(result.current.selectedFileName).toBe('helper.ts');
        },
        { timeout: 1000 },
      );

      // Hash should be cleaned to just demo slug (no variant, no file)
      await waitFor(
        () => {
          expect(window.location.hash).toBe('#demo');
        },
        { timeout: 1000 },
      );
    });

    it('should handle variant changes and keep hash clean', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'hero',
        code: {
          CssModules: {
            fileName: 'index.tsx',
            source: '<Hero />',
            extraFiles: {
              'styles.module.css': '.hero { color: blue; }',
            },
          },
          Tailwind: {
            fileName: 'index.tsx',
            source: '<Hero />',
            extraFiles: {
              'config.ts': 'export const config = {};',
            },
          },
        },
      };

      window.location.hash = '#hero:css-modules:styles.module.css';

      const { result } = renderHook(() =>
        useCode(contentProps, {
          avoidMutatingAddressBar: true,
          initialVariant: 'Tailwind',
        }),
      );

      // Wait for variant to switch and file to be selected
      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('CssModules');
        },
        { timeout: 1000 },
      );

      await waitFor(
        () => {
          expect(result.current.selectedFileName).toBe('styles.module.css');
        },
        { timeout: 1000 },
      );

      // Hash should be cleaned
      await waitFor(
        () => {
          expect(window.location.hash).toBe('#hero');
        },
        { timeout: 1000 },
      );

      // User switches variant
      act(() => {
        result.current.selectVariant('Tailwind');
      });

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('Tailwind');
        },
        { timeout: 1000 },
      );

      // Hash should stay clean (just slug, no variant)
      await waitFor(
        () => {
          expect(window.location.hash).toBe('#hero');
        },
        { timeout: 1000 },
      );
    });

    it('should handle file selection while keeping hash clean', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'demo',
        code: {
          Default: {
            fileName: 'main.js',
            source: 'console.log("main");',
            extraFiles: {
              'helper.js': 'export const help = () => {};',
              'config.js': 'export const config = {};',
            },
          },
        },
      };

      window.location.hash = '#demo';

      const { result } = renderHook(() => useCode(contentProps, { avoidMutatingAddressBar: true }));

      await waitFor(() => {
        expect(result.current.selectedFileName).toBe('main.js');
      });

      // User selects different file
      act(() => {
        result.current.selectFileName('helper.js');
      });

      await waitFor(
        () => {
          expect(result.current.selectedFileName).toBe('helper.js');
        },
        { timeout: 1000 },
      );

      // Hash should remain clean (no file portion added)
      await waitFor(
        () => {
          expect(window.location.hash).toBe('#demo');
        },
        { timeout: 1000 },
      );

      // Select another file
      act(() => {
        result.current.selectFileName('config.js');
      });

      await waitFor(
        () => {
          expect(result.current.selectedFileName).toBe('config.js');
        },
        { timeout: 1000 },
      );

      // Hash should still be clean
      expect(window.location.hash).toBe('#demo');
    });

    it('should clean hash to just slug when on default variant main file', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'simple',
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

      // Hash includes default variant and main file
      window.location.hash = '#simple:java-script:demo.js';

      const { result } = renderHook(() =>
        useCode(contentProps, {
          avoidMutatingAddressBar: true,
          initialVariant: 'JavaScript',
        }),
      );

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('JavaScript');
          expect(result.current.selectedFileName).toBe('demo.js');
        },
        { timeout: 1000 },
      );

      // Hash should be cleaned to just slug (no variant, no file for default variant)
      await waitFor(
        () => {
          expect(window.location.hash).toBe('#simple');
        },
        { timeout: 1000 },
      );
    });

    it('should handle cross-variant file navigation and maintain clean hash', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'multi',
        code: {
          JavaScript: {
            fileName: 'index.js',
            source: 'const x = 1;',
            extraFiles: {
              'utils.js': 'export const util = () => {};',
            },
          },
          TypeScript: {
            fileName: 'index.ts',
            source: 'const x: number = 1;',
            extraFiles: {
              'utils.ts': 'export const util = (): void => {};',
            },
          },
        },
      };

      // Start with TypeScript variant and extra file
      window.location.hash = '#multi:type-script:utils.ts';

      const { result } = renderHook(() => useCode(contentProps, { avoidMutatingAddressBar: true }));

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('TypeScript');
          expect(result.current.selectedFileName).toBe('utils.ts');
        },
        { timeout: 1000 },
      );

      // Hash should be cleaned to variant only
      await waitFor(
        () => {
          expect(window.location.hash).toBe('#multi');
        },
        { timeout: 1000 },
      );

      // Switch to JavaScript variant
      act(() => {
        result.current.selectVariant('JavaScript');
      });

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('JavaScript');
        },
        { timeout: 1000 },
      );

      // Hash should stay clean (just slug)
      await waitFor(
        () => {
          expect(window.location.hash).toBe('#multi');
        },
        { timeout: 1000 },
      );
    });

    it('should not cause infinite loop with avoidMutatingAddressBar enabled', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'test',
        code: {
          Default: {
            fileName: 'index.tsx',
            source: 'export default Component;',
            extraFiles: {
              'styles.css': '.component {}',
            },
          },
        },
      };

      window.location.hash = '#test:styles.css';

      let hookCallCount = 0;
      const { result } = renderHook(() => {
        hookCallCount += 1;
        return useCode(contentProps, { avoidMutatingAddressBar: true });
      });

      await waitFor(
        () => {
          expect(result.current.selectedFileName).toBe('styles.css');
        },
        { timeout: 1000 },
      );

      await waitFor(
        () => {
          expect(window.location.hash).toBe('#test');
        },
        { timeout: 1000 },
      );

      // Should not have excessive re-renders
      expect(hookCallCount).toBeLessThan(20);
    });

    it('should handle rapid hash changes with clean URLs', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'rapid',
        code: {
          Default: {
            fileName: 'main.js',
            source: 'console.log("main");',
            extraFiles: {
              'a.js': 'console.log("a");',
              'b.js': 'console.log("b");',
              'c.js': 'console.log("c");',
            },
          },
        },
      };

      window.location.hash = '#rapid:a.js';

      const { result } = renderHook(() => useCode(contentProps, { avoidMutatingAddressBar: true }));

      await waitFor(
        () => {
          expect(result.current.selectedFileName).toBe('a.js');
        },
        { timeout: 1000 },
      );

      // Simulate rapid external hash changes (e.g., browser back/forward)
      act(() => {
        window.location.hash = '#rapid:b.js';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      await waitFor(
        () => {
          expect(result.current.selectedFileName).toBe('b.js');
        },
        { timeout: 1000 },
      );

      act(() => {
        window.location.hash = '#rapid:c.js';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      await waitFor(
        () => {
          expect(result.current.selectedFileName).toBe('c.js');
        },
        { timeout: 1000 },
      );

      // Hash should eventually stabilize to clean version
      await waitFor(
        () => {
          expect(window.location.hash).toBe('#rapid');
        },
        { timeout: 1000 },
      );
    });

    it('should work with localStorage variant preference and clean hash', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'pref',
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

      // Hash includes TypeScript variant file
      window.location.hash = '#pref:type-script:demo.ts';

      const { result } = renderHook(() => useCode(contentProps, { avoidMutatingAddressBar: true }));

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('TypeScript');
          expect(result.current.selectedFileName).toBe('demo.ts');
        },
        { timeout: 1000 },
      );

      // Hash should be cleaned to variant only
      await waitFor(
        () => {
          expect(window.location.hash).toBe('#pref');
        },
        { timeout: 1000 },
      );

      Storage.prototype.getItem = originalGetItem;
    });

    it('should not add hash when none exists and user switches tabs/files', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'advanced',
        code: {
          Basic: {
            fileName: 'index.tsx',
            source: 'export default BasicComponent;',
            extraFiles: {
              'styles.css': '.basic { color: blue; }',
            },
          },
          Advanced: {
            fileName: 'index.tsx',
            source: 'export default AdvancedComponent;',
            extraFiles: {
              'config.ts': 'export const config = {};',
            },
          },
        },
      };

      // Start with no hash
      window.location.hash = '';

      const { result } = renderHook(() => useCode(contentProps, { avoidMutatingAddressBar: true }));

      await waitFor(() => {
        expect(result.current.selectedVariant).toBe('Basic');
        expect(result.current.selectedFileName).toBe('index.tsx');
      });

      // User switches to Advanced variant
      act(() => {
        result.current.selectVariant('Advanced');
      });

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('Advanced');
          expect(result.current.selectedFileName).toBe('index.tsx');
        },
        { timeout: 1000 },
      );

      // Hash should remain empty (not add #advanced)
      expect(window.location.hash).toBe('');

      // User selects a different file
      act(() => {
        result.current.selectFileName('config.ts');
      });

      await waitFor(
        () => {
          expect(result.current.selectedFileName).toBe('config.ts');
        },
        { timeout: 1000 },
      );

      // Hash should still be empty
      expect(window.location.hash).toBe('');
    });
  });

  describe('fileHashAfterRead flag', () => {
    it('should completely remove hash when fileHashAfterRead is "remove"', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'advanced',
        code: {
          Default: {
            fileName: 'index.tsx',
            source: 'export default Component;',
            extraFiles: {
              'index.module.css': '.component { color: red; }',
              'utils.ts': 'export const util = () => {};',
            },
          },
        },
      };

      // Start with hash including file name
      window.location.hash = '#advanced:index.module.css';

      const { result } = renderHook(() => useCode(contentProps, { fileHashAfterRead: 'remove' }));

      await waitFor(
        () => {
          // Should read the hash and update state to select the file
          expect(result.current.selectedFileName).toBe('index.module.css');
        },
        { timeout: 1000 },
      );

      // Hash should be completely removed
      await waitFor(
        () => {
          expect(window.location.hash).toBe('');
        },
        { timeout: 1000 },
      );
    });

    it('should remove hash with variant in URL when fileHashAfterRead is "remove"', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'demo',
        code: {
          JavaScript: {
            fileName: 'index.js',
            source: 'const x = 1;',
            extraFiles: {
              'helper.js': 'export const help = () => {};',
            },
          },
          TypeScript: {
            fileName: 'index.ts',
            source: 'const x: number = 1;',
            extraFiles: {
              'helper.ts': 'export const help = (): void => {};',
            },
          },
        },
      };

      // Hash includes variant and file
      window.location.hash = '#demo:type-script:helper.ts';

      const { result } = renderHook(() => useCode(contentProps, { fileHashAfterRead: 'remove' }));

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('TypeScript');
          expect(result.current.selectedFileName).toBe('helper.ts');
        },
        { timeout: 1000 },
      );

      // Hash should be completely removed
      await waitFor(
        () => {
          expect(window.location.hash).toBe('');
        },
        { timeout: 1000 },
      );
    });

    it('should not add hash when none exists with fileHashAfterRead "remove"', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'test',
        code: {
          Basic: {
            fileName: 'index.tsx',
            source: 'export default BasicComponent;',
          },
          Advanced: {
            fileName: 'index.tsx',
            source: 'export default AdvancedComponent;',
          },
        },
      };

      // Start with no hash
      window.location.hash = '';

      const { result } = renderHook(() => useCode(contentProps, { fileHashAfterRead: 'remove' }));

      await waitFor(() => {
        expect(result.current.selectedVariant).toBe('Basic');
      });

      // User switches to Advanced variant
      act(() => {
        result.current.selectVariant('Advanced');
      });

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('Advanced');
        },
        { timeout: 1000 },
      );

      // Hash should remain empty (not add one)
      expect(window.location.hash).toBe('');
    });

    it('should clean hash to demo slug when fileHashAfterRead is "demo"', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'hero',
        code: {
          Default: {
            fileName: 'index.tsx',
            source: 'export default Hero;',
            extraFiles: {
              'styles.css': '.hero { color: blue; }',
            },
          },
        },
      };

      window.location.hash = '#hero:styles.css';

      const { result } = renderHook(() => useCode(contentProps, { fileHashAfterRead: 'demo' }));

      await waitFor(
        () => {
          expect(result.current.selectedFileName).toBe('styles.css');
        },
        { timeout: 1000 },
      );

      // Hash should be cleaned to just demo slug
      await waitFor(
        () => {
          expect(window.location.hash).toBe('#hero');
        },
        { timeout: 1000 },
      );
    });

    it('should not update localStorage when navigating via hash to different variant', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'demo',
        code: {
          JavaScript: {
            fileName: 'index.js',
            source: 'const x = 1;',
          },
          TypeScript: {
            fileName: 'index.ts',
            source: 'const x: number = 1;',
          },
        },
      };

      // Mock localStorage
      const mockGetItem = vi.fn();
      const mockSetItem = vi.fn();
      const originalGetItem = Storage.prototype.getItem;
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.getItem = mockGetItem;
      Storage.prototype.setItem = mockSetItem;

      // Set hash to TypeScript variant file BEFORE rendering
      window.location.hash = '#demo:type-script:index.ts';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('TypeScript');
          expect(result.current.selectedFileName).toBe('index.ts');
        },
        { timeout: 1000 },
      );

      // localStorage should NOT have been updated for hash-driven navigation
      // Filter out any calls that might be for transforms or other preferences
      const variantCalls = mockSetItem.mock.calls.filter(
        (call) => call[0] && call[0].includes('variant_pref'),
      );
      expect(variantCalls).toHaveLength(0);

      // Restore
      Storage.prototype.getItem = originalGetItem;
      Storage.prototype.setItem = originalSetItem;
    });

    it('should not update localStorage when hash changes AFTER mount to trigger variant switch', async () => {
      const contentProps: ContentProps<{}> = {
        slug: 'demo',
        code: {
          JavaScript: {
            fileName: 'index.js',
            source: 'const x = 1;',
          },
          TypeScript: {
            fileName: 'index.ts',
            source: 'const x: number = 1;',
          },
          Python: {
            fileName: 'index.py',
            source: 'x = 1',
          },
        },
      };

      // Mock localStorage
      const mockGetItem = vi.fn();
      const mockSetItem = vi.fn();
      const originalGetItem = Storage.prototype.getItem;
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.getItem = mockGetItem;
      Storage.prototype.setItem = mockSetItem;

      // Ensure hash is empty before starting
      window.location.hash = '';

      // Start with JavaScript variant
      window.location.hash = '#demo:index.js';

      const { result, unmount } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('JavaScript');
        },
        { timeout: 1000 },
      );

      // Clear any calls from initialization
      mockSetItem.mockClear();

      // Verify we're starting from JavaScript
      expect(result.current.selectedVariant).toBe('JavaScript');
      expect(window.location.hash).toBe('#demo:index.js');

      // Now change hash to TypeScript variant AFTER mount
      act(() => {
        window.location.hash = '#demo:type-script:index.ts';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('TypeScript');
          expect(result.current.selectedFileName).toBe('index.ts');
        },
        { timeout: 2000 },
      );

      // localStorage should NOT have been updated for hash-driven navigation
      const variantCalls = mockSetItem.mock.calls.filter(
        (call) => call[0] && call[0].includes('variant_pref'),
      );
      expect(variantCalls).toHaveLength(0);

      // Change to Python variant via hash
      mockSetItem.mockClear();
      act(() => {
        window.location.hash = '#demo:python:index.py';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('Python');
          expect(result.current.selectedFileName).toBe('index.py');
        },
        { timeout: 1000 },
      );

      // Still should not update localStorage
      const pythonVariantCalls = mockSetItem.mock.calls.filter(
        (call) => call[0] && call[0].includes('variant_pref'),
      );
      expect(pythonVariantCalls).toHaveLength(0);

      // Cleanup
      unmount();

      // Restore
      Storage.prototype.getItem = originalGetItem;
      Storage.prototype.setItem = originalSetItem;
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
