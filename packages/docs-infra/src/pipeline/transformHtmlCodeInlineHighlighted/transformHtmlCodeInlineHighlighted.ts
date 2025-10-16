import { createStarryNight } from '@wooorm/starry-night';
import type { Root as HastRoot, Element } from 'hast';
import { visit } from 'unist-util-visit';
import { grammars, extensionMap } from '../parseSource/grammars';
import { removePrefixFromHighlightedNodes } from './removePrefixFromHighlightedNodes';

type StarryNight = Awaited<ReturnType<typeof createStarryNight>>;

const STARRY_NIGHT_KEY = '__docs_infra_starry_night_instance__';

/**
 * Ensures Starry Night is initialized and ready to use.
 * Call this once before using the transformHtmlCodeInlineHighlighted plugin.
 */
export async function ensureStarryNightInitialized(): Promise<void> {
  if (!(globalThis as any)[STARRY_NIGHT_KEY]) {
    (globalThis as any)[STARRY_NIGHT_KEY] = await createStarryNight(grammars);
  }
}

/**
 * A rehype plugin that applies inline syntax highlighting to code elements.
 * Unlike transformHtmlCodePrecomputed, this does NOT add line gutters or precomputed data.
 * It's meant for inline code snippets that should be highlighted but remain lightweight.
 *
 * Processes code elements and replaces their text content with syntax-highlighted HAST nodes.
 *
 * @returns A unified transformer function
 */
export default function transformHtmlCodeInlineHighlighted() {
  return async (tree: HastRoot) => {
    const starryNight = (globalThis as any)[STARRY_NIGHT_KEY] as StarryNight | undefined;
    if (!starryNight) {
      throw new Error(
        'Starry Night not initialized. Call ensureStarryNightInitialized() before using transformHtmlCodeInlineHighlighted.',
      );
    }

    visit(tree, 'element', (node: Element) => {
      // Only process code elements (inline code or code blocks without special handling)
      if (node.tagName !== 'code') {
        return;
      }

      // Skip if this is already part of a pre element (will be handled by transformHtmlCodePrecomputed)
      // or if it has no children
      if (!node.children || node.children.length === 0) {
        return;
      }

      // Extract the text content
      const textNode = node.children.find((child) => child.type === 'text');
      if (!textNode || textNode.type !== 'text') {
        return;
      }

      const source = textNode.value;

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

      // Remove the dataHighlightingPrefix property after processing
      if (node.properties?.dataHighlightingPrefix) {
        delete node.properties.dataHighlightingPrefix;
      }
    });
  };
}
