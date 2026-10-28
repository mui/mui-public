import type { Element, ElementContent } from 'hast';

/**
 * Removes a suffix from the end of highlighted HAST nodes.
 *
 * Mirror of `removePrefixFromHighlightedNodes`: used to strip temporary
 * trailing characters that were appended to the source before highlighting
 * (e.g., closing `)` for object-literal wrapping).
 *
 * @param children - The array of HAST nodes to modify
 * @param suffixLength - The number of characters to remove from the end
 */
export function removeSuffixFromHighlightedNodes(
  children: ElementContent[],
  suffixLength: number,
): void {
  let removedLength = 0;

  while (removedLength < suffixLength && children.length > 0) {
    const lastChild = children[children.length - 1];

    if (lastChild.type === 'text') {
      const textLength = lastChild.value.length;
      if (removedLength + textLength <= suffixLength) {
        children.pop();
        removedLength += textLength;
      } else {
        const charsToRemove = suffixLength - removedLength;
        lastChild.value = lastChild.value.slice(0, textLength - charsToRemove);
        removedLength = suffixLength;
      }
    } else if (lastChild.type === 'element') {
      const element = lastChild as Element;
      if (element.children && element.children.length > 0) {
        const lastElementChild = element.children[element.children.length - 1];
        if (lastElementChild.type === 'text') {
          const textLength = lastElementChild.value.length;
          if (removedLength + textLength <= suffixLength) {
            element.children.pop();
            removedLength += textLength;
            if (element.children.length === 0) {
              children.pop();
            }
          } else {
            const charsToRemove = suffixLength - removedLength;
            lastElementChild.value = lastElementChild.value.slice(0, textLength - charsToRemove);
            removedLength = suffixLength;
          }
        } else {
          break;
        }
      } else {
        children.pop();
      }
    } else {
      break;
    }
  }
}
