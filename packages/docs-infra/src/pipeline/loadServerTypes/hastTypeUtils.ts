/**
 * HAST type detection utilities for analyzing syntax-highlighted TypeScript types.
 *
 * These utilities work on already-highlighted HAST nodes to detect type patterns
 * (unions, functions, objects) and derive shortType/detailedType variants.
 */

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
 * Checks if a HAST element has a specific CSS class.
 */
function hasClass(element: Element, className: string): boolean {
  const classes = element.properties?.className;
  if (Array.isArray(classes)) {
    return classes.includes(className);
  }
  if (typeof classes === 'string') {
    return classes.split(' ').includes(className);
  }
  return false;
}

/**
 * Finds all elements with a specific class in a HAST tree.
 */
function findElementsWithClass(
  node: HastRoot | Element | RootContent,
  className: string,
): Element[] {
  const results: Element[] = [];

  if (node.type === 'element') {
    if (hasClass(node, className)) {
      results.push(node);
    }
  }

  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      results.push(...findElementsWithClass(child as RootContent, className));
    }
  }

  return results;
}

/**
 * Checks if a HAST tree contains a top-level pipe operator (|) indicating a union type.
 * Top-level means not nested inside parentheses or braces.
 *
 * Starry Night highlights `|` with the `pl-k` (keyword) class.
 */
export function isUnionHast(hast: HastRoot): boolean {
  // Track nesting depth
  const fullText = getHastTextContent(hast);
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let angleDepth = 0;

  // Scan through text to find top-level pipes
  for (const char of fullText) {
    switch (char) {
      case '(':
        parenDepth += 1;
        break;
      case ')':
        parenDepth -= 1;
        break;
      case '{':
        braceDepth += 1;
        break;
      case '}':
        braceDepth -= 1;
        break;
      case '[':
        bracketDepth += 1;
        break;
      case ']':
        bracketDepth -= 1;
        break;
      case '<':
        angleDepth += 1;
        break;
      case '>':
        angleDepth -= 1;
        break;
      case '|':
        // Check if this is a top-level pipe (not nested)
        if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0 && angleDepth === 0) {
          return true;
        }
        break;
      default:
        // Other characters don't affect depth tracking
        break;
    }
  }

  return false;
}

/**
 * Checks if a HAST tree represents a function type.
 *
 * Function types contain `=>` which Starry Night highlights with `pl-k` (keyword) class.
 */
export function isFunctionHast(hast: HastRoot): boolean {
  // Find all keyword elements (pl-k class)
  const keywordElements = findElementsWithClass(hast, 'pl-k');

  // Check if any keyword element contains '=>'
  for (const element of keywordElements) {
    const text = getHastTextContent(element);
    if (text.includes('=>')) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a HAST tree represents an object type.
 *
 * Object types contain `{` and `}` braces at the top level.
 */
export function isObjectHast(hast: HastRoot): boolean {
  const fullText = getHastTextContent(hast);

  // Simple check: starts with { (after trimming)
  const trimmed = fullText.trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}');
}

/**
 * Checks if a HAST tree represents an array type.
 *
 * Array types end with `[]`.
 */
export function isArrayHast(hast: HastRoot): boolean {
  const fullText = getHastTextContent(hast);
  return fullText.trim().endsWith('[]');
}

/**
 * Checks if a HAST tree represents a tuple type.
 *
 * Tuple types start with `[` and end with `]` but are not arrays.
 */
export function isTupleHast(hast: HastRoot): boolean {
  const fullText = getHastTextContent(hast);
  const trimmed = fullText.trim();
  return trimmed.startsWith('[') && trimmed.endsWith(']') && !trimmed.endsWith('[]');
}

/**
 * Derives the short type string from a highlighted HAST based on its structure.
 *
 * This function analyzes the HAST structure to determine what simplified label
 * to show (e.g., "Union", "function") without needing the original plain text.
 *
 * @param name - The property name (used for special cases like className, render)
 * @param hast - The syntax-highlighted HAST to analyze
 * @returns A short type string, or undefined if no shortening is needed
 */
export function getShortTypeFromHast(name: string, hast: HastRoot): string | undefined {
  // Event handlers and getters show as "function"
  if (/^(on|get)[A-Z].*/.test(name)) {
    return 'function';
  }

  // className can be string or function
  if (name === 'className') {
    return 'string | function';
  }

  // style can be React.CSSProperties or function
  if (name === 'style') {
    return 'React.CSSProperties | function';
  }

  // render can be ReactElement or function
  if (name === 'render') {
    return 'ReactElement | function';
  }

  // These props never get shortened - always show actual type
  if (name.endsWith('Ref') || name === 'children') {
    return undefined;
  }

  // Check for union type first - complex unions should be shortened to "Union"
  // even if they contain function types
  if (isUnionHast(hast)) {
    const fullText = getHastTextContent(hast);
    const pipeCount = (fullText.match(/\|/g) || []).length;

    // Simple unions (less than 3 members AND short text) don't need shortening
    // This matches the original: (type.split('|').length < 3 && type.length < 30)
    if (pipeCount < 2 && fullText.length < 30) {
      return undefined;
    }

    return 'Union';
  }

  // Check for function type (only for non-union function types)
  if (isFunctionHast(hast)) {
    return 'function';
  }

  // Simple types don't need a short version
  return undefined;
}

/**
 * Determines whether a type should have a detailed expanded view based on its HAST structure.
 *
 * @param name - The property name (used for special cases)
 * @param hast - The syntax-highlighted HAST to analyze
 * @returns true if the type should have a detailed view
 */
export function shouldShowDetailedTypeFromHast(name: string, hast: HastRoot): boolean {
  // Event handlers and getters typically have complex function signatures
  if (/^(on|get)[A-Z].*/.test(name)) {
    return true;
  }

  // className can be string or function, show details
  if (name === 'className') {
    return true;
  }

  // render prop can be ReactElement or function, show details
  if (name === 'render') {
    return true;
  }

  // Simple types and short unions don't need expansion
  if (name.endsWith('Ref') || name === 'children') {
    return false;
  }

  const fullText = getHastTextContent(hast);

  // Simple intrinsic types don't need expansion
  if (fullText === 'boolean' || fullText === 'string' || fullText === 'number') {
    return false;
  }

  // Check if it's a union
  if (!isUnionHast(hast)) {
    return false;
  }

  // Count union members (approximate by counting top-level pipes)
  const pipeCount = (fullText.match(/\|/g) || []).length;

  // Short unions (less than 3 members and short text) don't need expansion
  if (pipeCount < 2 && fullText.length < 30) {
    return false;
  }

  // Complex unions benefit from detailed expansion
  return true;
}

/**
 * Result of collecting type references from HAST.
 */
export interface TypeReference {
  /** The full dotted name (e.g., "Slider.Root.State" or "DirectionProvider") */
  name: string;
  /** Start index in parent's children array */
  startIndex: number;
  /** End index in parent's children array (exclusive) */
  endIndex: number;
  /** The parent element containing this reference */
  parent: Element;
}

/**
 * Collects all type references (pl-en spans) from a HAST tree.
 *
 * This function walks the HAST and identifies type references that could be
 * replaced with their definitions. It handles both:
 * - Single identifiers (e.g., `DirectionProvider`)
 * - Dotted identifiers (e.g., `Slider.Root.State`)
 *
 * @param hast - The HAST root to analyze
 * @returns Array of type references found
 */
export function collectTypeReferences(hast: HastRoot): TypeReference[] {
  const references: TypeReference[] = [];

  function walkElement(element: Element): void {
    const children = element.children || [];

    let i = 0;
    while (i < children.length) {
      const child = children[i];

      // Look for pl-en spans (entity names / type identifiers)
      if (child.type === 'element' && child.tagName === 'span' && hasClass(child, 'pl-en')) {
        // Start collecting a potential multi-part reference
        const startIndex = i;
        const nameParts: string[] = [getHastTextContent(child)];

        // Look ahead for `.` followed by another pl-en span
        let j = i + 1;
        while (j < children.length - 1) {
          const dotCandidate = children[j];
          const nextCandidate = children[j + 1];

          // Check if we have a dot text node followed by a pl-en span
          const isDot = dotCandidate.type === 'text' && dotCandidate.value === '.';

          const isNextPlEn =
            nextCandidate.type === 'element' &&
            nextCandidate.tagName === 'span' &&
            hasClass(nextCandidate, 'pl-en');

          if (isDot && isNextPlEn) {
            nameParts.push(getHastTextContent(nextCandidate));
            j += 2; // Skip the dot and the pl-en span
          } else {
            break;
          }
        }

        // Record the reference
        references.push({
          name: nameParts.join('.'),
          startIndex,
          endIndex: j,
          parent: element,
        });

        // Continue from where we left off
        i = j;
      } else {
        // Recurse into child elements
        if (child.type === 'element') {
          walkElement(child);
        }
        i += 1;
      }
    }
  }

  // Start from root's children
  for (const child of hast.children) {
    if (child.type === 'element') {
      walkElement(child);
    }
  }

  return references;
}

/**
 * Replaces type references in a HAST with their expanded definitions.
 *
 * @param hast - The HAST to modify (will be cloned)
 * @param highlightedExports - Map of export names to their highlighted HAST definitions
 * @returns A new HAST with references replaced, or the original if no replacements needed
 */
export function replaceTypeReferences(
  hast: HastRoot,
  highlightedExports: Record<string, HastRoot>,
): HastRoot {
  // Deep clone the HAST to avoid mutating the original
  const cloned = JSON.parse(JSON.stringify(hast)) as HastRoot;

  const references = collectTypeReferences(cloned);

  // Process references in reverse order so indices remain valid
  for (let i = references.length - 1; i >= 0; i -= 1) {
    const ref = references[i];

    // Check if this reference has a definition in our exports
    const definition = highlightedExports[ref.name];
    if (!definition) {
      continue;
    }

    // Get the content to insert (children of the code element from the definition)
    const defCodeElement = definition.children[0];
    if (defCodeElement?.type !== 'element') {
      continue;
    }

    const replacementChildren = (defCodeElement as Element).children || [];

    // Replace the reference span(s) with the definition content
    const parent = ref.parent;
    parent.children.splice(
      ref.startIndex,
      ref.endIndex - ref.startIndex,
      ...JSON.parse(JSON.stringify(replacementChildren)),
    );
  }

  return cloned;
}
