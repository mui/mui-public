/**
 * @vitest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { VariantCode } from '../CodeHighlighter/types';
import { useFileHashNavigation } from './useFileHashNavigation';

// Mock the useUrlHashState hook to prevent browser API issues
let mockHashValue = '';
let mockSetHash = vi.fn();

vi.mock('../useUrlHashState', () => ({
  useUrlHashState: () => [mockHashValue, mockSetHash],
}));

describe('useFileHashNavigation', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Reset mock hash state
    mockHashValue = '';
    mockSetHash = vi.fn();

    // Mock window.location and window.history
    Object.defineProperty(window, 'location', {
      value: {
        pathname: '/test',
        search: '',
        hash: '',
      },
      writable: true,
    });

    Object.defineProperty(window, 'history', {
      value: {
        replaceState: vi.fn(),
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('selectFileName functionality', () => {
    it('should update URL hash when selecting a file', () => {
      const selectedVariant = {
        fileName: 'BasicCode.tsx',
        source: 'const BasicCode = () => <div>Basic</div>;',
        extraFiles: {
          'helperUtils.js': 'export const helper = () => {};',
        },
      };

      let selectedFileNameInternal = selectedVariant.fileName;
      const setSelectedFileNameInternal = vi.fn((fileName: string | undefined) => {
        selectedFileNameInternal = fileName || selectedVariant.fileName;
      });

      const { result } = renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'Basic',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
        }),
      );

      // Initially should be on the main file
      expect(mockSetHash).not.toHaveBeenCalled();

      // Select a different file
      act(() => {
        result.current.selectFileName('helperUtils.js');
      });

      // Should update the URL hash with the correct slug
      expect(mockSetHash).toHaveBeenCalledWith('basic:helper-utils.js');
      expect(setSelectedFileNameInternal).toHaveBeenCalledWith('helperUtils.js');
    });

    it('should handle transformed file names correctly', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
      };

      const transformedFiles = {
        files: [
          {
            name: 'component.js', // transformed name
            originalName: 'component.tsx',
            source: 'const Component = () => <div>Test</div>;',
            component: null,
          },
        ],
        filenameMap: { 'component.js': 'component.tsx' },
      };

      const selectedFileNameInternal = selectedVariant.fileName;
      const setSelectedFileNameInternal = vi.fn();

      const { result } = renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal,
          setSelectedFileNameInternal,
          transformedFiles,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
        }),
      );

      act(() => {
        result.current.selectFileName('component.js'); // Using transformed name
      });

      // Should resolve to original name and update hash
      expect(mockSetHash).toHaveBeenCalledWith('test:component.tsx');
      expect(setSelectedFileNameInternal).toHaveBeenCalledWith('component.tsx');
    });
  });

  describe('hash-driven file selection', () => {
    it('should select file based on URL hash on hydration', () => {
      // Set initial hash before creating the hook to simulate page load with hash
      mockHashValue = 'basic:helper-utils.js';

      const selectedVariant = {
        fileName: 'BasicCode.tsx',
        source: 'const BasicCode = () => <div>Basic</div>;',
        extraFiles: {
          'helperUtils.js': 'export const helper = () => {};',
        },
      };

      let selectedFileNameInternal = selectedVariant.fileName;
      const setSelectedFileNameInternal = vi.fn((fileName: string | undefined) => {
        selectedFileNameInternal = fileName || selectedVariant.fileName;
      });

      renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'Basic',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
        }),
      );

      // The hook should parse the initial hash and select the correct file
      expect(setSelectedFileNameInternal).toHaveBeenCalledWith('helperUtils.js');

      // Should not have called setHash during initialization with existing hash
      expect(mockSetHash).not.toHaveBeenCalled();
    });

    it('should handle invalid hash gracefully and fall back to main file', () => {
      // Set an invalid hash that doesn't match any file
      mockHashValue = 'basic:nonexistent-file.js';

      const selectedVariant = {
        fileName: 'BasicCode.tsx',
        source: 'const BasicCode = () => <div>Basic</div>;',
        extraFiles: {
          'helperUtils.js': 'export const helper = () => {};',
        },
      };

      const selectedFileNameInternal = selectedVariant.fileName;
      const setSelectedFileNameInternal = vi.fn();

      renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'Basic',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
        }),
      );

      // Should not have changed the selected file
      expect(setSelectedFileNameInternal).not.toHaveBeenCalled();
    });

    it('should reset to main file when hash is cleared', () => {
      mockHashValue = '';

      const selectedVariant = {
        fileName: 'main.tsx',
        source: 'const Main = () => <div>Main</div>;',
        extraFiles: {
          'helper.js': 'export const helper = () => {};',
        },
      };

      let selectedFileNameInternal = 'helper.js'; // Start with helper selected
      const setSelectedFileNameInternal = vi.fn((fileName: string | undefined) => {
        selectedFileNameInternal = fileName || selectedVariant.fileName;
      });

      renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
        }),
      );

      // Should reset to main file when hash is empty
      expect(setSelectedFileNameInternal).toHaveBeenCalledWith('main.tsx');
    });
  });

  describe('variant changes', () => {
    it('should update URL hash when variant changes', () => {
      const selectedVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      const selectedFileNameInternal = 'styles.css';
      const setSelectedFileNameInternal = vi.fn();

      // Simulate user having already selected a file (hash exists)
      mockHashValue = 'basic:styles.css';

      const { rerender } = renderHook(
        ({ selectedVariantKey }) => {
          return useFileHashNavigation({
            selectedVariant,
            selectedFileNameInternal,
            setSelectedFileNameInternal,
            transformedFiles: undefined,
            mainSlug: 'Basic',
            selectedVariantKey,
            variantKeys: ['Default', 'Tailwind'],
            initialVariant: 'Default',
          });
        },
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should have loaded the file from the initial hash
      expect(mockSetHash).not.toHaveBeenCalled();

      // Clear the setHash mock to track new calls from variant change
      mockSetHash.mockClear();

      // Change to Tailwind variant
      rerender({ selectedVariantKey: 'Tailwind' });

      // Should update the hash to include the new variant
      expect(mockSetHash).toHaveBeenCalledWith('basic:tailwind:styles.css');
    });

    it('should not create hash when none exists on variant change', () => {
      const selectedVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      const selectedFileNameInternal = selectedVariant.fileName;
      const setSelectedFileNameInternal = vi.fn();

      // Start with no hash
      mockHashValue = '';

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileHashNavigation({
            selectedVariant,
            selectedFileNameInternal,
            setSelectedFileNameInternal,
            transformedFiles: undefined,
            mainSlug: 'Basic',
            selectedVariantKey,
            variantKeys: ['Default', 'Tailwind'],
            initialVariant: 'Default',
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Verify no hash set on initial load
      expect(mockSetHash).not.toHaveBeenCalled();

      // Change variant - should NOT create a hash since none existed
      rerender({ selectedVariantKey: 'Tailwind' });

      // Should still not have set any hash
      expect(mockSetHash).not.toHaveBeenCalled();
    });

    it('should not update hash when current hash is for different demo', () => {
      const selectedVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      const selectedFileNameInternal = selectedVariant.fileName;
      const setSelectedFileNameInternal = vi.fn();

      // Start with hash for a different demo
      mockHashValue = 'different-demo:component.tsx';

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileHashNavigation({
            selectedVariant,
            selectedFileNameInternal,
            setSelectedFileNameInternal,
            transformedFiles: undefined,
            mainSlug: 'Basic',
            selectedVariantKey,
            variantKeys: ['Default', 'Tailwind'],
            initialVariant: 'Default',
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Verify no hash updates on initial load with different demo hash
      expect(mockSetHash).not.toHaveBeenCalled();

      // Change variant - should NOT update hash since it's for a different demo
      rerender({ selectedVariantKey: 'Tailwind' });

      // Should still not have updated the hash
      expect(mockSetHash).not.toHaveBeenCalled();
    });

    it('should update hash when current hash is for same demo and variant changes', () => {
      const selectedVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      const selectedFileNameInternal = 'styles.css';
      const setSelectedFileNameInternal = vi.fn();

      // Start with hash for the same demo
      mockHashValue = 'basic:styles.css';

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileHashNavigation({
            selectedVariant,
            selectedFileNameInternal,
            setSelectedFileNameInternal,
            transformedFiles: undefined,
            mainSlug: 'Basic',
            selectedVariantKey,
            variantKeys: ['Default', 'Tailwind'],
            initialVariant: 'Default',
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should have loaded the file from the hash but not set a new hash
      expect(mockSetHash).not.toHaveBeenCalled();

      // Change variant - should update hash to include variant
      rerender({ selectedVariantKey: 'Tailwind' });

      // Should have updated the hash to include the new variant
      expect(mockSetHash).toHaveBeenCalledWith('basic:tailwind:styles.css');
    });
  });

  describe('cross-variant navigation', () => {
    it('should find and select files from different variants when effectiveCode is provided', () => {
      const effectiveCode = {
        Default: {
          fileName: 'checkbox-default.tsx',
          source: 'const DefaultCheckbox = () => <div>Default</div>;',
          extraFiles: {
            'default-styles.css': 'body { margin: 0; }',
          },
        },
        Tailwind: {
          fileName: 'checkbox-tailwind.tsx',
          source: 'const TailwindCheckbox = () => <div>Tailwind</div>;',
          extraFiles: {
            'tailwind.config.js': 'module.exports = {};',
          },
        },
      };

      const mockSelectVariant = vi.fn();

      // Set hash to a file from Tailwind variant while Default is selected
      mockHashValue = 'checkbox:tailwind:tailwind.config.js';

      let selectedFileNameInternal = effectiveCode.Default.fileName;
      let selectedVariant: VariantCode = effectiveCode.Default;
      const setSelectedFileNameInternal = vi.fn((fileName: string | undefined) => {
        selectedFileNameInternal = fileName || selectedVariant.fileName || '';
      });

      const { rerender } = renderHook(
        ({ selectedVariantKey }) => {
          selectedVariant = effectiveCode[selectedVariantKey as keyof typeof effectiveCode];
          return useFileHashNavigation({
            selectedVariant,
            selectedFileNameInternal,
            setSelectedFileNameInternal,
            transformedFiles: undefined,
            mainSlug: 'checkbox',
            selectedVariantKey,
            variantKeys: ['Default', 'Tailwind'],
            initialVariant: 'Default',
            effectiveCode,
            selectVariant: mockSelectVariant,
          });
        },
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should have called selectVariant to switch to Tailwind variant
      expect(mockSelectVariant).toHaveBeenCalledWith('Tailwind');

      // Simulate the variant change
      mockSelectVariant.mockClear();
      rerender({ selectedVariantKey: 'Tailwind' });

      // Now the file should be selected
      expect(setSelectedFileNameInternal).toHaveBeenCalledWith('tailwind.config.js');
    });

    it('should not switch variants if selectVariant function is not provided', () => {
      const effectiveCode = {
        Default: {
          fileName: 'widget-default.tsx',
          source: 'const DefaultWidget = () => <div>Default</div>;',
        },
        Custom: {
          fileName: 'widget-custom.tsx',
          source: 'const CustomWidget = () => <div>Custom</div>;',
          extraFiles: {
            'custom-config.json': '{"theme": "dark"}',
          },
        },
      };

      // Set hash to file from Custom variant while Default is selected
      mockHashValue = 'widget:custom:custom-config.json';

      const selectedFileNameInternal = effectiveCode.Default.fileName || '';
      const setSelectedFileNameInternal = vi.fn();

      renderHook(() =>
        useFileHashNavigation({
          selectedVariant: effectiveCode.Default,
          selectedFileNameInternal,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'widget',
          selectedVariantKey: 'Default',
          variantKeys: ['Default', 'Custom'],
          initialVariant: 'Default',
          effectiveCode,
          // No selectVariant provided
        }),
      );

      // Without selectVariant, it should NOT find files in other variants
      expect(setSelectedFileNameInternal).not.toHaveBeenCalled();
    });
  });

  describe('user interaction tracking', () => {
    it('should not automatically set URL hash on initial load without user interaction', () => {
      const selectedVariant = {
        fileName: 'CheckboxBasic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'index.ts': 'export * from "./CheckboxBasic";',
        },
      };

      // Ensure no initial hash
      mockHashValue = '';

      const selectedFileNameInternal = selectedVariant.fileName;
      const setSelectedFileNameInternal = vi.fn();

      const { result } = renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'basic',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
        }),
      );

      // Should not set hash on initial load without user interaction
      expect(mockSetHash).not.toHaveBeenCalled();

      // But after user selects a file, should set hash
      act(() => {
        result.current.selectFileName('index.ts');
      });

      expect(mockSetHash).toHaveBeenCalledWith('basic:index.ts');
    });

    it('should treat initial hash as user interaction', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
        extraFiles: {
          'helper.js': 'export const helper = () => {};',
        },
      };

      // Start with a hash (user came to page with hash)
      mockHashValue = 'test:helper.js';

      const setSelectedFileNameInternal = vi.fn();

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileHashNavigation({
            selectedVariant,
            selectedFileNameInternal: 'helper.js', // Hash selected this file
            setSelectedFileNameInternal,
            transformedFiles: undefined,
            mainSlug: 'test',
            selectedVariantKey,
            variantKeys: ['Default', 'Advanced'],
            initialVariant: 'Default',
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Variant change should update hash since there was already a hash (user interaction)
      rerender({ selectedVariantKey: 'Advanced' });

      expect(mockSetHash).toHaveBeenCalledWith('test:advanced:helper.js');
    });
  });

  describe('manual hash editing edge cases', () => {
    it('should not cause infinite loop when hash is manually edited to malformed value', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
      };

      // Start with valid hash
      mockHashValue = 'test:component.tsx';

      const selectedFileNameInternal = selectedVariant.fileName;
      const setSelectedFileNameInternal = vi.fn();

      const { rerender } = renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
        }),
      );

      // Manually edit hash to malformed value (simulating user typing in address bar)
      mockHashValue = 'test:::::malformed:::';
      mockSetHash.mockClear();

      rerender();

      // Should not cause infinite setHash calls
      expect(mockSetHash).not.toHaveBeenCalled();
    });

    it('should not cause infinite loop with rapid hash changes', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
        extraFiles: {
          'file1.js': 'content1',
          'file2.js': 'content2',
          'file3.js': 'content3',
        },
      };

      const selectedFileNameInternal = selectedVariant.fileName;
      const setSelectedFileNameInternal = vi.fn();

      const { rerender } = renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
        }),
      );

      // Simulate rapid hash changes
      const hashes = ['test:file1.js', 'test:file2.js', 'test:file3.js', 'test:component.tsx'];

      hashes.forEach((hash) => {
        mockHashValue = hash;
        mockSetHash.mockClear();
        rerender();
      });

      // Should not have created excessive setHash calls
      // The hook should stabilize after processing the hash changes
      const totalSetHashCalls = mockSetHash.mock.calls.length;
      expect(totalSetHashCalls).toBeLessThan(10); // Arbitrary threshold
    });
  });

  describe('kebab-case conversion', () => {
    it('should handle kebab-case conversion in hash checks correctly', () => {
      const selectedVariant = {
        fileName: 'Component.tsx',
        source: 'const Component = () => <div>Test</div>;',
      };

      // Hash with kebab-case (as it would appear in URL)
      mockHashValue = 'my-complex-demo:component.tsx';

      const selectedFileNameInternal = selectedVariant.fileName;
      const setSelectedFileNameInternal = vi.fn();

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileHashNavigation({
            selectedVariant,
            selectedFileNameInternal,
            setSelectedFileNameInternal,
            transformedFiles: undefined,
            mainSlug: 'MyComplexDemo',
            selectedVariantKey,
            variantKeys: ['Default', 'Advanced'],
            initialVariant: 'Default',
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should recognize the hash matches this demo (kebab-case conversion)
      expect(mockSetHash).not.toHaveBeenCalled();

      // Change variant - should update hash since it matches this demo
      rerender({ selectedVariantKey: 'Advanced' });

      // Should have updated the hash with the new variant
      expect(mockSetHash).toHaveBeenCalledWith('my-complex-demo:advanced:component.tsx');
    });
  });

  describe('fileHashMode', () => {
    it("should clean up hash to demo-only format after reading file from hash (mode: 'clean')", () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
        extraFiles: {
          'index.module.css': '.container { padding: 1rem; }',
        },
      };

      // Set initial hash with file specified
      mockHashValue = 'advanced:index.module.css';

      const setSelectedFileNameInternal = vi.fn();

      renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal: selectedVariant.fileName,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'Advanced',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
          fileHashMode: 'clean',
        }),
      );

      // Should have selected the file from the hash
      expect(setSelectedFileNameInternal).toHaveBeenCalledWith('index.module.css');

      // Should have cleaned up the hash to just the demo slug
      expect(mockSetHash).toHaveBeenCalledWith('advanced');
    });

    it("should not add hash when user selects a file and no hash exists (mode: 'clean')", () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
        extraFiles: {
          'styles.css': '.button { color: blue; }',
        },
      };

      mockHashValue = '';

      const setSelectedFileNameInternal = vi.fn();

      const { result } = renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal: selectedVariant.fileName,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'Demo',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
          fileHashMode: 'clean',
        }),
      );

      act(() => {
        result.current.selectFileName('styles.css');
      });

      // Should have selected the file
      expect(setSelectedFileNameInternal).toHaveBeenCalledWith('styles.css');

      // Should NOT have set a hash (avoids adding hash when none exists)
      expect(mockSetHash).not.toHaveBeenCalled();
    });

    it("should clean hash to just slug regardless of variant (mode: 'clean')", () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
        extraFiles: {
          'helper.ts': 'export const helper = () => {};',
        },
      };

      // Set initial hash with file specified for a non-initial variant
      mockHashValue = 'demo:premium:helper.ts';

      const setSelectedFileNameInternal = vi.fn();

      renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal: selectedVariant.fileName,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'Demo',
          selectedVariantKey: 'Premium',
          variantKeys: ['Default', 'Premium'],
          initialVariant: 'Default',
          fileHashMode: 'clean',
        }),
      );

      // Should have selected the file from the hash
      expect(setSelectedFileNameInternal).toHaveBeenCalledWith('helper.ts');

      // Should have cleaned up the hash to just slug (no variant, no filename)
      expect(mockSetHash).toHaveBeenCalledWith('demo');
    });

    it("should set hash with filename when mode is 'full' (default behavior)", () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
        extraFiles: {
          'utils.js': 'export const util = () => {};',
        },
      };

      mockHashValue = '';

      const setSelectedFileNameInternal = vi.fn();

      const { result } = renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal: selectedVariant.fileName,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
          fileHashMode: 'full',
        }),
      );

      // User selects a file
      act(() => {
        result.current.selectFileName('utils.js');
      });

      // Should have selected the file
      expect(setSelectedFileNameInternal).toHaveBeenCalledWith('utils.js');

      // Should have set full hash with filename (default behavior)
      expect(mockSetHash).toHaveBeenCalledWith('test:utils.js');
    });

    it("should update hash on variant change with clean format (mode: 'clean')", () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
        extraFiles: {
          'helper.ts': 'export const helper = () => {};',
        },
      };

      let selectedFileNameInternal = selectedVariant.fileName;
      const setSelectedFileNameInternal = vi.fn();

      // Start with a hash for a specific file (simulating user selected a file)
      mockHashValue = 'demo:component.tsx';

      const { result, rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileHashNavigation({
            selectedVariant,
            selectedFileNameInternal,
            setSelectedFileNameInternal,
            transformedFiles: undefined,
            mainSlug: 'Demo',
            selectedVariantKey,
            variantKeys: ['Default', 'Advanced'],
            initialVariant: 'Default',
            fileHashMode: 'clean',
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Initially it should clean up the hash to just "demo"
      expect(mockSetHash).toHaveBeenCalledWith('demo');

      mockSetHash.mockClear();

      // User selects a different file to trigger user interaction
      act(() => {
        result.current.selectFileName('helper.ts');
      });

      selectedFileNameInternal = 'helper.ts';

      // Should set clean hash
      expect(mockSetHash).toHaveBeenCalledWith('demo');
      mockSetHash.mockClear();

      // Change to Advanced variant
      rerender({ selectedVariantKey: 'Advanced' });

      // Should keep hash as just slug (no variant in clean format)
      expect(mockSetHash).toHaveBeenCalledWith('demo');
    });
  });

  describe('fileHashMode: remove-after-interaction', () => {
    it('should read hash on load but not remove it', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
        extraFiles: {
          'helper.ts': 'export const helper = () => {};',
        },
      };

      // Set initial hash with file specified
      mockHashValue = 'demo:helper.ts';

      const setSelectedFileNameInternal = vi.fn();

      renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal: selectedVariant.fileName,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'demo',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
          fileHashMode: 'remove-after-interaction',
        }),
      );

      // Should have selected the file from the hash
      expect(setSelectedFileNameInternal).toHaveBeenCalledWith('helper.ts');

      // Should NOT have removed or cleaned the hash on load
      expect(mockSetHash).not.toHaveBeenCalled();
    });

    it('should remove hash when user clicks a tab/file', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
        extraFiles: {
          'styles.css': '.button { color: blue; }',
        },
      };

      // Start with a hash containing ':'
      mockHashValue = 'demo:component.tsx';

      const setSelectedFileNameInternal = vi.fn();

      const { result } = renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal: selectedVariant.fileName,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'demo',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
          fileHashMode: 'remove-after-interaction',
        }),
      );

      mockSetHash.mockClear();

      // User clicks to select a different file
      act(() => {
        result.current.selectFileName('styles.css');
      });

      // Should have selected the file
      expect(setSelectedFileNameInternal).toHaveBeenCalledWith('styles.css');

      // Should have removed the hash (not just cleaned it)
      expect(mockSetHash).toHaveBeenCalledWith(null);
    });

    it('should not add hash when none exists and user selects a file', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
        extraFiles: {
          'utils.js': 'export const util = () => {};',
        },
      };

      mockHashValue = '';

      const setSelectedFileNameInternal = vi.fn();

      const { result } = renderHook(() =>
        useFileHashNavigation({
          selectedVariant,
          selectedFileNameInternal: selectedVariant.fileName,
          setSelectedFileNameInternal,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
          fileHashMode: 'remove-after-interaction',
        }),
      );

      // User selects a file
      act(() => {
        result.current.selectFileName('utils.js');
      });

      // Should have selected the file
      expect(setSelectedFileNameInternal).toHaveBeenCalledWith('utils.js');

      // Should NOT have set a hash
      expect(mockSetHash).not.toHaveBeenCalled();
    });

    it('should remove hash when variant changes with existing hash', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
      };

      const selectedFileNameInternal = selectedVariant.fileName;
      const setSelectedFileNameInternal = vi.fn();

      // Start with a hash
      mockHashValue = 'demo:component.tsx';

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileHashNavigation({
            selectedVariant,
            selectedFileNameInternal,
            setSelectedFileNameInternal,
            transformedFiles: undefined,
            mainSlug: 'demo',
            selectedVariantKey,
            variantKeys: ['Default', 'Advanced'],
            initialVariant: 'Default',
            fileHashMode: 'remove-after-interaction',
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Initially should not remove hash on load
      expect(mockSetHash).not.toHaveBeenCalled();

      mockSetHash.mockClear();

      // User changes to Advanced variant
      rerender({ selectedVariantKey: 'Advanced' });

      // Should remove the hash (user interaction)
      expect(mockSetHash).toHaveBeenCalledWith(null);
    });

    it('should not update hash when variant changes and no hash exists', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
      };

      const setSelectedFileNameInternal = vi.fn();

      // No initial hash
      mockHashValue = '';

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileHashNavigation({
            selectedVariant,
            selectedFileNameInternal: selectedVariant.fileName,
            setSelectedFileNameInternal,
            transformedFiles: undefined,
            mainSlug: 'demo',
            selectedVariantKey,
            variantKeys: ['Default', 'Advanced'],
            initialVariant: 'Default',
            fileHashMode: 'remove-after-interaction',
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Change variant
      rerender({ selectedVariantKey: 'Advanced' });

      // Should NOT have set any hash
      expect(mockSetHash).not.toHaveBeenCalled();
    });

    it('should handle cross-variant file navigation from hash', () => {
      const effectiveCode = {
        Default: {
          fileName: 'component-default.tsx',
          source: 'const DefaultComponent = () => <div>Default</div>;',
        },
        Advanced: {
          fileName: 'component-advanced.tsx',
          source: 'const AdvancedComponent = () => <div>Advanced</div>;',
          extraFiles: {
            'advanced-helper.ts': 'export const helper = () => {};',
          },
        },
      };

      const mockSelectVariant = vi.fn();

      // Set hash to a file from Advanced variant while Default is selected
      mockHashValue = 'demo:advanced:advanced-helper.ts';

      let selectedFileNameInternal = effectiveCode.Default.fileName;
      let selectedVariant: VariantCode = effectiveCode.Default;
      const setSelectedFileNameInternal = vi.fn((fileName: string | undefined) => {
        selectedFileNameInternal = fileName || selectedVariant.fileName || '';
      });

      const { rerender } = renderHook(
        ({ selectedVariantKey }) => {
          selectedVariant = effectiveCode[selectedVariantKey as keyof typeof effectiveCode];
          return useFileHashNavigation({
            selectedVariant,
            selectedFileNameInternal,
            setSelectedFileNameInternal,
            transformedFiles: undefined,
            mainSlug: 'demo',
            selectedVariantKey,
            variantKeys: ['Default', 'Advanced'],
            initialVariant: 'Default',
            effectiveCode,
            selectVariant: mockSelectVariant,
            fileHashMode: 'remove-after-interaction',
          });
        },
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should have called selectVariant to switch to Advanced variant
      expect(mockSelectVariant).toHaveBeenCalledWith('Advanced');

      // Simulate the variant change
      mockSelectVariant.mockClear();
      mockSetHash.mockClear();
      rerender({ selectedVariantKey: 'Advanced' });

      // Now the file should be selected
      expect(setSelectedFileNameInternal).toHaveBeenCalledWith('advanced-helper.ts');

      // Hash should NOT be removed on load (only on user interaction)
      expect(mockSetHash).not.toHaveBeenCalled();
    });
  });
});
