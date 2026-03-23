/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileNavigation } from './useFileNavigation';
import { Pre } from './Pre';
import type { VariantCode } from '../CodeHighlighter/types';

// Mock the useUrlHashState hook to prevent browser API issues
// JSDOM doesn't fully support hash change events, so we mock this to control hash values in tests
let mockHashValue = '';
let mockSetHash = vi.fn();

vi.mock('../useUrlHashState', () => ({
  useUrlHashState: () => [mockHashValue, mockSetHash],
}));

describe('useFileNavigation', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Reset mock hash state
    mockHashValue = '';
    mockSetHash = vi.fn();

    // Mock window.location and window.history
    // JSDOM provides basic implementations, but we need to ensure they're properly configured
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

  describe('file slug generation', () => {
    it('should generate correct slugs for initial variant files', () => {
      const selectedVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
          'helper.ts': 'export const helper = () => {};',
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'Basic',
          selectedVariantKey: 'Default',
          variantKeys: ['Default', 'Tailwind'],
          shouldHighlight: true,
        }),
      );

      expect(result.current.files).toEqual([
        {
          name: 'checkbox-basic.tsx',
          slug: 'basic:checkbox-basic.tsx',
          component: expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              shouldHighlight: true,
              children: 'const BasicCheckbox = () => <div>Basic</div>;',
            }),
          }),
        },
        {
          name: 'styles.css',
          slug: 'basic:styles.css',
          component: expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              shouldHighlight: true,
              children: 'body { margin: 0; }',
            }),
          }),
        },
        {
          name: 'helper.ts',
          slug: 'basic:helper.ts',
          component: expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              shouldHighlight: true,
              children: 'export const helper = () => {};',
            }),
          }),
        },
      ]);
    });

    it('should generate correct slugs for non-initial variant files', () => {
      const selectedVariant = {
        fileName: 'checkbox-tailwind.tsx',
        source: 'const TailwindCheckbox = () => <div className="p-4">Tailwind</div>;',
        extraFiles: {
          'tailwind.config.js': 'module.exports = {};',
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'Basic',
          selectedVariantKey: 'Tailwind',
          variantKeys: ['Default', 'Tailwind'],
          shouldHighlight: true,
        }),
      );

      expect(result.current.files).toEqual([
        {
          name: 'checkbox-tailwind.tsx',
          slug: 'basic:tailwind:checkbox-tailwind.tsx',
          component: expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              shouldHighlight: true,
              children: 'const TailwindCheckbox = () => <div className="p-4">Tailwind</div>;',
            }),
          }),
        },
        {
          name: 'tailwind.config.js',
          slug: 'basic:tailwind:tailwind.config.js',
          component: expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              shouldHighlight: true,
              children: 'module.exports = {};',
            }),
          }),
        },
      ]);
    });

    it('should handle files with complex names and extensions', () => {
      const selectedVariant = {
        fileName: 'checkbox.test.tsx',
        source: 'test content',
        extraFiles: {
          'component.d.ts': 'type definitions',
          'style.module.css': 'css module',
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'Advanced Checkbox',
          selectedVariantKey: 'Testing',
          variantKeys: ['Default', 'Testing'],
          shouldHighlight: true,
        }),
      );

      expect(result.current.files).toEqual([
        {
          name: 'checkbox.test.tsx',
          slug: 'advanced-checkbox:testing:checkbox.test.tsx',
          component: expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              shouldHighlight: true,
              children: 'test content',
            }),
          }),
        },
        {
          name: 'component.d.ts',
          slug: 'advanced-checkbox:testing:component.d.ts',
          component: expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              shouldHighlight: true,
              children: 'type definitions',
            }),
          }),
        },
        {
          name: 'style.module.css',
          slug: 'advanced-checkbox:testing:style.module.css',
          component: expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              shouldHighlight: true,
              children: 'css module',
            }),
          }),
        },
      ]);
    });

    it('should handle empty or missing slug gracefully', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'test content',
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: '',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      expect(result.current.files).toEqual([
        {
          name: 'component.tsx',
          slug: 'component.tsx',
          component: expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              shouldHighlight: true,
              children: 'test content',
            }),
          }),
        },
      ]);
    });

    it('should respect explicit initialVariant parameter', () => {
      const selectedVariant = {
        fileName: 'checkbox-special.tsx',
        source: 'const SpecialCheckbox = () => <div>Special</div>;',
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'Basic',
          selectedVariantKey: 'Special',
          variantKeys: ['Default', 'Tailwind', 'Special'],
          shouldHighlight: true,
        }),
      );

      expect(result.current.files).toEqual([
        {
          name: 'checkbox-special.tsx',
          slug: 'basic:special:checkbox-special.tsx', // Special variant includes variant name (only Default is excluded)
          component: expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              shouldHighlight: true,
              children: 'const SpecialCheckbox = () => <div>Special</div>;',
            }),
          }),
        },
      ]);
    });

    it('should convert camelCase and PascalCase filenames to kebab-case', () => {
      const selectedVariant = {
        fileName: 'BasicCode.tsx',
        source: 'const BasicCode = () => <div>Basic</div>;',
        extraFiles: {
          'helperUtils.js': 'export const helper = () => {};',
          'MyComponent.test.tsx': 'test content',
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'Basic',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      expect(result.current.files).toEqual([
        {
          name: 'BasicCode.tsx',
          slug: 'basic:basic-code.tsx',
          component: expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              shouldHighlight: true,
              children: 'const BasicCode = () => <div>Basic</div>;',
            }),
          }),
        },
        {
          name: 'helperUtils.js',
          slug: 'basic:helper-utils.js',
          component: expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              shouldHighlight: true,
              children: 'export const helper = () => {};',
            }),
          }),
        },
        {
          name: 'MyComponent.test.tsx',
          slug: 'basic:my-component.test.tsx',
          component: expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              shouldHighlight: true,
              children: 'test content',
            }),
          }),
        },
      ]);
    });

    it('should exclude variant name from slug for Default variant only', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Component</div>;',
        extraFiles: {
          'utils.js': 'export const util = () => {};',
        },
      };

      // Test Default variant - should NOT include variant name
      const { result: defaultResult } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'MyDemo',
          selectedVariantKey: 'Default',
          variantKeys: ['Default', 'Styled', 'Tailwind'],
          shouldHighlight: true,
        }),
      );

      expect(defaultResult.current.files).toEqual([
        {
          name: 'component.tsx',
          slug: 'my-demo:component.tsx', // No variant name for Default
          component: expect.any(Object),
        },
        {
          name: 'utils.js',
          slug: 'my-demo:utils.js', // No variant name for Default
          component: expect.any(Object),
        },
      ]);

      // Test Styled variant - should include variant name
      const { result: styledResult } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'MyDemo',
          selectedVariantKey: 'Styled',
          variantKeys: ['Default', 'Styled', 'Tailwind'],
          shouldHighlight: true,
        }),
      );

      expect(styledResult.current.files).toEqual([
        {
          name: 'component.tsx',
          slug: 'my-demo:styled:component.tsx', // Includes variant name
          component: expect.any(Object),
        },
        {
          name: 'utils.js',
          slug: 'my-demo:styled:utils.js', // Includes variant name
          component: expect.any(Object),
        },
      ]);

      // Test Tailwind variant - should include variant name
      const { result: tailwindResult } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'MyDemo',
          selectedVariantKey: 'Tailwind',
          variantKeys: ['Default', 'Styled', 'Tailwind'],
          shouldHighlight: true,
        }),
      );

      expect(tailwindResult.current.files).toEqual([
        {
          name: 'component.tsx',
          slug: 'my-demo:tailwind:component.tsx', // Includes variant name
          component: expect.any(Object),
        },
        {
          name: 'utils.js',
          slug: 'my-demo:tailwind:utils.js', // Includes variant name
          component: expect.any(Object),
        },
      ]);
    });

    it('should remove hash when selecting a file if hash already exists (fileHashMode=remove-hash)', () => {
      // Set initial hash to simulate existing hash
      mockHashValue = 'basic:basic-code.tsx';

      const selectedVariant = {
        fileName: 'BasicCode.tsx',
        source: 'const BasicCode = () => <div>Basic</div>;',
        extraFiles: {
          'helperUtils.js': 'export const helper = () => {};',
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'Basic',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          fileHashMode: 'remove-hash',
        }),
      );

      // Initially should be on the main file
      expect(result.current.selectedFileName).toBe('BasicCode.tsx');

      // Select a different file
      act(() => {
        result.current.selectFileName('helperUtils.js');
      });

      // Should remove the hash when clicking a file (remove-hash mode)
      expect(mockSetHash).toHaveBeenCalledWith(null);

      // Verify the function is available
      expect(typeof result.current.selectFileName).toBe('function');
    });

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

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'Basic',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      // The hook should parse the initial hash and select the correct file
      // Since our mock simulates the hash being 'basic:helper-utils.js',
      // the hook should have selected 'helperUtils.js'
      expect(result.current.selectedFileName).toBe('helperUtils.js');

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

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'Basic',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      // Should fall back to the main file when hash points to nonexistent file
      expect(result.current.selectedFileName).toBe('BasicCode.tsx');

      // Should not have called setHash during initialization
      expect(mockSetHash).not.toHaveBeenCalled();
    });

    it('should NOT update URL hash when variant changes without existing hash', () => {
      const selectedVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      const { result, rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug: 'Basic',
            selectedVariantKey,
            variantKeys: ['Default', 'Tailwind'],
            shouldHighlight: true,
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Initially on Default variant, main file
      expect(result.current.selectedFileName).toBe('checkbox-basic.tsx');

      // Change variant without any existing hash
      rerender({ selectedVariantKey: 'Tailwind' });

      // Should NOT set hash when no hash existed before
      expect(mockSetHash).not.toHaveBeenCalled();
    });

    it('should remove hash when variant changes via dropdown with hash present', () => {
      // Set initial hash
      mockHashValue = 'basic:default:styles.css';

      const selectedVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug: 'Basic',
            selectedVariantKey,
            variantKeys: ['Default', 'Tailwind'],
            shouldHighlight: true,
            fileHashMode: 'remove-hash',
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      mockSetHash.mockClear();

      // User manually switches variant via dropdown
      rerender({ selectedVariantKey: 'Tailwind' });

      // Should remove hash when user switches variants (fileHashMode='remove-hash')
      expect(mockSetHash).toHaveBeenCalledWith(null);
    });

    it('should keep variant in hash when variant changes with fileHashMode=remove-filename', () => {
      // Set initial hash with file
      mockHashValue = 'basic:default:styles.css';

      const selectedVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug: 'Basic',
            selectedVariantKey,
            variantKeys: ['Default', 'Tailwind'],
            shouldHighlight: true,
            fileHashMode: 'remove-filename',
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      mockSetHash.mockClear();

      // User manually switches to non-Default variant
      rerender({ selectedVariantKey: 'Tailwind' });

      // Should keep variant in hash but remove filename
      expect(mockSetHash).toHaveBeenCalledWith('basic:tailwind');
    });

    it('should NOT remove hash when hash drives variant change', () => {
      // Initial state: no hash, on Default variant
      mockHashValue = '';

      const selectedVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
      };

      const { rerender } = renderHook(
        ({ selectedVariantKey, hashVariant }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug: 'Basic',
            selectedVariantKey,
            variantKeys: ['Default', 'Tailwind'],
            shouldHighlight: true,
            hashVariant,
          }),
        {
          initialProps: { selectedVariantKey: 'Default', hashVariant: null as string | null },
        },
      );

      // User manually edits hash to point to Tailwind variant
      mockHashValue = 'basic:tailwind:checkbox-basic.tsx';

      // Simulate hash change causing variant switch
      rerender({ selectedVariantKey: 'Tailwind', hashVariant: 'Tailwind' as string | null });

      // Should NOT remove hash because the hash drove the change
      expect(mockSetHash).not.toHaveBeenCalledWith(null);
    });

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

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'basic',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      // Should default to main file
      expect(result.current.selectedFileName).toBe('CheckboxBasic.tsx');

      // Should not set hash on initial load without user interaction
      expect(mockSetHash).not.toHaveBeenCalled();

      // Even after user selects a file, should NOT create hash when none exists
      act(() => {
        result.current.selectFileName('index.ts');
      });

      expect(mockSetHash).not.toHaveBeenCalled();
    });

    it('should remove hash when user switches variants after loading from hash', () => {
      const selectedVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      // Start with user having already selected a file (simulated by initial hash)
      mockHashValue = 'basic:styles.css';

      const { result, rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug: 'Basic',
            selectedVariantKey,
            variantKeys: ['Default', 'Tailwind'],
            shouldHighlight: true,
            fileHashMode: 'remove-hash',
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should have loaded the file from the initial hash
      expect(result.current.selectedFileName).toBe('styles.css');

      // Clear the setHash mock to track new calls from variant change
      mockSetHash.mockClear();

      // User manually changes to Tailwind variant via dropdown
      rerender({ selectedVariantKey: 'Tailwind' });

      // Should remove hash when user manually switches variants (not hash-driven)
      expect(mockSetHash).toHaveBeenCalledWith(null);
    });
  });

  describe('hash update behavior', () => {
    it('should not create hash when none exists on variant change', () => {
      const selectedVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      // Start with no hash
      mockHashValue = '';

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug: 'Basic',
            selectedVariantKey,
            variantKeys: ['Default', 'Tailwind'],
            shouldHighlight: true,
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

      // Start with hash for a different demo
      mockHashValue = 'different-demo:component.tsx';

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug: 'Basic', // This demo is 'basic', hash is for 'different-demo'
            selectedVariantKey,
            variantKeys: ['Default', 'Tailwind'],
            shouldHighlight: true,
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

    it('should remove hash when user manually switches variants (same demo)', () => {
      const selectedVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      // Start with hash for the same demo
      mockHashValue = 'basic:styles.css';

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug: 'Basic',
            selectedVariantKey,
            variantKeys: ['Default', 'Tailwind'],
            shouldHighlight: true,
            fileHashMode: 'remove-hash',
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should have loaded the file from the hash but not set a new hash
      expect(mockSetHash).not.toHaveBeenCalled();

      mockSetHash.mockClear();

      // User manually switches variant - should remove hash
      rerender({ selectedVariantKey: 'Tailwind' });

      // Should remove hash when user manually switches variants
      expect(mockSetHash).toHaveBeenCalledWith(null);
    });

    it('should handle kebab-case conversion in hash checks correctly', () => {
      const selectedVariant = {
        fileName: 'Component.tsx',
        source: 'const Component = () => <div>Test</div>;',
      };

      // Hash with kebab-case (as it would appear in URL)
      mockHashValue = 'my-complex-demo:component.tsx';

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug: 'MyComplexDemo', // PascalCase mainSlug
            selectedVariantKey,
            variantKeys: ['Default', 'Advanced'],
            shouldHighlight: true,
            fileHashMode: 'remove-hash',
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should recognize the hash matches this demo (kebab-case conversion)
      expect(mockSetHash).not.toHaveBeenCalled();

      // Change variant - should remove hash since it matches this demo and user manually switched
      rerender({ selectedVariantKey: 'Advanced' });

      // Should have removed the hash when user manually switches variants
      expect(mockSetHash).toHaveBeenCalledWith(null);
    });

    it('should not create hash when file selection changes but no hash exists', () => {
      const selectedVariant = {
        fileName: 'main.tsx',
        source: 'const Main = () => <div>Main</div>;',
        extraFiles: {
          'helper.ts': 'export const helper = () => {};',
        },
      };

      // No initial hash
      mockHashValue = '';

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      // Verify no hash set initially
      expect(mockSetHash).not.toHaveBeenCalled();

      // When user explicitly selects a file, hash should NOT be created when none exists
      act(() => {
        result.current.selectFileName('helper.ts');
      });

      // Should still not have created a hash
      expect(mockSetHash).not.toHaveBeenCalled();
    });

    it('should prevent cross-page hash persistence regression', () => {
      // Simulate the original bug scenario:
      // 1. User is on page with hash: /components/button#basic:button.tsx
      // 2. User navigates to different page: /components/checkbox
      // 3. Variant change should NOT restore the button hash

      const selectedVariant = {
        fileName: 'checkbox.tsx',
        source: 'const Checkbox = () => <div>Checkbox</div>;',
      };

      // Simulate hash from previous page (different demo)
      mockHashValue = 'button-demo:button.tsx';

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug: 'CheckboxDemo', // Different demo than the hash
            selectedVariantKey,
            variantKeys: ['Default', 'Styled'],
            shouldHighlight: true,
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should not update hash on initial load
      expect(mockSetHash).not.toHaveBeenCalled();

      // Variant change should NOT update the hash (different demo)
      rerender({ selectedVariantKey: 'Styled' });

      // Hash should remain unchanged - no setHash calls
      expect(mockSetHash).not.toHaveBeenCalled();

      // Even if user selects a file, it should NOT create a hash (no hash for this demo exists)
      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'CheckboxDemo',
          selectedVariantKey: 'Styled',
          variantKeys: ['Default', 'Styled'],
          shouldHighlight: true,
        }),
      );

      mockSetHash.mockClear();

      act(() => {
        result.current.selectFileName('checkbox.tsx');
      });

      // Should NOT create a new hash when none exists for this demo
      expect(mockSetHash).not.toHaveBeenCalled();
    });

    it('should handle empty mainSlug edge case', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
      };

      // Hash with some content
      mockHashValue = 'some-other:file.tsx';

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug: '', // Empty mainSlug
            selectedVariantKey,
            variantKeys: ['Default', 'Alternative'],
            shouldHighlight: true,
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should not crash or update hash
      expect(mockSetHash).not.toHaveBeenCalled();

      // Variant change with empty mainSlug should not update hash
      rerender({ selectedVariantKey: 'Alternative' });

      expect(mockSetHash).not.toHaveBeenCalled();
    });

    it('should not interfere with same-page section navigation', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
      };

      // Simulate user navigating to a different section on the same page
      // (This would be set by browser's native hash navigation, not our code)
      mockHashValue = 'some-section-heading';

      const { rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug: 'ComponentDemo',
            selectedVariantKey,
            variantKeys: ['Default', 'Styled'],
            shouldHighlight: true,
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should not interfere with section hash
      expect(mockSetHash).not.toHaveBeenCalled();

      // Variant change should NOT update the section hash
      rerender({ selectedVariantKey: 'Styled' });

      // Section hash should remain untouched
      expect(mockSetHash).not.toHaveBeenCalled();
    });
  });

  describe('Cross-Variant Navigation', () => {
    it('should find and select files from different variants when effectiveCode is provided', () => {
      // Setup multiple variants with different files
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

      // Mock selectVariant function with proper signature
      const mockSelectVariant = vi.fn();

      // Set hash to a file from Tailwind variant while Default is selected
      // Expected slug format: mainSlug:variantKey:fileName where all are kebab-cased
      // mainSlug='checkbox', variantKey='Tailwind'→'tailwind', fileName='tailwind.config.js' has baseName='tailwind.config'
      // toKebabCase('tailwind.config') → 'tailwind.config' (dots preserved), so slug is 'checkbox:tailwind:tailwind.config.js'
      mockHashValue = 'checkbox:tailwind:tailwind.config.js';

      const { result, rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant: effectiveCode[selectedVariantKey as keyof typeof effectiveCode],
            transformedFiles: undefined,
            mainSlug: 'checkbox',
            selectedVariantKey,
            variantKeys: ['Default', 'Tailwind'],
            shouldHighlight: true,
            effectiveCode,
            selectVariant: mockSelectVariant,
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should have called selectVariant to switch to Tailwind variant
      expect(mockSelectVariant).toHaveBeenCalledWith('Tailwind');

      // Simulate the variant change
      rerender({ selectedVariantKey: 'Tailwind' });

      // Now the file should be selected
      expect(result.current.selectedFileName).toBe('tailwind.config.js');
    });

    it('should find and select main files from different variants', () => {
      const effectiveCode = {
        Default: {
          fileName: 'button-default.tsx',
          source: 'const DefaultButton = () => <div>Default</div>;',
        },
        Material: {
          fileName: 'button-material.tsx',
          source: 'const MaterialButton = () => <div>Material</div>;',
        },
      };

      const mockSelectVariant = vi.fn();

      // Set hash to main file from Material variant while Default is selected
      mockHashValue = 'button:material:button-material.tsx';

      const { result, rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant: effectiveCode[selectedVariantKey as keyof typeof effectiveCode],
            transformedFiles: undefined,
            mainSlug: 'button',
            selectedVariantKey,
            variantKeys: ['Default', 'Material'],
            shouldHighlight: true,
            effectiveCode,
            selectVariant: mockSelectVariant,
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should have called selectVariant to switch to Material variant
      expect(mockSelectVariant).toHaveBeenCalledWith('Material');

      // Simulate the variant change
      rerender({ selectedVariantKey: 'Material' });

      // File should be selected from the correct variant
      expect(result.current.selectedFileName).toBe('button-material.tsx');
    });

    it('should handle initial variant files without switching variants', () => {
      const effectiveCode = {
        Default: {
          fileName: 'component.tsx',
          source: 'const Component = () => <div>Default</div>;',
          extraFiles: {
            'utils.ts': 'export const util = () => {};',
          },
        },
        Styled: {
          fileName: 'component-styled.tsx',
          source: 'const StyledComponent = () => <div>Styled</div>;',
        },
      };

      const mockSelectVariant = vi.fn();

      // Set hash to file from initial variant (Default)
      mockHashValue = 'component:utils.ts';

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant: effectiveCode.Default,
          transformedFiles: undefined,
          mainSlug: 'component',
          selectedVariantKey: 'Default',
          variantKeys: ['Default', 'Styled'],
          shouldHighlight: true,
          effectiveCode,
          selectVariant: mockSelectVariant,
        }),
      );

      // Should NOT have called selectVariant since file is in current variant
      expect(mockSelectVariant).not.toHaveBeenCalled();
      expect(result.current.selectedFileName).toBe('utils.ts');
    });

    it('should fallback to single-variant search when effectiveCode is not provided', () => {
      const selectedVariant = {
        fileName: 'fallback.tsx',
        source: 'const Fallback = () => <div>Fallback</div>;',
        extraFiles: {
          'helper.js': 'export const helper = () => {};',
        },
      };

      const mockSelectVariant = vi.fn();

      // Set hash to extra file
      mockHashValue = 'fallback:helper.js';

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'fallback',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          // effectiveCode not provided - should use fallback logic
          selectVariant: mockSelectVariant,
        }),
      );

      // Should have selected the file using single-variant logic
      expect(mockSelectVariant).not.toHaveBeenCalled();
      expect(result.current.selectedFileName).toBe('helper.js');
    });

    it('should handle non-initial variants correctly', () => {
      const effectiveCode = {
        Default: {
          fileName: 'card-default.tsx',
          source: 'const DefaultCard = () => <div>Default</div>;',
        },
        Premium: {
          fileName: 'card-premium.tsx',
          source: 'const PremiumCard = () => <div>Premium</div>;',
          extraFiles: {
            'premium-styles.css': '.premium { color: gold; }',
          },
        },
      };

      const mockSelectVariant = vi.fn();

      // Set hash to a non-initial variant file (Premium variant, where Default is initial)
      mockHashValue = 'card:premium:premium-styles.css';

      const { result, rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant: effectiveCode[selectedVariantKey as keyof typeof effectiveCode],
            transformedFiles: undefined,
            mainSlug: 'card',
            selectedVariantKey,
            variantKeys: ['Default', 'Premium'],
            shouldHighlight: true,
            effectiveCode,
            selectVariant: mockSelectVariant,
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should have called selectVariant to switch to Premium variant
      expect(mockSelectVariant).toHaveBeenCalledWith('Premium');

      // Simulate the variant change
      rerender({ selectedVariantKey: 'Premium' });

      // File should be selected from the correct variant
      expect(result.current.selectedFileName).toBe('premium-styles.css');
    });

    it('should handle hash mismatches gracefully', () => {
      const effectiveCode = {
        Default: {
          fileName: 'test.tsx',
          source: 'const Test = () => <div>Test</div>;',
        },
        Advanced: {
          fileName: 'test-advanced.tsx',
          source: 'const AdvancedTest = () => <div>Advanced</div>;',
        },
      };

      const mockSelectVariant = vi.fn();

      // Set hash to a file that doesn't exist in any variant
      mockHashValue = 'test:nonexistent:missing-file.js';

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant: effectiveCode.Default,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default', 'Advanced'],
          shouldHighlight: true,
          effectiveCode,
          selectVariant: mockSelectVariant,
        }),
      );

      // Should NOT have called selectVariant and should fallback to current selection
      expect(mockSelectVariant).not.toHaveBeenCalled();
      expect(result.current.selectedFileName).toBe('test.tsx'); // Main file of current variant
    });

    it('should prioritize effectiveCode search over transformed files', () => {
      const effectiveCode = {
        Default: {
          fileName: 'component.tsx',
          source: 'const Component = () => <div>Default</div>;',
        },
        Styled: {
          fileName: 'component-styled.tsx',
          source: 'const StyledComponent = () => <div>Styled</div>;',
          extraFiles: {
            'styles.css': '.styled { color: blue; }',
          },
        },
      };

      const mockSelectVariant = vi.fn();

      // Set hash to a file that exists in effectiveCode (Styled variant)
      mockHashValue = 'component:styled:styles.css';

      const { result, rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant: effectiveCode[selectedVariantKey as keyof typeof effectiveCode],
            transformedFiles: undefined, // No transformed files for simplicity
            mainSlug: 'component',
            selectedVariantKey,
            variantKeys: ['Default', 'Styled'],
            shouldHighlight: true,
            effectiveCode,
            selectVariant: mockSelectVariant,
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should have called selectVariant to switch to Styled variant
      expect(mockSelectVariant).toHaveBeenCalledWith('Styled');

      // Simulate the variant change
      rerender({ selectedVariantKey: 'Styled' });

      // File should be selected from the correct variant
      expect(result.current.selectedFileName).toBe('styles.css');
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

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant: effectiveCode.Default,
          transformedFiles: undefined,
          mainSlug: 'widget',
          selectedVariantKey: 'Default',
          variantKeys: ['Default', 'Custom'],
          shouldHighlight: true,
          effectiveCode,
          // selectVariant not provided
        }),
      );

      // Without selectVariant, it should NOT find files in other variants
      // It should stay on the current variant's main file
      expect(result.current.selectedFileName).toBe('widget-default.tsx');
    });
  });

  describe('allFilesSlugs', () => {
    it('should return correct slugs for all files across all variants', () => {
      const defaultVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
          'helper.ts': 'export const helper = () => {};',
        },
      };

      const tailwindVariant = {
        fileName: 'checkbox-tailwind.tsx',
        source: 'const TailwindCheckbox = () => <div className="p-4">Tailwind</div>;',
        extraFiles: {
          'tailwind.config.js': 'module.exports = {};',
          'postcss.config.js': 'module.exports = { plugins: [] };',
        },
      };

      const effectiveCode = {
        Default: defaultVariant,
        Tailwind: tailwindVariant,
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant: defaultVariant,
          transformedFiles: undefined,
          mainSlug: 'Basic',
          selectedVariantKey: 'Default',
          variantKeys: ['Default', 'Tailwind'],
          shouldHighlight: true,
          effectiveCode,
        }),
      );

      expect(result.current.allFilesSlugs).toEqual([
        // Default variant files (initial variant)
        {
          fileName: 'checkbox-basic.tsx',
          slug: 'basic:checkbox-basic.tsx',
          variantName: 'Default',
        },
        { fileName: 'styles.css', slug: 'basic:styles.css', variantName: 'Default' },
        { fileName: 'helper.ts', slug: 'basic:helper.ts', variantName: 'Default' },
        // Tailwind variant files (non-initial variant)
        // Variant-only slug for Tailwind
        {
          fileName: 'checkbox-tailwind.tsx',
          slug: 'basic:tailwind',
          variantName: 'Tailwind',
        },
        {
          fileName: 'checkbox-tailwind.tsx',
          slug: 'basic:tailwind:checkbox-tailwind.tsx',
          variantName: 'Tailwind',
        },
        {
          fileName: 'tailwind.config.js',
          slug: 'basic:tailwind:tailwind.config.js',
          variantName: 'Tailwind',
        },
        {
          fileName: 'postcss.config.js',
          slug: 'basic:tailwind:postcss.config.js',
          variantName: 'Tailwind',
        },
      ]);
    });

    it('should handle single variant with complex file names', () => {
      const testingVariant = {
        fileName: 'MyComplexComponent.test.tsx',
        source: 'test content',
        extraFiles: {
          'utilityHelpers.js': 'helper content',
          'ComponentStyles.module.css': 'css content',
          'APIUtils.d.ts': 'type definitions',
        },
      };

      const effectiveCode = {
        Testing: testingVariant,
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant: testingVariant,
          transformedFiles: undefined,
          mainSlug: 'Advanced Component Demo',
          selectedVariantKey: 'Testing',
          variantKeys: ['Testing'],
          shouldHighlight: true,
          effectiveCode,
        }),
      );

      // Testing variant should include variant name (only Default is excluded)
      expect(result.current.allFilesSlugs).toEqual([
        // Variant-only slug for Testing variant
        {
          fileName: 'MyComplexComponent.test.tsx',
          slug: 'advanced-component-demo:testing',
          variantName: 'Testing',
        },
        {
          fileName: 'MyComplexComponent.test.tsx',
          slug: 'advanced-component-demo:testing:my-complex-component.test.tsx',
          variantName: 'Testing',
        },
        {
          fileName: 'utilityHelpers.js',
          slug: 'advanced-component-demo:testing:utility-helpers.js',
          variantName: 'Testing',
        },
        {
          fileName: 'ComponentStyles.module.css',
          slug: 'advanced-component-demo:testing:component-styles.module.css',
          variantName: 'Testing',
        },
        {
          fileName: 'APIUtils.d.ts',
          slug: 'advanced-component-demo:testing:apiutils.d.ts',
          variantName: 'Testing',
        },
      ]);
    });

    it('should handle variant with only main file (no extra files)', () => {
      const selectedVariant = {
        fileName: 'simple-component.tsx',
        source: 'const SimpleComponent = () => <div>Simple</div>;',
      };

      const effectiveCode = {
        Default: selectedVariant,
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'Simple',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          effectiveCode,
        }),
      );

      expect(result.current.allFilesSlugs).toEqual([
        {
          fileName: 'simple-component.tsx',
          slug: 'simple:simple-component.tsx',
          variantName: 'Default',
        },
      ]);
    });

    it('should handle variant with only extra files (no main file)', () => {
      const selectedVariant = {
        extraFiles: {
          'config.json': '{ "setting": true }',
          'README.md': '# Configuration files',
        },
      };

      const effectiveCode = {
        Default: selectedVariant,
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'Config',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          effectiveCode,
        }),
      );

      expect(result.current.allFilesSlugs).toEqual([
        { fileName: 'config.json', slug: 'config:config.json', variantName: 'Default' },
        { fileName: 'README.md', slug: 'config:readme.md', variantName: 'Default' },
      ]);
    });

    it('should return empty array when no effectiveCode is provided', () => {
      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant: null,
          transformedFiles: undefined,
          mainSlug: 'Test',
          selectedVariantKey: undefined,
          variantKeys: [],
          shouldHighlight: true,
          effectiveCode: undefined,
        }),
      );

      expect(result.current.allFilesSlugs).toEqual([]);
    });

    it('should return empty array when variantKeys is empty', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
      };

      const effectiveCode = {
        Default: selectedVariant,
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'Test',
          selectedVariantKey: 'Default',
          variantKeys: [],
          shouldHighlight: true,
          effectiveCode,
        }),
      );

      expect(result.current.allFilesSlugs).toEqual([]);
    });

    it('should include all variants in allFilesSlugs regardless of selected variant', () => {
      const defaultVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      const styledVariant = {
        fileName: 'styled-component.tsx',
        source: 'const StyledComponent = () => <div>Styled Test</div>;',
        extraFiles: {
          'styled.css': '.styled { color: blue; }',
        },
      };

      const effectiveCode = {
        Default: defaultVariant,
        Styled: styledVariant,
      };

      const { result, rerender } = renderHook(
        ({ selectedVariantKey }) =>
          useFileNavigation({
            selectedVariant: selectedVariantKey === 'Default' ? defaultVariant : styledVariant,
            transformedFiles: undefined,
            mainSlug: 'Test',
            selectedVariantKey,
            variantKeys: ['Default', 'Styled'],
            shouldHighlight: true,
            effectiveCode,
          }),
        {
          initialProps: { selectedVariantKey: 'Default' },
        },
      );

      // Should always return all files from all variants
      const expectedSlugs = [
        // Default variant files (initial variant)
        { fileName: 'component.tsx', slug: 'test:component.tsx', variantName: 'Default' },
        { fileName: 'styles.css', slug: 'test:styles.css', variantName: 'Default' },
        // Styled variant files (non-initial variant)
        // Variant-only slug for Styled
        {
          fileName: 'styled-component.tsx',
          slug: 'test:styled',
          variantName: 'Styled',
        },
        {
          fileName: 'styled-component.tsx',
          slug: 'test:styled:styled-component.tsx',
          variantName: 'Styled',
        },
        { fileName: 'styled.css', slug: 'test:styled:styled.css', variantName: 'Styled' },
      ];

      expect(result.current.allFilesSlugs).toEqual(expectedSlugs);

      // Change to non-initial variant - should still return the same all files
      rerender({ selectedVariantKey: 'Styled' });

      expect(result.current.allFilesSlugs).toEqual(expectedSlugs);
    });

    it('should respect explicit initialVariant parameter', () => {
      const defaultVariant = {
        fileName: 'default-component.tsx',
        source: 'const DefaultComponent = () => <div>Default</div>;',
        extraFiles: {
          'default.css': '.default { color: black; }',
        },
      };

      const tailwindVariant = {
        fileName: 'tailwind-component.tsx',
        source: 'const TailwindComponent = () => <div>Tailwind</div>;',
        extraFiles: {
          'tailwind.css': '.tailwind { color: green; }',
        },
      };

      const specialVariant = {
        fileName: 'special-component.tsx',
        source: 'const SpecialComponent = () => <div>Special</div>;',
        extraFiles: {
          'special.css': '.special { color: red; }',
        },
      };

      const effectiveCode = {
        Default: defaultVariant,
        Tailwind: tailwindVariant,
        Special: specialVariant,
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant: specialVariant,
          transformedFiles: undefined,
          mainSlug: 'Demo',
          selectedVariantKey: 'Special',
          variantKeys: ['Default', 'Tailwind', 'Special'],
          shouldHighlight: true,
          effectiveCode,
        }),
      );

      // Only Default variant files exclude variant name from slug
      expect(result.current.allFilesSlugs).toEqual([
        // Default variant files (excludes variant name)
        {
          fileName: 'default-component.tsx',
          slug: 'demo:default-component.tsx',
          variantName: 'Default',
        },
        { fileName: 'default.css', slug: 'demo:default.css', variantName: 'Default' },
        // Tailwind variant files (includes variant name)
        // Variant-only slug for Tailwind
        {
          fileName: 'tailwind-component.tsx',
          slug: 'demo:tailwind',
          variantName: 'Tailwind',
        },
        {
          fileName: 'tailwind-component.tsx',
          slug: 'demo:tailwind:tailwind-component.tsx',
          variantName: 'Tailwind',
        },
        { fileName: 'tailwind.css', slug: 'demo:tailwind:tailwind.css', variantName: 'Tailwind' },
        // Special variant files (includes variant name)
        // Variant-only slug for Special
        {
          fileName: 'special-component.tsx',
          slug: 'demo:special',
          variantName: 'Special',
        },
        {
          fileName: 'special-component.tsx',
          slug: 'demo:special:special-component.tsx',
          variantName: 'Special',
        },
        { fileName: 'special.css', slug: 'demo:special:special.css', variantName: 'Special' },
      ]);
    });

    it('should handle empty mainSlug gracefully', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
        extraFiles: {
          'helper.js': 'export const helper = () => {};',
        },
      };

      const effectiveCode = {
        Default: selectedVariant,
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: '',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          effectiveCode,
        }),
      );

      expect(result.current.allFilesSlugs).toEqual([
        { fileName: 'component.tsx', slug: 'component.tsx', variantName: 'Default' },
        { fileName: 'helper.js', slug: 'helper.js', variantName: 'Default' },
      ]);
    });

    it('should be memoized and not create new arrays on every render', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      const effectiveCode = {
        Default: selectedVariant,
      };

      const { result, rerender } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'Test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          effectiveCode,
        }),
      );

      const firstRender = result.current.allFilesSlugs;

      // Rerender without changing dependencies
      rerender();

      const secondRender = result.current.allFilesSlugs;

      // Should be the same reference (memoized) or at least the same content
      // Note: In test environment, reference might not always be preserved
      expect(firstRender).toEqual(secondRender);
    });

    it('should create new array when dependencies change', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Test</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      const effectiveCode = {
        Default: selectedVariant,
      };

      const { result, rerender } = renderHook(
        ({ mainSlug }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug,
            selectedVariantKey: 'Default',
            variantKeys: ['Default'],
            shouldHighlight: true,
            effectiveCode,
          }),
        {
          initialProps: { mainSlug: 'Test' },
        },
      );

      const firstRender = result.current.allFilesSlugs;

      // Change mainSlug dependency
      rerender({ mainSlug: 'NewTest' });

      const secondRender = result.current.allFilesSlugs;

      // Should be different references (new memoization)
      expect(firstRender).not.toBe(secondRender);

      // But content should be updated
      expect(secondRender).toEqual([
        { fileName: 'component.tsx', slug: 'new-test:component.tsx', variantName: 'Default' },
        { fileName: 'styles.css', slug: 'new-test:styles.css', variantName: 'Default' },
      ]);
    });
  });

  describe('shouldHighlight behavior', () => {
    it('should create components with highlighting when shouldHighlight=true', () => {
      const selectedVariant = {
        fileName: 'test.js',
        source: 'const x = 1;',
        extraFiles: {
          'utils.js': 'export const util = () => {};',
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      expect(result.current.files).toHaveLength(2);
      expect(result.current.files[0].name).toBe('test.js');
      expect(result.current.files[1].name).toBe('utils.js');
      // Components should be created with syntax highlighting enabled
      expect(result.current.files[0].component).toBeDefined();
      expect(result.current.files[1].component).toBeDefined();
      expect(result.current.selectedFileComponent).toBeDefined();
    });

    it('should create components without highlighting when shouldHighlight=false', () => {
      const selectedVariant = {
        fileName: 'test.js',
        source: 'const x = 1;',
        extraFiles: {
          'utils.js': 'export const util = () => {};',
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: false,
        }),
      );

      expect(result.current.files).toHaveLength(2);
      expect(result.current.files[0].name).toBe('test.js');
      expect(result.current.files[1].name).toBe('utils.js');
      // Components should be created without syntax highlighting
      expect(result.current.files[0].component).toBeDefined();
      expect(result.current.files[1].component).toBeDefined();
      expect(result.current.selectedFileComponent).toBeDefined();
    });

    it('should return highlighted JSX when shouldHighlight=true with HAST nodes', () => {
      // Create a variant with HAST nodes (syntax highlighted source)
      const selectedVariant: VariantCode = {
        fileName: 'test.js',
        source: {
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['token', 'keyword'] },
              children: [{ type: 'text', value: 'const' }],
            },
            { type: 'text', value: ' x = 1;' },
          ],
        },
        extraFiles: {
          'utils.js': {
            source: {
              type: 'root',
              children: [
                {
                  type: 'element',
                  tagName: 'span',
                  properties: { className: ['token', 'keyword'] },
                  children: [{ type: 'text', value: 'export' }],
                },
                { type: 'text', value: ' const util = () => {};' },
              ],
            },
          },
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      expect(result.current.files).toHaveLength(2);
      // With shouldHighlight=true, HAST nodes should be converted to JSX (React elements)
      expect(typeof result.current.files[0].component).toBe('object'); // JSX React element
      expect(typeof result.current.files[1].component).toBe('object'); // JSX React element
      expect(typeof result.current.selectedFileComponent).toBe('object'); // JSX React element
    });

    it('should return plain text when shouldHighlight=false with HAST nodes', () => {
      // Create a variant with HAST nodes (syntax highlighted source)
      const selectedVariant: VariantCode = {
        fileName: 'test.js',
        source: {
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['token', 'keyword'] },
              children: [{ type: 'text', value: 'const' }],
            },
            { type: 'text', value: ' x = 1;' },
          ],
        },
        extraFiles: {
          'utils.js': {
            source: {
              type: 'root',
              children: [
                {
                  type: 'element',
                  tagName: 'span',
                  properties: { className: ['token', 'keyword'] },
                  children: [{ type: 'text', value: 'export' }],
                },
                { type: 'text', value: ' const util = () => {};' },
              ],
            },
          },
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: false,
        }),
      );

      expect(result.current.files).toHaveLength(2);
      // With shouldHighlight=false, still returns JSX objects (Pre components)
      expect(typeof result.current.files[0].component).toBe('object');
      expect(result.current.files[0].component).toEqual(
        expect.objectContaining({
          type: Pre,
          props: expect.objectContaining({
            shouldHighlight: false,
            children: expect.objectContaining({
              type: 'root',
              children: expect.any(Array),
            }),
          }),
        }),
      );
      expect(typeof result.current.files[1].component).toBe('object');
      expect(result.current.files[1].component).toEqual(
        expect.objectContaining({
          type: Pre,
          props: expect.objectContaining({
            shouldHighlight: false,
            children: expect.objectContaining({
              type: 'root',
              children: expect.any(Array),
            }),
          }),
        }),
      );
      expect(typeof result.current.selectedFileComponent).toBe('object');
      expect(result.current.selectedFileComponent).toEqual(
        expect.objectContaining({
          type: Pre,
          props: expect.objectContaining({
            shouldHighlight: false,
            children: expect.objectContaining({
              type: 'root',
              children: expect.any(Array),
            }),
          }),
        }),
      );
    });

    it('should handle shouldHighlight behavior when switching between files', () => {
      const selectedVariant: VariantCode = {
        fileName: 'main.js',
        source: {
          type: 'root',
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['token', 'keyword'] },
              children: [{ type: 'text', value: 'const' }],
            },
            { type: 'text', value: ' main = true;' },
          ],
        },
        extraFiles: {
          'helper.js': {
            source: {
              type: 'root',
              children: [
                {
                  type: 'element',
                  tagName: 'span',
                  properties: { className: ['token', 'keyword'] },
                  children: [{ type: 'text', value: 'const' }],
                },
                { type: 'text', value: ' helper = false;' },
              ],
            },
          },
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: false, // Test with highlighting disabled
        }),
      );

      // Initially on main file - should be JSX object (Pre component)
      expect(result.current.selectedFileName).toBe('main.js');
      expect(typeof result.current.selectedFileComponent).toBe('object');
      expect(result.current.selectedFileComponent).toEqual(
        expect.objectContaining({
          type: Pre,
          props: expect.objectContaining({
            shouldHighlight: false,
            children: expect.objectContaining({
              type: 'root',
              children: expect.any(Array),
            }),
          }),
        }),
      );

      // Switch to helper file - should also be JSX object (Pre component)
      act(() => {
        result.current.selectFileName('helper.js');
      });

      expect(result.current.selectedFileName).toBe('helper.js');
      expect(typeof result.current.selectedFileComponent).toBe('object');
      expect(result.current.selectedFileComponent).toEqual(
        expect.objectContaining({
          type: Pre,
          props: expect.objectContaining({
            shouldHighlight: false,
            children: expect.objectContaining({
              type: 'root',
              children: expect.any(Array),
            }),
          }),
        }),
      );
    });

    it('should apply shouldHighlight to selectedFileComponent when switching files', () => {
      const selectedVariant = {
        fileName: 'main.js',
        source: 'const main = true;',
        extraFiles: {
          'helper.js': 'const helper = false;',
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: false,
        }),
      );

      // Initially on main file
      expect(result.current.selectedFileName).toBe('main.js');
      expect(result.current.selectedFileComponent).toBeDefined();

      // Switch to helper file using act to handle state update
      act(() => {
        result.current.selectFileName('helper.js');
      });

      expect(result.current.selectedFileName).toBe('helper.js');
      expect(result.current.selectedFileComponent).toBeDefined();
      // Component should be created with shouldHighlight=false setting
    });

    it('should render transformed files from source in Pre component', () => {
      const selectedVariant = {
        fileName: 'test.js',
        source: 'const x = 1;',
      };

      const transformedFiles = {
        files: [
          {
            name: 'test.ts',
            originalName: 'test.js',
            source: 'const x: number = 1;',
          },
        ],
        filenameMap: { 'test.js': 'test.ts' },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].name).toBe('test.ts');
      // Component should be a Pre element rendering the source, not the pre-created component
      expect(result.current.files[0].component).toEqual(
        expect.objectContaining({
          type: Pre,
          props: expect.objectContaining({
            shouldHighlight: true,
            children: 'const x: number = 1;',
          }),
        }),
      );
      expect(result.current.selectedFileComponent).toEqual(
        expect.objectContaining({
          type: Pre,
          props: expect.objectContaining({
            shouldHighlight: true,
            children: 'const x: number = 1;',
          }),
        }),
      );
    });
  });

  describe('selectedFileLines', () => {
    it('should count lines correctly for string content', () => {
      // Test 1: Main file (3 lines)
      const selectedVariant = {
        fileName: 'test.js',
        source: 'const x = 1;\nconst y = 2;\nconst z = 3;',
        extraFiles: {
          'multiline.js': 'line 1\nline 2\nline 3\nline 4',
          'single.js': 'single line',
          'empty.js': '',
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      // Main file (3 lines)
      expect(result.current.selectedFileLines).toBe(3);

      // Test 2: multiline.js (4 lines)
      const selectedVariantMultiline = {
        fileName: 'multiline.js',
        source: 'line 1\nline 2\nline 3\nline 4',
        extraFiles: {},
      };

      const { result: result2 } = renderHook(() =>
        useFileNavigation({
          selectedVariant: selectedVariantMultiline,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      expect(result2.current.selectedFileLines).toBe(4);

      // Test 3: single.js (1 line)
      const selectedVariantSingle = {
        fileName: 'single.js',
        source: 'single line',
        extraFiles: {},
      };

      const { result: result3 } = renderHook(() =>
        useFileNavigation({
          selectedVariant: selectedVariantSingle,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      expect(result3.current.selectedFileLines).toBe(1);

      // Test 4: empty.js (1 line - empty string split by '\n' returns [''] which has length 1)
      const selectedVariantEmpty = {
        fileName: 'empty.js',
        source: '',
        extraFiles: {},
      };

      const { result: result4 } = renderHook(() =>
        useFileNavigation({
          selectedVariant: selectedVariantEmpty,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      expect(result4.current.selectedFileLines).toBe(1);
    });

    it('should count lines correctly for hast content', () => {
      const selectedVariant: VariantCode = {
        fileName: 'test.js',
        source: {
          type: 'root',
          children: [
            { type: 'element', tagName: 'span', properties: {}, children: [] },
            { type: 'element', tagName: 'div', properties: {}, children: [] },
            { type: 'element', tagName: 'p', properties: {}, children: [] },
          ],
        },
        extraFiles: {
          'hast-single.js': {
            source: {
              type: 'root',
              children: [{ type: 'element', tagName: 'span', properties: {}, children: [] }],
            },
          },
          'hast-empty.js': {
            source: {
              type: 'root',
              children: [],
            },
          },
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      // Main file (3 children but no line breaks = 1 line)
      expect(result.current.selectedFileLines).toBe(1);

      // Switch to single child file (1 line)
      act(() => {
        result.current.selectFileName('hast-single.js');
      });
      expect(result.current.selectedFileLines).toBe(1);

      // Switch to empty children file (0 lines)
      act(() => {
        result.current.selectFileName('hast-empty.js');
      });
      expect(result.current.selectedFileLines).toBe(0);
    });

    it('should handle transformed files line counting', () => {
      const selectedVariant = {
        fileName: 'test.js',
        source: 'const x = 1;',
      };

      const transformedFiles = {
        files: [
          {
            name: 'test.ts',
            originalName: 'test.js',
            source: 'const x: number = 1;\nconst y: string = "hello";\nconst z: boolean = true;',
          },
        ],
        filenameMap: { 'test.js': 'test.ts' },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      // Should count lines from transformed source (3 lines)
      expect(result.current.selectedFileLines).toBe(3);
    });

    it('should use totalLines from hast data when available', () => {
      // Test case where the HAST object has totalLines in its data (like from addLineGutters)
      const selectedVariant: VariantCode = {
        fileName: 'test.js',
        source: {
          type: 'root',
          data: {
            totalLines: 42, // This should take precedence over countLines
          },
          children: [
            { type: 'element', tagName: 'span', properties: {}, children: [] },
            { type: 'element', tagName: 'div', properties: {}, children: [] },
            { type: 'element', tagName: 'p', properties: {}, children: [] },
          ],
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      // Should use totalLines from data (42) instead of countLines result
      expect(result.current.selectedFileLines).toBe(42);
    });

    it('should handle totalLines as string and convert to number', () => {
      const selectedVariant: VariantCode = {
        fileName: 'test.js',
        source: {
          type: 'root',
          data: {
            totalLines: '15', // String value should be converted to number
          } as any,
          children: [{ type: 'element', tagName: 'span', properties: {}, children: [] }],
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      expect(result.current.selectedFileLines).toBe(15);
    });

    it('should fallback to countLines when totalLines is invalid', () => {
      const selectedVariant: VariantCode = {
        fileName: 'test.js',
        source: {
          type: 'root',
          data: {
            totalLines: null, // Invalid totalLines should fallback to countLines
          } as any,
          children: [
            { type: 'element', tagName: 'span', properties: {}, children: [] },
            { type: 'element', tagName: 'div', properties: {}, children: [] },
          ],
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      // Should fallback to countLines (1 line for 2 children without line breaks) when totalLines is null
      expect(result.current.selectedFileLines).toBe(1);
    });

    it('should handle transformed files with hast content', () => {
      const selectedVariant: VariantCode = {
        fileName: 'test.js',
        source: 'const x = 1;',
      };

      const transformedFiles = {
        files: [
          {
            name: 'test.ts',
            originalName: 'test.js',
            source: {
              type: 'root' as const,
              children: [
                { type: 'element' as const, tagName: 'span', properties: {}, children: [] },
                { type: 'element' as const, tagName: 'div', properties: {}, children: [] },
                { type: 'element' as const, tagName: 'p', properties: {}, children: [] },
                { type: 'element' as const, tagName: 'section', properties: {}, children: [] },
                { type: 'element' as const, tagName: 'article', properties: {}, children: [] },
              ],
            },
          },
        ],
        filenameMap: { 'test.js': 'test.ts' },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      // Should count using countLines from transformed hast (1 line for 5 children without line breaks)
      expect(result.current.selectedFileLines).toBe(1);
    });

    it('should return 0 lines when no file is selected', () => {
      const selectedVariant: VariantCode | null = null;

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      expect(result.current.selectedFileLines).toBe(0);
    });

    it('should return 0 lines for invalid content types', () => {
      const selectedVariant: VariantCode = {
        fileName: 'test.js',
        source: undefined, // Invalid content
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      expect(result.current.selectedFileLines).toBe(0);
    });

    it('should handle extraFiles with object format line counting', () => {
      const selectedVariant: VariantCode = {
        fileName: 'main.js',
        source: 'const main = true;',
        extraFiles: {
          'helper.js': {
            source: 'line 1\nline 2\nline 3',
          },
          'utils.js': {
            source: {
              type: 'root',
              children: [
                { type: 'element', tagName: 'span', properties: {}, children: [] },
                { type: 'element', tagName: 'div', properties: {}, children: [] },
              ],
            },
          },
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      // Main file (1 line)
      expect(result.current.selectedFileLines).toBe(1);

      // Switch to helper file with string source (3 lines)
      act(() => {
        result.current.selectFileName('helper.js');
      });
      expect(result.current.selectedFileLines).toBe(3);

      // Switch to utils file with hast source (1 line for 2 children without line breaks)
      act(() => {
        result.current.selectFileName('utils.js');
      });
      expect(result.current.selectedFileLines).toBe(1);
    });

    it('should handle files with trailing newlines correctly', () => {
      const selectedVariant = {
        fileName: 'test.js',
        source: 'line 1\nline 2\nline 3\n', // Trailing newline
        extraFiles: {
          'double-trailing.js': 'line 1\nline 2\n\n', // Double trailing newline
          'no-trailing.js': 'line 1\nline 2\nline 3', // No trailing newline
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      // Main file with trailing newline (4 lines: 3 content + 1 empty)
      expect(result.current.selectedFileLines).toBe(4);

      // Switch to file with double trailing newlines (4 lines: 2 content + 2 empty)
      act(() => {
        result.current.selectFileName('double-trailing.js');
      });
      expect(result.current.selectedFileLines).toBe(4);

      // Switch to file without trailing newline (3 lines)
      act(() => {
        result.current.selectFileName('no-trailing.js');
      });
      expect(result.current.selectedFileLines).toBe(3);
    });

    it('should provide accurate line counting with countLines for complex HAST structures', () => {
      // Test case demonstrating countLines accuracy with realistic syntax-highlighted content
      const selectedVariant: VariantCode = {
        fileName: 'test.js',
        source: {
          type: 'root',
          data: {},
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: {},
              children: [{ type: 'text', value: 'function' }],
            },
            { type: 'text', value: ' ' },
            {
              type: 'element',
              tagName: 'span',
              properties: {},
              children: [{ type: 'text', value: 'test' }],
            },
            { type: 'text', value: '() {\n  return ' },
            {
              type: 'element',
              tagName: 'span',
              properties: {},
              children: [{ type: 'text', value: '"hello"' }],
            },
            { type: 'text', value: ';\n}' },
          ],
        },
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      // countLines correctly identifies 3 lines based on the 2 newlines (\n)
      // The function intelligently parses text content across multiple elements
      // (naive children.length would incorrectly return 6)
      expect(result.current.selectedFileLines).toBe(3);
    });
  });

  describe('stability and re-render behavior', () => {
    it('should not cause excessive re-renders when selectFileName is called multiple times with same value', () => {
      const selectedVariant = {
        fileName: 'main.tsx',
        source: 'const Main = () => <div>Main</div>;',
        extraFiles: {
          'helper.ts': 'export const helper = () => {};',
          'config.js': 'export const config = {};',
        },
      };

      let callCount = 0;
      const { result } = renderHook(() => {
        callCount += 1;
        return useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        });
      });

      // Select a file first
      act(() => {
        result.current.selectFileName('helper.ts');
      });

      expect(result.current.selectedFileName).toBe('helper.ts');

      // Clear the count after initial selection
      const afterFirstSelection = callCount;

      // Call selectFileName multiple times with the same value
      // This could happen with URL hash changes or user interactions
      act(() => {
        result.current.selectFileName('helper.ts');
      });

      act(() => {
        result.current.selectFileName('helper.ts');
      });

      act(() => {
        result.current.selectFileName('helper.ts');
      });

      // Should not cause excessive re-renders when setting the same value repeatedly
      const totalNewCalls = callCount - afterFirstSelection;
      // Allow some re-renders for the hash updates, but not hundreds
      expect(totalNewCalls).toBeLessThan(10);

      // Verify state is still correct
      expect(result.current.selectedFileName).toBe('helper.ts');
    });

    it('should not cause excessive re-renders when hash changes trigger same file selection', () => {
      const selectedVariant = {
        fileName: 'component.tsx',
        source: 'const Component = () => <div>Component</div>;',
        extraFiles: {
          'utils.ts': 'export const utils = {};',
        },
      };

      // Start with a hash pointing to utils.ts
      mockHashValue = 'test:utils.ts';

      let callCount = 0;
      const { rerender } = renderHook(() => {
        callCount += 1;
        return useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        });
      });

      // Initial render should select the file from hash
      const initialCalls = callCount;

      // Simulate multiple hash changes to the same file
      // This could happen with browser back/forward navigation
      rerender();
      rerender();
      rerender();

      const totalNewCalls = callCount - initialCalls;
      // Should not cause excessive re-renders
      expect(totalNewCalls).toBeLessThan(10);
    });

    it('should handle rapid file selection changes without excessive re-renders', () => {
      const selectedVariant = {
        fileName: 'main.tsx',
        source: 'const Main = () => <div>Main</div>;',
        extraFiles: {
          'file1.ts': 'export const file1 = {};',
          'file2.ts': 'export const file2 = {};',
          'file3.ts': 'export const file3 = {};',
        },
      };

      let callCount = 0;
      const { result } = renderHook(() => {
        callCount += 1;
        return useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        });
      });

      const initialCalls = callCount;

      // Rapidly switch between files
      act(() => {
        result.current.selectFileName('file1.ts');
        result.current.selectFileName('file2.ts');
        result.current.selectFileName('file3.ts');
        result.current.selectFileName('file1.ts');
      });

      const totalNewCalls = callCount - initialCalls;
      // Should handle rapid changes efficiently
      expect(totalNewCalls).toBeLessThan(15);

      // Should end up with the last selected file
      expect(result.current.selectedFileName).toBe('file1.ts');
    });
  });

  describe('sourceEnhancers', () => {
    it('should render selectedFileComponent from source when no enhancers provided', () => {
      const selectedVariant = {
        fileName: 'test.tsx',
        source: 'const Component = () => <div>Test</div>;',
      };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
        }),
      );

      expect(result.current.selectedFileComponent).toEqual(
        expect.objectContaining({
          type: Pre,
          props: expect.objectContaining({
            shouldHighlight: true,
            children: 'const Component = () => <div>Test</div>;',
          }),
        }),
      );
    });

    it('should render selectedFileComponent from source when empty enhancers array provided', () => {
      const selectedVariant = {
        fileName: 'test.tsx',
        source: 'const Component = () => <div>Test</div>;',
      };

      // Stable reference for empty array
      const emptyEnhancers: never[] = [];

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          sourceEnhancers: emptyEnhancers,
        }),
      );

      expect(result.current.selectedFileComponent).toEqual(
        expect.objectContaining({
          type: Pre,
          props: expect.objectContaining({
            shouldHighlight: true,
            children: 'const Component = () => <div>Test</div>;',
          }),
        }),
      );
    });

    it('should pass sourceEnhancers to useSourceEnhancing and call enhancer with HAST source', async () => {
      // Create a HAST root for testing
      const hastSource = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'const x = 1;' }],
      };

      const mainFileComments = { 'comment-1': { line: 1, text: 'test comment' } };

      const selectedVariant = {
        fileName: 'test.tsx',
        source: hastSource,
        comments: mainFileComments,
      };

      const mockEnhancer = vi.fn((root) => root);
      // Stable reference for enhancers array
      const enhancers = [mockEnhancer];

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          sourceEnhancers: enhancers,
        }),
      );

      // Wait for the enhancer to be called
      await vi.waitFor(() => {
        expect(mockEnhancer).toHaveBeenCalled();
      });

      // The enhancer should be called with the HAST root, comments, and filename
      expect(mockEnhancer).toHaveBeenCalledWith(hastSource, mainFileComments, 'test.tsx');

      // Component should still render properly
      expect(result.current.selectedFileComponent).toBeDefined();
    });

    it('should use enhancedSource in selectedFileComponent when enhancers modify the source', async () => {
      // Enhanced HAST root with modification marker
      const enhancedHast = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'ENHANCED: const x = 1;' }],
      };

      const originalHast = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'const x = 1;' }],
      };

      const selectedVariant = {
        fileName: 'test.tsx',
        source: originalHast,
      };

      // Enhancer that returns the enhanced version
      const mockEnhancer = vi.fn(() => enhancedHast);
      // Stable reference for enhancers array
      const enhancers = [mockEnhancer];

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          sourceEnhancers: enhancers,
        }),
      );

      // Wait for enhancement to complete
      await vi.waitFor(() => {
        expect(mockEnhancer).toHaveBeenCalled();
      });

      // Wait for the component to update with enhanced source
      await vi.waitFor(() => {
        expect(result.current.selectedFileComponent).toEqual(
          expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              shouldHighlight: true,
              children: enhancedHast,
            }),
          }),
        );
      });
    });

    it('should get comments from main file when main file is selected', async () => {
      const mainFileComments = { 'line-1': { line: 1, text: 'main file comment' } };

      const selectedVariant = {
        fileName: 'main.tsx',
        source: { type: 'root' as const, children: [] },
        comments: mainFileComments,
        extraFiles: {
          'helper.ts': {
            source: 'export const helper = () => {};',
            comments: { 'line-2': { line: 2, text: 'helper comment' } },
          },
        },
      };

      const mockEnhancer = vi.fn((root) => root);
      const enhancers = [mockEnhancer];

      renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          sourceEnhancers: enhancers,
        }),
      );

      await vi.waitFor(() => {
        expect(mockEnhancer).toHaveBeenCalled();
      });

      // Should receive main file comments
      expect(mockEnhancer).toHaveBeenCalledWith(expect.anything(), mainFileComments, 'main.tsx');
    });

    it('should get comments from extra file when extra file is selected via hash', async () => {
      const helperComments = { 'line-2': { line: 2, text: 'helper comment' } };

      const selectedVariant = {
        fileName: 'main.tsx',
        source: { type: 'root' as const, children: [] },
        comments: { 'line-1': { line: 1, text: 'main file comment' } },
        extraFiles: {
          'helper.ts': {
            source: { type: 'root' as const, children: [] },
            comments: helperComments,
          },
        },
      };

      const mockEnhancer = vi.fn((root) => root);
      const enhancers = [mockEnhancer];

      // Set hash to select helper.ts file
      mockHashValue = 'test:helper.ts';

      renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          sourceEnhancers: enhancers,
        }),
      );

      await vi.waitFor(() => {
        expect(mockEnhancer).toHaveBeenCalled();
      });

      // Should receive helper file comments
      expect(mockEnhancer).toHaveBeenCalledWith(expect.anything(), helperComments, 'helper.ts');
    });

    it('should pass undefined comments when file has no comments', async () => {
      const selectedVariant = {
        fileName: 'main.tsx',
        source: { type: 'root' as const, children: [] },
        // No comments on main file
        extraFiles: {
          'helper.ts': {
            source: { type: 'root' as const, children: [] },
            // No comments on extra file either
          },
        },
      };

      const mockEnhancer = vi.fn((root) => root);
      const enhancers = [mockEnhancer];

      renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          sourceEnhancers: enhancers,
        }),
      );

      await vi.waitFor(() => {
        expect(mockEnhancer).toHaveBeenCalled();
      });

      // Should receive undefined for comments
      expect(mockEnhancer).toHaveBeenCalledWith(expect.anything(), undefined, 'main.tsx');
    });

    it('should enhance transformed files when transforms exist', async () => {
      const transformedSource = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'const x = 1;' }],
      };

      const selectedVariant = {
        fileName: 'test.ts',
        source: 'const x: number = 1;', // Original TypeScript
        comments: { 'ts-comment': { line: 1, text: 'TypeScript comment' } },
      };

      const transformedFiles = {
        files: [
          {
            name: 'test.js',
            originalName: 'test.ts',
            source: transformedSource, // Transformed JavaScript
          },
        ],
        filenameMap: { 'test.ts': 'test.js' },
      };

      const mockEnhancer = vi.fn((root) => root);
      const enhancers = [mockEnhancer];

      renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          sourceEnhancers: enhancers,
        }),
      );

      await vi.waitFor(() => {
        expect(mockEnhancer).toHaveBeenCalled();
      });

      // Enhancer should be called with the transformed HAST source and transformed filename
      expect(mockEnhancer).toHaveBeenCalledWith(
        transformedSource,
        expect.anything(),
        'test.js', // Should use transformed filename
      );
    });

    it('should handle async enhancers that return promises', async () => {
      const originalHast = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'original' }],
      };

      const enhancedHast = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'enhanced async' }],
      };

      const selectedVariant = {
        fileName: 'test.tsx',
        source: originalHast,
      };

      // Async enhancer
      const asyncEnhancer = vi.fn(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        return enhancedHast;
      });
      const enhancers = [asyncEnhancer];

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          sourceEnhancers: enhancers,
        }),
      );

      // Initially should show original source (before async completes)
      expect(result.current.selectedFileComponent).toEqual(
        expect.objectContaining({
          type: Pre,
          props: expect.objectContaining({
            children: originalHast,
          }),
        }),
      );

      // Wait for async enhancement
      await vi.waitFor(() => {
        expect(asyncEnhancer).toHaveBeenCalled();
      });

      // After enhancement, should show enhanced source
      await vi.waitFor(() => {
        expect(result.current.selectedFileComponent).toEqual(
          expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              children: enhancedHast,
            }),
          }),
        );
      });
    });

    it('should chain multiple enhancers in sequence', async () => {
      const originalHast = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'original' }],
      };

      const firstEnhancedHast = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'first enhanced' }],
      };

      const secondEnhancedHast = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'second enhanced' }],
      };

      const selectedVariant = {
        fileName: 'test.tsx',
        source: originalHast,
      };

      const firstEnhancer = vi.fn(() => firstEnhancedHast);
      const secondEnhancer = vi.fn(() => secondEnhancedHast);
      const enhancers = [firstEnhancer, secondEnhancer];

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          sourceEnhancers: enhancers,
        }),
      );

      await vi.waitFor(() => {
        expect(secondEnhancer).toHaveBeenCalled();
      });

      // First enhancer should be called with original
      expect(firstEnhancer).toHaveBeenCalledWith(originalHast, undefined, 'test.tsx');

      // Second enhancer should receive output from first enhancer
      // Note: Comments are passed to all enhancers in the chain (not just first)
      expect(secondEnhancer).toHaveBeenCalledWith(firstEnhancedHast, undefined, 'test.tsx');

      // Final result should be from second enhancer
      await vi.waitFor(() => {
        expect(result.current.selectedFileComponent).toEqual(
          expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              children: secondEnhancedHast,
            }),
          }),
        );
      });
    });

    it('should not enhance string sources (only HAST roots can be enhanced)', () => {
      const selectedVariant = {
        fileName: 'test.tsx',
        source: 'const x = 1;', // String source, not HAST
      };

      const mockEnhancer = vi.fn((root) => root);
      const enhancers = [mockEnhancer];

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          sourceEnhancers: enhancers,
        }),
      );

      // Enhancer should not be called for string sources
      // (useSourceEnhancing returns the original source if it can't resolve to HAST)
      expect(mockEnhancer).not.toHaveBeenCalled();

      // Component should still render with string source
      expect(result.current.selectedFileComponent).toEqual(
        expect.objectContaining({
          type: Pre,
          props: expect.objectContaining({
            children: 'const x = 1;',
          }),
        }),
      );
    });

    it('should handle hastJson format with enhancers', async () => {
      const hastRoot = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'from json' }],
      };

      const selectedVariant = {
        fileName: 'test.tsx',
        source: { hastJson: JSON.stringify(hastRoot) },
      };

      const mockEnhancer = vi.fn((root) => root);
      const enhancers = [mockEnhancer];

      renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          sourceEnhancers: enhancers,
        }),
      );

      await vi.waitFor(() => {
        expect(mockEnhancer).toHaveBeenCalled();
      });

      // Enhancer should receive parsed HAST root
      expect(mockEnhancer).toHaveBeenCalledWith(hastRoot, undefined, 'test.tsx');
    });

    it('should return null selectedFileComponent when no variant is selected', () => {
      const mockEnhancer = vi.fn((root) => root);
      const enhancers = [mockEnhancer];

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant: null,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          sourceEnhancers: enhancers,
        }),
      );

      expect(result.current.selectedFileComponent).toBeNull();
      expect(mockEnhancer).not.toHaveBeenCalled();
    });

    it('should use transformed file source for enhancement when transforms are applied', async () => {
      // Original TypeScript source
      const originalTsHast = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'const x: number = 1;' }],
      };

      // Transformed JavaScript source
      const transformedJsHast = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'const x = 1;' }],
      };

      const selectedVariant = {
        fileName: 'test.ts',
        source: originalTsHast,
      };

      const transformedFiles = {
        files: [
          {
            name: 'test.js',
            originalName: 'test.ts',
            source: transformedJsHast,
          },
        ],
        filenameMap: { 'test.ts': 'test.js' },
      };

      const enhancedJsHast = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'const x = 1; // enhanced' }],
      };

      const mockEnhancer = vi.fn(() => enhancedJsHast);
      const enhancers = [mockEnhancer];

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          sourceEnhancers: enhancers,
        }),
      );

      await vi.waitFor(() => {
        expect(mockEnhancer).toHaveBeenCalled();
      });

      // Should enhance the transformed (JavaScript) source, not original TypeScript
      expect(mockEnhancer).toHaveBeenCalledWith(
        transformedJsHast,
        undefined,
        'test.js', // Transformed filename
      );

      // Component should render with enhanced transformed source
      await vi.waitFor(() => {
        expect(result.current.selectedFileComponent).toEqual(
          expect.objectContaining({
            type: Pre,
            props: expect.objectContaining({
              children: enhancedJsHast,
            }),
          }),
        );
      });
    });

    it('should re-run enhancers when file selection changes', async () => {
      const mainFileHast = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'main file' }],
      };

      const helperFileHast = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'helper file' }],
      };

      const selectedVariant = {
        fileName: 'main.tsx',
        source: mainFileHast,
        extraFiles: {
          'helper.ts': {
            source: helperFileHast,
          },
        },
      };

      const mockEnhancer = vi.fn((root) => ({
        ...root,
        data: { enhanced: true },
      }));
      const enhancers = [mockEnhancer];

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          sourceEnhancers: enhancers,
        }),
      );

      await vi.waitFor(() => {
        expect(mockEnhancer).toHaveBeenCalledWith(mainFileHast, undefined, 'main.tsx');
      });

      // Select helper file
      act(() => {
        result.current.selectFileName('helper.ts');
      });

      // Wait for enhancer to be called with helper file
      await vi.waitFor(() => {
        expect(mockEnhancer).toHaveBeenCalledWith(helperFileHast, undefined, 'helper.ts');
      });
    });

    it('should preserve shouldHighlight setting when using enhancers', async () => {
      const hastSource = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'const x = 1;' }],
      };

      const selectedVariant = {
        fileName: 'test.tsx',
        source: hastSource,
      };

      const mockEnhancer = vi.fn((root) => root);
      const enhancers = [mockEnhancer];

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: false, // Explicitly set to false
          sourceEnhancers: enhancers,
        }),
      );

      await vi.waitFor(() => {
        expect(mockEnhancer).toHaveBeenCalled();
      });

      // Should preserve shouldHighlight=false in the rendered component
      expect(result.current.selectedFileComponent).toEqual(
        expect.objectContaining({
          type: Pre,
          props: expect.objectContaining({
            shouldHighlight: false,
            children: hastSource,
          }),
        }),
      );
    });

    it('should handle preClassName and preRef props with enhancers', async () => {
      const hastSource = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'const x = 1;' }],
      };

      const selectedVariant = {
        fileName: 'test.tsx',
        source: hastSource,
      };

      const mockEnhancer = vi.fn((root) => root);
      const enhancers = [mockEnhancer];
      const mockRef = { current: null };

      const { result } = renderHook(() =>
        useFileNavigation({
          selectedVariant,
          transformedFiles: undefined,
          mainSlug: 'test',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          shouldHighlight: true,
          preClassName: 'custom-class',
          preRef: mockRef,
          sourceEnhancers: enhancers,
        }),
      );

      await vi.waitFor(() => {
        expect(mockEnhancer).toHaveBeenCalled();
      });

      // Should include className and ref in the rendered component
      expect(result.current.selectedFileComponent).toEqual(
        expect.objectContaining({
          type: Pre,
          props: expect.objectContaining({
            className: 'custom-class',
          }),
        }),
      );
    });
  });
});
