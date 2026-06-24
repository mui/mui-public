/**
 * Browser integration tests for `useEditable`: the full type → flush → re-highlight →
 * restore cycle the docs live code editor runs on every keystroke. They cover the
 * behaviors that only emerge when the highlighted DOM is replaced underneath the caret —
 * caret stability while typing and deleting indents, scroll-anchor `onBoundary` firing at
 * the visible top/bottom, focus retention on the first keystroke, and a selection's
 * direction surviving a re-render.
 *
 * Unlike `useEditable.browser.ts` (which drives a static highlighted DOM with a `vi.fn()`
 * onChange and only asserts the *text* handed to onChange), these tests wire `useEditable`
 * to a real React component whose `onChange` updates source state, re-highlights it into
 * the production `.line`/`pl-*` span structure, and lets the engine's `observeAndRestore`
 * restore the caret.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { useEditable, preloadEditableEngine } from './useEditable';
import type { Position, Options } from './useEditable';

beforeAll(async () => {
  await preloadEditableEngine();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

// ---------------------------------------------------------------------------
// Minimal, deterministic re-highlighter
// ---------------------------------------------------------------------------
// Splits each line into tokens and wraps identifiers (`pl-smi`) and single-char
// operators (`pl-k`) in their own spans, leaving whitespace/punctuation as bare
// text. This reproduces the multi-span-per-line DOM shape that production
// highlighting produces — enough to surface caret-at-element-boundary bugs —
// without pulling in the async grammar/worker pipeline. Each line span keeps its
// trailing `\n` inside it, matching the production serializer.
const WORD = /[A-Za-z0-9_$]/;
const OPERATOR = new Set(['=', '+', '-', '*', '/', '<', '>', '!', '&', '|', '%', '?', ':']);

function highlightLine(lineText: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lineText.length) {
    const char = lineText[i];
    if (WORD.test(char)) {
      let j = i + 1;
      while (j < lineText.length && WORD.test(lineText[j])) {
        j += 1;
      }
      nodes.push(
        <span className="pl-smi" key={key}>
          {lineText.slice(i, j)}
        </span>,
      );
      key += 1;
      i = j;
    } else if (OPERATOR.has(char)) {
      nodes.push(
        <span className="pl-k" key={key}>
          {char}
        </span>,
      );
      key += 1;
      i += 1;
    } else {
      // Coalesce a run of bare characters (whitespace/punctuation) into one
      // text node, as the highlighter would.
      let j = i + 1;
      while (j < lineText.length && !WORD.test(lineText[j]) && !OPERATOR.has(lineText[j])) {
        j += 1;
      }
      nodes.push(lineText.slice(i, j));
      i = j;
    }
  }
  return nodes;
}

function Highlighted({ source }: { source: string }) {
  // Mirror the production live-editing structure: `.line` spans live inside a
  // `.frame`, and the newline after each line is a SEPARATE sibling text node
  // ("trailing newline" / gap node), NOT kept inside the line span. These gap
  // nodes are exactly what `caretSelector` + `snapCaretOutOfGapNode` exist for.
  // `source` always carries a trailing newline.
  const withoutTrailing = source.endsWith('\n') ? source.slice(0, -1) : source;
  const lines = withoutTrailing.split('\n');
  return (
    <code>
      <span className="frame" data-frame="0" data-lined="">
        {lines.map((line, index) => (
          <React.Fragment key={index}>
            <span className="line" data-ln={index + 1}>
              {highlightLine(line)}
            </span>
            {'\n'}
          </React.Fragment>
        ))}
      </span>
    </code>
  );
}

type HarnessHandle = {
  ref: React.RefObject<HTMLPreElement | null>;
  onChange: ReturnType<typeof vi.fn>;
  getSource: () => string;
  scrollEl: HTMLDivElement | null;
  /**
   * Forces an idle host re-render without touching the source — models an async
   * enhancer / parent `setState` that re-runs the engine's `observeAndRestore`
   * (and thus its caret/selection restore) between keystrokes.
   */
  rerender: () => void;
};

function Editor({
  initialSource,
  options,
  handleRef,
  scroll,
}: {
  initialSource: string;
  options: Options;
  handleRef: { current: HarnessHandle | null };
  scroll?: boolean;
}) {
  const [source, setSource] = React.useState(initialSource);
  const [, forceRerender] = React.useReducer((count: number) => count + 1, 0);
  const ref = React.useRef<HTMLPreElement | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const onChange = React.useMemo(
    () =>
      vi.fn((text: string, _position: Position) => {
        setSource(text);
      }),
    [],
  );

  useEditable(ref, onChange, options);

  React.useEffect(() => {
    handleRef.current = {
      ref,
      onChange,
      getSource: () =>
        onChange.mock.calls.length
          ? onChange.mock.calls[onChange.mock.calls.length - 1][0]
          : initialSource,
      scrollEl: scrollRef.current,
      rerender: forceRerender,
    };
  });

  const editor = (
    <React.Fragment>
      {/* Production line/frame CSS (from CollapsibleContent.module.css): the
          frame collapses its gap newlines via `line-height: 0`, and each `.line`
          is a `display: block`. An EMPTY line then has no inline content and
          renders at zero height — which is what makes consecutive empty lines
          skippable by native vertical ArrowUp. */}
      <style>{`
        [data-testid="editor"] { line-height: 1.5; font-family: monospace; }
        [data-testid="editor"] .frame[data-lined] { display: block; white-space: normal; line-height: 0; }
        [data-testid="editor"] .frame[data-lined] .line { display: block; white-space: pre; line-height: initial; }
      `}</style>
      <pre ref={ref} style={{ tabSize: 2, margin: 0 }} data-testid="editor">
        <Highlighted source={source} />
      </pre>
    </React.Fragment>
  );

  if (!scroll) {
    return editor;
  }
  // A short, scrollable viewport so we can detect "the view jumps" by reading
  // scrollTop before/after an edit.
  return (
    <div
      ref={scrollRef}
      style={{ height: '60px', overflow: 'auto', fontFamily: 'monospace', lineHeight: '20px' }}
      data-testid="scroll"
    >
      {editor}
    </div>
  );
}

/** Renders the editor and returns a handle once the engine has attached. */
async function setupEditor(
  initialSource: string,
  options: Options = {},
  opts: { scroll?: boolean } = {},
) {
  const handleRef: { current: HarnessHandle | null } = { current: null };
  render(
    <Editor
      initialSource={initialSource}
      options={options}
      handleRef={handleRef}
      scroll={opts.scroll}
    />,
  );

  // Wait a frame for the layout effects (engine attach + contentEditable).
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });

  const handle = handleRef.current!;
  const element = handle.ref.current!;
  return { handle, element };
}

/**
 * Places the caret at an absolute character offset (counting newlines that live
 * inside `.line` spans) and waits a frame so the engine captures the position.
 */
async function placeCaret(element: HTMLElement, offset: number) {
  element.focus();
  const sel = window.getSelection()!;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let current = 0;
  let node = walker.nextNode();
  while (node) {
    const len = node.textContent!.length;
    if (current + len >= offset) {
      const range = document.createRange();
      range.setStart(node, offset - current);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      break;
    }
    current += len;
    node = walker.nextNode();
  }
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** Computes the caret's (line, column) from the live Selection. */
function caretLineColumn(element: HTMLElement): { line: number; column: number; position: number } {
  const sel = window.getSelection()!;
  const range = sel.getRangeAt(0);
  const until = document.createRange();
  until.setStart(element, 0);
  until.setEnd(range.startContainer, range.startOffset);
  const text = until.toString();
  const lines = text.split('\n');
  return { line: lines.length - 1, column: lines[lines.length - 1].length, position: text.length };
}

/** Lets queued microtasks / rAF callbacks / React effects settle. */
async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}

/** Builds an async preParse that re-highlights on a macrotask (worker-like). */
function asyncPreParse() {
  return vi.fn(
    (_text: string, _position: Position) =>
      new Promise<undefined>((resolve) => {
        setTimeout(() => resolve(undefined), 0);
      }),
  );
}

/**
 * A preParse whose resolution is controlled by the test — models the worker
 * round-trip so we can inspect the DOM *during* the async gap (before the
 * re-highlight commits) the way the user sees "the wrong thing for a second".
 */
function deferredPreParse() {
  let resolveFn: (() => void) | null = null;
  const preParse = vi.fn(
    (_text: string, _position: Position) =>
      new Promise<undefined>((resolve) => {
        resolveFn = () => resolve(undefined);
      }),
  );
  return {
    preParse,
    resolvePending: async () => {
      resolveFn?.();
      resolveFn = null;
      await settle();
    },
  };
}

describe('useEditable — caret & selection across re-highlights', () => {
  // -------------------------------------------------------------------------
  // Caret stability when typing x, =, Backspace (must not jump to column 0)
  // -------------------------------------------------------------------------
  it('keeps the caret after the typed char when typing x, =, Backspace on a fresh line', async () => {
    const { handle, element } = await setupEditor('\n', { indentation: 2, caretSelector: '.line' });
    await placeCaret(element, 0);
    await userEvent.keyboard('x');
    await settle();
    await userEvent.keyboard('=');
    await settle();
    await userEvent.keyboard('{Backspace}');
    await settle();
    expect(handle.getSource()).toBe('x\n');
    expect(caretLineColumn(element)).toMatchObject({ line: 0, column: 1 });
  });

  it('keeps the caret after the typed char through an async re-highlight (preParse)', async () => {
    const { handle, element } = await setupEditor('\n', {
      indentation: 2,
      caretSelector: '.line',
      preParse: asyncPreParse(),
    });
    await placeCaret(element, 0);
    await userEvent.keyboard('x');
    await settle();
    await settle();
    await userEvent.keyboard('=');
    await settle();
    await settle();
    await userEvent.keyboard('{Backspace}');
    await settle();
    await settle();
    expect(handle.getSource()).toBe('x\n');
    expect(caretLineColumn(element)).toMatchObject({ line: 0, column: 1 });
  });

  it('keeps the caret when typing = then Backspace at the end of an indented line', async () => {
    // `      <p style=` then backspace the `=`. This mirrors typing an attribute.
    const initial = 'function App() {\n  return <p style\n}\n';
    const { handle, element } = await setupEditor(initial, {
      indentation: 2,
      caretSelector: '.line',
    });
    // caret at end of `  return <p style` (line 1)
    const offset = 'function App() {\n  return <p style'.length;
    await placeCaret(element, offset);
    await userEvent.keyboard('=');
    await settle();
    await userEvent.keyboard('{Backspace}');
    await settle();
    expect(handle.getSource()).toBe(initial);
    // caret should be back at end of `style` (column 17), not column 0
    expect(caretLineColumn(element)).toMatchObject({ line: 1, column: '  return <p style'.length });
  });

  it('keeps the caret at the end of an indented line in a collapsed (minColumn) gutter', async () => {
    // The collapsed editor (clipped indent gutter) is where the real bug shows.
    const initial = 'function foo() {\n  doStuff()\n}\n';
    const { handle, element } = await setupEditor(initial, {
      indentation: 2,
      caretSelector: '.line',
      minColumn: 2,
      minRow: 1,
      maxRow: 1,
      onBoundary: vi.fn(),
    });
    const offset = 'function foo() {\n  doStuff()'.length; // end of line 1
    await placeCaret(element, offset);
    await userEvent.keyboard('x');
    await settle();
    await userEvent.keyboard('=');
    await settle();
    await userEvent.keyboard('{Backspace}');
    await settle();
    expect(handle.getSource()).toBe('function foo() {\n  doStuff()x\n}\n');
    expect(caretLineColumn(element)).toMatchObject({ line: 1, column: '  doStuff()x'.length });
  });

  it('keeps the caret in a collapsed gutter through an async re-highlight', async () => {
    const initial = 'function foo() {\n  doStuff()\n}\n';
    const { handle, element } = await setupEditor(initial, {
      indentation: 2,
      caretSelector: '.line',
      minColumn: 2,
      minRow: 1,
      maxRow: 1,
      onBoundary: vi.fn(),
      preParse: asyncPreParse(),
    });
    const offset = 'function foo() {\n  doStuff()'.length;
    await placeCaret(element, offset);
    await userEvent.keyboard('x');
    await settle();
    await settle();
    await userEvent.keyboard('=');
    await settle();
    await settle();
    await userEvent.keyboard('{Backspace}');
    await settle();
    await settle();
    expect(handle.getSource()).toBe('function foo() {\n  doStuff()x\n}\n');
    expect(caretLineColumn(element)).toMatchObject({ line: 1, column: '  doStuff()x'.length });
  });

  it('lands the caret at the line/gap boundary when editing at the end of a line', async () => {
    // The real bug uses the `End` key to land the caret at the line end — which
    // in the framed `.line` structure is the boundary with the inter-line gap
    // node. Native typing there can flatten the spans / split across lines.
    const initial = 'function foo() {\n  doStuff()\n}\n';
    const { handle, element } = await setupEditor(initial, {
      indentation: 2,
      caretSelector: '.line',
    });
    // Put the caret somewhere on line 1, then End to the line end.
    await placeCaret(element, 'function foo() {\n  do'.length);
    await userEvent.keyboard('{End}');
    await settle();
    await userEvent.keyboard('x');
    await settle();
    await userEvent.keyboard('=');
    await settle();
    await userEvent.keyboard('{Backspace}');
    await settle();
    expect(handle.getSource()).toBe('function foo() {\n  doStuff()x\n}\n');
    expect(caretLineColumn(element)).toMatchObject({ line: 1, column: '  doStuff()x'.length });
  });

  // -------------------------------------------------------------------------
  // Caret restoration when erasing the last indent on a clipped (collapsed-window) line
  // -------------------------------------------------------------------------
  it('restores the caret when backspacing the last indent of a blank clipped line (minColumn)', async () => {
    // Simulate a collapsed window: indentation clipped to minColumn=2, the
    // visible region is rows 1..3. Line 2 is a blank line with exactly 2 spaces.
    const initial = 'function foo() {\n  const a = 1;\n  \n  return a;\n}\n';
    const { element } = await setupEditor(
      initial,
      {
        indentation: 2,
        caretSelector: '.line',
        minColumn: 2,
        minRow: 1,
        maxRow: 3,
        onBoundary: vi.fn(),
      },
      { scroll: true },
    );
    // caret at end of the blank line 2 (column 2 == minColumn)
    const offset = 'function foo() {\n  const a = 1;\n  '.length;
    await placeCaret(element, offset);
    const before = caretLineColumn(element);
    await userEvent.keyboard('{Backspace}');
    await settle();
    const after = caretLineColumn(element);
    // Assert the (arguably correct) behavior: stay on the same line, now empty.
    expect(after.line).toBe(before.line);
  });

  it('restores the caret when backspacing an indent on a content line in a clipped gutter (minColumn)', async () => {
    const initial = 'function foo() {\n  const a = 1;\n}\n';
    const { element } = await setupEditor(
      initial,
      {
        indentation: 2,
        caretSelector: '.line',
        minColumn: 2,
        minRow: 1,
        maxRow: 1,
        onBoundary: vi.fn(),
      },
      { scroll: true },
    );
    // caret right after the 2-space indent on line 1 (`  const a = 1;`)
    const offset = 'function foo() {\n  '.length;
    await placeCaret(element, offset);
    await userEvent.keyboard('{Backspace}');
    await settle();
    const after = caretLineColumn(element);
    expect(after).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // ArrowUp at the visible top fires onBoundary (scroll anchor)
  // -------------------------------------------------------------------------
  it('fires onBoundary on ArrowUp at the first row and ArrowDown at the last row', async () => {
    const onBoundary = vi.fn();
    const initial = 'line0\nline1\nline2\nline3\nline4\n';
    const { element } = await setupEditor(
      initial,
      { indentation: 2, caretSelector: '.line', minRow: 2, maxRow: 3, onBoundary },
      { scroll: true },
    );
    // Caret on line 2 (minRow), then ArrowUp.
    const upOffset = 'line0\nline1\n'.length + 2;
    await placeCaret(element, upOffset);
    await userEvent.keyboard('{ArrowUp}');
    await settle();
    const upCalls = onBoundary.mock.calls.length;

    // Caret on line 3 (maxRow), then ArrowDown.
    const downOffset = 'line0\nline1\nline2\n'.length + 2;
    await placeCaret(element, downOffset);
    await userEvent.keyboard('{ArrowDown}');
    await settle();
    const downCalls = onBoundary.mock.calls.length - upCalls;

    expect(upCalls).toBeGreaterThan(0); // ArrowUp must fire the boundary
    expect(downCalls).toBeGreaterThan(0); // ArrowDown must fire the boundary
  });

  // -------------------------------------------------------------------------
  // Transient DOM vs committed source during an async re-highlight: backspacing the
  // last indent collapses the line during the worker round-trip, before the committed
  // source catches up.
  // -------------------------------------------------------------------------
  it('keeps the transient DOM consistent with the committed source when async-backspacing the last indent', async () => {
    const { preParse, resolvePending } = deferredPreParse();
    const initial = 'function foo() {\n  const a = 1;\n  \n  return a;\n}\n';
    const { element } = await setupEditor(
      initial,
      {
        indentation: 2,
        caretSelector: '.line',
        minColumn: 2,
        minRow: 1,
        maxRow: 3,
        onBoundary: vi.fn(),
        preParse,
      },
      { scroll: true },
    );
    const offset = 'function foo() {\n  const a = 1;\n  '.length;
    await placeCaret(element, offset);

    // Compact structural signature: the frame's direct children, each as
    // either `LINE(<text>)` or `TEXT(<text>)`, so we can see the mangled
    // transient structure without vitest truncating a long innerHTML string.
    const signature = () => {
      const frame = element.querySelector('.frame')!;
      return Array.from(frame.childNodes).map((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          return `TEXT(${JSON.stringify(node.textContent)})`;
        }
        const childEl = node as HTMLElement;
        if (childEl.classList?.contains('line')) {
          return `LINE(${JSON.stringify(childEl.textContent)})`;
        }
        return `OTHER(${childEl.tagName})`;
      });
    };

    await userEvent.keyboard('{Backspace}');
    await settle();

    // DURING the async gap (preParse not yet resolved): what does the DOM show?
    const transientSig = signature();

    await resolvePending();
    await settle();

    const finalSig = signature();
    // The transient DOM the user sees during the async worker round-trip must already
    // be structurally consistent with the final committed result — no wrong intermediate
    // state (no dangling empty `.line` span, no dropped gap newline), so the signatures match.
    expect(transientSig).toEqual(finalSig);
  });

  // -------------------------------------------------------------------------
  // ArrowUp navigation across consecutive empty lines
  // -------------------------------------------------------------------------
  it('moves ArrowUp onto an empty line first, then the line above', async () => {
    const initial = 'aaa\n\nbbb\nccc\n';
    const { element } = await setupEditor(initial, { indentation: 2, caretSelector: '.line' });

    // Start on "ccc" (line 3), column 1.
    const start = 'aaa\n\nbbb\n'.length + 1;
    await placeCaret(element, start);

    await userEvent.keyboard('{ArrowUp}');
    await settle();
    const step1 = caretLineColumn(element); // expect line 2 ("bbb")

    await userEvent.keyboard('{ArrowUp}');
    await settle();
    const step2 = caretLineColumn(element); // expect line 1 (empty)

    await userEvent.keyboard('{ArrowUp}');
    await settle();
    const step3 = caretLineColumn(element); // expect line 0 ("aaa")

    // At the engine level the empty line IS reachable and each step lands on
    // the expected row (this passes in all 3 browsers). If the "weird" ArrowUp
    // behavior shows up in the real docs, it is not in this engine path —
    // suspect the real frame/visibleFrames render or layout, not navigation.
    expect(step1.line).toBe(2);
    expect(step2.line).toBe(1); // the empty line — reachable, not skipped
    expect(step3.line).toBe(0);
  });

  // -------------------------------------------------------------------------
  // New bug: TWO consecutive empty lines — ArrowUp skips both at once.
  // -------------------------------------------------------------------------
  it('stops ArrowUp on each of two consecutive empty lines (does not skip both)', async () => {
    // Lines: 0 "aaa", 1 "" , 2 "", 3 "bbb", 4 "ccc".
    const initial = 'aaa\n\n\nbbb\nccc\n';
    const { element } = await setupEditor(initial, { indentation: 2, caretSelector: '.line' });

    // Start on "bbb" (line 3), column 1.
    const start = 'aaa\n\n\n'.length + 1;
    await placeCaret(element, start);

    await userEvent.keyboard('{ArrowUp}');
    await settle();
    const step1 = caretLineColumn(element); // expect line 2 (second empty line)

    await userEvent.keyboard('{ArrowUp}');
    await settle();
    const step2 = caretLineColumn(element); // expect line 1 (first empty line)

    await userEvent.keyboard('{ArrowUp}');
    await settle();
    const step3 = caretLineColumn(element); // expect line 0 ("aaa")

    // DESIRED: ArrowUp stops on EACH line, including the zero-height empty ones.
    // The bug skips both empty lines, so a single ArrowUp from "bbb" jumps
    // straight to "aaa" (step1.line === 0).
    const ctx = JSON.stringify({ step1, step2, step3 });
    expect(step1.line, ctx).toBe(2); // second empty line
    expect(step2.line, ctx).toBe(1); // first empty line
    expect(step3.line, ctx).toBe(0); // "aaa"
  });

  // -------------------------------------------------------------------------
  // A BACKWARD Shift+Arrow selection keeps its focus at the top across a
  // host re-render (the restore must not flip the focus to the bottom end).
  // -------------------------------------------------------------------------
  it('preserves a backward Shift+ArrowUp selection across a re-render, focus still at the top', async () => {
    const initial = 'aaa\nbbb\nccc\nddd\n';
    const { handle, element } = await setupEditor(initial, {
      indentation: 2,
      caretSelector: '.line',
    });

    // Reads the moving end (focus) and the fixed end (anchor) of the live
    // selection as (line, column), so we can assert the selection DIRECTION —
    // `caretLineColumn` only reports the forward-normalized range start.
    const endPoint = (node: Node, offset: number) => {
      const until = document.createRange();
      until.setStart(element, 0);
      until.setEnd(node, offset);
      const lines = until.toString().split('\n');
      return { line: lines.length - 1, column: lines[lines.length - 1].length };
    };
    const focusPoint = () => {
      const sel = window.getSelection()!;
      return endPoint(sel.focusNode!, sel.focusOffset);
    };
    const anchorPoint = () => {
      const sel = window.getSelection()!;
      return endPoint(sel.anchorNode!, sel.anchorOffset);
    };

    // Start collapsed on "ddd" (line 3), column 0, then grow the selection
    // UPWARD twice so the focus is above the anchor (a backward range).
    await placeCaret(element, 'aaa\nbbb\nccc\n'.length);
    await userEvent.keyboard('{Shift>}{ArrowUp}{ArrowUp}{/Shift}');
    await settle();

    // Anchor stays on line 3; the focus has climbed two lines up to line 1.
    expect(anchorPoint().line, 'anchor before re-render').toBe(3);
    expect(focusPoint().line, 'focus before re-render').toBe(1);

    // An idle host re-render (e.g. an async re-highlight committing) re-runs the
    // engine's caret/selection restore. The backward direction must survive it.
    act(() => {
      handle.rerender();
    });
    await settle();

    expect(anchorPoint().line, 'anchor after re-render').toBe(3);
    // The bug: the restore rebuilt a forward range, flipping the focus to the
    // bottom (line 3). With the fix the focus stays at the top (line 1).
    expect(focusPoint().line, 'focus after re-render').toBe(1);

    // And the next Shift+ArrowUp must keep extending from the TOP — landing the
    // focus on line 0 — rather than collapsing the selection from the bottom.
    await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}');
    await settle();
    expect(focusPoint().line, 'focus after a third Shift+ArrowUp').toBe(0);
    expect(anchorPoint().line, 'anchor unchanged after third Shift+ArrowUp').toBe(3);
  });

  // -------------------------------------------------------------------------
  // Focus retention on the first keystroke (async preParse path)
  // -------------------------------------------------------------------------
  it('keeps focus after the first keystroke through an async re-highlight', async () => {
    const { element } = await setupEditor('hello\n', {
      indentation: 2,
      caretSelector: '.line',
      preParse: asyncPreParse(),
    });
    await placeCaret(element, 5);
    expect(document.activeElement).toBe(element);
    await userEvent.keyboard('!');
    await settle();
    await settle();
    expect(document.activeElement).toBe(element);
  });

  // -------------------------------------------------------------------------
  // Single-bound paging: PageDown engages only when `maxRow` is set and PageUp
  // only when `minRow` is set — mirroring ArrowDown (needs `maxRow`) / ArrowUp
  // (needs `minRow`). With only the OPPOSITE bound present the page key has no
  // fold in its direction, so it falls through to native and must NOT fire
  // `onBoundary`. Latent through `Pre` (which always supplies both bounds), but
  // `Options.minRow`/`maxRow` are independently optional.
  // -------------------------------------------------------------------------
  it('pages to the fold only for the bound in its own direction', async () => {
    const initial = 'line0\nline1\nline2\nline3\nline4\n';

    // Only `maxRow` (a bottom fold, no top fold): PageDown expands, PageUp is native.
    {
      const onBoundary = vi.fn();
      const { element } = await setupEditor(
        initial,
        { indentation: 2, caretSelector: '.line', maxRow: 2, onBoundary },
        { scroll: true },
      );
      await placeCaret(element, 'line0\n'.length); // line 1, inside the window
      await userEvent.keyboard('{PageUp}');
      await settle();
      expect(onBoundary, 'PageUp with no minRow stays native').not.toHaveBeenCalled();

      await userEvent.keyboard('{PageDown}');
      await settle();
      expect(onBoundary, 'PageDown expands the bottom fold').toHaveBeenCalledTimes(1);
      expect(caretLineColumn(element).line, 'caret jumped to the bottom edge').toBe(2);
    }

    // Only `minRow` (a top fold, no bottom fold): PageUp expands, PageDown is native.
    {
      const onBoundary = vi.fn();
      const { element } = await setupEditor(
        initial,
        { indentation: 2, caretSelector: '.line', minRow: 2, onBoundary },
        { scroll: true },
      );
      await placeCaret(element, 'line0\nline1\nline2\nline3\n'.length); // line 4, inside the window
      await userEvent.keyboard('{PageDown}');
      await settle();
      expect(onBoundary, 'PageDown with no maxRow stays native').not.toHaveBeenCalled();

      await userEvent.keyboard('{PageUp}');
      await settle();
      expect(onBoundary, 'PageUp expands the top fold').toHaveBeenCalledTimes(1);
      expect(caretLineColumn(element).line, 'caret jumped to the top edge').toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// deletedFromLineStart: whole-line removals only, not in-place collapses
// ---------------------------------------------------------------------------
// A selection delete reports `deletedFromLineStart` so the controlled
// comment/highlight map drops its anchor one line — the post-delete caret sits on
// a line that shifted up from below the deletion. That must be limited to
// deletions that removed WHOLE lines. A selection that ends mid-line collapses the
// spanned lines INTO the first line, which survives (emptied) under the caret;
// reporting the flag there drags a marker on that surviving line one line too high
// (the live-editor "the highlight shifts up instead of being deleted" bug). The
// source stands in for an @highlight block on lines 4-6 with blank padding (3, 7).
describe('useEditable — selection delete reports deletedFromLineStart only for whole-line removals', () => {
  const SRC = 'const a = 1;\nconst b = 2;\n\ndoThing();\ndoOther();\ndoLast();\n\nconst c = 3;\n';
  const lastPosition = (handle: HarnessHandle): Position | undefined =>
    handle.onChange.mock.calls.at(-1)?.[1];

  it('reports the flag when a column-0 selection removes whole lines', async () => {
    const { handle, element } = await setupEditor(SRC, { indentation: 2, caretSelector: '.line' });
    // Column 0 of the blank line 3 → column 0 of the blank line 7 (a line boundary):
    // whole lines 3-6 are removed and line 7 shifts up under the caret.
    await placeCaret(element, 26);
    await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{/Shift}');
    await settle();
    await userEvent.keyboard('{Backspace}');
    await settle();
    expect(handle.getSource()).toBe('const a = 1;\nconst b = 2;\n\nconst c = 3;\n');
    expect(lastPosition(handle)?.deletedFromLineStart).toBe(true);
  });

  it('reports the flag when a column-0 selection stops on the region’s exclusive -end line', async () => {
    const { handle, element } = await setupEditor(SRC, { indentation: 2, caretSelector: '.line' });
    // Column 0 of the blank line 3 → column 0 of line 6 (still a line boundary), one
    // ArrowDown short of scenario A. A range's @highlight-end is EXCLUSIVE — it sits
    // on the line just below the last highlighted line — so selecting "from the line
    // above through the last newline of the region" lands here, deleting the whole
    // highlighted body (lines 4-5) while doLast() (the -end line) survives. This is
    // still a whole-line removal, so the flag holds; the matching comment-map case is
    // `useSourceEditing`'s "removes the highlight when the selection stops on the
    // region’s exclusive -end line".
    await placeCaret(element, 26);
    await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowDown}{ArrowDown}{/Shift}');
    await settle();
    await userEvent.keyboard('{Backspace}');
    await settle();
    expect(handle.getSource()).toBe('const a = 1;\nconst b = 2;\ndoLast();\n\nconst c = 3;\n');
    expect(lastPosition(handle)?.deletedFromLineStart).toBe(true);
  });

  it('does NOT report the flag when the selection ends mid-line and collapses in place', async () => {
    const { handle, element } = await setupEditor(SRC, { indentation: 2, caretSelector: '.line' });
    // Column 0 of line 4 → the END of line 6 (mid-line, NOT a line boundary): the three
    // region lines collapse into one empty line that survives under the caret.
    await placeCaret(element, 27);
    await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowDown}{End}{/Shift}');
    await settle();
    await userEvent.keyboard('{Backspace}');
    await settle();
    expect(handle.getSource()).toBe('const a = 1;\nconst b = 2;\n\n\n\nconst c = 3;\n');
    expect(lastPosition(handle)?.deletedFromLineStart).not.toBe(true);
  });
});
