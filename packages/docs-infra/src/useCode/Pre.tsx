'use client';

import * as React from 'react';
import { toText } from 'hast-util-to-text';
import { ElementContent } from 'hast';
import { decompressSync, strFromU8 } from 'fflate';
import { decode } from 'uint8-to-base64';
import type { HastRoot, VariantSource } from '../CodeHighlighter/types';
import { hastToJsx } from '../pipeline/hastUtils';

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
  language,
  ref,
  shouldHighlight,
  hydrateMargin = '200px 0px 200px 0px',
}: {
  children: VariantSource;
  className?: string;
  language?: string;
  ref?: React.Ref<HTMLPreElement>;
  shouldHighlight?: boolean;
  hydrateMargin?: string;
}): React.ReactNode {
  const hast = React.useMemo(() => {
    if (typeof children === 'string') {
      return null;
    }

    if ('hastJson' in children) {
      return JSON.parse(children.hastJson) as HastRoot;
    }

    if ('hastGzip' in children) {
      return JSON.parse(strFromU8(decompressSync(decode(children.hastGzip)))) as HastRoot;
    }

    return children;
  }, [children]);

  const [visibleFrames, setVisibleFrames] = React.useState<{ [key: number]: boolean }>({
    [0]: true,
  });

  const observer = React.useRef<IntersectionObserver | null>(null);
  const bindIntersectionObserver = React.useCallback(
    (root: HTMLPreElement | null) => {
      if (!root) {
        if (observer.current) {
          observer.current.disconnect();
        }
        observer.current = null;

        return;
      }

      observer.current = new IntersectionObserver(
        (entries) =>
          setVisibleFrames((prev) => {
            const visible: number[] = [];
            const invisible: number[] = [];

            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                visible.push(Number(entry.target.getAttribute('data-frame')));
              } else {
                invisible.push(Number(entry.target.getAttribute('data-frame')));
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

      // <pre><code><span class="frame" data-frame="0">...</span><span class="frame" data-frame="1">...</span>...</code></pre>
      root.childNodes[0].childNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (!element.hasAttribute('data-frame')) {
            console.warn('Expected frame element in useCode <Pre>', element);
            return;
          }

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
    if (observer.current && node) {
      observer.current.observe(node);
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

        return (
          <span key={index} className="frame" data-frame={index} ref={observeFrame}>
            {renderCode(
              child.children,
              shouldHighlight && isVisible,
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

  return (
    <pre ref={bindIntersectionObserver} className={className}>
      <code className={language ? `language-${language}` : undefined}>
        {typeof children === 'string' ? children : frames}
      </code>
    </pre>
  );
}
