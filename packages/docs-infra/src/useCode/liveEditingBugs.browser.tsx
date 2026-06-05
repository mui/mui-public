/**
 * Reproduction harness + tests for four live-editing bugs reported against the
 * docs live code editor:
 *
 *   1. Erasing the last indent (tab) unit on a line makes the view jump.
 *   2. Pressing ArrowUp at the visible top doesn't trigger the scroll anchor.
 *   3. Typing `x`, then `=`, then Backspace sends the caret to column 0.
 *   4. The first keystroke in the editable loses focus.
 *
 * Unlike `useEditable.browser.ts` (which drives a static highlighted DOM with a
 * `vi.fn()` onChange and only asserts the *text* handed to onChange), these
 * tests wire `useEditable` to a real React component whose `onChange` updates
 * source state, re-highlights it into the production `.line`/`pl-*` span
 * structure, and lets the engine's `observeAndRestore` restore the caret — i.e.
 * the full type → flush → re-highlight → restore cycle that the bugs live in.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { useEditable, preloadEditableEngine, type Position, type Options } from './useEditable';

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

describe('live-editing bug repros', () => {
  // -------------------------------------------------------------------------
  // Bug 3: type x, =, Backspace -> caret jumps to column 0
  // -------------------------------------------------------------------------
  it('Bug 3a: fresh line — x, =, Backspace keeps caret after x', async () => {
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

  it('Bug 3b: x, =, Backspace with async preParse keeps caret after x', async () => {
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

  it('Bug 3c: typing =, Backspace at end of an existing indented JSX-ish line', async () => {
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

  it('Bug 3d: collapsed (minColumn) — x, =, Backspace at end of an indented line keeps caret after x', async () => {
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

  it('Bug 3e: collapsed + async preParse — x, =, Backspace keeps caret after x', async () => {
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

  it('Bug 3f: End then x, =, Backspace at a line end (caret lands at the line/gap boundary)', async () => {
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
  // Bug 1: erasing the last indent on a clipped (collapsed-window) line jumps
  // -------------------------------------------------------------------------
  it('Bug 1a: Backspace of last indent on a blank clipped line (minColumn) — where does caret land?', async () => {
    // Simulate a collapsed window: indentation clipped to minColumn=2, the
    // visible region is rows 1..3. Line 2 is a blank line with exactly 2 spaces.
    const initial = 'function foo() {\n  const a = 1;\n  \n  return a;\n}\n';
    const { handle, element } = await setupEditor(
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
    // The reported source + caret movement reveal whether the whole line
    // collapsed (caret jumps to the previous line) or just one indent went away.
    // eslint-disable-next-line no-console
    console.log(
      'Bug1a before',
      before,
      'after',
      after,
      'source',
      JSON.stringify(handle.getSource()),
    );
    // Assert the (arguably correct) behavior: stay on the same line, now empty.
    expect(after.line).toBe(before.line);
  });

  it('Bug 1b: Backspace of indent on a content line in a clipped gutter (minColumn)', async () => {
    const initial = 'function foo() {\n  const a = 1;\n}\n';
    const { handle, element } = await setupEditor(
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
    // eslint-disable-next-line no-console
    console.log('Bug1b after', after, 'source', JSON.stringify(handle.getSource()));
    expect(after).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Bug 2: ArrowUp at the visible top should fire onBoundary (scroll anchor)
  // -------------------------------------------------------------------------
  it('Bug 2: ArrowUp at minRow fires onBoundary; ArrowDown at maxRow fires onBoundary', async () => {
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

    // eslint-disable-next-line no-console
    console.log('Bug2 onBoundary up-calls', upCalls, 'down-calls', downCalls);
    expect(upCalls).toBeGreaterThan(0); // ArrowUp must fire the boundary
    expect(downCalls).toBeGreaterThan(0); // ArrowDown must fire the boundary
  });

  // -------------------------------------------------------------------------
  // Clue A: backspace last indent + async re-highlight shows the wrong thing
  // transiently (during the worker round-trip the line is collapsed but the
  // committed source hasn't caught up yet).
  // -------------------------------------------------------------------------
  it('Clue A: async backspace of last indent — transient DOM vs committed source', async () => {
    const { preParse, resolvePending } = deferredPreParse();
    const initial = 'function foo() {\n  const a = 1;\n  \n  return a;\n}\n';
    const { handle, element } = await setupEditor(
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
    const transientText = element.textContent ?? '';
    const transientLineCount = element.querySelectorAll('.line').length;
    const transientSig = signature();
    const committedDuringGap = handle.onChange.mock.calls.length;

    await resolvePending();
    await settle();

    const finalText = element.textContent ?? '';
    const finalSig = signature();
    const finalSource = handle.getSource();
    // eslint-disable-next-line no-console
    console.log(
      'ClueA transient',
      JSON.stringify(transientText),
      'lines',
      transientLineCount,
      'committedDuringGap',
      committedDuringGap,
      '| final',
      JSON.stringify(finalText),
      'source',
      JSON.stringify(finalSource),
    );
    // The transient DOM should already match the final committed text — i.e.
    // the user must NOT see a wrong intermediate state. If they differ, the
    // async path is showing the wrong thing for a moment.
    void transientText;
    void transientLineCount;
    void committedDuringGap;
    void finalText;
    void finalSource;
    // DESIRED: the DOM the user sees during the async worker round-trip should
    // already be structurally consistent with the committed result. Currently
    // it is NOT — `edit.insert` leaves a dangling empty `.line` span and drops
    // the gap newline, so this fails (reproducing "shows the wrong thing for a
    // second") until the async commit cleans it up.
    expect(transientSig).toEqual(finalSig);
  });

  // -------------------------------------------------------------------------
  // Clue B: ArrowUp navigation across empty lines is "weird".
  // -------------------------------------------------------------------------
  it('Clue B: ArrowUp across an empty line lands on the empty line, then the line above', async () => {
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
  it('Clue B2: ArrowUp stops on each of two consecutive empty lines (does not skip both)', async () => {
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
  // Bug 4: first keystroke loses focus (async preParse path)
  // -------------------------------------------------------------------------
  it('Bug 4: editable keeps focus after the first keystroke (async preParse)', async () => {
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
});
