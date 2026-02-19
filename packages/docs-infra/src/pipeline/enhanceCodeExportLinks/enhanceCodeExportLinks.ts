import type { Root as HastRoot, Element, Text, ElementContent } from 'hast';
import { visit } from 'unist-util-visit';

/**
 * Options for the enhanceCodeExportLinks plugin.
 */
export interface EnhanceCodeExportLinksOptions {
  /**
   * Map from export names (both flat and dotted) to their anchor hrefs.
   * Examples:
   * - "AccordionTrigger" → "#trigger"
   * - "Accordion.Trigger" → "#trigger"
   * - "AccordionTriggerState" → "#trigger.state"
   * - "Accordion.Trigger.State" → "#trigger.state"
   */
  anchorMap: Record<string, string>;
  /**
   * When set, the plugin emits a custom component element instead of an `<a>` tag.
   * The custom element receives `href` and `name` (the matched identifier) as properties.
   * This is used to render interactive type popovers via a `TypeRef` component.
   */
  typeRefComponent?: string;
}

/**
 * Classes that may contain linkable type names in GitHub syntax highlighting.
 * - pl-c1: Primer Light constant (constants, asterisk in imports)
 * - pl-en: Primer Light entity.name (type names, function names)
 */
const LINKABLE_CLASSES = ['pl-c1', 'pl-en'];

/**
 * Checks if an element is a linkable span (pl-c1 or pl-en).
 * Only spans are considered linkable - not anchors we've already created.
 */
function isLinkableSpan(element: Element): boolean {
  // Only spans can be linkable (not anchors we may have already created)
  if (element.tagName !== 'span') {
    return false;
  }
  const className = element.properties?.className;
  if (!Array.isArray(className)) {
    return false;
  }
  return LINKABLE_CLASSES.some((cls) => className.includes(cls));
}

/**
 * Gets the text content of an element (concatenates all text children).
 */
function getTextContent(element: Element): string {
  let text = '';
  for (const child of element.children) {
    if (child.type === 'text') {
      text += child.value;
    }
  }
  return text;
}

/**
 * Represents a chain of linkable spans that may form a dotted identifier.
 * For example: `Accordion.Trigger.State` would be represented as:
 * - spans: [span with "Accordion", span with "Trigger", span with "State"]
 * - dotTexts: [text node with ".", text node with "."]
 * - startIndex: index in parent children where the chain starts
 * - endIndex: index in parent children where the chain ends (inclusive)
 */
interface LinkableChain {
  spans: Element[];
  dotTexts: Text[];
  startIndex: number;
  endIndex: number;
}

/**
 * Finds chains of linkable spans (pl-c1 or pl-en) separated by "." text nodes.
 * Returns all chains found in the children array.
 */
function findLinkableChains(children: ElementContent[]): LinkableChain[] {
  const chains: LinkableChain[] = [];
  let i = 0;

  while (i < children.length) {
    const node = children[i];

    // Look for a linkable span to start a chain
    if (node.type === 'element' && isLinkableSpan(node)) {
      const chain: LinkableChain = {
        spans: [node],
        dotTexts: [],
        startIndex: i,
        endIndex: i,
      };

      // Try to extend the chain with `.` followed by another linkable span
      let j = i + 1;
      while (j < children.length - 1) {
        const maybeText = children[j];
        const maybeNextSpan = children[j + 1];

        // Check for pattern: text node with just "." followed by linkable span
        if (
          maybeText.type === 'text' &&
          maybeText.value === '.' &&
          maybeNextSpan.type === 'element' &&
          isLinkableSpan(maybeNextSpan)
        ) {
          chain.dotTexts.push(maybeText);
          chain.spans.push(maybeNextSpan);
          chain.endIndex = j + 1;
          j += 2;
        } else {
          break;
        }
      }

      chains.push(chain);
      i = chain.endIndex + 1;
    } else {
      i += 1;
    }
  }

  return chains;
}

/**
 * Builds the full identifier string from a chain.
 * For example: ["Accordion", "Trigger", "State"] → "Accordion.Trigger.State"
 */
function chainToIdentifier(chain: LinkableChain): string {
  return chain.spans.map(getTextContent).join('.');
}

/**
 * Creates a link element wrapping the given children.
 * When `tagName` is provided, emits a custom component element with `name` property.
 * Otherwise, emits a standard `<a>` element.
 */
function createLinkElement(
  href: string,
  children: ElementContent[],
  identifier: string,
  className?: string[],
  tagName?: string,
): Element {
  if (tagName) {
    return {
      type: 'element',
      tagName,
      properties:
        className && className.length > 0
          ? { href, name: identifier, className }
          : { href, name: identifier },
      children,
    };
  }
  return {
    type: 'element',
    tagName: 'a',
    properties: className && className.length > 0 ? { href, className } : { href },
    children,
  };
}

/**
 * Enhances children by linking linkable spans to their corresponding anchors.
 * - Single linkable spans that match are converted to anchor elements.
 * - Chains of linkable spans (separated by ".") are wrapped in a single anchor.
 * - Recursively processes nested elements (like frame/line spans).
 */
function enhanceChildren(
  children: ElementContent[],
  anchorMap: Record<string, string>,
  typeRefComponent?: string,
): ElementContent[] {
  // First, recursively process any nested elements
  const processedChildren = children.map((child) => {
    if (child.type === 'element' && !isLinkableSpan(child) && child.children) {
      // Recursively process children of non-linkable elements
      return {
        ...child,
        children: enhanceChildren(child.children, anchorMap, typeRefComponent),
      } as Element;
    }
    return child;
  });

  const chains = findLinkableChains(processedChildren);

  if (chains.length === 0) {
    return processedChildren;
  }

  // Build new children array, replacing matched chains with anchors
  const newChildren: ElementContent[] = [];
  let currentIndex = 0;

  for (const chain of chains) {
    // Add any nodes before this chain
    while (currentIndex < chain.startIndex) {
      newChildren.push(processedChildren[currentIndex]);
      currentIndex += 1;
    }

    // Build the identifier and look it up
    const identifier = chainToIdentifier(chain);
    const href = anchorMap[identifier];

    if (href) {
      if (chain.spans.length === 1) {
        // Single span: convert the span to an anchor with the same class
        const span = chain.spans[0];
        const className = span.properties?.className;
        const link = createLinkElement(
          href,
          span.children,
          identifier,
          Array.isArray(className) ? (className as string[]) : undefined,
          typeRefComponent,
        );
        newChildren.push(link);
      } else {
        // Multiple spans: wrap all nodes (spans + dots) in a single anchor
        const wrappedChildren: ElementContent[] = [];
        for (let k = 0; k < chain.spans.length; k += 1) {
          wrappedChildren.push(chain.spans[k]);
          if (k < chain.dotTexts.length) {
            wrappedChildren.push(chain.dotTexts[k]);
          }
        }
        const link = createLinkElement(
          href,
          wrappedChildren,
          identifier,
          undefined,
          typeRefComponent,
        );
        newChildren.push(link);
      }
    } else {
      // No match: keep the original nodes
      for (let k = chain.startIndex; k <= chain.endIndex; k += 1) {
        newChildren.push(processedChildren[k]);
      }
    }

    currentIndex = chain.endIndex + 1;
  }

  // Add any remaining nodes after the last chain
  while (currentIndex < processedChildren.length) {
    newChildren.push(processedChildren[currentIndex]);
    currentIndex += 1;
  }

  return newChildren;
}

/**
 * A rehype plugin that links code identifiers (pl-c1 and pl-en spans) to their
 * corresponding type documentation anchors.
 *
 * Transforms patterns like:
 * `<code><span class="pl-en">Trigger</span></code>`
 *
 * Into:
 * `<code><a href="#trigger" class="pl-en">Trigger</a></code>`
 *
 * And chains like:
 * `<code><span class="pl-en">Accordion</span>.<span class="pl-en">Trigger</span></code>`
 *
 * Into:
 * `<code><a href="#trigger"><span class="pl-en">Accordion</span>.<span class="pl-en">Trigger</span></a></code>`
 *
 * This allows users to click on type references in code to navigate to
 * their documentation.
 *
 * **Important**: This plugin should run after syntax highlighting plugins
 * (like transformHtmlCodeInlineHighlighted) as it modifies the structure
 * of highlighted elements.
 *
 * @param options - Configuration options including the anchorMap
 * @returns A unified transformer function
 */
export default function enhanceCodeExportLinks(options: EnhanceCodeExportLinksOptions) {
  const { anchorMap, typeRefComponent } = options;

  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element) => {
      // Only process code elements
      if (node.tagName !== 'code') {
        return;
      }

      // Skip if no children
      if (!node.children || node.children.length === 0) {
        return;
      }

      // Process children and replace with enhanced version
      node.children = enhanceChildren(node.children, anchorMap, typeRefComponent);
    });
  };
}
