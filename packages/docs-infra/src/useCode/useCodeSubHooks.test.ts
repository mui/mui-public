/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVariantSelection } from './useVariantSelection';
import { useTransformManagement } from './useTransformManagement';
import { useFileNavigation } from './useFileNavigation';
import { useUIState } from './useUIState';

describe('useCode sub-hooks', () => {
  describe('useVariantSelection', () => {
    it('should select first variant by default', () => {
      const effectiveCode = {
        Default: { source: 'const x = 1;', fileName: 'test.js' },
        Alternative: { source: 'let x = 1;', fileName: 'test.js' },
      };

      const { result } = renderHook(() => useVariantSelection({ effectiveCode }));

      expect(result.current.variantKeys).toEqual(['Default', 'Alternative']);
      expect(result.current.selectedVariantKey).toBe('Default');
      expect(result.current.selectedVariant).toEqual(effectiveCode.Default);
    });

    it('should use initial variant when provided', () => {
      const effectiveCode = {
        Default: { source: 'const x = 1;', fileName: 'test.js' },
        Alternative: { source: 'let x = 1;', fileName: 'test.js' },
      };

      const { result } = renderHook(() =>
        useVariantSelection({ effectiveCode, initialVariant: 'Alternative' }),
      );

      expect(result.current.selectedVariantKey).toBe('Alternative');
      expect(result.current.selectedVariant).toEqual(effectiveCode.Alternative);
    });
  });

  describe('useTransformManagement', () => {
    it('should return empty transforms when none available', () => {
      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode: {},
          selectedVariantKey: 'Default',
          selectedVariant: null,
          shouldHighlight: true,
        }),
      );

      expect(result.current.availableTransforms).toEqual([]);
      expect(result.current.selectedTransform).toBeNull();
      expect(result.current.transformedFiles).toBeUndefined();
    });

    it('should handle shouldHighlight=true for transform creation', () => {
      const effectiveCode = {
        Default: {
          source: 'const x = 1;',
          fileName: 'test.js',
          transforms: {
            'js-to-ts': {
              delta: { 0: ['const x: number = 1;'] },
              fileName: 'test.ts',
            },
          },
        },
      } as any;

      const selectedVariant = {
        source: 'const x = 1;',
        fileName: 'test.js',
        transforms: {
          'js-to-ts': {
            delta: { 0: ['const x: number = 1;'] },
            fileName: 'test.ts',
          },
        },
      } as any;

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant,
          shouldHighlight: true,
          initialTransform: 'js-to-ts', // Need to select a transform for transformedFiles to be defined
        }),
      );

      expect(result.current.availableTransforms).toEqual(['js-to-ts']);
      expect(result.current.selectedTransform).toBe('js-to-ts');
      expect(result.current.transformedFiles).toBeDefined();
    });

    it('should handle shouldHighlight=false for transform creation', () => {
      const effectiveCode = {
        Default: {
          source: 'const x = 1;',
          fileName: 'test.js',
          transforms: {
            'js-to-ts': {
              delta: { 0: ['const x: number = 1;'] },
              fileName: 'test.ts',
            },
          },
        },
      } as any;

      const selectedVariant = {
        source: 'const x = 1;',
        fileName: 'test.js',
        transforms: {
          'js-to-ts': {
            delta: { 0: ['const x: number = 1;'] },
            fileName: 'test.ts',
          },
        },
      } as any;

      const { result } = renderHook(() =>
        useTransformManagement({
          effectiveCode,
          selectedVariantKey: 'Default',
          selectedVariant,
          shouldHighlight: false,
          initialTransform: 'js-to-ts', // Need to select a transform for transformedFiles to be defined
        }),
      );

      expect(result.current.availableTransforms).toEqual(['js-to-ts']);
      expect(result.current.selectedTransform).toBe('js-to-ts');
      expect(result.current.transformedFiles).toBeDefined();
      // The main difference is in how components are created within transformedFiles
      // When shouldHighlight=false, components won't have syntax highlighting applied
    });
  });

  describe('useUIState', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => useUIState({}));

      expect(result.current.expanded).toBe(false);
      expect(typeof result.current.expand).toBe('function');
      expect(typeof result.current.setExpanded).toBe('function');
    });

    it('should respect defaultOpen option', () => {
      const { result } = renderHook(() => useUIState({ defaultOpen: true }));

      expect(result.current.expanded).toBe(true);
    });
  });

  describe('useFileNavigation', () => {
    it('should handle shouldHighlight for file components', () => {
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
      // Components should be created with syntax highlighting
      expect(result.current.files[0].component).toBeDefined();
      expect(result.current.files[1].component).toBeDefined();
    });

    it('should handle shouldHighlight=false for file components', () => {
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
    });
  });
});
