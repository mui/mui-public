import type { Root as HastRoot, RootContent, Element as HastElement } from 'hast';

/**
 * Strip syntax-highlighting `<span>` elements from a HAST tree while preserving
 * semantic structure and text content. Produces a "links-only" version of the
 * tree suitable as a lightweight server-rendered fallback for deferred highlighting.
 *
 * - Highlighting `<span>` elements (e.g. `pl-k`, `pl-smi`, `line`): removed, children promoted
 * - Frame `<span>` elements (`frame`): preserved with their data attributes
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

function isFrameSpan(element: HastElement): boolean {
  const className = element.properties?.className;
  return className === 'frame' || (Array.isArray(className) && className.includes('frame'));
}

function processChildren(children: RootContent[]): RootContent[] {
  const flat = children.flatMap((node): RootContent[] => {
    if (node.type !== 'element') {
      return [node];
    }
    const element = node as HastElement;
    if (element.tagName === 'span' && !isFrameSpan(element)) {
      // Unwrap highlighting spans: replace with recursively-processed children
      return processChildren(element.children as RootContent[]);
    }
    // Keep semantic spans, links, and other elements — process their children
    return [
      {
        ...element,
        children: processChildren(element.children as RootContent[]),
      } as RootContent,
    ];
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
