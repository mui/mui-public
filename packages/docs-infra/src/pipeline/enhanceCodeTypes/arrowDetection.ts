import type { ElementContent } from 'hast';
import { isKeywordSpan, getTextContent } from './hastUtils';

/**
 * Scans forward through sibling nodes to determine if `=>` or a function body `{`
 * follows after the matching `)` for the current `(`. This confirms that a
 * parenthesized expression is actually a function parameter list.
 *
 * Starts scanning from `charIndex` within the text node at `siblings[siblingIndex]`,
 * with an initial paren depth of 1 (the opening `(` has been consumed).
 */
export function hasArrowAfterParens(
  siblings: ElementContent[],
  siblingIndex: number,
  charIndex: number,
): boolean {
  let depth = 1;

  // Scan the rest of the current text node
  const firstNode = siblings[siblingIndex];
  if (firstNode.type === 'text') {
    for (let j = charIndex; j < firstNode.value.length; j += 1) {
      const c = firstNode.value[j];
      if (c === '(') {
        depth += 1;
      } else if (c === ')') {
        depth -= 1;
        if (depth === 0) {
          // Check the rest of this text node for =>
          const rest = firstNode.value.substring(j + 1).trimStart();
          if (rest.startsWith('=>')) {
            return true;
          }
          // Need to check subsequent siblings
          return checkSiblingsForArrow(siblings, siblingIndex + 1);
        }
      }
    }
  }

  // Continue scanning subsequent siblings
  for (let s = siblingIndex + 1; s < siblings.length; s += 1) {
    const sib = siblings[s];
    if (sib.type === 'text') {
      for (let j = 0; j < sib.value.length; j += 1) {
        const c = sib.value[j];
        if (c === '(') {
          depth += 1;
        } else if (c === ')') {
          depth -= 1;
          if (depth === 0) {
            const rest = sib.value.substring(j + 1).trimStart();
            if (rest.startsWith('=>')) {
              return true;
            }
            return checkSiblingsForArrow(siblings, s + 1);
          }
        }
      }
    }
    // Element nodes (spans) don't contain parens in their text content for our purposes,
    // but we skip them for depth tracking. The `=>` keyword is always a pl-k span.
  }

  return false;
}

/**
 * After finding the matching `)`, checks subsequent siblings for `=>` (pl-k span or text).
 * Bare `{` is NOT accepted — that pattern is a function declaration handled by case 3
 * (sawFunctionKeyword). Accepting `{` here would false-classify `if(cond){}` as a function.
 * Skips whitespace text nodes and return-type annotations (`: Type`).
 */
export function checkSiblingsForArrow(siblings: ElementContent[], startIndex: number): boolean {
  let sawReturnTypeColon = false;

  for (let s = startIndex; s < siblings.length; s += 1) {
    const sib = siblings[s];
    if (sib.type === 'text') {
      const trimmed = sib.value.trimStart();
      if (trimmed.length === 0) {
        continue; // whitespace-only text node, skip
      }
      // Text starting with => confirms arrow function
      if (trimmed.startsWith('=>')) {
        return true;
      }
      // Colon after `)` means a return-type annotation (e.g., `(a): Result => {}`)
      if (!sawReturnTypeColon && trimmed.startsWith(':')) {
        sawReturnTypeColon = true;
        continue;
      }
      // Inside a return type annotation, skip type-related text tokens
      if (sawReturnTypeColon) {
        continue;
      }
      return false;
    }
    if (sib.type === 'element') {
      if (isKeywordSpan(sib)) {
        const text = getTextContent(sib);
        // pl-k span containing "=>" confirms arrow function
        if (text === '=>') {
          return true;
        }
        // pl-k ":" is a return-type annotation colon
        if (!sawReturnTypeColon && text === ':') {
          sawReturnTypeColon = true;
          continue;
        }
      }
      // Inside a return type annotation, skip type name spans and other tokens
      if (sawReturnTypeColon) {
        continue;
      }
      // Any other element without a prior colon means it's not an arrow function
      return false;
    }
  }
  return false;
}
