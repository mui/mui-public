import type { Element, ElementContent } from 'hast';

/**
 * Removes a prefix from the beginning of highlighted HAST nodes.
 *
 * Used after syntax highlighting to strip temporary prefix text (e.g. `type _ = `)
 * that was added to give the highlighter valid TypeScript. The prefix may span
 * across multiple text nodes AND across arbitrarily-nested element boundaries,
 * so this walks recursively and returns the number of characters it consumed
 * so callers can coordinate.
 */
export function removePrefixFromHighlightedNodes(
  children: ElementContent[],
  prefixLength: number,
): number {
  let removedLength = 0;

  while (removedLength < prefixLength && children.length > 0) {
    const firstChild = children[0];

    if (firstChild.type === 'text') {
      const textLength = firstChild.value.length;
      if (removedLength + textLength <= prefixLength) {
        children.shift();
        removedLength += textLength;
      } else {
        const charsToRemove = prefixLength - removedLength;
        firstChild.value = firstChild.value.slice(charsToRemove);
        removedLength = prefixLength;
      }
    } else if (firstChild.type === 'element') {
      const element = firstChild as Element;
      if (!element.children || element.children.length === 0) {
        children.shift();
        continue;
      }
      const consumed = removePrefixFromHighlightedNodes(
        element.children as ElementContent[],
        prefixLength - removedLength,
      );
      removedLength += consumed;
      if (element.children.length === 0) {
        children.shift();
      } else if (consumed === 0) {
        // Defensive: nothing removable here, stop rather than spin.
        break;
      }
    } else {
      break;
    }
  }

  return removedLength;
}
