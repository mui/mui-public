/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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
          shouldHighlight: true,
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
          shouldHighlight: true,
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
          shouldHighlight: true,
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
          shouldHighlight: true,
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
          shouldHighlight: true,
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
          shouldHighlight: true,
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
          shouldHighlight: true,
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
          shouldHighlight: true,
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
            shouldHighlight: true,
          }),
        {
          initialProps: {
            selectedVariantKey: 'Default',
            variantKeys: ['Default', 'Tailwind'],
            initialVariant: 'Default',
            shouldHighlight: true,
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
        shouldHighlight: true,
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
          shouldHighlight: true,
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
            shouldHighlight: true,
          }),
        {
          initialProps: {
            selectedVariantKey: 'Default',
            variantKeys: ['Default', 'Tailwind'],
            initialVariant: 'Default',
            shouldHighlight: true,
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
        shouldHighlight: true,
      });

      // Check that URL was updated with the new variant slug
      expect(mockReplaceState).toHaveBeenCalledWith(
        null,
        '',
        '/docs/components?tab=demo#basic:tailwind:checkbox-basic.tsx',
      );
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
          initialVariant: 'Default',
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
          initialVariant: 'Default',
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
      const selectedVariant = {
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
          initialVariant: 'Default',
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
      const selectedVariant = {
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
          initialVariant: 'Default',
          shouldHighlight: false,
        }),
      );

      expect(result.current.files).toHaveLength(2);
      // With shouldHighlight=false, HAST nodes should be converted to plain text strings
      expect(typeof result.current.files[0].component).toBe('string');
      expect(result.current.files[0].component).toBe('const x = 1;');
      expect(typeof result.current.files[1].component).toBe('string');
      expect(result.current.files[1].component).toBe('export const util = () => {};');
      expect(typeof result.current.selectedFileComponent).toBe('string');
      expect(result.current.selectedFileComponent).toBe('const x = 1;');
    });

    it('should handle shouldHighlight behavior when switching between files', () => {
      const selectedVariant = {
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
          initialVariant: 'Default',
          shouldHighlight: false, // Test with highlighting disabled
        }),
      );

      // Initially on main file - should be plain text
      expect(result.current.selectedFileName).toBe('main.js');
      expect(typeof result.current.selectedFileComponent).toBe('string');
      expect(result.current.selectedFileComponent).toBe('const main = true;');

      // Switch to helper file - should also be plain text
      act(() => {
        result.current.selectFileName('helper.js');
      });

      expect(result.current.selectedFileName).toBe('helper.js');
      expect(typeof result.current.selectedFileComponent).toBe('string');
      expect(result.current.selectedFileComponent).toBe('const helper = false;');
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
          initialVariant: 'Default',
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

    it('should respect shouldHighlight with transformed files', () => {
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
            component: 'mock transformed component', // Pre-created component
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
          initialVariant: 'Default',
          shouldHighlight: true, // This should not affect pre-created components in transformedFiles
        }),
      );

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].name).toBe('test.ts');
      expect(result.current.files[0].component).toBe('mock transformed component');
      expect(result.current.selectedFileComponent).toBe('mock transformed component');
    });
  });
});
