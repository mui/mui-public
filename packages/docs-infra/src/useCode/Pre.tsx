'use client';

import * as React from 'react';
import { toText } from 'hast-util-to-text';
import { type ElementContent } from 'hast';
import { useEditable, type Position } from './useEditable';
import type { SetSource } from './useSourceEditing';
import type { HastRoot, VariantSource } from '../CodeHighlighter/types';
import { useCodeContext } from '../CodeProvider/CodeContext';
import { hastToJsx, decompressHast } from '../pipeline/hastUtils';

const hastChildrenCache = new WeakMap<ElementContent[], React.ReactNode>();
const textChildrenCache = new WeakMap<ElementContent[], string>();

const INITIAL_VISIBLE_FRAME_TYPES = new Set([
  'highlighted',
  'focus',
  'padding-top',
  'padding-bottom',
]);

function getInitialVisibleFrames(hast: HastRoot | null): { [key: number]: boolean } {
  if (!hast) {
    return { 0: true };
  }

  const visibleFrames: { [key: number]: boolean } = {};
  let frameIndex = 0;
  let hasVisibleEmphasisFrame = false;

  hast.children.forEach((child) => {
    if (child.type !== 'element' || child.properties.className !== 'frame') {
      return;
    }

    const frameType = child.properties.dataFrameType;
    if (typeof frameType === 'string' && INITIAL_VISIBLE_FRAME_TYPES.has(frameType)) {
      visibleFrames[frameIndex] = true;
      hasVisibleEmphasisFrame = true;
    }

    frameIndex += 1;
  });

  if (!hasVisibleEmphasisFrame && frameIndex > 0) {
    visibleFrames[0] = true;
  }

  return visibleFrames;
}

/**
 * Bounds describing the visible region of a collapsible code block in its
 * collapsed state. Used to constrain caret movement in `useEditable` and to
 * trigger expansion when the user navigates past the boundaries.
 */
type CollapsedBounds = {
  /**
   * Smallest column the visible region exposes on indented lines (derived
   * from the minimum `data-frame-indent` across collapsed-visible region
   * frames). `undefined` when no visible region frame is indented.
   */
  minColumn: number | undefined;
  /** First row of the visible region. */
  minRow: number;
  /** Last row of the visible region. */
  maxRow: number;
};

/**
 * Counts newlines in a hast subtree and reports whether the tree's text
 * content ends with a newline. Walks text nodes directly instead of
 * materializing the subtree into a string — avoids the O(N) allocation
 * `hast-util-to-text` performs per call, which adds up across hundreds of
 * frames in large code blocks.
 *
 * Returns `[newlineCount, endsWithNewline]`. `endsWithNewline` is `false`
 * for an empty subtree (matches the previous `text.endsWith('\n')` check
 * on an empty string).
 */
function countFrameNewlines(node: ElementContent | HastRoot): [number, boolean] {
  let count = 0;
  let endsWithNewline = false;
  let sawText = false;

  const walk = (current: { type: string; value?: unknown; children?: unknown }): void => {
    if (current.type === 'text') {
      const value = current.value as string;
      if (value.length === 0) {
        return;
      }
      sawText = true;
      for (let i = 0; i < value.length; i += 1) {
        if (value.charCodeAt(i) === 10 /* \n */) {
          count += 1;
        }
      }
      endsWithNewline = value.charCodeAt(value.length - 1) === 10;
      return;
    }
    if (Array.isArray(current.children)) {
      const children = current.children;
      for (let i = 0; i < children.length; i += 1) {
        walk(children[i]);
      }
    }
  };

  walk(node);
  return [count, sawText && endsWithNewline];
}

/**
 * Counts newlines in a hast subtree without tracking the trailing-newline
 * flag. Used for hidden frames that precede the visible-when-collapsed
 * region: we only need to advance the running row offset, not figure out
 * how the frame's last line aligns.
 */
function countFrameNewlinesOnly(node: ElementContent | HastRoot): number {
  let count = 0;

  const walk = (current: { type: string; value?: unknown; children?: unknown }): void => {
    if (current.type === 'text') {
      const value = current.value as string;
      for (let i = 0; i < value.length; i += 1) {
        if (value.charCodeAt(i) === 10 /* \n */) {
          count += 1;
        }
      }
      return;
    }
    if (Array.isArray(current.children)) {
      const children = current.children;
      for (let i = 0; i < children.length; i += 1) {
        walk(children[i]);
      }
    }
  };

  walk(node);
  return count;
}

/**
 * When the code block is collapsible, returns the row range of the
 * collapsed-visible frames (the same set used by `getInitialVisibleFrames`)
 * along with the minimum indent column. Returns `undefined` when the block
 * isn't collapsible or no frame is visible-when-collapsed.
 *
 * `data-frame-indent` is encoded as `leadingSpaces / indentation`, so the
 * column count is `indent * indentation`.
 */
function computeCollapsedBounds(
  hast: HastRoot | null,
  indentation: number,
): CollapsedBounds | undefined {
  if (!hast || hast.data?.collapsible !== true) {
    return undefined;
  }

  let minIndent: number | undefined;
  let minRow: number | undefined;
  let maxRow: number | undefined;
  let row = 0;

  for (const child of hast.children) {
    if (child.type !== 'element' || child.properties.className !== 'frame') {
      continue;
    }
    const frameType = child.properties.dataFrameType;
    const indent = child.properties.dataFrameIndent;
    const isVisibleWhenCollapsed =
      typeof frameType === 'string' && INITIAL_VISIBLE_FRAME_TYPES.has(frameType);

    if (!isVisibleWhenCollapsed) {
      // Once we've passed the visible region, hidden frames can't change
      // any output — bail out entirely.
      if (maxRow !== undefined) {
        break;
      }
      // Hidden frames before the visible region only need their row count
      // to keep `row` accurate for the next visible frame's `minRow`. We
      // don't need `endsWithNewline` (only consumed by visible frames for
      // `maxRow` arithmetic) or any indent metadata, so do the cheap
      // newline-only walk.
      row += countFrameNewlinesOnly(child);
      continue;
    }

    const [newlines, endsWithNewline] = countFrameNewlines(child);
    const lastContentRow = endsWithNewline ? row + Math.max(0, newlines - 1) : row + newlines;

    if (minRow === undefined) {
      minRow = row;
    }
    maxRow = lastContentRow;
    if (typeof indent === 'number' && (minIndent === undefined || indent < minIndent)) {
      minIndent = indent;
    }

    row += newlines;
  }

  if (minRow === undefined || maxRow === undefined) {
    return undefined;
  }

  return {
    minColumn: minIndent !== undefined && minIndent > 0 ? minIndent * indentation : undefined,
    minRow,
    maxRow,
  };
}

function renderCode(hastChildren: ElementContent[], renderHast?: boolean, text?: string) {
  if (renderHast) {
    let jsx = hastChildrenCache.get(hastChildren);
    if (!jsx) {
      jsx = hastToJsx({ type: 'root', children: hastChildren });
      hastChildrenCache.set(hastChildren, jsx);
    }
    return jsx;
  }

  if (text !== undefined) {
    return text;
  }

  let txt = textChildrenCache.get(hastChildren);
  if (!txt) {
    txt = toText({ type: 'root', children: hastChildren }, { whitespace: 'pre' });
    textChildrenCache.set(hastChildren, txt);
  }
  return txt;
}

export function Pre({
  children,
  className,
  fileName,
  language,
  ref,
  setSource,
  shouldHighlight,
  hydrateMargin = '200px 0px 200px 0px',
  expanded = false,
  expand,
}: {
  children: VariantSource;
  className?: string;
  fileName?: string;
  language?: string;
  ref?: React.Ref<HTMLPreElement>;
  setSource?: SetSource;
  shouldHighlight?: boolean;
  hydrateMargin?: string;
  /**
   * Whether the host has expanded the (collapsible) code block. When `true`,
   * collapsed-state behaviors such as `minColumn` are disabled so the caret
   * can move into the indent gutter normally.
   */
  expanded?: boolean;
  /**
   * Called when the user attempts to navigate the caret past the visible
   * region of a collapsed code block (e.g. `ArrowUp` on the first visible
   * row, `ArrowDown` on the last). Typically wired to the host's
   * `expand()` action.
   */
  expand?: () => void;
}): React.ReactNode {
  const hast = React.useMemo(() => {
    if (typeof children === 'string') {
      return null;
    }

    if ('hastJson' in children) {
      return JSON.parse(children.hastJson) as HastRoot;
    }

    if ('hastCompressed' in children) {
      return JSON.parse(decompressHast(children.hastCompressed)) as HastRoot;
    }

    return children;
  }, [children]);

  const preRef = React.useRef<HTMLPreElement>(null);

  // useEditable uses ref.current in its effect deps. On first render it's null
  // (set later by the callback ref), so the deps change on the next render,
  // causing contentEditable to flash and the cursor to be lost. Delaying
  // enablement by one synchronous re-render ensures the ref is already set
  // when useEditable first activates, keeping deps stable afterward.
  const [editableReady, setEditableReady] = React.useState(false);
  React.useLayoutEffect(() => {
    setEditableReady(true);
  }, []);

  const onEditableChange = React.useCallback(
    (text: string, position: Position, preParsed?: HastRoot) => {
      setSource?.(text, fileName, position, preParsed);
    },
    [setSource, fileName],
  );

  // Worker-backed async parser exposed by `CodeProvider`. When present we
  // hand it to `useEditable` as `preParse` so highlighting moves off the
  // main thread during live typing. The resolved HAST is forwarded into
  // `setSource` (4th arg) where the host can stash it in a per-file cache
  // so the synchronous `parseControlledCode` pass can reuse it.
  const { parseSourceAsync } = useCodeContext();
  const preParse = React.useMemo(() => {
    if (!setSource || !parseSourceAsync || !fileName) {
      return undefined;
    }
    return (text: string, _position: Position, signal: AbortSignal) =>
      parseSourceAsync(text, fileName, language, signal);
  }, [setSource, parseSourceAsync, fileName, language]);

  const [visibleFrames, setVisibleFrames] = React.useState<{ [key: number]: boolean }>(() =>
    getInitialVisibleFrames(hast),
  );

  // When the code block is collapsible AND currently collapsed, derive the
  // visible region's row range and minimum indent column so that:
  //   - the caret never lands in the clipped indent gutter (`minColumn`),
  //   - arrow-key navigation past the visible region is blocked, optionally
  //     calling `expand` so the host can reveal the hidden content.
  // See `computeCollapsedBounds` above.
  //
  // `data-frame-indent` is encoded as `leadingSpaces / 2`, matching the
  // hardcoded `indentation: 2` below.
  const indentation = 2;
  const collapsedBounds = React.useMemo(
    () => (expanded ? undefined : computeCollapsedBounds(hast, indentation)),
    [hast, expanded],
  );

  useEditable(preRef, onEditableChange, {
    indentation,
    disabled: !setSource || !editableReady,
    minColumn: collapsedBounds?.minColumn,
    minRow: collapsedBounds?.minRow,
    maxRow: collapsedBounds?.maxRow,
    onBoundary: collapsedBounds && expand ? expand : undefined,
    // The HAST emitted for highlighted code separates `.line` spans with
    // whitespace text nodes (newlines) that are direct children of `.frame`.
    // Without this, clicks or arrow navigation could land the caret in
    // those gap nodes \u2014 visually invisible (collapsed via line-height: 0)
    // but still real text positions in contentEditable. `.line` matches
    // every selectable row. Only set when the highlighter has actually
    // produced `.line` elements.
    caretSelector: shouldHighlight ? '.line' : undefined,
    preParse,
  });

  const observer = React.useRef<IntersectionObserver | null>(null);
  const frameIndexMap = React.useRef(new WeakMap<Element, number>());
  const bindIntersectionObserver = React.useCallback(
    (root: HTMLPreElement | null) => {
      preRef.current = root;

      if (!root) {
        if (observer.current) {
          observer.current.disconnect();
        }
        observer.current = null;

        return;
      }

      const indexMap = frameIndexMap.current;

      observer.current = new IntersectionObserver(
        (entries) =>
          setVisibleFrames((prev) => {
            const visible: number[] = [];
            const invisible: number[] = [];

            entries.forEach((entry) => {
              const index = indexMap.get(entry.target);
              if (index === undefined) {
                return;
              }
              if (entry.isIntersecting) {
                visible.push(index);
              } else {
                invisible.push(index);
              }
            });

            // avoid mutating the object if nothing changed
            let frames: { [key: number]: boolean } | undefined;
            visible.forEach((frame) => {
              if (prev[frame] !== true) {
                if (!frames) {
                  frames = { ...prev };
                }
                frames[frame] = true;
              }
            });

            invisible.forEach((frame) => {
              if (prev[frame]) {
                if (!frames) {
                  frames = { ...prev };
                }
                delete frames[frame];
              }
            });

            return frames || prev;
          }),
        { rootMargin: hydrateMargin },
      );

      // <pre><code><span class="frame">...</span><span class="frame">...</span>...</code></pre>
      const codeElement = root.querySelector('code');
      if (!codeElement) {
        return;
      }
      let frameIndex = 0;
      codeElement.childNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (!element.classList.contains('frame')) {
            console.warn('Expected frame element in useCode <Pre>', element);
            return;
          }

          indexMap.set(element, frameIndex);
          frameIndex += 1;
          observer.current?.observe(element);
        }
      });

      if (ref) {
        if (typeof ref === 'function') {
          ref(root);
        } else {
          ref.current = root;
        }
      }
    },
    [ref, hydrateMargin],
  );

  const observeFrame = React.useCallback((node: HTMLSpanElement | null) => {
    if (node) {
      // Derive frame index from DOM position among .frame siblings.
      // This avoids putting data-frame in server-rendered HTML.
      let index = 0;
      let sibling = node.previousElementSibling;
      while (sibling) {
        if (sibling.classList.contains('frame')) {
          index += 1;
        }
        sibling = sibling.previousElementSibling;
      }
      frameIndexMap.current.set(node, index);
      if (observer.current) {
        observer.current.observe(node);
      }
    }
  }, []);

  const frames = React.useMemo(() => {
    let frameIndex = 0;

    return hast?.children.map((child, index) => {
      if (child.type !== 'element') {
        if (child.type === 'text') {
          return <React.Fragment key={index}>{child.value}</React.Fragment>;
        }

        return null;
      }

      if (child.properties.className === 'frame') {
        const isVisible = Boolean(visibleFrames[frameIndex]);
        const shouldRenderHast = shouldHighlight && isVisible;

        frameIndex += 1;

        return (
          <span
            key={index}
            className="frame"
            data-lined={shouldRenderHast ? '' : undefined}
            data-frame-type={
              child.properties.dataFrameType ? String(child.properties.dataFrameType) : undefined
            }
            data-frame-indent={
              child.properties.dataFrameIndent != null
                ? String(child.properties.dataFrameIndent)
                : undefined
            }
            data-frame-truncated={
              child.properties.dataFrameTruncated
                ? String(child.properties.dataFrameTruncated)
                : undefined
            }
            data-frame-description={
              child.properties.dataFrameDescription
                ? String(child.properties.dataFrameDescription)
                : undefined
            }
            ref={observeFrame}
          >
            {renderCode(
              child.children,
              shouldRenderHast,
              child.properties?.dataAsString ? String(child.properties?.dataAsString) : undefined,
            )}
          </span>
        );
      }

      return (
        <React.Fragment key={index}>
          {shouldHighlight ? hastToJsx(child) : toText(child, { whitespace: 'pre' })}
        </React.Fragment>
      );
    });
  }, [hast, observeFrame, shouldHighlight, visibleFrames]);

  const hasCollapsibleFrames = hast?.data?.collapsible === true;

  const isEditable = Boolean(setSource);

  // Focus-trap state for editable code blocks. When the user tabs into the
  // wrapper (keyboard-only, gated by `:focus-visible`), an overlay prompts
  // them to press Enter before contentEditable Tab-indentation kicks in.
  // Mouse clicks land directly on the `<pre>` (skipping the wrapper as a
  // focus stop) so editing still engages immediately for pointer users.
  // Escape from the engaged `<pre>` returns focus to the wrapper, restoring
  // normal Tab navigation through the page.
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [armed, setArmed] = React.useState(false);
  const overlayId = React.useId();

  const handleWrapperFocus = React.useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    // Only show the overlay for keyboard-driven focus. `:focus-visible` is
    // the browser's heuristic for "user is navigating with the keyboard",
    // which keeps the overlay from flashing if the wrapper itself ever
    // receives a click (e.g. on padding around the `<pre>`).
    let focusVisible = true;
    try {
      focusVisible = event.currentTarget.matches(':focus-visible');
    } catch {
      // Older browsers without `:focus-visible` support — treat any focus
      // as keyboard focus rather than silently dropping the overlay.
    }
    if (focusVisible) {
      setArmed(true);
    }
  }, []);

  const handleWrapperBlur = React.useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    setArmed(false);
  }, []);

  const handleWrapperKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      preRef.current?.focus();
    }
  }, []);

  const handlePreKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLPreElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Returning focus to the wrapper restores the page's Tab order.
      // Programmatic focus after a keyboard event keeps the browser's
      // last-interaction heuristic on "keyboard", so the wrapper will
      // re-match `:focus-visible` and the overlay will re-appear.
      wrapperRef.current?.focus();
    }
  }, []);

  const preElement = (
    // The <pre> is made interactive by contentEditable (set imperatively by
    // useEditable). jsx-a11y can't see that, so disable its rule here.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <pre
      ref={bindIntersectionObserver}
      className={className}
      spellCheck={false}
      tabIndex={isEditable ? -1 : undefined}
      onKeyDown={isEditable ? handlePreKeyDown : undefined}
    >
      <code
        className={language ? `language-${language}` : undefined}
        data-collapsible={hasCollapsibleFrames ? '' : undefined}
      >
        {typeof children === 'string' ? children : frames}
      </code>
    </pre>
  );

  if (!isEditable) {
    return preElement;
  }

  return (
    // Intentional focus trap: the wrapper is a keyboard-only stop in the
    // tab order so we can prompt the user ("Press Enter to start editing")
    // before contentEditable's Tab-indents-instead-of-moving-focus behavior
    // takes over. role="group" + aria-label give it an accessible name.
    /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
    <div
      ref={wrapperRef}
      className="editable-code-wrapper"
      data-editable-armed={armed ? '' : undefined}
      tabIndex={0}
      role="group"
      aria-label="Editable code"
      aria-describedby={overlayId}
      onFocus={handleWrapperFocus}
      onBlur={handleWrapperBlur}
      onKeyDown={handleWrapperKeyDown}
    >
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      {preElement}
      <div id={overlayId} className="editable-code-overlay" hidden={!armed}>
        Press <kbd>Enter</kbd> to start editing
      </div>
    </div>
  );
}
