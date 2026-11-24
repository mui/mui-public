import type { Root as HastRoot, Element } from 'hast';
import { visit } from 'unist-util-visit';
import { getHighlighter } from '../parseSource/parseSource';
import { normalizeLanguage } from '../parseSource/languages';
import type { HighlightLanguage } from '../parseSource/languages';
import { extendSyntaxTokens } from '../parseSource/extendSyntaxTokens';
import { capabilitiesForLanguage } from '../parseSource/languageCapabilities';
import { getHastTextContent } from '../hastUtils';
import { removePrefixFromHighlightedNodes } from './removePrefixFromHighlightedNodes';
import { removeSuffixFromHighlightedNodes } from './removeSuffixFromHighlightedNodes';

function getInlineLanguage(node: Element): HighlightLanguage | undefined {
  const className = node.properties?.className;
  if (!Array.isArray(className)) {
    return undefined;
  }

  const languageClass = className.find(
    (classNameValue) =>
      typeof classNameValue === 'string' && classNameValue.startsWith('language-'),
  );
  if (typeof languageClass !== 'string') {
    return undefined;
  }

  return normalizeLanguage(languageClass.replace('language-', ''));
}

/**
 * Options for the transformHtmlCodeInline plugin.
 */
export interface TransformHtmlCodeInlineOptions {
  /**
   * When true, also processes code elements inside pre elements.
   * By default, code inside pre is skipped (handled by transformHtmlCodeBlock).
   * When enabled, code inside pre will NOT get the data-inline attribute.
   * @default false
   */
  includePreElements?: boolean;
}

/**
 * A rehype plugin that applies inline syntax highlighting to code elements.
 * Unlike transformHtmlCodeBlock, this does NOT add line gutters or precomputed data.
 * It's meant for inline code snippets that should be highlighted but remain lightweight.
 *
 * Processes code elements and replaces their text content with syntax-highlighted HAST nodes.
 *
 * @param options - Configuration options for the plugin
 * @returns A unified transformer function
 */
export default function transformHtmlCodeInline(options: TransformHtmlCodeInlineOptions = {}) {
  const { includePreElements = false } = options;

  return async (tree: HastRoot) => {
    const highlighter = await getHighlighter();

    visit(tree, 'element', (node: Element, _index, parent) => {
      // Only process code elements (inline code or code blocks without special handling)
      if (node.tagName !== 'code') {
        return;
      }

      // Check if this is inside a pre element
      const isInsidePre = parent && parent.type === 'element' && parent.tagName === 'pre';

      // Skip if this is inside a pre element (unless includePreElements is enabled)
      if (isInsidePre && !includePreElements) {
        return;
      }

      // Skip if it has no children
      if (!node.children || node.children.length === 0) {
        return;
      }

      // Extract all text content from children (handles multiple text nodes and newlines)
      const source = node.children.map((child) => getHastTextContent(child)).join('');
      if (!source) {
        return;
      }

      // Check if there's a highlighting prefix in the data attributes
      const highlightingPrefix =
        typeof node.properties?.dataHighlightingPrefix === 'string'
          ? node.properties.dataHighlightingPrefix
          : undefined;

      // Temporarily prepend the prefix for proper syntax highlighting
      let sourceToHighlight = highlightingPrefix ? `${highlightingPrefix}${source}` : source;

      // Inline JS-family snippets that look like a bare object literal (e.g. `{ height: 400 }`)
      // are tokenized as a block statement with labeled statements, which makes
      // the keys appear as `pl-en` (entity name) tokens rather than property names. Wrap them
      // in `(...)` so the snippet parses as an expression and `extendSyntaxTokens` can split
      // out the keys via `splitObjectKeys`. The wrapping characters are stripped after highlighting.
      let objectWrap = false;

      // Skip if no language specified or unsupported type
      const language = getInlineLanguage(node);
      if (!language) {
        return;
      }

      if (!highlightingPrefix && capabilitiesForLanguage(language).semantics === 'js') {
        const trimmed = sourceToHighlight.trim();
        if (trimmed.length >= 2 && trimmed.startsWith('{') && trimmed.endsWith('}')) {
          sourceToHighlight = `(${sourceToHighlight})`;
          objectWrap = true;
        }
      }

      // Apply syntax highlighting
      const highlighted = highlighter.highlight(sourceToHighlight, language);
      if (!highlighted) {
        return;
      }
      extendSyntaxTokens(highlighted, language);

      // Replace the code element's children with the highlighted nodes
      if (highlighted.type === 'root' && highlighted.children) {
        node.children = highlighted.children as any;

        // If we added a prefix for highlighting, remove it from the output
        if (highlightingPrefix && node.children.length > 0) {
          removePrefixFromHighlightedNodes(node.children, highlightingPrefix.length);
        }
        if (objectWrap && node.children.length > 0) {
          removePrefixFromHighlightedNodes(node.children, 1);
          removeSuffixFromHighlightedNodes(node.children, 1);
        }
      }

      // Mark this code element as inline highlighted (only for inline code, not pre>code)
      if (!isInsidePre) {
        node.properties = node.properties || {};
        node.properties.dataInline = '';
      }

      // Remove the dataHighlightingPrefix property after processing
      if (node.properties?.dataHighlightingPrefix) {
        delete node.properties.dataHighlightingPrefix;
      }
    });
  };
}
