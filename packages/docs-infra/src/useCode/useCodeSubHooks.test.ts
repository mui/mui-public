/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVariantSelection } from './useVariantSelection';
import { useTransformManagement } from './useTransformManagement';
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
        }),
      );

      expect(result.current.availableTransforms).toEqual([]);
      expect(result.current.selectedTransform).toBeNull();
      expect(result.current.transformedFiles).toBeUndefined();
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
});
