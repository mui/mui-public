import { createStarryNight } from '@wooorm/starry-night';
import type { Root as HastRoot, Element } from 'hast';
import { visit } from 'unist-util-visit';
import { grammars, extensionMap } from '../parseSource/grammars';
import { removePrefixFromHighlightedNodes } from './removePrefixFromHighlightedNodes';

type StarryNight = Awaited<ReturnType<typeof createStarryNight>>;

const STARRY_NIGHT_KEY = '__docs_infra_starry_night_instance__';

/**
 * Options for the transformHtmlCodeInlineHighlighted plugin.
 */
export interface TransformHtmlCodeInlineHighlightedOptions {
  /**
   * When true, also processes code elements inside pre elements.
   * By default, code inside pre is skipped (handled by transformHtmlCodePrecomputed).
   * When enabled, code inside pre will NOT get the data-inline attribute.
   * @default false
   */
  includePreElements?: boolean;
}

/**
 * Ensures Starry Night is initialized and returns the instance.
 * Uses a global singleton for efficiency across multiple plugin invocations.
 */
async function getStarryNight(): Promise<StarryNight> {
  if (!(globalThis as any)[STARRY_NIGHT_KEY]) {
    (globalThis as any)[STARRY_NIGHT_KEY] = await createStarryNight(grammars);
  }
  return (globalThis as any)[STARRY_NIGHT_KEY];
}

/**
 * A rehype plugin that applies inline syntax highlighting to code elements.
 * Unlike transformHtmlCodePrecomputed, this does NOT add line gutters or precomputed data.
 * It's meant for inline code snippets that should be highlighted but remain lightweight.
 *
 * Processes code elements and replaces their text content with syntax-highlighted HAST nodes.
 *
 * @param options - Configuration options for the plugin
 * @returns A unified transformer function
 */
export default function transformHtmlCodeInlineHighlighted(
  options: TransformHtmlCodeInlineHighlightedOptions = {},
) {
  const { includePreElements = false } = options;

  return async (tree: HastRoot) => {
    const starryNight = await getStarryNight();

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
      const getTextContent = (children: typeof node.children): string => {
        return children
          .map((child) => {
            if (child.type === 'text') {
              return child.value;
            }
            if (child.type === 'element' && 'children' in child) {
              return getTextContent(child.children);
            }
            return '';
          })
          .join('');
      };

      const source = getTextContent(node.children);
      if (!source) {
        return;
      }

      // Check if there's a highlighting prefix in the data attributes
      const highlightingPrefix =
        typeof node.properties?.dataHighlightingPrefix === 'string'
          ? node.properties.dataHighlightingPrefix
          : undefined;

      // Temporarily prepend the prefix for proper syntax highlighting
      const sourceToHighlight = highlightingPrefix ? `${highlightingPrefix}${source}` : source;

      // Determine language from className (e.g., 'language-ts')
      const className = node.properties?.className;
      let fileType: string | undefined;

      if (Array.isArray(className)) {
        const langClass = className.find((c) => typeof c === 'string' && c.startsWith('language-'));
        if (langClass && typeof langClass === 'string') {
          const lang = langClass.replace('language-', '');
          // Map common language names to file extensions
          const langToExt: Record<string, string> = {
            ts: '.ts',
            typescript: '.ts',
            js: '.js',
            javascript: '.js',
            jsx: '.jsx',
            tsx: '.tsx',
            css: '.css',
            html: '.html',
            json: '.json',
            md: '.md',
            markdown: '.md',
            sh: '.sh',
            shell: '.sh',
            bash: '.sh',
            yaml: '.yaml',
            yml: '.yaml',
          };
          fileType = langToExt[lang] || `.${lang}`;
        }
      }

      // Skip if no language specified or unsupported type
      if (!fileType || !extensionMap[fileType]) {
        return;
      }

      // Apply syntax highlighting
      const highlighted = starryNight.highlight(sourceToHighlight, extensionMap[fileType]);

      // Replace the code element's children with the highlighted nodes
      if (highlighted.type === 'root' && highlighted.children) {
        node.children = highlighted.children as any;

        // If we added a prefix for highlighting, remove it from the output
        if (highlightingPrefix && node.children.length > 0) {
          removePrefixFromHighlightedNodes(node.children, highlightingPrefix.length);
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
