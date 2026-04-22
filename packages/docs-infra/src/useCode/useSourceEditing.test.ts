/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Position } from 'use-editable';
import { useSourceEditing } from './useSourceEditing';
import type { Code, ControlledCode, VariantCode, SourceComments } from '../CodeHighlighter/types';
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

function pos(line: number): Position {
  return { position: 0, extent: 0, content: '', line };
}

function posWithExtent(line: number, extent: number): Position {
  return { position: 0, extent, content: '', line };
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
      expect(variant.extraFiles!['styles.css']).toEqual({
        source: 'body { color: red; }',
        totalLines: 1,
      });
      expect(variant.extraFiles!['helpers.ts']).toEqual({
        source: 'export const h = 1;',
        totalLines: 1,
      });
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
      expect(variant.extraFiles!['styles.css']).toEqual({ source: 'new styles', totalLines: 1 });
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

      expect(variant.extraFiles!['styles.css']).toEqual({ source: 'new css', totalLines: 1 });
      expect(variant.extraFiles!['helpers.ts']).toEqual({
        source: 'helper content',
        totalLines: 1,
      });
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
      expect(variant.extraFiles!['styles.css']).toEqual({ source: 'edited', totalLines: 1 });
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
      expect(afterSecond!.Default!.extraFiles!['styles.css']).toEqual({
        source: 'new css',
        totalLines: 1,
      });
    });
  });

  describe('comment shifting', () => {
    it('shifts comments down when lines are added, and reverses on undo', () => {
      const comments: SourceComments = { 1: ['@highlight'], 4: ['@focus'] };
      const originalSource = 'line0\nline1\nline2\nline3';
      const editedSource = 'line0\nline1\n\nline2\nline3';
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: originalSource,
        comments,
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

      // Add a line after line 1 (0-indexed). Cursor ends on the new empty line (0-indexed line 2).
      act(() => result.current.setSource!(editedSource, undefined, pos(2)));

      const controlled = captureControlledCode(context);
      const variant = controlled!.Default!;

      expect(variant.comments![1]).toEqual(['@highlight']);
      expect(variant.comments![5]).toEqual(['@focus']);
      expect(variant.comments![4]).toBeUndefined();

      // Undo: remove the added line. Cursor at 0-indexed line 1, delta = -1.
      act(() => result.current.setSource!(originalSource, undefined, pos(1)));
      const undone = captureControlledCode(context, controlled);

      expect(undone!.Default!.comments).toEqual(comments);
    });

    it('shifts comments up when lines are removed, and reverses on undo', () => {
      const comments: SourceComments = { 1: ['@highlight'], 5: ['@focus'] };
      const originalSource = 'line0\nline1\nline2\nline3\nline4';
      const editedSource = 'line0\nline1line2\nline3\nline4';
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: originalSource,
        comments,
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

      // Delete line2 (merge into line1). Cursor at 0-indexed line 1, delta = -1.
      act(() => result.current.setSource!(editedSource, undefined, pos(1)));

      const controlled = captureControlledCode(context);
      const variant = controlled!.Default!;

      expect(variant.comments![1]).toEqual(['@highlight']);
      expect(variant.comments![4]).toEqual(['@focus']);
      expect(variant.comments![5]).toBeUndefined();

      // Undo: re-add the line. Cursor at 0-indexed line 2 (new line), delta = +1.
      act(() => result.current.setSource!(originalSource, undefined, pos(2)));
      const undone = captureControlledCode(context, controlled);

      expect(undone!.Default!.comments).toEqual(comments);
    });

    it('collapses comments from deleted range and restores on undo', () => {
      const comments: SourceComments = {
        1: ['@keep-before'],
        3: ['@deleted-1'],
        4: ['@deleted-2'],
        6: ['@keep-after'],
      };
      const originalSource = 'a\nb\nc\nd\ne\nf';
      const editedSource = 'a\nb\ne\nf';
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: originalSource,
        comments,
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

      // Delete lines c and d (0-indexed 2,3). Cursor at 0-indexed line 1, delta = -2.
      act(() => result.current.setSource!(editedSource, undefined, pos(1)));

      const controlled = captureControlledCode(context);
      const variant = controlled!.Default!;

      // Line 1 is before the edit — unchanged
      expect(variant.comments![1]).toEqual(['@keep-before']);
      // Lines 3 and 4 collapsed onto the edit line (line 2)
      expect(variant.comments![2]).toEqual(['@deleted-1', '@deleted-2']);
      // Line 6 shifted up by 2 to line 4
      expect(variant.comments![4]).toEqual(['@keep-after']);
      expect(variant.comments![6]).toBeUndefined();

      // Undo: re-add the 2 deleted lines. Cursor at 0-indexed line 3, delta = +2.
      act(() => result.current.setSource!(originalSource, undefined, pos(3)));
      const undone = captureControlledCode(context, controlled);

      // Comments fully restored to original positions
      expect(undone!.Default!.comments).toEqual(comments);
      // Collapse map cleared after full restore
      expect(undone!.Default!.collapseMap).toBeUndefined();
    });

    it('keeps highlight in place when undoing a multi-line selection delete', () => {
      // Simulates: user has highlight on lines 7-8, types text inside the
      // highlighted region (adding 2 lines AFTER line 8), selects the typed
      // text (extent > 0), backspaces to delete it, then presses Ctrl+Z.
      //
      // The undo replays the saved pre-deletion state, where `position`
      // points to the SELECTION-START (not the post-edit cursor). Without
      // accounting for `extent > 0`, shiftComments mistakenly thinks the
      // edit happened earlier in the file and shifts the highlighted lines
      // downward — so the user sees the highlight on the typed lines
      // instead of on its original location.
      const comments: SourceComments = {
        7: ['@highlight-start'],
        8: ['@highlight-end'],
      };
      const originalSource = 'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8\nL9\nL10\nL11';
      // Typed text adds 2 lines after L8: 'test', '<div>test</div>', 'test'
      // appended after L8's content.
      const typedSource = 'L1\nL2\nL3\nL4\nL5\nL6\nL7\nL8test\n<div>test</div>\ntest\nL9\nL10\nL11';

      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: originalSource,
        comments,
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

      // Step 1: type the text (single setSource for simplicity).
      // Cursor lands at end of last "test" → 0-indexed line 9.
      act(() => result.current.setSource!(typedSource, undefined, pos(9)));
      const afterType = captureControlledCode(context);
      // Highlight stays on lines 7 (L7) and 8 (L8test).
      expect(afterType!.Default!.comments).toEqual(comments);

      // Step 2: select the typed text and Backspace.
      // Cursor lands at start of selection (end of L8) → 0-indexed line 7.
      act(() => result.current.setSource!(originalSource, undefined, pos(7)));
      const afterDelete = captureControlledCode(context, afterType);
      expect(afterDelete!.Default!.comments).toEqual(comments);

      // Step 3: Ctrl+Z restores the pre-Backspace state. The saved position
      // is the SELECTION-START in the typed text — line 7 (0-indexed) with
      // extent = 25 (length of selected text).
      act(() => result.current.setSource!(typedSource, undefined, posWithExtent(7, 25)));
      const afterUndo = captureControlledCode(context, afterDelete);

      // Highlight must remain on lines 7 (L7) and 8 (L8test) — the same
      // logical lines as before the delete. Without the extent-aware fix,
      // they would incorrectly shift to lines 9 and 10 (the typed content).
      expect(afterUndo!.Default!.comments).toEqual(comments);
    });

    it('places -end comments at editLine+1 instead of editLine when collapsing', () => {
      // Simulates deleting whitespace before </div> in JSX, merging two lines.
      // @highlight-end should stay at the line AFTER the merged content, not
      // collapse onto editLine where it would shrink the highlighted range.
      const comments: SourceComments = {
        2: ['@highlight-start'],
        4: ['@highlight-end'],
      };
      const originalSource = 'a\nb\nc\nd\ne';
      // Delete line d (merge c+d into "cd"). delta = -1, cursor 0-indexed line 2.
      const editedSource = 'a\nb\ncd\ne';
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: originalSource,
        comments,
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

      act(() => result.current.setSource!(editedSource, undefined, pos(2)));

      const controlled = captureControlledCode(context);
      const variant = controlled!.Default!;

      // @highlight-start unchanged (before edit)
      expect(variant.comments![2]).toEqual(['@highlight-start']);
      // @highlight-end placed at editLine+1 (line 4), NOT editLine (line 3)
      // This preserves the range [2, 3] instead of shrinking to [2, 2]
      expect(variant.comments![4]).toEqual(['@highlight-end']);
      expect(variant.comments![3]).toBeUndefined();
      // Boundary comments are not tracked in collapseMap
      expect(variant.collapseMap).toBeUndefined();

      // Re-add a line: @highlight-end shifts normally from 4 to 5,
      // expanding the range to include the new line.
      act(() => result.current.setSource!(originalSource, undefined, pos(3)));
      const expanded = captureControlledCode(context, controlled);

      expect(expanded!.Default!.comments![2]).toEqual(['@highlight-start']);
      expect(expanded!.Default!.comments![5]).toEqual(['@highlight-end']);
    });

    it('separates regular and -end comments in the same deleted range', () => {
      const comments: SourceComments = {
        2: ['@highlight-start'],
        4: ['@regular'],
        5: ['@highlight-end'],
        6: ['@after'],
      };
      const originalSource = 'a\nb\nc\nd\ne\nf';
      // Delete lines c, d, e. delta = -3, cursor 0-indexed line 1.
      const editedSource = 'a\nb\nf';
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: originalSource,
        comments,
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

      act(() => result.current.setSource!(editedSource, undefined, pos(1)));

      const controlled = captureControlledCode(context);
      const variant = controlled!.Default!;

      // @regular collapses onto editLine (2), next to @highlight-start
      expect(variant.comments![2]).toEqual(['@highlight-start', '@regular']);
      // @highlight-end at editLine+1 = 3, @after shifts from 6 to 3
      expect(variant.comments![3]).toEqual(['@highlight-end', '@after']);
      // Only @regular tracked in collapseMap, not @highlight-end
      expect(variant.collapseMap![2]).toEqual([{ offset: 2, comments: ['@regular'] }]);

      // Re-add 3 lines: @regular restores from collapseMap to line 4,
      // but @highlight-end and @after shift normally from 3 to 6.
      act(() => result.current.setSource!(originalSource, undefined, pos(4)));
      const expanded = captureControlledCode(context, controlled);

      expect(expanded!.Default!.comments![2]).toEqual(['@highlight-start']);
      expect(expanded!.Default!.comments![4]).toEqual(['@regular']);
      // @highlight-end and @after both shift to line 6
      expect(expanded!.Default!.comments![6]).toEqual(['@highlight-end', '@after']);
    });

    it('does not shift comments when line count is unchanged', () => {
      const comments: SourceComments = { 1: ['@highlight'], 3: ['@focus'] };
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: 'aaa\nbbb\nccc',
        comments,
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

      // Edit text on line 1 without changing line count
      act(() => result.current.setSource!('aaa\nBBB\nccc', undefined, pos(1)));

      const controlled = captureControlledCode(context);

      expect(controlled!.Default!.comments).toEqual(comments);

      // Undo: revert to original text, still same line count
      act(() => result.current.setSource!('aaa\nbbb\nccc', undefined, pos(1)));
      const undone = captureControlledCode(context, controlled);

      expect(undone!.Default!.comments).toEqual(comments);
    });

    it('shifts extra file comments when editing, and reverses on undo', () => {
      const extraComments: SourceComments = { 2: ['@highlight'], 5: ['@focus'] };
      const originalExtra = 'a\nb\nc\nd\ne';
      const editedExtra = 'a\nNEW\nb\nc\nd\ne';
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: 'main',
        comments: { 1: ['@main-highlight'] },
        extraFiles: {
          'styles.css': { source: originalExtra, comments: extraComments },
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

      // Add a line in the extra file after line 0-indexed 0. Cursor at new line 1.
      act(() => result.current.setSource!(editedExtra, 'styles.css', pos(1)));

      const controlled = captureControlledCode(context);
      const variant = controlled!.Default!;

      // Main file comments untouched
      expect(variant.comments).toEqual({ 1: ['@main-highlight'] });
      // Extra file comments shifted down by 1
      const extraEntry = variant.extraFiles!['styles.css'];
      expect(extraEntry.comments![3]).toEqual(['@highlight']);
      expect(extraEntry.comments![6]).toEqual(['@focus']);
      expect(extraEntry.comments![2]).toBeUndefined();
      expect(extraEntry.comments![5]).toBeUndefined();

      // Undo: remove the added line. Cursor at 0-indexed line 0, delta = -1.
      act(() => result.current.setSource!(originalExtra, 'styles.css', pos(0)));
      const undone = captureControlledCode(context, controlled);

      expect(undone!.Default!.comments).toEqual({ 1: ['@main-highlight'] });
      expect(undone!.Default!.extraFiles!['styles.css'].comments).toEqual(extraComments);
    });

    it('partially restores collapsed comments when fewer lines are re-added', () => {
      const comments: SourceComments = {
        3: ['@c'],
        4: ['@d'],
        5: ['@e'],
      };
      const originalSource = 'a\nb\nc\nd\ne\nf';
      // Delete lines c, d, e → 3 lines removed
      const editedSource = 'a\nb\nf';
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: originalSource,
        comments,
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

      // Delete 3 lines (c, d, e). Cursor at 0-indexed line 1, delta = -3.
      act(() => result.current.setSource!(editedSource, undefined, pos(1)));

      const collapsed = captureControlledCode(context);
      const v1 = collapsed!.Default!;

      // All three collapsed onto edit line 2
      expect(v1.comments![2]).toEqual(['@c', '@d', '@e']);
      expect(v1.collapseMap).toBeDefined();

      // Partial undo: add back 1 line (only @c at offset 1 restores)
      const partialSource = 'a\nb\nNEW\nf';
      act(() => result.current.setSource!(partialSource, undefined, pos(2)));
      const partial = captureControlledCode(context, collapsed);
      const v2 = partial!.Default!;

      // @c restored to line 3 (editLine 2 + offset 1)
      expect(v2.comments![3]).toEqual(['@c']);
      // @d and @e remain collapsed on edit line 2
      expect(v2.comments![2]).toEqual(['@d', '@e']);
      // CollapseMap still has remaining entries
      expect(v2.collapseMap![2]).toEqual([
        { offset: 2, comments: ['@d'] },
        { offset: 3, comments: ['@e'] },
      ]);
    });

    it('correctly handles duplicate comment strings across collapsed entries', () => {
      // Two different lines with the same comment string
      const comments: SourceComments = {
        3: ['@highlight'],
        4: ['@highlight'],
      };
      const originalSource = 'a\nb\nc\nd';
      const editedSource = 'a\nb';
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: originalSource,
        comments,
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

      // Delete lines c and d. Cursor at 0-indexed line 1, delta = -2.
      act(() => result.current.setSource!(editedSource, undefined, pos(1)));

      const collapsed = captureControlledCode(context);
      const v1 = collapsed!.Default!;

      // Both @highlight collapsed onto edit line 2
      expect(v1.comments![2]).toEqual(['@highlight', '@highlight']);

      // Undo: add both lines back. Cursor at 0-indexed line 3, delta = +2.
      act(() => result.current.setSource!(originalSource, undefined, pos(3)));
      const undone = captureControlledCode(context, collapsed);
      const v2 = undone!.Default!;

      // Both @highlight restored to their original lines
      expect(v2.comments).toEqual(comments);
      // Edit line 2 should have no leftover comments
      expect(v2.comments![2]).toBeUndefined();
      expect(v2.collapseMap).toBeUndefined();
    });

    it('preserves pre-existing edit-line comments through collapse and restore', () => {
      const comments: SourceComments = {
        2: ['@existing'],
        3: ['@collapsed-1'],
        4: ['@collapsed-2'],
      };
      const originalSource = 'a\nb\nc\nd';
      const editedSource = 'a\nb';
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: originalSource,
        comments,
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

      // Delete lines c and d. Cursor at 0-indexed line 1, delta = -2.
      act(() => result.current.setSource!(editedSource, undefined, pos(1)));

      const collapsed = captureControlledCode(context);
      const v1 = collapsed!.Default!;

      // Edit line 2 keeps @existing and gains collapsed comments
      expect(v1.comments![2]).toEqual(['@existing', '@collapsed-1', '@collapsed-2']);

      // Undo: add both lines back. Cursor at 0-indexed line 3, delta = +2.
      act(() => result.current.setSource!(originalSource, undefined, pos(3)));
      const undone = captureControlledCode(context, collapsed);

      // Fully restored: @existing stays on line 2, collapsed comments back to original lines
      expect(undone!.Default!.comments).toEqual(comments);
      expect(undone!.Default!.collapseMap).toBeUndefined();
    });

    it('restores original comments after multiple edits at different positions are undone', () => {
      const comments: SourceComments = {
        1: ['@a'],
        3: ['@c'],
        5: ['@e'],
      };
      const originalSource = 'a\nb\nc\nd\ne\nf';
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: originalSource,
        comments,
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

      // Edit 1: delete line c. Source: a\nb\nd\ne\nf (5 lines). Cursor at 0-indexed line 1.
      const afterDel1 = 'a\nb\nd\ne\nf';
      act(() => result.current.setSource!(afterDel1, undefined, pos(1)));
      const state1 = captureControlledCode(context);

      expect(state1!.Default!.comments![1]).toEqual(['@a']);
      expect(state1!.Default!.comments![2]).toEqual(['@c']); // collapsed onto editLine 2
      expect(state1!.Default!.comments![4]).toEqual(['@e']); // shifted from 5 to 4

      // Edit 2: delete line e (now at 0-indexed line 3). Source: a\nb\nd\nf (4 lines). Cursor at 0-indexed line 2.
      const afterDel2 = 'a\nb\nd\nf';
      act(() => result.current.setSource!(afterDel2, undefined, pos(2)));
      const state2 = captureControlledCode(context, state1);

      expect(state2!.Default!.comments![1]).toEqual(['@a']);
      expect(state2!.Default!.comments![2]).toEqual(['@c']);
      expect(state2!.Default!.comments![3]).toEqual(['@e']); // collapsed onto editLine 3

      // Undo edit 2: add line e back. Source: a\nb\nd\ne\nf (5 lines). Cursor at 0-indexed line 3.
      act(() => result.current.setSource!(afterDel1, undefined, pos(3)));
      const state3 = captureControlledCode(context, state2);

      expect(state3!.Default!.comments![1]).toEqual(['@a']);
      expect(state3!.Default!.comments![2]).toEqual(['@c']);
      expect(state3!.Default!.comments![4]).toEqual(['@e']); // restored to line 4

      // Undo edit 1: add line c back. Source: original (6 lines). Cursor at 0-indexed line 2.
      act(() => result.current.setSource!(originalSource, undefined, pos(2)));
      const state4 = captureControlledCode(context, state3);

      // Fully restored to original comments
      expect(state4!.Default!.comments).toEqual(comments);
      expect(state4!.Default!.collapseMap).toBeUndefined();
    });

    it('preserves comments through toControlledCode normalization', () => {
      const comments: SourceComments = { 1: ['@highlight'], 3: ['@focus'] };
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: 'line1\nline2\nline3',
        comments,
        extraFiles: {
          'helper.ts': { source: 'code', comments: { 2: ['@extra'] } },
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

      // First edit triggers toControlledCode normalization (no position = comments cleared)
      act(() => result.current.setSource!('edited'));

      const controlled = captureControlledCode(context);
      const variant = controlled!.Default!;

      // Main comments cleared (no position data, can't track shifts)
      expect(variant.comments).toBeUndefined();
      // Extra file comments preserved (not edited)
      expect(variant.extraFiles!['helper.ts'].comments).toEqual({ 2: ['@extra'] });
    });

    it('clears comments when setSource is called without position', () => {
      const comments: SourceComments = { 1: ['@highlight'], 3: ['@focus'] };
      const selectedVariant: VariantCode = {
        fileName: 'App.tsx',
        source: 'line1\nline2\nline3',
        comments,
        extraFiles: {
          'helper.ts': { source: 'code', comments: { 2: ['@extra'] } },
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

      // Edit main file without position
      act(() => result.current.setSource!('new main'));

      const controlled = captureControlledCode(context);
      const variant = controlled!.Default!;

      expect(variant.comments).toBeUndefined();
      expect(variant.collapseMap).toBeUndefined();
      // Extra file untouched
      expect(variant.extraFiles!['helper.ts'].comments).toEqual({ 2: ['@extra'] });

      // Edit extra file without position
      act(() => result.current.setSource!('new helper', 'helper.ts'));
      const afterExtra = captureControlledCode(context, controlled);

      expect(afterExtra!.Default!.extraFiles!['helper.ts'].comments).toBeUndefined();
    });
  });
});
