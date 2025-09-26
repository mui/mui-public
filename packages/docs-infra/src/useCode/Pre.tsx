'use client';

import * as React from 'react';
import { toText } from 'hast-util-to-text';
import { ElementContent } from 'hast';
import { decompressSync, strFromU8 } from 'fflate';
import { decode } from 'uint8-to-base64';
import type { HastRoot, VariantSource } from '../CodeHighlighter/types';
import { hastToJsx } from '../pipeline/hastUtils';

export function Pre({
  children,
  className,
  ref,
  shouldHighlight,
  hydrateMargin = '200px 0px 200px 0px',
}: {
  children: VariantSource;
  className?: string;
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

      root.childNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
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

  const hastChildrenCache = React.useMemo<undefined | Array<React.ReactNode | null>>(
    () => hast?.children.map(() => null),
    [hast],
  );
  const textChildrenCache = React.useMemo<undefined | Array<string | null>>(
    () => hast?.children.map(() => null),
    [hast],
  );
  const renderCode = React.useCallback(
    (index: number, hastChildren: ElementContent[], renderHast?: boolean, text?: string) => {
      if (renderHast) {
        const cached = hastChildrenCache?.[index];
        if (cached) {
          return cached;
        }

        const jsx = hastToJsx({ type: 'root', children: hastChildren });
        if (hastChildrenCache) {
          hastChildrenCache[index] = jsx;
        }

        return jsx;
      }

      if (text !== undefined) {
        return text;
      }

      const cached = textChildrenCache?.[index];
      if (cached) {
        return cached;
      }

      const txt = toText({ type: 'root', children: hastChildren }, { whitespace: 'pre' });
      if (textChildrenCache) {
        textChildrenCache[index] = txt;
      }

      return txt;
    },
    [hastChildrenCache, textChildrenCache],
  );

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
              index,
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
  }, [hast, renderCode, observeFrame, shouldHighlight, visibleFrames]);

  return (
    <pre ref={bindIntersectionObserver} className={className}>
      <code>{typeof children === 'string' ? children : frames}</code>
    </pre>
  );
}
