/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Root as HastRoot } from 'hast';
import type { SourceEnhancer, SourceComments } from '../CodeHighlighter/types';
import { useSourceEnhancing } from './useSourceEnhancing';

function makeHast(value: string): HastRoot {
  return {
    type: 'root',
    children: [{ type: 'text', value }],
  };
}

function textOf(source: unknown): string | undefined {
  if (
    source &&
    typeof source === 'object' &&
    'children' in source &&
    Array.isArray((source as HastRoot).children)
  ) {
    const first = (source as HastRoot).children[0];
    if (first && first.type === 'text') {
      return first.value;
    }
  }
  return undefined;
}

describe('useSourceEnhancing', () => {
  describe('no enhancers', () => {
    it('should return the source unchanged when no enhancers are provided', () => {
      const source = makeHast('original');

      const { result } = renderHook(() =>
        useSourceEnhancing({
          source,
          fileName: 'test.tsx',
          comments: undefined,
          sourceEnhancers: undefined,
        }),
      );

      expect(result.current.enhancedSource).toBe(source);
      expect(result.current.isEnhancing).toBe(false);
    });

    it('should return the source unchanged when enhancers array is empty', () => {
      const source = makeHast('original');

      const { result } = renderHook(() =>
        useSourceEnhancing({
          source,
          fileName: 'test.tsx',
          comments: undefined,
          sourceEnhancers: [],
        }),
      );

      expect(result.current.enhancedSource).toBe(source);
      expect(result.current.isEnhancing).toBe(false);
    });

    it('should return null when source is null', () => {
      const { result } = renderHook(() =>
        useSourceEnhancing({
          source: null,
          fileName: 'test.tsx',
          comments: undefined,
          sourceEnhancers: [() => makeHast('should not run')],
        }),
      );

      expect(result.current.enhancedSource).toBeNull();
      expect(result.current.isEnhancing).toBe(false);
    });

    it('should return null when source is undefined', () => {
      const { result } = renderHook(() =>
        useSourceEnhancing({
          source: undefined,
          fileName: 'test.tsx',
          comments: undefined,
          sourceEnhancers: [() => makeHast('should not run')],
        }),
      );

      expect(result.current.enhancedSource).toBeNull();
      expect(result.current.isEnhancing).toBe(false);
    });
  });

  describe('string sources', () => {
    it('should return string sources unchanged since they cannot be enhanced', () => {
      const source = 'const x = 1;';

      const enhancer = vi.fn(() => makeHast('enhanced'));

      const { result } = renderHook(() =>
        useSourceEnhancing({
          source,
          fileName: 'test.tsx',
          comments: undefined,
          sourceEnhancers: [enhancer],
        }),
      );

      expect(result.current.enhancedSource).toBe(source);
      expect(result.current.isEnhancing).toBe(false);
      expect(enhancer).not.toHaveBeenCalled();
    });
  });

  describe('sync enhancers', () => {
    it('should apply a single sync enhancer immediately', () => {
      const source = makeHast('original');
      const enhanced = makeHast('enhanced');
      const enhancer = vi.fn(() => enhanced);

      const { result } = renderHook(() =>
        useSourceEnhancing({
          source,
          fileName: 'test.tsx',
          comments: undefined,
          sourceEnhancers: [enhancer],
        }),
      );

      expect(textOf(result.current.enhancedSource)).toBe('enhanced');
      expect(result.current.isEnhancing).toBe(false);
      expect(enhancer).toHaveBeenCalledExactlyOnceWith(source, undefined, 'test.tsx');
    });

    it('should chain multiple sync enhancers in order', () => {
      const source = makeHast('original');
      const callOrder: string[] = [];

      const first: SourceEnhancer = (root) => {
        callOrder.push('first');
        expect(textOf(root)).toBe('original');
        return makeHast('first');
      };
      const second: SourceEnhancer = (root) => {
        callOrder.push('second');
        expect(textOf(root)).toBe('first');
        return makeHast('second');
      };
      const third: SourceEnhancer = (root) => {
        callOrder.push('third');
        expect(textOf(root)).toBe('second');
        return makeHast('third');
      };

      const { result } = renderHook(() =>
        useSourceEnhancing({
          source,
          fileName: 'test.tsx',
          comments: undefined,
          sourceEnhancers: [first, second, third],
        }),
      );

      expect(textOf(result.current.enhancedSource)).toBe('third');
      expect(result.current.isEnhancing).toBe(false);
      expect(callOrder).toEqual(['first', 'second', 'third']);
    });

    it('should pass comments and fileName to enhancers', () => {
      const source = makeHast('original');
      const comments: SourceComments = { 1: ['@highlight'] };
      const enhancer = vi.fn((root: HastRoot) => root);

      renderHook(() =>
        useSourceEnhancing({
          source,
          fileName: 'MyComponent.tsx',
          comments,
          sourceEnhancers: [enhancer],
        }),
      );

      expect(enhancer).toHaveBeenCalledWith(source, comments, 'MyComponent.tsx');
    });

    it('should use "unknown" as fileName when fileName is undefined', () => {
      const source = makeHast('original');
      const enhancer = vi.fn((root: HastRoot) => root);

      renderHook(() =>
        useSourceEnhancing({
          source,
          fileName: undefined,
          comments: undefined,
          sourceEnhancers: [enhancer],
        }),
      );

      expect(enhancer).toHaveBeenCalledWith(source, undefined, 'unknown');
    });

    it('should re-run sync enhancers when source changes', () => {
      const sourceA = makeHast('A');
      const sourceB = makeHast('B');
      const enhancer = vi.fn((root: HastRoot) =>
        makeHast(`enhanced-${textOf(root)}`),
      );
      const enhancers: SourceEnhancer[] = [enhancer];

      const { result, rerender } = renderHook(
        ({ source }) =>
          useSourceEnhancing({
            source,
            fileName: 'test.tsx',
            comments: undefined,
            sourceEnhancers: enhancers,
          }),
        { initialProps: { source: sourceA as typeof sourceA | typeof sourceB } },
      );

      expect(textOf(result.current.enhancedSource)).toBe('enhanced-A');
      expect(enhancer).toHaveBeenCalledTimes(1);

      rerender({ source: sourceB });

      expect(textOf(result.current.enhancedSource)).toBe('enhanced-B');
      expect(enhancer).toHaveBeenCalledTimes(2);
      expect(result.current.isEnhancing).toBe(false);
    });

    it('should re-run sync enhancers when comments change', () => {
      const source = makeHast('original');
      const commentsA: SourceComments = { 1: ['@highlight'] };
      const commentsB: SourceComments = { 2: ['@highlight'] };
      const enhancer = vi.fn((root: HastRoot) => root);
      const enhancers: SourceEnhancer[] = [enhancer];

      const { rerender } = renderHook(
        ({ comments }) =>
          useSourceEnhancing({
            source,
            fileName: 'test.tsx',
            comments,
            sourceEnhancers: enhancers,
          }),
        { initialProps: { comments: commentsA as SourceComments } },
      );

      expect(enhancer).toHaveBeenCalledTimes(1);
      expect(enhancer).toHaveBeenCalledWith(source, commentsA, 'test.tsx');

      rerender({ comments: commentsB });

      expect(enhancer).toHaveBeenCalledTimes(2);
      expect(enhancer).toHaveBeenLastCalledWith(source, commentsB, 'test.tsx');
    });

    it('should re-run sync enhancers when fileName changes', () => {
      const source = makeHast('original');
      const enhancer = vi.fn((root: HastRoot) => root);
      const enhancers: SourceEnhancer[] = [enhancer];

      const { rerender } = renderHook(
        ({ name }) =>
          useSourceEnhancing({
            source,
            fileName: name,
            comments: undefined,
            sourceEnhancers: enhancers,
          }),
        { initialProps: { name: 'file-a.tsx' } },
      );

      expect(enhancer).toHaveBeenCalledTimes(1);
      expect(enhancer).toHaveBeenCalledWith(source, undefined, 'file-a.tsx');

      rerender({ name: 'file-b.tsx' });

      expect(enhancer).toHaveBeenCalledTimes(2);
      expect(enhancer).toHaveBeenLastCalledWith(source, undefined, 'file-b.tsx');
    });

    it('should not re-run enhancers when inputs are unchanged', () => {
      const source = makeHast('original');
      const enhancers: SourceEnhancer[] = [vi.fn((root: HastRoot) => root)];

      const { rerender } = renderHook(() =>
        useSourceEnhancing({
          source,
          fileName: 'test.tsx',
          comments: undefined,
          sourceEnhancers: enhancers,
        }),
      );

      rerender();
      rerender();

      expect(enhancers[0]).toHaveBeenCalledTimes(1);
    });
  });

  describe('async enhancers', () => {
    it('should show original source immediately and resolve async enhancer', async () => {
      const source = makeHast('original');
      const enhanced = makeHast('enhanced-async');

      const asyncEnhancer: SourceEnhancer = async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        return enhanced;
      };
      const enhancers: SourceEnhancer[] = [asyncEnhancer];

      const { result } = renderHook(() =>
        useSourceEnhancing({
          source,
          fileName: 'test.tsx',
          comments: undefined,
          sourceEnhancers: enhancers,
        }),
      );

      // Before async resolves, shows the original (no sync enhancers ran before it)
      expect(textOf(result.current.enhancedSource)).toBe('original');
      expect(result.current.isEnhancing).toBe(true);

      await vi.waitFor(() => {
        expect(textOf(result.current.enhancedSource)).toBe('enhanced-async');
      });
      expect(result.current.isEnhancing).toBe(false);
    });

    it('should apply sync enhancers immediately and continue with async ones', async () => {
      const source = makeHast('original');

      const syncEnhancer: SourceEnhancer = () => makeHast('sync-done');

      const asyncEnhancer: SourceEnhancer = async (root) => {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        return makeHast(`async-after-${textOf(root)}`);
      };
      const enhancers: SourceEnhancer[] = [syncEnhancer, asyncEnhancer];

      const { result } = renderHook(() =>
        useSourceEnhancing({
          source,
          fileName: 'test.tsx',
          comments: undefined,
          sourceEnhancers: enhancers,
        }),
      );

      // Immediately shows sync-enhanced result
      expect(textOf(result.current.enhancedSource)).toBe('sync-done');
      expect(result.current.isEnhancing).toBe(true);

      // Eventually resolves with async result
      await vi.waitFor(() => {
        expect(textOf(result.current.enhancedSource)).toBe('async-after-sync-done');
      });
      expect(result.current.isEnhancing).toBe(false);
    });

    it('should run sync enhancers after async ones without re-running the sync ones', async () => {
      const source = makeHast('original');
      const syncBefore = vi.fn<SourceEnhancer>(() => makeHast('sync-before'));
      const syncAfter = vi.fn<SourceEnhancer>((root) =>
        makeHast(`sync-after-${textOf(root)}`),
      );

      const asyncEnhancer: SourceEnhancer = async (root) => {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        return makeHast(`async-${textOf(root)}`);
      };

      const enhancers: SourceEnhancer[] = [syncBefore, asyncEnhancer, syncAfter];

      const { result } = renderHook(() =>
        useSourceEnhancing({
          source,
          fileName: 'test.tsx',
          comments: undefined,
          sourceEnhancers: enhancers,
        }),
      );

      // syncBefore runs during render, asyncEnhancer is pending
      expect(textOf(result.current.enhancedSource)).toBe('sync-before');
      expect(syncBefore).toHaveBeenCalledTimes(1);
      // syncAfter hasn't run yet — it's after the async one
      expect(syncAfter).not.toHaveBeenCalled();

      await vi.waitFor(() => {
        expect(textOf(result.current.enhancedSource)).toBe(
          'sync-after-async-sync-before',
        );
      });

      // syncBefore was NOT re-run for the async path
      expect(syncBefore).toHaveBeenCalledTimes(1);
      // syncAfter ran once in the async continuation
      expect(syncAfter).toHaveBeenCalledTimes(1);
    });

    it('should cancel pending async work when source changes', async () => {
      const sourceA = makeHast('A');
      const sourceB = makeHast('B');

      let resolveA: () => void;
      const asyncEnhancerA = vi.fn(
        async () =>
          new Promise<HastRoot>((resolve) => {
            resolveA = () => resolve(makeHast('async-A'));
          }),
      );

      const syncEnhancerB: SourceEnhancer = () => makeHast('sync-B');

      const { result, rerender } = renderHook(
        ({ source, enhancers }) =>
          useSourceEnhancing({
            source,
            fileName: 'test.tsx',
            comments: undefined,
            sourceEnhancers: enhancers,
          }),
        {
          initialProps: {
            source: sourceA as HastRoot,
            enhancers: [asyncEnhancerA] as SourceEnhancer[],
          },
        },
      );

      expect(result.current.isEnhancing).toBe(true);

      // Switch to a new source with a sync enhancer
      rerender({ source: sourceB, enhancers: [syncEnhancerB] });

      expect(textOf(result.current.enhancedSource)).toBe('sync-B');
      expect(result.current.isEnhancing).toBe(false);

      // Resolve the old async enhancer — should be cancelled
      await act(async () => {
        resolveA!();
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
      });

      // Should still show the new source, not the stale async result
      expect(textOf(result.current.enhancedSource)).toBe('sync-B');
    });
  });

  describe('hastJson and hastGzip sources', () => {
    it('should resolve hastJson sources before enhancing', () => {
      const hast = makeHast('from-json');
      const source = { hastJson: JSON.stringify(hast) };
      const enhancer = vi.fn((root: HastRoot) =>
        makeHast(`enhanced-${textOf(root)}`),
      );

      const { result } = renderHook(() =>
        useSourceEnhancing({
          source,
          fileName: 'test.tsx',
          comments: undefined,
          sourceEnhancers: [enhancer],
        }),
      );

      expect(textOf(result.current.enhancedSource)).toBe('enhanced-from-json');
      expect(result.current.isEnhancing).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle enhancers that mutate the root in-place', () => {
      const source = makeHast('original');
      const enhancer: SourceEnhancer = (root) => {
        (root.children[0] as { value: string }).value = 'mutated';
        return root;
      };

      const { result } = renderHook(() =>
        useSourceEnhancing({
          source,
          fileName: 'test.tsx',
          comments: undefined,
          sourceEnhancers: [enhancer],
        }),
      );

      expect(textOf(result.current.enhancedSource)).toBe('mutated');
    });

    it('should handle switching from enhancers to no enhancers', () => {
      const source = makeHast('original');
      const enhancer: SourceEnhancer = () => makeHast('enhanced');

      const { result, rerender } = renderHook(
        ({ enhancers }) =>
          useSourceEnhancing({
            source,
            fileName: 'test.tsx',
            comments: undefined,
            sourceEnhancers: enhancers,
          }),
        { initialProps: { enhancers: [enhancer] as SourceEnhancer[] | undefined } },
      );

      expect(textOf(result.current.enhancedSource)).toBe('enhanced');

      rerender({ enhancers: undefined });

      expect(result.current.enhancedSource).toBe(source);
      expect(result.current.isEnhancing).toBe(false);
    });

    it('should handle switching from no enhancers to enhancers', () => {
      const source = makeHast('original');
      const enhancer: SourceEnhancer = () => makeHast('enhanced');

      const { result, rerender } = renderHook(
        ({ enhancers }) =>
          useSourceEnhancing({
            source,
            fileName: 'test.tsx',
            comments: undefined,
            sourceEnhancers: enhancers,
          }),
        { initialProps: { enhancers: undefined as SourceEnhancer[] | undefined } },
      );

      expect(result.current.enhancedSource).toBe(source);

      rerender({ enhancers: [enhancer] });

      expect(textOf(result.current.enhancedSource)).toBe('enhanced');
      expect(result.current.isEnhancing).toBe(false);
    });

    it('should handle source changing to null', () => {
      const source = makeHast('original');
      const enhancer: SourceEnhancer = () => makeHast('enhanced');
      const enhancers: SourceEnhancer[] = [enhancer];

      const { result, rerender } = renderHook(
        ({ src }) =>
          useSourceEnhancing({
            source: src,
            fileName: 'test.tsx',
            comments: undefined,
            sourceEnhancers: enhancers,
          }),
        { initialProps: { src: source as HastRoot | null } },
      );

      expect(textOf(result.current.enhancedSource)).toBe('enhanced');

      rerender({ src: null });

      expect(result.current.enhancedSource).toBeNull();
      expect(result.current.isEnhancing).toBe(false);
    });
  });
});
