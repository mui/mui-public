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

    // Mock history API to update location.hash
    // JSDOM doesn't automatically update window.location.hash when history methods are called,
    // so we manually parse the URL and update the hash to simulate real browser behavior
    window.history.replaceState = vi.fn((state, title, url) => {
      if (typeof url === 'string') {
        const hashIndex = url.indexOf('#');
        mockLocation.hash = hashIndex >= 0 ? url.substring(hashIndex) : '';
      }
    });
    window.history.pushState = vi.fn((state, title, url) => {
      if (typeof url === 'string') {
        const hashIndex = url.indexOf('#');
        mockLocation.hash = hashIndex >= 0 ? url.substring(hashIndex) : '';
      }
    });
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

    it('should prioritize hash variant over localStorage preference', async () => {
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

      // Set localStorage to prefer TypeScript
      window.localStorage.setItem('_docs_variant_pref:JavaScript:TypeScript', 'TypeScript');

      // Hash explicitly specifies JavaScript variant and file
      window.location.hash = '#test-slug:java-script:demo.js';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          // Should use JavaScript variant from hash, ignoring localStorage
          expect(result.current.selectedVariant).toBe('JavaScript');
          expect(result.current.selectedFileName).toBe('demo.js');
        },
        { timeout: 1000 },
      );

      // Hash should be preserved
      expect(window.location.hash).toBe('#test-slug:java-script:demo.js');
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

      // Set localStorage to prefer TypeScript (sorted variant keys with underscore prefix)
      window.localStorage.setItem('_docs_variant_pref:JavaScript:TypeScript', 'TypeScript');

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('TypeScript');
        },
        { timeout: 1000 },
      );
    });

    it('should respect localStorage when no hash and no initialVariant prop', async () => {
      // Ensure no hash present
      window.location.hash = '';

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

      // Set localStorage to prefer Python (sorted variant keys with underscore prefix)
      window.localStorage.setItem('_docs_variant_pref:JavaScript:Python:TypeScript', 'Python');

      // Call useCode WITHOUT initialVariant prop
      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          // Should use Python from localStorage since there's no hash and no initialVariant
          expect(result.current.selectedVariant).toBe('Python');
          expect(result.current.selectedFileName).toBe('demo.py');
        },
        { timeout: 1000 },
      );
    });

    it('should respect localStorage with slug defined but no hash', async () => {
      // Ensure no hash present
      window.location.hash = '';

      const contentProps: ContentProps<{}> = {
        slug: 'my-demo',
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

      // Set localStorage to prefer TypeScript (sorted variant keys with underscore prefix)
      window.localStorage.setItem('_docs_variant_pref:JavaScript:TypeScript', 'TypeScript');

      // Call useCode WITHOUT initialVariant prop
      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          // Should use TypeScript from localStorage since there's no hash and no initialVariant
          expect(result.current.selectedVariant).toBe('TypeScript');
          expect(result.current.selectedFileName).toBe('demo.ts');
        },
        { timeout: 1000 },
      );
    });

    it('should apply localStorage value when it loads asynchronously after initial render', async () => {
      // Ensure no hash present
      window.location.hash = '';

      const contentProps: ContentProps<{}> = {
        code: {
          CssModules: {
            fileName: 'demo.module.css',
            source: '.button { color: blue; }',
          },
          Tailwind: {
            fileName: 'demo.tsx',
            source: '<button className="text-blue-500">Click</button>',
          },
        },
      };

      // Start WITHOUT localStorage value (simulating it not loaded yet)
      window.localStorage.removeItem('_docs_variant_pref:CssModules:Tailwind');

      const { result } = renderHook(() => useCode(contentProps));

      // Initially should use first variant (CssModules)
      await waitFor(() => {
        expect(result.current.selectedVariant).toBe('CssModules');
      });

      // Now simulate localStorage loading late by setting it
      act(() => {
        window.localStorage.setItem('_docs_variant_pref:CssModules:Tailwind', 'Tailwind');
        // Trigger a storage event to simulate the async load
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: '_docs_variant_pref:CssModules:Tailwind',
            newValue: 'Tailwind',
            oldValue: null,
            storageArea: window.localStorage,
          }),
        );
      });

      // Should update to Tailwind from localStorage
      await waitFor(
        () => {
          expect(result.current.selectedVariant).toBe('Tailwind');
          expect(result.current.selectedFileName).toBe('demo.tsx');
        },
        { timeout: 1000 },
      );
    });

    it('should fallback to first variant when localStorage has invalid value', async () => {
      // Ensure no hash present
      window.location.hash = '';

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

      // Set localStorage to a variant that doesn't exist
      window.localStorage.setItem('_docs_variant_pref:JavaScript:TypeScript', 'Python');

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(
        () => {
          // Should fallback to first variant (JavaScript) since Python doesn't exist
          expect(result.current.selectedVariant).toBe('JavaScript');
          expect(result.current.selectedFileName).toBe('demo.js');
        },
        { timeout: 1000 },
      );
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

      // Set localStorage to prefer TypeScript
      window.localStorage.setItem('_docs_variant_pref:JavaScript:Python:TypeScript', 'TypeScript');

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
    });
  });

  describe('cross-page navigation', () => {
    it('should apply variant preference from any hash to all demos on page', async () => {
      const demo1Props: ContentProps<{}> = {
        slug: 'demo1',
        code: {
          JavaScript: {
            fileName: 'demo1.js',
            source: 'console.log("demo1");',
          },
          TypeScript: {
            fileName: 'demo1.ts',
            source: 'console.log("demo1");',
          },
        },
      };

      const demo2Props: ContentProps<{}> = {
        slug: 'demo2',
        code: {
          JavaScript: {
            fileName: 'demo2.js',
            source: 'console.log("demo2");',
          },
          TypeScript: {
            fileName: 'demo2.ts',
            source: 'console.log("demo2");',
          },
        },
      };

      // Hash points to demo1 with TypeScript variant
      window.location.hash = '#demo1:type-script:demo1.ts';

      const { result: result1 } = renderHook(() => useCode(demo1Props));
      const { result: result2 } = renderHook(() => useCode(demo2Props));

      await waitFor(() => {
        // Demo1 should use TypeScript from hash
        expect(result1.current.selectedVariant).toBe('TypeScript');
        expect(result1.current.selectedFileName).toBe('demo1.ts');
        // Demo2 should ALSO use TypeScript from hash, even though hash slug is demo1
        expect(result2.current.selectedVariant).toBe('TypeScript');
        expect(result2.current.selectedFileName).toBe('demo2.ts');
      });
    });

    it('should not apply file selection from hash to different demo', async () => {
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
        // Demo2 should ignore file selection and use main file (but uses same variant)
        expect(result2.current.selectedVariant).toBe('Default');
        expect(result2.current.selectedFileName).toBe('demo2.js');
      });
    });

    it('should handle demos with different available variants gracefully', async () => {
      const demo1Props: ContentProps<{}> = {
        slug: 'demo1',
        code: {
          JavaScript: {
            fileName: 'demo1.js',
            source: 'console.log("demo1");',
          },
          TypeScript: {
            fileName: 'demo1.ts',
            source: 'console.log("demo1");',
          },
          Python: {
            fileName: 'demo1.py',
            source: 'print("demo1")',
          },
        },
      };

      const demo2Props: ContentProps<{}> = {
        slug: 'demo2',
        code: {
          JavaScript: {
            fileName: 'demo2.js',
            source: 'console.log("demo2");',
          },
          TypeScript: {
            fileName: 'demo2.ts',
            source: 'console.log("demo2");',
          },
          // Note: No Python variant
        },
      };

      // Hash specifies Python variant (which demo1 has but demo2 doesn't)
      window.location.hash = '#demo1:python:demo1.py';

      const { result: result1 } = renderHook(() => useCode(demo1Props));
      const { result: result2 } = renderHook(() => useCode(demo2Props));

      await waitFor(() => {
        // Demo1 should use Python variant from hash
        expect(result1.current.selectedVariant).toBe('Python');
        expect(result1.current.selectedFileName).toBe('demo1.py');
        // Demo2 doesn't have Python, should fallback to first available (JavaScript)
        expect(result2.current.selectedVariant).toBe('JavaScript');
        expect(result2.current.selectedFileName).toBe('demo2.js');
      });
    });

    it('should apply Default variant to all demos when hash has file but no variant', async () => {
      const demo1Props: ContentProps<{}> = {
        slug: 'demo1',
        code: {
          Default: {
            fileName: 'demo1.js',
            source: 'console.log("demo1");',
            extraFiles: {
              'config1.js': 'export const config = {};',
            },
          },
          TypeScript: {
            fileName: 'demo1.ts',
            source: 'console.log("demo1");',
          },
        },
      };

      const demo2Props: ContentProps<{}> = {
        slug: 'demo2',
        code: {
          Default: {
            fileName: 'demo2.js',
            source: 'console.log("demo2");',
          },
          TypeScript: {
            fileName: 'demo2.ts',
            source: 'console.log("demo2");',
          },
        },
      };

      // Hash with 2 parts (slug:file) implies Default variant
      window.location.hash = '#demo1:config1.js';

      const { result: result1 } = renderHook(() => useCode(demo1Props));
      const { result: result2 } = renderHook(() => useCode(demo2Props));

      await waitFor(() => {
        // Both demos should use Default variant
        expect(result1.current.selectedVariant).toBe('Default');
        expect(result1.current.selectedFileName).toBe('config1.js');
        expect(result2.current.selectedVariant).toBe('Default');
        expect(result2.current.selectedFileName).toBe('demo2.js');
      });
    });

    it('should respect initialVariant prop when no hash or localStorage', async () => {
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

      const { result } = renderHook(() =>
        useCode(contentProps, {
          initialVariant: 'TypeScript',
        }),
      );

      await waitFor(() => {
        expect(result.current.selectedVariant).toBe('TypeScript');
        expect(result.current.selectedFileName).toBe('demo.ts');
      });
    });

    it('should override initialVariant when hash is present', async () => {
      window.location.hash = '#demo:java-script:demo.js';

      const contentProps: ContentProps<{}> = {
        slug: 'demo',
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

      const { result } = renderHook(() =>
        useCode(contentProps, {
          initialVariant: 'TypeScript',
        }),
      );

      await waitFor(() => {
        // Hash should take precedence over initialVariant
        expect(result.current.selectedVariant).toBe('JavaScript');
        expect(result.current.selectedFileName).toBe('demo.js');
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
    it('should NOT create hash when user manually selects file without existing hash', async () => {
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

      // Hash should NOT be created when none exists
      expect((window.history.replaceState as any).mock.calls.length).toBe(initialHistoryCallCount);
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

    it('should remove hash when user manually switches variant', async () => {
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

      // Start with hash specifying JavaScript variant and utils file
      window.location.hash = '#test-slug:java-script:utils.js';

      const { result } = renderHook(() => useCode(contentProps));

      await waitFor(() => {
        expect(result.current.selectedVariant).toBe('JavaScript');
        expect(result.current.selectedFileName).toBe('utils.js');
      });

      // Current hash should be set
      expect(window.location.hash).toBe('#test-slug:java-script:utils.js');

      // Switch to TypeScript - should remove hash and change variant
      await act(async () => {
        result.current.selectVariant('TypeScript');
        // Give React time to process state updates
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      });

      // Hash should be removed when user manually switches variant (with default fileHashMode='remove-hash')
      await waitFor(() => {
        expect(window.location.hash).toBe('');
      });

      // Variant and file should update
      await waitFor(() => {
        expect(result.current.selectedVariant).toBe('TypeScript');
        expect(result.current.selectedFileName).toBe('demo.ts');
      });
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
