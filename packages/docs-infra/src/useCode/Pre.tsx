'use client';

import * as React from 'react';
import { toText } from 'hast-util-to-text';
import { ElementContent } from 'hast';
import { useEditable } from './useEditable';
import type { Position } from './useEditable';
import type { HastRoot, VariantSource } from '../CodeHighlighter/types';
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

    const text = toText(child, { whitespace: 'pre' });
    const newlines = text.length > 0 ? text.split('\n').length - 1 : 0;
    const lastContentRow = text.endsWith('\n') ? row + Math.max(0, newlines - 1) : row + newlines;

    if (isVisibleWhenCollapsed) {
      if (minRow === undefined) {
        minRow = row;
      }
      maxRow = lastContentRow;
      if (typeof indent === 'number' && (minIndent === undefined || indent < minIndent)) {
        minIndent = indent;
      }
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
  setSource?: (source: string, fileName?: string, position?: Position) => void;
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
  const isEditable = Boolean(setSource);

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
    (text: string, position: Position) => {
      setSource?.(text, fileName, position);
    },
    [setSource, fileName],
  );

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
        const shouldRenderHast = shouldHighlight && (isEditable || isVisible);

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
  }, [hast, isEditable, observeFrame, shouldHighlight, visibleFrames]);

  const hasCollapsibleFrames = hast?.data?.collapsible === true;

  return (
    <pre ref={bindIntersectionObserver} className={className}>
      <code
        className={language ? `language-${language}` : undefined}
        data-collapsible={hasCollapsibleFrames ? '' : undefined}
      >
        {typeof children === 'string' ? children : frames}
      </code>
    </pre>
  );
}
