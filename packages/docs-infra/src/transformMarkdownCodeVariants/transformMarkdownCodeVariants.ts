import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Code, Parent } from 'mdast';

/**
 * Remark plugin that transforms code blocks with variants into HTML pre/code structures.
 *
 * Transforms consecutive code blocks with variant metadata like:
 *
 * ```javascript variant=npm
 * npm install @mui/internal-docs-infra
 * ```
 * ```javascript variant=pnpm
 * pnpm install @mui/internal-docs-infra
 * ```
 * ```javascript variant=yarn
 * yarn add @mui/internal-docs-infra
 * ```
 *
 * OR with variant-group (with labels between):
 *
 * npm
 * ```bash variant-group=install
 * npm install @mui/internal-docs-infra
 * ```
 * pnpm
 * ```bash variant-group=install
 * pnpm install @mui/internal-docs-infra
 * ```
 * yarn
 * ```bash variant-group=install
 * yarn add @mui/internal-docs-infra
 * ```
 *
 * Into HTML that the existing rehype plugin can process:
 * <pre>
 *   <code data-variant="npm">npm install @mui/internal-docs-infra</code>
 *   <code data-variant="pnpm">pnpm install @mui/internal-docs-infra</code>
 *   <code data-variant="yarn">yarn add @mui/internal-docs-infra</code>
 * </pre>
 */

/**
 * Parse meta string to extract variant and other properties
 */
function parseMeta(meta: string) {
  const result: { variant?: string; variantGroup?: string; props: Record<string, string> } = {
    props: {},
  };

  // Parse key=value pairs, handling quoted values
  const regex = /([\w-]+)=("(?:[^"\\]|\\.)*"|[^\s]+)/g;
  let match = regex.exec(meta);

  while (match !== null) {
    const [, key, rawValue] = match;

    // Remove quotes if present
    const value =
      rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue;

    if (key === 'variant') {
      result.variant = value;
    } else if (key === 'variant-group') {
      result.variantGroup = value;
    } else {
      result.props[key] = value;
    }

    match = regex.exec(meta);
  }

  return result;
}

export const transformMarkdownCodeVariants: Plugin = () => {
  return (tree) => {
    const processedIndices = new Set<number>();
    const nodesToRemove: Set<any> = new Set();
    const replacements: Array<{ index: number; replacement: any }> = [];

    visit(tree, (node, index, parent) => {
      if (!parent || !Array.isArray((parent as Parent).children) || typeof index !== 'number') {
        return;
      }

      // Skip if already processed
      if (processedIndices.has(index)) {
        return;
      }

      const parentNode = parent as Parent;

      // Look for code blocks with variant metadata
      if (node.type === 'code') {
        const codeNode = node as Code;

        // Check if variant metadata is in meta field or lang field (when no language is specified)
        let metaString = codeNode.meta;
        let actualLang = codeNode.lang;

        // If meta is empty but lang contains '=', it means variant info is in lang
        if (!metaString && actualLang && actualLang.includes('=')) {
          metaString = actualLang;
          actualLang = null;
        }

        if (!metaString) {
          return;
        }

        const metaData = parseMeta(metaString);

        if (metaData.variant || metaData.variantGroup) {
          // Collect consecutive code blocks that belong together
          const codeBlocks: Array<{
            node: Code;
            index: number;
            variant: string;
            props: Record<string, string>;
            actualLang: string | null;
            labelFromPrevious?: string;
          }> = [];

          let currentIndex = index;

          // For variant-group, look for pattern: [label] -> code block
          // For variant, look for adjacent code blocks only

          if (metaData.variantGroup) {
            // Collect all blocks with the same variant-group
            while (currentIndex < parentNode.children.length) {
              const currentNode = parentNode.children[currentIndex] as any;

              if (currentNode.type === 'code') {
                // Parse language and meta for current node
                let currentMetaString = currentNode.meta;
                let currentActualLang = currentNode.lang;

                if (!currentMetaString && currentActualLang && currentActualLang.includes('=')) {
                  currentMetaString = currentActualLang;
                  currentActualLang = null;
                }

                if (currentMetaString) {
                  const currentMetaData = parseMeta(currentMetaString);

                  if (currentMetaData.variantGroup === metaData.variantGroup) {
                    // Look for label before this code block
                    let labelFromPrevious: string | undefined;
                    if (currentIndex > 0) {
                      const prevNode = parentNode.children[currentIndex - 1] as any;
                      if (
                        prevNode.type === 'paragraph' &&
                        prevNode.children.length === 1 &&
                        prevNode.children[0].type === 'text'
                      ) {
                        labelFromPrevious = prevNode.children[0].value.trim();
                      }
                    }

                    codeBlocks.push({
                      node: currentNode,
                      index: currentIndex,
                      variant: labelFromPrevious || currentMetaData.variantGroup || 'default',
                      props: currentMetaData.props,
                      actualLang: currentActualLang,
                      labelFromPrevious,
                    });

                    processedIndices.add(currentIndex);

                    // Skip the label and move to next potential code block
                    currentIndex += 1;

                    // Skip ahead past any paragraph that could be a label
                    if (currentIndex < parentNode.children.length) {
                      const nextNode = parentNode.children[currentIndex] as any;
                      if (
                        nextNode.type === 'paragraph' &&
                        nextNode.children.length === 1 &&
                        nextNode.children[0].type === 'text'
                      ) {
                        currentIndex += 1; // Skip the potential label
                      }
                    }
                  } else {
                    break; // Different group, stop collecting
                  }
                } else {
                  break; // No meta, stop collecting
                }
              } else {
                break; // Not a code block, stop collecting
              }
            }
          } else if (metaData.variant) {
            // Collect adjacent code blocks with variants
            while (currentIndex < parentNode.children.length) {
              const currentNode = parentNode.children[currentIndex] as any;

              if (currentNode.type === 'code') {
                // Parse language and meta for current node
                let currentMetaString = currentNode.meta;
                let currentActualLang = currentNode.lang;

                if (!currentMetaString && currentActualLang && currentActualLang.includes('=')) {
                  currentMetaString = currentActualLang;
                  currentActualLang = null;
                }

                if (currentMetaString) {
                  const currentMetaData = parseMeta(currentMetaString);

                  if (currentMetaData.variant) {
                    codeBlocks.push({
                      node: currentNode,
                      index: currentIndex,
                      variant: currentMetaData.variant,
                      props: currentMetaData.props,
                      actualLang: currentActualLang,
                    });

                    processedIndices.add(currentIndex);
                    currentIndex += 1;
                  } else {
                    break; // No variant, stop collecting
                  }
                } else {
                  break; // No meta, stop collecting
                }
              } else {
                break; // Not a code block, stop collecting
              }
            }
          }

          // Only process if we have multiple blocks
          if (codeBlocks.length > 1) {
            // Create proper HTML elements with hProperties for remark-rehype compatibility
            const preElement = {
              type: 'element',
              tagName: 'pre',
              data: {
                hName: 'pre',
                hProperties: {},
              },
              children: codeBlocks.map((block) => {
                // Build hProperties for HTML attributes
                const hProperties: Record<string, any> = {
                  'data-variant': block.variant,
                };

                // Add language class if available
                if (block.actualLang) {
                  hProperties.className = `language-${block.actualLang}`;
                }

                // Add additional props as data attributes
                Object.entries(block.props).forEach(([key, value]) => {
                  hProperties[`data-${key}`] = value;
                });

                return {
                  type: 'element',
                  tagName: 'code',
                  data: {
                    hName: 'code',
                    hProperties,
                  },
                  children: [
                    {
                      type: 'text',
                      value: block.node.value,
                    },
                  ],
                };
              }),
            };

            // Mark all code blocks and their labels for removal
            codeBlocks.forEach((block) => {
              nodesToRemove.add(block.node);

              // Also mark label paragraphs for removal if they exist
              if (block.labelFromPrevious && block.index > 0) {
                const prevNode = parentNode.children[block.index - 1];
                if (prevNode.type === 'paragraph') {
                  nodesToRemove.add(prevNode);
                }
              }
            });

            // Add replacement at the position of the first block
            replacements.push({
              index: codeBlocks[0].index,
              replacement: preElement,
            });
          }
        }
      }
    });

    // Apply replacements and removals in a second pass
    // First, replace the nodes
    visit(tree, (node, index, parent) => {
      if (!parent || !Array.isArray((parent as Parent).children) || typeof index !== 'number') {
        return;
      }

      const parentNode = parent as Parent;

      for (const replacement of replacements) {
        if (index === replacement.index) {
          parentNode.children[index] = replacement.replacement;
          break;
        }
      }
    });

    // Then, remove the marked nodes
    visit(tree, (node, index, parent) => {
      if (!parent || !Array.isArray((parent as Parent).children)) {
        return;
      }

      const parentNode = parent as Parent;
      parentNode.children = parentNode.children.filter((child: any) => !nodesToRemove.has(child));
    });
  };
};
