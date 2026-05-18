import type { Root as HastRoot, RootContent, Element as HastElement, ElementContent } from 'hast';

/**
 * Strip all non-structural `<span>` elements from a HAST tree while preserving
 * semantic structure and text content. Produces a "links-only" version of the
 * tree suitable as a lightweight server-rendered fallback for deferred highlighting.
 *
 * - All `<span>` elements except frame and collapse spans: removed, children promoted
 * - Frame `<span>` elements (`frame`): preserved with their data attributes
 *   (except `data-lined`, which is redundant once line spans are gone)
 * - Collapse `<span>` elements (`collapse`): preserved with their `data-lines`
 *   attribute so CSS can size the placeholder, keeping the fallback render's
 *   height in sync with the fully-highlighted render
 * - `<a>` elements: preserved, children recursively processed
 * - text nodes: preserved, adjacent text nodes merged
 * - other elements (pre, code, etc.): preserved, children recursively processed
 *
 * Does not mutate the input tree.
 */
export function stripHighlightingSpans(root: HastRoot): HastRoot {
  return {
    ...root,
    children: processChildren(root.children),
  };
}

function hasClassName(element: HastElement, name: string): boolean {
  const className = element.properties?.className;
  return className === name || (Array.isArray(className) && className.includes(name));
}

function isFrameSpan(element: HastElement): boolean {
  return hasClassName(element, 'frame');
}

function isCollapseSpan(element: HastElement): boolean {
  return hasClassName(element, 'collapse');
}

function processChildren(children: RootContent[]): RootContent[] {
  const flat = children.flatMap((node): RootContent[] => {
    if (node.type !== 'element') {
      return [node];
    }
    const element = node as HastElement;
    if (element.tagName === 'span' && !isFrameSpan(element) && !isCollapseSpan(element)) {
      // Unwrap highlighting spans: replace with recursively-processed children
      return processChildren(element.children as RootContent[]);
    }
    if (isCollapseSpan(element)) {
      // Collapse placeholders have no meaningful children (CSS sizes them
      // from `data-lines`), so skip the recursive walk and clone the node
      // shallowly. Keeping `children` referentially stable also lets the
      // caller's WeakMap cache reuse downstream JSX.
      return [element];
    }
    // Keep semantic spans, links, and other elements — process their children
    const processed: HastElement = {
      ...element,
      children: processChildren(element.children as RootContent[]) as ElementContent[],
    };
    // Strip data-lined from frame spans since line spans are removed in the
    // fallback HAST.
    if (isFrameSpan(element) && processed.properties) {
      const { dataLined, ...rest } = processed.properties;
      if (dataLined !== undefined) {
        processed.properties = rest;
      }
    }
    return [processed as RootContent];
  });
  return mergeAdjacentText(flat);
}

function mergeAdjacentText(nodes: RootContent[]): RootContent[] {
  const result: RootContent[] = [];
  for (const node of nodes) {
    const prev = result[result.length - 1];
    if (node.type === 'text' && prev?.type === 'text') {
      // Replace the previous text node with a merged one (no mutation)
      result[result.length - 1] = { type: 'text', value: prev.value + node.value };
    } else {
      result.push(node);
    }
  }
  return result;
}
