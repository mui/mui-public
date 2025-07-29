/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFileNavigation } from './useFileNavigation';

describe('useFileNavigation', () => {
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
          initialVariant: 'Default',
        }),
      );

      expect(result.current.files).toEqual([
        {
          name: 'checkbox-basic.tsx',
          slug: 'basic:checkbox-basic.tsx',
          component: 'const BasicCheckbox = () => <div>Basic</div>;',
        },
        {
          name: 'styles.css',
          slug: 'basic:styles.css',
          component: 'body { margin: 0; }',
        },
        {
          name: 'helper.ts',
          slug: 'basic:helper.ts',
          component: 'export const helper = () => {};',
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
          initialVariant: 'Default',
        }),
      );

      expect(result.current.files).toEqual([
        {
          name: 'checkbox-tailwind.tsx',
          slug: 'basic:tailwind:checkbox-tailwind.tsx',
          component: 'const TailwindCheckbox = () => <div className="p-4">Tailwind</div>;',
        },
        {
          name: 'tailwind.config.js',
          slug: 'basic:tailwind:tailwind.config.js',
          component: 'module.exports = {};',
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
          initialVariant: 'Default',
        }),
      );

      expect(result.current.files).toEqual([
        {
          name: 'checkbox.test.tsx',
          slug: 'advanced-checkbox:testing:checkbox.test.tsx',
          component: 'test content',
        },
        {
          name: 'component.d.ts',
          slug: 'advanced-checkbox:testing:component.d.ts',
          component: 'type definitions',
        },
        {
          name: 'style.module.css',
          slug: 'advanced-checkbox:testing:style.module.css',
          component: 'css module',
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
          initialVariant: 'Default',
        }),
      );

      expect(result.current.files).toEqual([
        {
          name: 'component.tsx',
          slug: 'component.tsx',
          component: 'test content',
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
          initialVariant: 'Special', // Special is the initial variant, not Default
        }),
      );

      expect(result.current.files).toEqual([
        {
          name: 'checkbox-special.tsx',
          slug: 'basic:checkbox-special.tsx', // Should be treated as initial variant
          component: 'const SpecialCheckbox = () => <div>Special</div>;',
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
          initialVariant: 'Default',
        }),
      );

      expect(result.current.files).toEqual([
        {
          name: 'BasicCode.tsx',
          slug: 'basic:basic-code.tsx',
          component: 'const BasicCode = () => <div>Basic</div>;',
        },
        {
          name: 'helperUtils.js',
          slug: 'basic:helper-utils.js',
          component: 'export const helper = () => {};',
        },
        {
          name: 'MyComponent.test.tsx',
          slug: 'basic:my-component.test.tsx',
          component: 'test content',
        },
      ]);
    });

    it('should update URL hash when selecting a file', () => {
      // Mock window.history.replaceState
      const mockReplaceState = vi.fn();
      Object.defineProperty(window, 'history', {
        value: { replaceState: mockReplaceState },
        writable: true,
      });

      // Mock window.location
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/docs/components',
          search: '?tab=demo',
          hash: '',
        },
        writable: true,
      });

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
          initialVariant: 'Default',
        }),
      );

      // Select a file
      result.current.selectFileName('helperUtils.js');

      // Check that URL was updated with the file's slug
      expect(mockReplaceState).toHaveBeenCalledWith(
        null,
        '',
        '/docs/components?tab=demo#basic:helper-utils.js',
      );
    });

    it('should select file based on URL hash on hydration', () => {
      // Mock window.location with a hash
      Object.defineProperty(window, 'location', {
        value: {
          hash: '#basic:helper-utils.js',
        },
        writable: true,
      });

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
          initialVariant: 'Default',
        }),
      );

      // Check that the file was selected based on the URL hash
      expect(result.current.selectedFileName).toBe('helperUtils.js');
    });

    it('should update URL hash when variant changes', () => {
      // Mock window.history.replaceState
      const mockReplaceState = vi.fn();
      Object.defineProperty(window, 'history', {
        value: { replaceState: mockReplaceState },
        writable: true,
      });

      // Mock window.location
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/docs/components',
          search: '?tab=demo',
          hash: '#basic:checkbox-basic.tsx',
        },
        writable: true,
      });

      const selectedVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      const { result, rerender } = renderHook(
        ({ selectedVariantKey, variantKeys, initialVariant }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug: 'Basic',
            selectedVariantKey,
            variantKeys,
            initialVariant,
          }),
        {
          initialProps: {
            selectedVariantKey: 'Default',
            variantKeys: ['Default', 'Tailwind'],
            initialVariant: 'Default',
          },
        },
      );

      // Simulate user clicking on a file first (this sets hasUserSelection to true)
      result.current.selectFileName('checkbox-basic.tsx');

      // Clear previous calls from the user selection
      mockReplaceState.mockClear();

      // Change variant to Tailwind
      rerender({
        selectedVariantKey: 'Tailwind',
        variantKeys: ['Default', 'Tailwind'],
        initialVariant: 'Default',
      });

      // Check that URL was updated with the new variant slug
      expect(mockReplaceState).toHaveBeenCalledWith(
        null,
        '',
        '/docs/components?tab=demo#basic:tailwind:checkbox-basic.tsx',
      );
    });

    it('should not automatically set URL hash on initial load without user interaction', () => {
      // Mock window.location and history
      const mockReplaceState = vi.fn();
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/test',
          search: '?param=value',
          hash: '', // No initial hash
        },
        writable: true,
      });
      Object.defineProperty(window, 'history', {
        value: { replaceState: mockReplaceState },
        writable: true,
      });

      const mockVariant = {
        fileName: 'CheckboxBasic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'index.ts': 'export * from "./CheckboxBasic";',
        },
      };

      renderHook(() =>
        useFileNavigation({
          selectedVariant: mockVariant,
          transformedFiles: undefined,
          mainSlug: 'basic',
          selectedVariantKey: 'Default',
          variantKeys: ['Default'],
          initialVariant: 'Default',
        }),
      );

      // Should not have called replaceState because there was no user interaction
      expect(mockReplaceState).not.toHaveBeenCalled();
    });

    it('should update URL hash when variant changes after initial URL hash selection', () => {
      // Mock window.location and history with an initial hash
      const mockReplaceState = vi.fn();
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/docs/components',
          search: '?tab=demo',
          hash: '#basic:checkbox-basic.tsx', // Has initial hash
        },
        writable: true,
      });
      Object.defineProperty(window, 'history', {
        value: { replaceState: mockReplaceState },
        writable: true,
      });

      const selectedVariant = {
        fileName: 'checkbox-basic.tsx',
        source: 'const BasicCheckbox = () => <div>Basic</div>;',
        extraFiles: {
          'styles.css': 'body { margin: 0; }',
        },
      };

      const { rerender } = renderHook(
        ({ selectedVariantKey, variantKeys, initialVariant }) =>
          useFileNavigation({
            selectedVariant,
            transformedFiles: undefined,
            mainSlug: 'Basic',
            selectedVariantKey,
            variantKeys,
            initialVariant,
          }),
        {
          initialProps: {
            selectedVariantKey: 'Default',
            variantKeys: ['Default', 'Tailwind'],
            initialVariant: 'Default',
          },
        },
      );

      // Clear calls from initial hash processing
      mockReplaceState.mockClear();

      // Change variant to Tailwind
      rerender({
        selectedVariantKey: 'Tailwind',
        variantKeys: ['Default', 'Tailwind'],
        initialVariant: 'Default',
      });

      // Check that URL was updated with the new variant slug
      expect(mockReplaceState).toHaveBeenCalledWith(
        null,
        '',
        '/docs/components?tab=demo#basic:tailwind:checkbox-basic.tsx',
      );
    });
  });
});
