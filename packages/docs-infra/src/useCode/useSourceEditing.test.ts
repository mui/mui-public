/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Position } from './useEditable';
import { useSourceEditing, preloadSourceEditingEngine } from './useSourceEditing';
import { analyzeSource } from './SourceEditingEngine';
import type { Code, ControlledCode, VariantCode, SourceComments } from '../CodeHighlighter/types';
import type { CodeHighlighterContextType } from '../CodeHighlighter/CodeHighlighterContext';

// `setSource`'s edit-time runtime now loads from a separate chunk. Warm it once
// so the otherwise-synchronous `contextSetCode` assertions below run within the
// same tick (mirrors a page where a block has already become editable).
beforeAll(async () => {
  await preloadSourceEditingEngine();
});

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

  describe('reset', () => {
    it('returns undefined when context has no setCode', () => {
      const { result } = renderHook(() =>
        useSourceEditing({
          context: createContext({ setCode: undefined }),
          selectedVariantKey: 'Default',
          effectiveCode: {},
          selectedVariant: { fileName: 'App.tsx', source: 'code' },
        }),
      );

      expect(result.current.reset).toBeUndefined();
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

      expect(result.current.reset).toBeUndefined();
    });

    it('is available even when no variant is loaded yet', () => {
      // reset operates on the controller-level ControlledCode; it should
      // not require a resolved variant to be invokable.
      const { result } = renderHook(() =>
        useSourceEditing({
          context: createContext(),
          selectedVariantKey: 'Default',
          effectiveCode: { Default: 'https://example.com/demo' },
          selectedVariant: null,
        }),
      );

      expect(result.current.reset).toBeTypeOf('function');
    });

    it('clears the controlled code by calling setCode(undefined)', () => {
      const context = createContext();
      const { result } = renderHook(() =>
        useSourceEditing({
          context,
          selectedVariantKey: 'Default',
          effectiveCode: { Default: { fileName: 'App.tsx', source: 'original' } },
          selectedVariant: { fileName: 'App.tsx', source: 'original' },
        }),
      );

      act(() => result.current.reset!());

      const setCode = context.setCode as ReturnType<typeof vi.fn>;
      expect(setCode).toHaveBeenCalledTimes(1);
      expect(setCode).toHaveBeenCalledWith(undefined);
    });

    it('discards edits across every variant and file (controller-wide scope)', () => {
      // Verifies the documented scope: even though the hook is parameterized
      // by a single selectedVariantKey/fileName, reset wipes the entire
      // ControlledCode owned by the surrounding controller — including
      // edits to other variants and to extra files.
      const context = createContext();
      const { result } = renderHook(() =>
        useSourceEditing({
          context,
          selectedVariantKey: 'Default',
          effectiveCode: {
            Default: {
              fileName: 'App.tsx',
              source: 'main original',
              extraFiles: { 'helpers.ts': 'h original' },
            },
            Alt: { fileName: 'App.tsx', source: 'alt original' },
          },
          selectedVariant: { fileName: 'App.tsx', source: 'main original' },
        }),
      );

      act(() => result.current.reset!());

      const setCode = context.setCode as ReturnType<typeof vi.fn>;
      // setCode is called with the literal `undefined` (not an updater),
      // so the previous ControlledCode — whatever it contained for other
      // variants/files — is discarded wholesale.
      expect(setCode).toHaveBeenCalledWith(undefined);
    });

    it('returns a stable callback across re-renders', () => {
      const context = createContext();
      const { result, rerender } = renderHook(
        ({ source }: { source: string }) =>
          useSourceEditing({
            context,
            selectedVariantKey: 'Default',
            effectiveCode: { Default: { fileName: 'App.tsx', source } },
            selectedVariant: { fileName: 'App.tsx', source },
          }),
        { initialProps: { source: 'a' } },
      );

      const first = result.current.reset;
      rerender({ source: 'b' });
      expect(result.current.reset).toBe(first);
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

  describe('analyzeSource', () => {
    it('counts a source without a trailing newline', () => {
      expect(analyzeSource('a\nb\nc').totalLines).toBe(3);
    });

    it('ignores a single trailing newline so terminated and unterminated sources agree', () => {
      // The contentEditable always appends a trailing newline; the original
      // source may not. Both must report the same line count so the first edit
      // sees a 0 line delta (no phantom comment/emphasis shift).
      expect(analyzeSource('a\nb').totalLines).toBe(2);
      expect(analyzeSource('a\nb\n').totalLines).toBe(2);
    });

    it('counts interior blank lines but not the phantom trailing line', () => {
      expect(analyzeSource('a\n\nb\n')).toEqual({ totalLines: 3, emptyLines: [2] });
    });

    it('treats an empty source and a lone newline as a single empty line', () => {
      expect(analyzeSource('')).toEqual({ totalLines: 1, emptyLines: [1] });
      expect(analyzeSource('\n')).toEqual({ totalLines: 1, emptyLines: [1] });
    });

    it('only ignores ONE trailing newline (a blank last line still counts)', () => {
      // `a`, `b`, then a genuine blank line — the second trailing newline is the
      // terminator that gets ignored, leaving the blank line as line 3.
      expect(analyzeSource('a\nb\n\n')).toEqual({ totalLines: 3, emptyLines: [3] });
    });
  });

  describe('comment shifting', () => {
    it('does not shift comments when an edit only adds the contentEditable trailing newline', () => {
      // The live contentEditable always serializes its text WITH a trailing
      // newline, but the host source here has none. Typing a character adds no
      // line, yet the edited text gains that trailing newline. The shift delta
      // must read 0 (not +1) so the highlight comment stays put — otherwise the
      // first edit drifts every emphasis frame down a line.
      const comments: SourceComments = { 2: ['@highlight'] };
      const originalSource = 'line0\nline1\nline2'; // host source: no trailing newline
      const editedSource = 'line0X\nline1\nline2\n'; // char typed + CE trailing newline
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

      act(() => result.current.setSource!(editedSource, undefined, pos(0)));

      const controlled = captureControlledCode(context);
      // The highlight stays on line 2 — it must not drift to line 3.
      expect(controlled!.Default!.comments).toEqual({ 2: ['@highlight'] });
    });

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

    it('reduces (does not shift) the highlight when deleting an empty line at the start', () => {
      // Highlighted region: lines 7-9 where L7 is an empty/whitespace-only line.
      // User backspaces at the start of L7, merging it into L6.
      //   Old: L6='    <div>', L7='      ' (@hl-start), L8='      <Checkbox/>',
      //        L9='      <p/>' (@hl-end)
      //   New: L6='    <div>      ', L7='      <Checkbox/>', L8='      <p/>' (@hl-end)
      //
      // Since the deleted L7 had no real content that shifted into L6, the
      // user expects the highlight to "lose" that empty line and start on
      // the next line (now L7 = <Checkbox/>) — NOT shift the start marker
      // up onto the <div> line.
      const comments: SourceComments = {
        7: ['@highlight-start'],
        9: ['@highlight-end'],
      };
      const originalSource =
        "import * as React from 'react';\n\n\nfunction App() {\n  return (\n    <div>\n      \n      <Checkbox/>\n      <p/>\n    </div>\n  );\n}";
      const editedSource =
        "import * as React from 'react';\n\n\nfunction App() {\n  return (\n    <div>      \n      <Checkbox/>\n      <p/>\n    </div>\n  );\n}";

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

      // Cursor lands at end of merged line 6 (0-indexed line 5). lineDelta = -1.
      act(() => result.current.setSource!(editedSource, undefined, pos(5)));

      const variant = captureControlledCode(context)!.Default!;

      // @highlight-start should NOT collapse onto L6 (the <div> line).
      // Instead it should land on what is now L7 (the <Checkbox/> line),
      // shrinking the highlighted range from 3 lines to 2.
      expect(variant.comments![6]).toBeUndefined();
      expect(variant.comments![7]).toEqual(['@highlight-start']);
      // @highlight-end shifts from L9 to L8 (one line removed before it).
      expect(variant.comments![8]).toEqual(['@highlight-end']);
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
      // The boundary marker is also stashed at its true offset (flagged
      // `boundary`) so an undo can restore it exactly. A forward re-insert
      // ignores the stash and lets the visible copy expand the range.
      expect(variant.collapseMap![3]).toEqual([
        { offset: 1, comments: ['@highlight-end'], boundary: true },
      ]);

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
      // @regular tracked for restore; @highlight-end is also stashed but flagged
      // `boundary` so it only restores on an undo (a forward re-insert lets the
      // visible boundary copy expand the range — see the re-add assertions below).
      expect(variant.collapseMap![2]).toEqual([
        { offset: 2, comments: ['@regular'] },
        { offset: 3, comments: ['@highlight-end'], boundary: true },
      ]);

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

    it('restores the exact comment map on undo/redo of a line merge', () => {
      // A forward Delete at the end of line 2 merges line 3 up. Undo restores the
      // pre-merge caret (0-indexed line 1) — the SAME position the merge reported —
      // so without a direction signal a relative re-shift cannot tell undo-of-a-merge
      // from forward typing and would drift the highlighted range. The `history`
      // flag tells `shiftComments` to reverse the edit after the pre-edit caret.
      const comments: SourceComments = {
        2: ['@highlight-start'],
        4: ['@highlight-end'],
      };
      const originalSource = 'a\nb\nc\nd\ne';
      const mergedSource = 'a\nbc\nd\ne'; // line 3 merged up into line 2
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

      // Forward merge: caret stays at the join (0-indexed line 1), delta -1.
      act(() => result.current.setSource!(mergedSource, undefined, pos(1)));
      const merged = captureControlledCode(context);
      const mergedComments = merged!.Default!.comments;

      // Undo: restore the original source with a history-flagged position.
      act(() =>
        result.current.setSource!(originalSource, undefined, { ...pos(1), history: 'undo' }),
      );
      const undone = captureControlledCode(context, merged);
      expect(undone!.Default!.comments).toEqual(comments);

      // Redo: re-apply the merge (a deletion) relative to the post-merge caret.
      act(() => result.current.setSource!(mergedSource, undefined, { ...pos(1), history: 'redo' }));
      const redone = captureControlledCode(context, undone);
      expect(redone!.Default!.comments).toEqual(mergedComments);
    });

    it('removes a fully-selected range on delete and restores it on undo', () => {
      // Selecting both ends of a range (here lines 3-5) plus the lines around it
      // and deleting leaves nowhere to shift the markers to, so the frame is
      // removed entirely — but its ends are stashed in the collapseMap so undo
      // rebuilds the frame at its original offsets.
      const comments: SourceComments = {
        3: ['@highlight-start'],
        5: ['@highlight-end'],
      };
      const originalSource = 'a\nb\nc\nd\ne\nf\ng';
      // Delete lines 2-6 (padding b/f AND the whole range c/d/e). delta = -5.
      const editedSource = 'a\ng';
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

      // Delete: caret collapses to line 2 (0-indexed 1) — this is the pivot.
      act(() => result.current.setSource!(editedSource, undefined, pos(1)));
      const deleted = captureControlledCode(context);

      // The frame is gone (no markers remain visible)...
      expect(deleted!.Default!.comments).toEqual({});
      // ...but both ends are stashed so undo can reopen it.
      expect(deleted!.Default!.collapseMap).toBeDefined();

      // Undo: the restored caret lands on a DIFFERENT line than the deletion's
      // collapse point (as a select-all does — the caret was elsewhere when the
      // selection was made). `historyPivotLine` carries the forward edit's anchor
      // so the reversal still pivots on the collapse line and finds the stash.
      act(() =>
        result.current.setSource!(originalSource, undefined, {
          ...pos(3),
          history: 'undo',
          historyPivotLine: 1,
        }),
      );
      const undone = captureControlledCode(context, deleted);
      expect(undone!.Default!.comments).toEqual(comments);
    });

    it('removes the highlight when a selection from the blank line above deletes the whole region', () => {
      // Collapsible-editor scenario A: Shift+Down a selection from the blank line ABOVE the
      // region down to the blank line below, deleting the region as whole lines. The engine
      // reports the post-edit caret on the line that shifted up (0-indexed 2) with
      // deletedFromLineStart. Both markers are gone → no frame remains.
      const comments: SourceComments = {
        4: ['@highlight-start'],
        6: ['@highlight-end'],
      };
      // 1:a 2:b 3:(blank) 4:x 5:y 6:z 7:(blank) 8:c
      const originalSource = 'a\nb\n\nx\ny\nz\n\nc\n';
      const editedSource = 'a\nb\n\nc\n';
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

      act(() =>
        result.current.setSource!(editedSource, undefined, {
          ...pos(2),
          deletedFromLineStart: true,
        }),
      );
      const deleted = captureControlledCode(context);

      expect(deleted!.Default!.comments).toEqual({});
    });

    it('removes the highlight when the selection stops on the region’s exclusive -end line', () => {
      // Collapsible-editor scenario B (the still-broken case the user reported):
      // place the caret on the blank line ABOVE the region and Shift+Down until the
      // last newline of the highlighted region is selected, then delete. Unlike
      // scenario A, the selection stops at the START of the line that carries the
      // EXCLUSIVE @highlight-end (which sits one line BELOW the last highlighted
      // line), so that line survives the delete. Every actually-highlighted line is
      // gone, so the highlight must disappear — NOT collapse the orphaned
      // @highlight-start up onto a surviving line above as a phantom one-line
      // highlight (the bug: it landed on line 2, "b").
      const comments: SourceComments = {
        4: ['@highlight-start'],
        6: ['@highlight-end'],
      };
      // 1:a 2:b 3:(blank) 4:x 5:y 6:z 7:(blank) 8:c. start@4/end@6 highlights x,y (4,5);
      // z (line 6) carries the exclusive end and is NOT highlighted.
      const originalSource = 'a\nb\n\nx\ny\nz\n\nc\n';
      // Select (line 3 col 0) -> (line 6 col 0): delete the blank line 3 and the two
      // highlighted lines x,y. z survives and shifts up to line 3.
      const editedSource = 'a\nb\nz\n\nc\n';
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

      act(() =>
        result.current.setSource!(editedSource, undefined, {
          ...pos(2),
          deletedFromLineStart: true,
        }),
      );
      const deleted = captureControlledCode(context);

      // No phantom highlight: @highlight-start did NOT collapse onto a surviving
      // line above. It is stashed in the collapseMap so an undo can rebuild the
      // frame. The surviving @highlight-end shifts up to line 3 (old z) and is left
      // as a lone, dangling marker — which renders NO emphasis (a -end with no
      // preceding -start is ignored) and is the undo memory that lets the end
      // re-pair with the restored start. It must NOT be removed, or undo breaks.
      expect(deleted!.Default!.comments).toEqual({ 3: ['@highlight-end'] });
      expect(deleted!.Default!.collapseMap![2]).toEqual([
        { offset: 2, comments: ['@highlight-start'] },
      ]);

      // Undo re-adds the 3 lines: the start restores from the stash to line 4 and
      // the surviving end shifts back down to line 6, rebuilding the frame exactly.
      act(() =>
        result.current.setSource!(originalSource, undefined, {
          ...pos(2),
          history: 'undo',
          historyPivotLine: 2,
          deletedFromLineStart: true,
        }),
      );
      const undone = captureControlledCode(context, deleted);
      expect(undone!.Default!.comments).toEqual(comments);
    });

    it('collapses the highlight onto the emptied line when its inner content is deleted', () => {
      // Collapsible-editor scenario C: select all content WITHIN the region (line 4 col 0
      // through the END of line 6) and delete, collapsing the three region lines into one
      // empty line. Because the selection ends MID-line (not at a line boundary), the first
      // line survives emptied under the caret, so the engine reports deletedFromLineStart
      // FALSE. The region collapses to a single highlighted line 4: @highlight-start stays
      // on line 4 and the EXCLUSIVE @highlight-end lands on line 5 (one past it) — NOT one
      // line too high onto the blank padding above (which is the bug when the flag is true).
      const comments: SourceComments = {
        4: ['@highlight-start'],
        6: ['@highlight-end'],
      };
      // 1:a 2:b 3:(blank) 4:x 5:y 6:z 7:(blank) 8:c
      const originalSource = 'a\nb\n\nx\ny\nz\n\nc\n';
      // x/y/z collapse to one empty line 4; blank padding (3 and 7) survives → 3 blanks.
      const editedSource = 'a\nb\n\n\n\nc\n';
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

      act(() => result.current.setSource!(editedSource, undefined, pos(3)));
      const collapsed = captureControlledCode(context);

      // Range [4, 5) → line 4 highlighted, blank padding (3 and 5) not.
      expect(collapsed!.Default!.comments).toEqual({
        4: ['@highlight-start'],
        5: ['@highlight-end'],
      });
    });

    it('anchors the deletion one line up when the selection started at column 0', () => {
      // Selecting from the very start of the range's first line (column 0)
      // through its end deletes whole lines from that first line down, so the
      // post-delete caret lands on the line that shifted UP from below the
      // deletion — one line lower than the edit's true anchor. `deletedFromLineStart`
      // corrects for that so the deleted first line isn't treated as surviving
      // (which would strand `@highlight-start`) and the frame is removed cleanly.
      const comments: SourceComments = {
        2: ['@highlight-start'],
        4: ['@highlight-end'],
      };
      const originalSource = 'a\nb\nc\nd\ne';
      // Delete lines 2-4 (the whole range b/c/d) selecting b from column 0. The
      // caret collapses onto the line that was 'e' (now 0-indexed line 1).
      const editedSource = 'a\ne';
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

      act(() =>
        result.current.setSource!(editedSource, undefined, {
          ...pos(1),
          deletedFromLineStart: true,
        }),
      );
      const deleted = captureControlledCode(context);

      // The whole frame is gone — the start marker was NOT stranded on a
      // surviving line — and both ends are stashed for undo.
      expect(deleted!.Default!.comments).toEqual({});
      expect(deleted!.Default!.collapseMap).toBeDefined();

      // Undo carries the same column-0 flag so it anchors on the same line and
      // rebuilds the frame at its original offsets.
      act(() =>
        result.current.setSource!(originalSource, undefined, {
          ...pos(1),
          history: 'undo',
          historyPivotLine: 1,
          deletedFromLineStart: true,
        }),
      );
      const undone = captureControlledCode(context, deleted);
      expect(undone!.Default!.comments).toEqual(comments);
    });

    it('collapses comments onto the new first line when the deletion starts at line 1', () => {
      // Column-0 selection delete that reaches the VERY FIRST line: there is no
      // surviving line above, so the post-delete caret lands on the line that
      // shifted up from below (now 0-indexed line 0). The deleted first line's
      // comments must collapse onto the new line 1 (a valid 1-indexed key), NOT
      // a phantom line 0 — otherwise they are stranded and undo can't rebuild.
      const comments: SourceComments = {
        1: ['@a'],
        2: ['@b'],
        4: ['@d'],
      };
      const originalSource = 'a\nb\nc\nd';
      // Select lines 1-3 (a/b/c) from line 1 column 0 and delete → 'd'. delta -3.
      const editedSource = 'd';
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

      act(() =>
        result.current.setSource!(editedSource, undefined, {
          ...pos(0),
          deletedFromLineStart: true,
        }),
      );
      const deleted = captureControlledCode(context);
      const variant = deleted!.Default!;

      // @a and @b collapse onto the new line 1; @d (a survivor) shifts there too.
      expect(variant.comments![1]).toEqual(['@a', '@b', '@d']);
      // Nothing stranded on the invalid line 0.
      expect(variant.comments![0]).toBeUndefined();
      // The collapsed comments are tracked at their offsets from the new line 1.
      expect(variant.collapseMap![1]).toEqual([
        { offset: 0, comments: ['@a'] },
        { offset: 1, comments: ['@b'] },
      ]);

      // Undo: re-add the 3 lines. The caret is restored to line 0 and the
      // column-0 flag rides along, so the reversal anchors identically.
      act(() =>
        result.current.setSource!(originalSource, undefined, {
          ...pos(0),
          history: 'undo',
          historyPivotLine: 0,
          deletedFromLineStart: true,
        }),
      );
      const undone = captureControlledCode(context, deleted);

      // Comments fully restored to their original lines; @d back on line 4.
      expect(undone!.Default!.comments).toEqual(comments);
      expect(undone!.Default!.collapseMap).toBeUndefined();
    });

    it('collapses a single-line column-0 merge at the top of the file and reverses on undo', () => {
      // The single-line variant of the top-of-file case: a column-0 selection
      // that removes exactly the first line. The deleted line's comment collapses
      // onto the new line 1 and the survivor below shifts up onto it.
      const comments: SourceComments = {
        1: ['@a'],
        2: ['@b'],
      };
      const originalSource = 'a\nb\nc';
      // Select line 1 ('a\n') from column 0 and delete → 'b\nc'. delta -1.
      const editedSource = 'b\nc';
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

      act(() =>
        result.current.setSource!(editedSource, undefined, {
          ...pos(0),
          deletedFromLineStart: true,
        }),
      );
      const deleted = captureControlledCode(context);

      // @a collapses onto the new line 1; @b (old line 2) shifts up onto it.
      expect(deleted!.Default!.comments![1]).toEqual(['@a', '@b']);
      expect(deleted!.Default!.comments![0]).toBeUndefined();

      // Undo restores the original lines exactly.
      act(() =>
        result.current.setSource!(originalSource, undefined, {
          ...pos(0),
          history: 'undo',
          historyPivotLine: 0,
          deletedFromLineStart: true,
        }),
      );
      const undone = captureControlledCode(context, deleted);
      expect(undone!.Default!.comments).toEqual(comments);
      expect(undone!.Default!.collapseMap).toBeUndefined();
    });

    it('removes a fully-deleted range that starts at line 1 and rebuilds it on undo', () => {
      // The whole range sits at the top of the file and both its ends are deleted
      // by a column-0 selection. With no surviving line above, the frame's ends
      // must stash at offsets from the new line 1 so undo reopens it intact.
      const comments: SourceComments = {
        1: ['@highlight-start'],
        2: ['@highlight-end'],
      };
      const originalSource = 'a\nb\nc\nd';
      // Select lines 1-3 from column 0 and delete → 'd'. delta -3.
      const editedSource = 'd';
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

      act(() =>
        result.current.setSource!(editedSource, undefined, {
          ...pos(0),
          deletedFromLineStart: true,
        }),
      );
      const deleted = captureControlledCode(context);

      // The frame is gone (no markers stranded on line 0 or anywhere)...
      expect(deleted!.Default!.comments).toEqual({});
      // ...but both ends are stashed at the new line 1 — each at its own offset
      // from that anchor (old line 1 → 0, old line 2 → 1) — so undo reopens it.
      expect(deleted!.Default!.collapseMap![1]).toEqual([
        { offset: 0, comments: ['@highlight-start'] },
        { offset: 1, comments: ['@highlight-end'] },
      ]);

      act(() =>
        result.current.setSource!(originalSource, undefined, {
          ...pos(0),
          history: 'undo',
          historyPivotLine: 0,
          deletedFromLineStart: true,
        }),
      );
      const undone = captureControlledCode(context, deleted);
      expect(undone!.Default!.comments).toEqual(comments);
      expect(undone!.Default!.collapseMap).toBeUndefined();
    });

    it('leaves a column-0 delete in the MIDDLE of the file unchanged by the top-of-file handling', () => {
      // Regression guard: the top-of-file fix must not touch a column-0 delete
      // that has a surviving line above it. Here the surviving line above keeps
      // its comment AND receives the collapsed ones; survivors below shift up.
      const comments: SourceComments = {
        2: ['@above'],
        3: ['@c'],
        5: ['@e'],
      };
      const originalSource = 'a\nb\nc\nd\ne\nf';
      // Select lines 3-4 (c/d) from line 3 column 0 and delete → 'a\nb\ne\nf'. delta -2.
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

      // Caret collapses onto 0-indexed line 2; the column-0 flag drops the anchor
      // to surviving line 2 (1-indexed). delta -2.
      act(() =>
        result.current.setSource!(editedSource, undefined, {
          ...pos(2),
          deletedFromLineStart: true,
        }),
      );
      const deleted = captureControlledCode(context);
      const variant = deleted!.Default!;

      // @above stays on its surviving line and @c collapses onto it.
      expect(variant.comments![2]).toEqual(['@above', '@c']);
      // @e (old line 5) shifts up by 2 to line 3.
      expect(variant.comments![3]).toEqual(['@e']);

      // Undo restores everything exactly.
      act(() =>
        result.current.setSource!(originalSource, undefined, {
          ...pos(2),
          history: 'undo',
          historyPivotLine: 2,
          deletedFromLineStart: true,
        }),
      );
      const undone = captureControlledCode(context, deleted);
      expect(undone!.Default!.comments).toEqual(comments);
      expect(undone!.Default!.collapseMap).toBeUndefined();
    });

    it('restores a shrunk range exactly on undo when only the -end was deleted', () => {
      // A partial-range delete: the selection covers the range's `-end` but its
      // `-start` survives above the deletion. The live view SHRINKS — the `-end`
      // collapses to the boundary (editLine+1) — but an undo must rebuild the
      // range EXACTLY at its original lines, not one line short or long.
      const comments: SourceComments = {
        2: ['@highlight-start'],
        5: ['@highlight-end'],
      };
      const originalSource = 'a\nb\nc\nd\ne\nf';
      // Select from line 3 column 0 through line 5 and delete → 'a\nb\nf'.
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

      // Delete: caret collapses to 0-indexed line 2; the column-0 start drops the
      // anchor one line, so editLine = 2. delta = -3.
      act(() =>
        result.current.setSource!(editedSource, undefined, {
          ...pos(2),
          deletedFromLineStart: true,
        }),
      );
      const deleted = captureControlledCode(context);

      // Live view shrinks: -start stays on line 2, -end collapses to editLine+1.
      expect(deleted!.Default!.comments![2]).toEqual(['@highlight-start']);
      expect(deleted!.Default!.comments![3]).toEqual(['@highlight-end']);
      // The -end is stashed at its true offset, flagged boundary, for undo.
      expect(deleted!.Default!.collapseMap![2]).toEqual([
        { offset: 3, comments: ['@highlight-end'], boundary: true },
      ]);

      // Undo restores the range EXACTLY (5, not 6).
      act(() =>
        result.current.setSource!(originalSource, undefined, {
          ...pos(2),
          history: 'undo',
          historyPivotLine: 2,
          deletedFromLineStart: true,
        }),
      );
      const undone = captureControlledCode(context, deleted);
      expect(undone!.Default!.comments).toEqual(comments);
      expect(undone!.Default!.collapseMap).toBeUndefined();
    });

    it('expands a shrunk range on a forward re-insert (not an undo) of the -end', () => {
      // The mirror of the undo case: after the same partial delete, RE-INSERTING
      // lines forward (no history flag) must let the boundary -end expand the
      // range — the stashed boundary entry is ignored on a non-undo re-insert.
      const comments: SourceComments = {
        2: ['@highlight-start'],
        5: ['@highlight-end'],
      };
      const originalSource = 'a\nb\nc\nd\ne\nf';
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

      // Delete lines c, d, e (caret stays at 0-indexed line 1 → editLine 2).
      act(() => result.current.setSource!(editedSource, undefined, pos(1)));
      const deleted = captureControlledCode(context);

      // Forward re-insert 3 lines (caret 0-indexed line 4 → editLine 2, no
      // history). The boundary -end (now visible on line 3) shifts a full +3 to
      // expand the range; the stash is discarded.
      act(() => result.current.setSource!(originalSource, undefined, pos(4)));
      const expanded = captureControlledCode(context, deleted);

      expect(expanded!.Default!.comments![2]).toEqual(['@highlight-start']);
      expect(expanded!.Default!.comments![6]).toEqual(['@highlight-end']);
      expect(expanded!.Default!.collapseMap).toBeUndefined();
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

  describe('preParsed cache write', () => {
    function makeHast() {
      return {
        type: 'root' as const,
        children: [{ type: 'text' as const, value: 'parsed' }],
      };
    }

    it('writes preParsed HAST into context.preParsedCache keyed by the resolved file name', () => {
      const preParsedCache = new Map<string, { source: string; hast: any }>();
      const context = createContext({ preParsedCache });
      const hast = makeHast();

      const { result } = renderHook(() =>
        useSourceEditing({
          context,
          selectedVariantKey: 'Default',
          effectiveCode: { Default: { fileName: 'App.tsx', source: 'old' } },
          selectedVariant: { fileName: 'App.tsx', source: 'old' },
        }),
      );

      act(() => result.current.setSource!('new source', undefined, pos(0), hast));

      expect(preParsedCache.get('App.tsx')).toEqual({ source: 'new source', hast });
    });

    it('uses the explicit fileName argument when provided', () => {
      const preParsedCache = new Map<string, { source: string; hast: any }>();
      const context = createContext({ preParsedCache });
      const hast = makeHast();

      const { result } = renderHook(() =>
        useSourceEditing({
          context,
          selectedVariantKey: 'Default',
          effectiveCode: {
            Default: {
              fileName: 'App.tsx',
              source: 'main',
              extraFiles: { 'helper.ts': { source: 'h' } },
            },
          },
          selectedVariant: {
            fileName: 'App.tsx',
            source: 'main',
            extraFiles: { 'helper.ts': { source: 'h' } },
          },
        }),
      );

      act(() => result.current.setSource!('new helper', 'helper.ts', pos(0), hast));

      expect(preParsedCache.get('helper.ts')).toEqual({ source: 'new helper', hast });
      expect(preParsedCache.has('App.tsx')).toBe(false);
    });

    it('does not write when preParsed is omitted', () => {
      const preParsedCache = new Map<string, { source: string; hast: any }>();
      const context = createContext({ preParsedCache });

      const { result } = renderHook(() =>
        useSourceEditing({
          context,
          selectedVariantKey: 'Default',
          effectiveCode: { Default: { fileName: 'App.tsx', source: 'old' } },
          selectedVariant: { fileName: 'App.tsx', source: 'old' },
        }),
      );

      act(() => result.current.setSource!('new source', undefined, pos(0)));

      expect(preParsedCache.size).toBe(0);
    });

    it('does nothing when context has no preParsedCache', () => {
      const context = createContext();
      const hast = makeHast();

      const { result } = renderHook(() =>
        useSourceEditing({
          context,
          selectedVariantKey: 'Default',
          effectiveCode: { Default: { fileName: 'App.tsx', source: 'old' } },
          selectedVariant: { fileName: 'App.tsx', source: 'old' },
        }),
      );

      // Should not throw.
      expect(() =>
        act(() => result.current.setSource!('new', undefined, pos(0), hast)),
      ).not.toThrow();
    });
  });
});
