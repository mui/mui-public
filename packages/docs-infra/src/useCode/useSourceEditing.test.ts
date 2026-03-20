/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSourceEditing } from './useSourceEditing';
import type { Code, ControlledCode, VariantCode } from '../CodeHighlighter/types';
import type { CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';

function createContext(
  overrides: Partial<CodeHighlighterContextType> = {},
): CodeHighlighterContextType {
  return {
    code: {},
    setCode: vi.fn(),
    ...overrides,
  };
}

/**
 * Captures the ControlledCode produced by setSource by intercepting the
 * setState updater function passed to context.setCode.
 */
function captureControlledCode(
  context: CodeHighlighterContextType,
  currentCode?: ControlledCode,
): ControlledCode | undefined {
  const setCode = context.setCode as ReturnType<typeof vi.fn>;
  const updater = setCode.mock.lastCall?.[0];
  if (typeof updater === 'function') {
    return updater(currentCode);
  }
  return updater;
}

describe('useSourceEditing', () => {
  describe('setSource availability', () => {
    it('returns undefined when context has no setCode', () => {
      const { result } = renderHook(() =>
        useSourceEditing({
          context: createContext({ setCode: undefined }),
          selectedVariantKey: 'Default',
          effectiveCode: {},
          selectedVariant: { fileName: 'App.tsx', source: 'code' },
        }),
      );

      expect(result.current.setSource).toBeUndefined();
    });

    it('returns undefined when disabled', () => {
      const { result } = renderHook(() =>
        useSourceEditing({
          context: createContext(),
          selectedVariantKey: 'Default',
          effectiveCode: {},
          selectedVariant: { fileName: 'App.tsx', source: 'code' },
          disabled: true,
        }),
      );

      expect(result.current.setSource).toBeUndefined();
    });

    it('returns undefined when selectedVariant is null (unloaded)', () => {
      const { result } = renderHook(() =>
        useSourceEditing({
          context: createContext(),
          selectedVariantKey: 'Default',
          effectiveCode: { Default: 'https://example.com/demo' },
          selectedVariant: null,
        }),
      );

      expect(result.current.setSource).toBeUndefined();
    });

    it('returns setSource when context has setCode, variant is loaded, and not disabled', () => {
      const { result } = renderHook(() =>
        useSourceEditing({
          context: createContext(),
          selectedVariantKey: 'Default',
          effectiveCode: {},
          selectedVariant: { fileName: 'App.tsx', source: 'code' },
        }),
      );

      expect(result.current.setSource).toBeTypeOf('function');
    });
  });

  describe('editing main file', () => {
    it('updates the main file source', () => {
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: 'original',
      };
      const effectiveCode: Code = { Default: selectedVariant };
      const context = createContext();

      const { result } = renderHook(() =>
        useSourceEditing({
          context,
          selectedVariantKey: 'Default',
          effectiveCode,
          selectedVariant,
        }),
      );

      act(() => result.current.setSource!('edited'));

      const controlled = captureControlledCode(context);
      expect(controlled!.Default!.source).toBe('edited');
    });

    it('preserves extra files when editing main file', () => {
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: 'original',
        extraFiles: {
          'styles.css': 'body { color: red; }',
          'helpers.ts': { source: 'export const h = 1;' },
        },
      };
      const effectiveCode: Code = { Default: selectedVariant };
      const context = createContext();

      const { result } = renderHook(() =>
        useSourceEditing({
          context,
          selectedVariantKey: 'Default',
          effectiveCode,
          selectedVariant,
        }),
      );

      act(() => result.current.setSource!('edited'));

      const controlled = captureControlledCode(context);
      const variant = controlled!.Default!;

      expect(variant.source).toBe('edited');
      expect(variant.extraFiles).toBeDefined();
      // String entries normalized to { source } objects
      expect(variant.extraFiles!['styles.css']).toEqual({ source: 'body { color: red; }' });
      expect(variant.extraFiles!['helpers.ts']).toEqual({ source: 'export const h = 1;' });
    });
  });

  describe('editing extra file', () => {
    it('updates the specified extra file', () => {
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: 'main code',
        extraFiles: {
          'styles.css': 'old styles',
        },
      };
      const effectiveCode: Code = { Default: selectedVariant };
      const context = createContext();

      const { result } = renderHook(() =>
        useSourceEditing({
          context,
          selectedVariantKey: 'Default',
          effectiveCode,
          selectedVariant,
        }),
      );

      act(() => result.current.setSource!('new styles', 'styles.css'));

      const controlled = captureControlledCode(context);
      const variant = controlled!.Default!;

      expect(variant.source).toBe('main code');
      expect(variant.extraFiles!['styles.css']).toEqual({ source: 'new styles' });
    });

    it('preserves other extra files when editing one', () => {
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: 'main code',
        extraFiles: {
          'styles.css': 'css content',
          'helpers.ts': { source: 'helper content' },
        },
      };
      const effectiveCode: Code = { Default: selectedVariant };
      const context = createContext();

      const { result } = renderHook(() =>
        useSourceEditing({
          context,
          selectedVariantKey: 'Default',
          effectiveCode,
          selectedVariant,
        }),
      );

      act(() => result.current.setSource!('new css', 'styles.css'));

      const controlled = captureControlledCode(context);
      const variant = controlled!.Default!;

      expect(variant.extraFiles!['styles.css']).toEqual({ source: 'new css' });
      expect(variant.extraFiles!['helpers.ts']).toEqual({ source: 'helper content' });
    });
  });

  describe('HAST source normalization', () => {
    it('converts HAST root sources to plain text on first edit', () => {
      const hastRoot = {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'highlighted code' }],
      };
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: hastRoot,
        extraFiles: {
          'styles.css': { source: hastRoot },
        },
      };
      const effectiveCode: Code = { Default: selectedVariant };
      const context = createContext();

      const { result } = renderHook(() =>
        useSourceEditing({
          context,
          selectedVariantKey: 'Default',
          effectiveCode,
          selectedVariant,
        }),
      );

      act(() => result.current.setSource!('edited', 'styles.css'));

      const controlled = captureControlledCode(context);
      const variant = controlled!.Default!;

      // Main source converted from HAST to string
      expect(variant.source).toBe('highlighted code');
      // Edited extra file has new value
      expect(variant.extraFiles!['styles.css']).toEqual({ source: 'edited' });
    });
  });

  describe('successive edits', () => {
    it('preserves previous edits when editing again', () => {
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: 'original',
        extraFiles: {
          'styles.css': 'original css',
        },
      };
      const effectiveCode: Code = { Default: selectedVariant };
      const context = createContext();

      const { result } = renderHook(() =>
        useSourceEditing({
          context,
          selectedVariantKey: 'Default',
          effectiveCode,
          selectedVariant,
        }),
      );

      // First edit: main file
      act(() => result.current.setSource!('first edit'));
      const afterFirst = captureControlledCode(context);

      // Second edit: extra file, passing previous controlled state
      act(() => result.current.setSource!('new css', 'styles.css'));
      const afterSecond = captureControlledCode(context, afterFirst);

      expect(afterSecond!.Default!.source).toBe('first edit');
      expect(afterSecond!.Default!.extraFiles!['styles.css']).toEqual({ source: 'new css' });
    });
  });
});
