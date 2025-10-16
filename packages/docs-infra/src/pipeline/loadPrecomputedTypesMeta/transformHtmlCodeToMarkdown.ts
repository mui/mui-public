import type { Root, Element } from 'hast';
import { visit } from 'unist-util-visit';
import type { Code } from '../../CodeHighlighter/types';
import { stringOrHastToString } from '../hastUtils/hastUtils';

/**
 * Rehype plugin that expands precomputed code blocks.
 *
 * When converting HAST back to MDAST, code blocks with precomputed syntax highlighting
 * (stored in `dataPrecompute` attribute) need to be expanded into their full HAST representation.
 * This plugin finds such `<pre>` elements and replaces them with the precomputed HAST nodes.
 *
 * The `dataPrecompute` attribute contains a JSON stringified `Code` object, which may include
 * HAST nodes in various formats (direct objects, hastJson strings, or hastGzip compressed strings).
 */
export default function transformHtmlCodeToMarkdown() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'pre' || !node.properties?.dataPrecompute) {
        return;
      }

      const dataPrecomputeRaw = node.properties.dataPrecompute;

      // dataPrecompute is a JSON stringified Code object
      if (typeof dataPrecomputeRaw !== 'string') {
        return;
      }

      try {
        // Parse the Code object
        const code: Code = JSON.parse(dataPrecomputeRaw);

        // Get the first variant (usually there's only one for inline code)
        const variantKey = Object.keys(code)[0];
        const variant = code[variantKey];

        if (!variant || typeof variant === 'string') {
          return;
        }

        // The variant should have a source which can be:
        // 1. A HAST node (object with type, children, etc.)
        // 2. A serialized HAST: { hastJson: string }
        // 3. A compressed HAST: { hastGzip: string }
        // 4. A string (not highlighted)
        const source = variant.source;

        if (!source) {
          return;
        }

        // Convert the source (HAST or string) to plain text
        const codeText = stringOrHastToString(source);

        // Create a <div> containing <pre><code> structure for proper markdown conversion
        const divNode: Element = {
          type: 'element',
          tagName: 'div',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'pre',
              properties: {},
              children: [
                {
                  type: 'element',
                  tagName: 'code',
                  properties: {},
                  children: [
                    {
                      type: 'text',
                      value: codeText,
                    },
                  ],
                },
              ],
            },
            // TODO: handle variant.extraFiles
          ],
        };

        // Replace the current node with the new div structure
        if (parent && typeof index === 'number') {
          parent.children[index] = divNode;
        }
      } catch (error) {
        // If parsing fails, leave the node as-is
        console.error('Failed to parse dataPrecompute:', error);
      }
    });
  };
}
