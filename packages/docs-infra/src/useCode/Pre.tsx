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
}: {
  children: VariantSource;
  className?: string;
  fileName?: string;
  language?: string;
  ref?: React.Ref<HTMLPreElement>;
  setSource?: (source: string, fileName?: string, position?: Position) => void;
  shouldHighlight?: boolean;
  hydrateMargin?: string;
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

  useEditable(preRef, onEditableChange, {
    indentation: 2,
    disabled: !setSource || !editableReady,
  });

  const [visibleFrames, setVisibleFrames] = React.useState<{ [key: number]: boolean }>({
    [0]: true,
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
    return hast?.children.map((child, index) => {
      if (child.type !== 'element') {
        if (child.type === 'text') {
          return <React.Fragment key={index}>{child.value}</React.Fragment>;
        }

        return null;
      }

      if (child.properties.className === 'frame') {
        const isVisible = Boolean(visibleFrames[index]);
        const shouldRenderHast = shouldHighlight && (isEditable || isVisible);

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

  return (
    <pre ref={bindIntersectionObserver} className={className}>
      <code className={language ? `language-${language}` : undefined}>
        {typeof children === 'string' ? children : frames}
      </code>
    </pre>
  );
}
