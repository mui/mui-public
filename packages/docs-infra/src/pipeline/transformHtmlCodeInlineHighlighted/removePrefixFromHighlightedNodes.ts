import type { Element, ElementContent } from 'hast';

/**
 * Removes a prefix from the beginning of highlighted HAST nodes.
 *
 * This function is used after syntax highlighting to remove temporary prefix text
 * that was added to provide context for the highlighter. The prefix may span across
 * multiple text nodes and element boundaries.
 *
 * @param children - The array of HAST nodes to modify
 * @param prefixLength - The number of characters to remove from the beginning
 *
 * @example
 * // Remove "type _ = " prefix from highlighted type
 * const nodes = [
 *   { type: 'element', children: [{ type: 'text', value: 'type _ = string' }] }
 * ];
 * removePrefixFromHighlightedNodes(nodes, 9);
 * // Result: [{ type: 'element', children: [{ type: 'text', value: 'string' }] }]
 */
export function removePrefixFromHighlightedNodes(
  children: ElementContent[],
  prefixLength: number,
): void {
  let removedLength = 0;

  // Remove nodes/text until we've removed the full prefix
  while (removedLength < prefixLength && children.length > 0) {
    const firstChild = children[0];

    if (firstChild.type === 'text') {
      const textLength = firstChild.value.length;
      if (removedLength + textLength <= prefixLength) {
        // Remove entire text node
        children.shift();
        removedLength += textLength;
      } else {
        // Remove part of text node
        const charsToRemove = prefixLength - removedLength;
        firstChild.value = firstChild.value.slice(charsToRemove);
        removedLength = prefixLength;
      }
    } else if (firstChild.type === 'element') {
      // For elements, we need to recurse into their children
      const element = firstChild as Element;
      if (element.children && element.children.length > 0) {
        const firstElementChild = element.children[0];
        if (firstElementChild.type === 'text') {
          const textLength = firstElementChild.value.length;
          if (removedLength + textLength <= prefixLength) {
            // Remove entire text node
            element.children.shift();
            removedLength += textLength;
            // If element is now empty, remove it too
            if (element.children.length === 0) {
              children.shift();
            }
          } else {
            // Remove part of text node
            const charsToRemove = prefixLength - removedLength;
            firstElementChild.value = firstElementChild.value.slice(charsToRemove);
            removedLength = prefixLength;
          }
        } else {
          // If first child isn't text, we can't easily handle this
          // Just stop trying to remove prefix
          break;
        }
      } else {
        // Empty element, remove it
        children.shift();
      }
    } else {
      // Unknown node type, stop trying to remove prefix
      break;
    }
  }
}
