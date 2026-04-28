import type { Root as HastRoot, Element, Text, RootContent } from 'hast';

/**
 * Extracts all text content from a HAST node recursively.
 */
export function getHastTextContent(node: HastRoot | Element | Text | RootContent): string {
  if (node.type === 'text') {
    return node.value || '';
  }
  if ('children' in node && Array.isArray(node.children)) {
    return node.children.map((child) => getHastTextContent(child as RootContent)).join('');
  }
  return '';
}

/**
 * Gets the direct text content of a HAST element (non-recursive, first level only).
 */
export function getShallowTextContent(element: Element): string {
  let text = '';
  for (const child of element.children) {
    if (child.type === 'text') {
      text += child.value;
    }
  }
  return text;
}
