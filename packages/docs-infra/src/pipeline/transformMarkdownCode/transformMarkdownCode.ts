import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Code, InlineCode, Parent } from 'mdast';
import { normalizeLanguage } from '../loaderUtils/getLanguageFromExtension';

/**
 * Pattern to match inline code with language suffix like `code{:lang}`
 * Captures:
 * - Group 1: The code content (everything before `{:`)
 * - Group 2: The language identifier
 *
 * Note: Using [\s\S] instead of . with /s flag for compatibility
 */
const INLINE_CODE_LANG_SUFFIX_PATTERN = /^([\s\S]+)\{:(\w+)\}$/;

export interface TransformMarkdownCodeOptions {
  /**
   * Default language to apply to inline code that doesn't have an explicit `{:lang}` suffix.
   * Set to `false` to disable default highlighting for inline code.
   * @default 'tsx'
   */
  defaultInlineCodeLanguage?: string | false;
}

/**
 * Remark plugin that transforms code blocks with variants into semantic HTML structures.
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
 * OR with variant-type (with labels between):
 *
 * npm
 * ```bash variant-type=install
 * npm install @mui/internal-docs-infra
 * ```
 * pnpm
 * ```bash variant-type=install
 * pnpm install @mui/internal-docs-infra
 * ```
 * yarn
 * ```bash variant-type=install
 * yarn add @mui/internal-docs-infra
 * ```
 *
 * OR individual code blocks with options:
 *
 * ```ts transform
 * console.log('test' as const)
 * ```
 *
 * Into semantic HTML that the existing rehype plugin can process:
 * <section>
 *   <figure>
 *     <figcaption>npm variant</figcaption>
 *     <dl>
 *       <dt><code>index.js</code></dt>
 *       <dd>
 *         <pre><code class="language-bash">npm install @mui/internal-docs-infra</code></pre>
 *       </dd>
 *     </dl>
 *   </figure>
 *   <figure>
 *     <figcaption>pnpm variant</figcaption>
 *     <dl>
 *       <dt><code>index.js</code></dt>
 *       <dd>
 *         <pre><code class="language-shell">pnpm install @mui/internal-docs-infra</code></pre>
 *       </dd>
 *     </dl>
 *   </figure>
 * </section>
 *
 * Or for individual blocks without filename (no dl wrapper needed):
 * <pre><code class="language-typescript" data-transform="true">console.log('test' as const)</code></pre>
 *
 * Or with explicit filename (uses dl/dt/dd structure):
 * <dl>
 *   <dt><code>example.ts</code></dt>
 *   <dd>
 *     <pre><code class="language-typescript">console.log('test' as const)</code></pre>
 *   </dd>
 * </dl>
 *
 * Note: The `dl/dt/dd` structure is only used when an explicit `filename` prop is provided.
 * Language information is passed via the `class="language-*"` attribute on the code element.
 *
 * Also handles inline code with language hints:
 *
 * ```md
 * This is a `<Component />{:jsx}` example
 * ```
 *
 * Becomes inline code with `class="language-jsx"` for syntax highlighting.
 * The `{:lang}` suffix is removed from the displayed code.
 *
 * A default language can be set via `defaultInlineCodeLanguage` option to apply
 * syntax highlighting to all inline code without explicit suffixes.
 */

/**
 * Gets filename from explicit filename prop only.
 * Does not derive filename from language - language is passed via className instead.
 */
function getFileName(props: Record<string, string>): string | null {
  // Only return explicit filename
  if (props.filename) {
    return props.filename;
  }

  return null;
}

/**
 * Parse meta string to extract variant and other properties
 */
function parseMeta(meta: string) {
  const result: { variant?: string; variantType?: string; props: Record<string, string> } = {
    props: {},
  };

  // Parse key=value pairs first, handling quoted values
  const keyValueRegex = /([\w-]+)=("(?:[^"\\]|\\.)*"|[^\s]+)/g;
  let match = keyValueRegex.exec(meta);
  const processedPositions: Array<[number, number]> = [];

  while (match !== null) {
    const [fullMatch, key, rawValue] = match;
    const startPos = match.index;
    const endPos = match.index + fullMatch.length;
    processedPositions.push([startPos, endPos]);

    // Remove quotes if present
    const value =
      rawValue.startsWith('"') && rawValue.endsWith('"') ? rawValue.slice(1, -1) : rawValue;

    if (key === 'variant') {
      result.variant = value;
    } else if (key === 'variant-type') {
      result.variantType = value;
    } else {
      result.props[key] = value;
    }

    match = keyValueRegex.exec(meta);
  }

  // Extract remaining parts as standalone flags
  let remainingMeta = meta;
  // Remove processed key=value pairs from the string (in reverse order to maintain positions)
  processedPositions
    .sort((a, b) => b[0] - a[0])
    .forEach(([start, end]) => {
      remainingMeta = remainingMeta.slice(0, start) + remainingMeta.slice(end);
    });

  // Process remaining standalone flags
  const remainingParts = remainingMeta.trim().split(/\s+/).filter(Boolean);
  for (const part of remainingParts) {
    if (part === 'variant') {
      // This shouldn't happen, but just in case
      result.variant = 'true';
    } else if (part === 'variant-type') {
      // This shouldn't happen, but just in case
      result.variantType = 'true';
    } else {
      // Handle standalone flags (e.g., "transform" becomes "transform": "true")
      result.props[part] = 'true';
    }
  }

  return result;
}

/**
 * Processes inline code with language suffix like `code{:lang}`.
 * Returns the code content and language if a suffix is found.
 */
function parseInlineCodeLanguage(
  value: string,
  defaultLanguage?: string,
): { code: string; language?: string } {
  const match = value.match(INLINE_CODE_LANG_SUFFIX_PATTERN);

  if (match) {
    return {
      code: match[1],
      language: match[2],
    };
  }

  return {
    code: value,
    language: defaultLanguage,
  };
}

export const transformMarkdownCode: Plugin<[TransformMarkdownCodeOptions?]> = (options = {}) => {
  const { defaultInlineCodeLanguage = 'tsx' } = options;

  return (tree) => {
    const processedIndices = new Set<number>();

    // First pass: handle inline code with language suffixes
    visit(tree, 'inlineCode', (node: InlineCode) => {
      const effectiveDefault =
        defaultInlineCodeLanguage === false ? undefined : defaultInlineCodeLanguage;
      const { code, language } = parseInlineCodeLanguage(node.value, effectiveDefault);

      if (language) {
        // Update the node value to remove the suffix
        node.value = code;

        // Add language class to be picked up by rehype
        // This follows the standard convention: class="language-{lang}"
        node.data = node.data || {};
        node.data.hProperties = node.data.hProperties || {};
        const hProperties = node.data.hProperties as Record<string, unknown>;
        const existingClassName = hProperties.className;

        if (Array.isArray(existingClassName)) {
          existingClassName.push(`language-${language}`);
        } else if (typeof existingClassName === 'string') {
          hProperties.className = [existingClassName, `language-${language}`];
        } else {
          hProperties.className = [`language-${language}`];
        }
      }
    });

    // Second pass: handle code blocks with variants and options
    visit(tree, (node, index, parent) => {
      if (!parent || !Array.isArray((parent as Parent).children) || typeof index !== 'number') {
        return;
      }

      // Skip if already processed
      if (processedIndices.has(index)) {
        return;
      }

      const parentNode = parent as Parent;

      // Look for code blocks with variant metadata or options
      if (node.type === 'code') {
        const codeNode = node as Code;

        // Check if variant metadata is in meta field or lang field (when no language is specified)
        let metaString = codeNode.meta;
        let langFromMeta = codeNode.lang || null;

        // If meta is empty but lang contains '=', it means variant info is in lang
        if (!metaString && codeNode.lang && codeNode.lang.includes('=')) {
          metaString = codeNode.lang;
          langFromMeta = null;
        }

        // Check if we have variants/variant-types or individual options
        let metaData: { variant?: string; variantType?: string; props: Record<string, string> } = {
          props: {},
        };

        if (metaString) {
          metaData = parseMeta(metaString);
        }

        // Use props from meta as the options for individual blocks
        const allProps = metaData.props;

        // Handle individual code blocks with options (but no variants)
        if (!metaData.variant && !metaData.variantType && Object.keys(allProps).length > 0) {
          const codeHProperties: Record<string, any> = {};

          // Add normalized language as class
          if (langFromMeta) {
            codeHProperties.className = `language-${normalizeLanguage(langFromMeta)}`;
          }

          // Add all props as data attributes (in camelCase)
          Object.entries(allProps).forEach(([key, value]) => {
            // Convert kebab-case to camelCase for data attributes
            const camelKey = key.includes('-')
              ? `data${key
                  .split('-')
                  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                  .join('')}`
              : `data${key.charAt(0).toUpperCase() + key.slice(1)}`;
            codeHProperties[camelKey] = value;
          });

          const fileName = getFileName(allProps);

          // Create pre > code element
          const preElement = {
            type: 'element',
            tagName: 'pre',
            data: { hName: 'pre', hProperties: {} },
            children: [
              {
                type: 'element',
                tagName: 'code',
                data: {
                  hName: 'code',
                  hProperties: codeHProperties,
                },
                children: [
                  {
                    type: 'text',
                    value: codeNode.value,
                  },
                ],
              },
            ],
          };

          // If there's a filename, wrap in dl/dt/dd structure
          // Otherwise, just use pre > code directly
          const outputElement = fileName
            ? {
                type: 'element',
                tagName: 'dl',
                data: {
                  hName: 'dl',
                  hProperties: {},
                },
                children: [
                  {
                    type: 'element',
                    tagName: 'dt',
                    data: { hName: 'dt', hProperties: {} },
                    children: [
                      {
                        type: 'element',
                        tagName: 'code',
                        data: { hName: 'code', hProperties: {} },
                        children: [{ type: 'text', value: fileName }],
                      },
                    ],
                  },
                  {
                    type: 'element',
                    tagName: 'dd',
                    data: { hName: 'dd', hProperties: {} },
                    children: [preElement],
                  },
                ],
              }
            : preElement;

          // Replace this individual code block immediately
          (parentNode.children as any)[index] = outputElement;
          processedIndices.add(index);
          return;
        }

        // Handle variant/variant-type logic (existing code)
        if (!metaString) {
          return;
        }

        if (metaData.variant || metaData.variantType) {
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

          // For variant-type, look for pattern: [label] -> code block
          // For variant, look for adjacent code blocks only

          if (metaData.variantType) {
            // Add the current code block as the first one for variant-type
            let currentLabelFromPrevious: string | undefined;
            if (index > 0) {
              const prevNode = parentNode.children[index - 1] as any;
              if (
                prevNode.type === 'paragraph' &&
                prevNode.children.length === 1 &&
                prevNode.children[0].type === 'text'
              ) {
                currentLabelFromPrevious = prevNode.children[0].value.trim();
              }
            }

            codeBlocks.push({
              node: codeNode,
              index,
              variant: currentLabelFromPrevious || metaData.variantType || 'default',
              props: allProps,
              actualLang: langFromMeta,
              labelFromPrevious: currentLabelFromPrevious,
            });
            processedIndices.add(index);

            // Start looking from the next element
            currentIndex = index + 1;

            // Collect all blocks with the same variant-type
            while (currentIndex < parentNode.children.length) {
              const currentNode = parentNode.children[currentIndex] as any;

              // Check if this is a potential label paragraph
              if (
                currentNode.type === 'paragraph' &&
                currentNode.children.length === 1 &&
                currentNode.children[0].type === 'text'
              ) {
                // Look for a code block after this paragraph
                if (currentIndex + 1 < parentNode.children.length) {
                  const nextNode = parentNode.children[currentIndex + 1] as any;
                  if (nextNode.type === 'code') {
                    // Check if this code block has the same variant-type
                    let nextMetaString = nextNode.meta;
                    let nextActualLang = nextNode.lang;

                    if (!nextMetaString && nextActualLang && nextActualLang.includes('=')) {
                      nextMetaString = nextActualLang;
                      nextActualLang = null;
                    }

                    if (nextMetaString) {
                      const nextMetaData = parseMeta(nextMetaString);

                      if (nextMetaData.variantType === metaData.variantType) {
                        const labelFromPrevious = currentNode.children[0].value.trim();

                        codeBlocks.push({
                          node: nextNode,
                          index: currentIndex + 1,
                          variant: labelFromPrevious || nextMetaData.variantType || 'default',
                          props: nextMetaData.props,
                          actualLang: nextActualLang,
                          labelFromPrevious,
                        });

                        processedIndices.add(currentIndex + 1);

                        // Skip the code block and move to next potential label
                        currentIndex += 2;
                        continue;
                      }
                    }
                  }
                }
                // If we didn't find a matching code block, break
                break;
              }

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

                  if (currentMetaData.variantType === metaData.variantType) {
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
                      variant: labelFromPrevious || currentMetaData.variantType || 'default',
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
            // Add the current code block as the first one for variant
            codeBlocks.push({
              node: codeNode,
              index,
              variant: metaData.variant,
              props: allProps,
              actualLang: langFromMeta,
            });
            processedIndices.add(index);

            // Start looking from the next element
            currentIndex = index + 1;

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
            // Create section with figure elements for each variant
            const sectionElement = {
              type: 'element',
              tagName: 'section',
              data: {
                hName: 'section',
                hProperties: {},
              },
              children: codeBlocks.map((block) => {
                // Build hProperties for HTML attributes
                const codeHProperties: Record<string, any> = {};

                // Add normalized language as class
                if (block.actualLang) {
                  codeHProperties.className = `language-${normalizeLanguage(block.actualLang)}`;
                }

                // Add additional props as data attributes (in camelCase)
                Object.entries(block.props).forEach(([key, value]) => {
                  // Convert kebab-case to camelCase for data attributes
                  const camelKey = key.includes('-')
                    ? `data${key
                        .split('-')
                        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                        .join('')}`
                    : `data${key.charAt(0).toUpperCase() + key.slice(1)}`;
                  codeHProperties[camelKey] = value;
                });

                // Add data-variant to track the variant
                codeHProperties.dataVariant = block.variant;

                const fileName = getFileName(block.props);

                return {
                  type: 'element',
                  tagName: 'figure',
                  data: { hName: 'figure', hProperties: {} },
                  children: [
                    {
                      type: 'element',
                      tagName: 'figcaption',
                      data: { hName: 'figcaption', hProperties: {} },
                      children: [
                        {
                          type: 'text',
                          value: `${block.variant} variant`,
                        },
                      ],
                    },
                    {
                      type: 'element',
                      tagName: 'dl',
                      data: { hName: 'dl', hProperties: {} },
                      children: [
                        ...(fileName
                          ? [
                              {
                                type: 'element',
                                tagName: 'dt',
                                data: { hName: 'dt', hProperties: {} },
                                children: [
                                  {
                                    type: 'element',
                                    tagName: 'code',
                                    data: { hName: 'code', hProperties: {} },
                                    children: [{ type: 'text', value: fileName }],
                                  },
                                ],
                              },
                            ]
                          : []),
                        {
                          type: 'element',
                          tagName: 'dd',
                          data: { hName: 'dd', hProperties: {} },
                          children: [
                            {
                              type: 'element',
                              tagName: 'pre',
                              data: { hName: 'pre', hProperties: {} },
                              children: [
                                {
                                  type: 'element',
                                  tagName: 'code',
                                  data: {
                                    hName: 'code',
                                    hProperties: codeHProperties,
                                    meta: `variant=${block.variant}${Object.entries(block.props)
                                      .map(([key, value]) => ` ${key}=${value}`)
                                      .join('')}`,
                                  },
                                  children: [
                                    {
                                      type: 'text',
                                      value: block.node.value,
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                };
              }),
            };

            // Replace the first block with the group and mark others for removal
            (parentNode.children as any)[codeBlocks[0].index] = sectionElement;

            // Remove all other code blocks and their labels (in reverse order to maintain indices)
            const indicesToRemove = codeBlocks
              .slice(1)
              .map((block) => {
                const indices = [block.index];
                // Also include label paragraph if it exists
                if (block.labelFromPrevious && block.index > 0) {
                  const prevNode = parentNode.children[block.index - 1];
                  if (prevNode.type === 'paragraph') {
                    indices.push(block.index - 1);
                  }
                }
                return indices;
              })
              .flat()
              .sort((a, b) => b - a); // Sort in descending order

            // Remove the marked indices
            for (const removeIdx of indicesToRemove) {
              if (removeIdx < parentNode.children.length) {
                parentNode.children.splice(removeIdx, 1);
                // Update processed indices to account for removed elements
                const updatedProcessedIndices = new Set<number>();
                processedIndices.forEach((processedIdx) => {
                  if (processedIdx > removeIdx) {
                    updatedProcessedIndices.add(processedIdx - 1);
                  } else if (processedIdx < removeIdx) {
                    updatedProcessedIndices.add(processedIdx);
                  }
                  // Don't add the removed index
                });
                processedIndices.clear();
                updatedProcessedIndices.forEach((processedIdx) => {
                  processedIndices.add(processedIdx);
                });
              }
            }

            // Also remove the label of the first block if it exists
            if (codeBlocks[0].labelFromPrevious && codeBlocks[0].index > 0) {
              const labelIndex = codeBlocks[0].index - 1;
              const prevNode = parentNode.children[labelIndex];
              if (prevNode && prevNode.type === 'paragraph') {
                parentNode.children.splice(labelIndex, 1);
                // Update processed indices
                const updatedProcessedIndices = new Set<number>();
                processedIndices.forEach((processedIdx) => {
                  if (processedIdx > labelIndex) {
                    updatedProcessedIndices.add(processedIdx - 1);
                  } else if (processedIdx < labelIndex) {
                    updatedProcessedIndices.add(processedIdx);
                  }
                });
                processedIndices.clear();
                updatedProcessedIndices.forEach((processedIdx) => {
                  processedIndices.add(processedIdx);
                });
              }
            }
          } else if (codeBlocks.length === 1) {
            // Single code block with variant - create a simple dl without figure wrapper
            const block = codeBlocks[0];

            const codeHProperties: Record<string, any> = {};

            // Add normalized language as class
            if (block.actualLang) {
              codeHProperties.className = `language-${normalizeLanguage(block.actualLang)}`;
            }

            // Add additional props as data attributes (in camelCase)
            Object.entries(block.props).forEach(([key, value]) => {
              // Convert kebab-case to camelCase for data attributes
              const camelKey = key.includes('-')
                ? `data${key
                    .split('-')
                    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                    .join('')}`
                : `data${key.charAt(0).toUpperCase() + key.slice(1)}`;
              codeHProperties[camelKey] = value;
            });

            // Add data-variant to track the variant
            codeHProperties.dataVariant = block.variant;

            const fileName = getFileName(block.props);

            const dlElement = {
              type: 'element',
              tagName: 'dl',
              data: {
                hName: 'dl',
                hProperties: {},
              },
              children: [
                ...(fileName
                  ? [
                      {
                        type: 'element',
                        tagName: 'dt',
                        data: { hName: 'dt', hProperties: {} },
                        children: [
                          {
                            type: 'element',
                            tagName: 'code',
                            data: { hName: 'code', hProperties: {} },
                            children: [{ type: 'text', value: fileName }],
                          },
                        ],
                      },
                    ]
                  : []),
                {
                  type: 'element',
                  tagName: 'dd',
                  data: { hName: 'dd', hProperties: {} },
                  children: [
                    {
                      type: 'element',
                      tagName: 'pre',
                      data: { hName: 'pre', hProperties: {} },
                      children: [
                        {
                          type: 'element',
                          tagName: 'code',
                          data: {
                            hName: 'code',
                            hProperties: codeHProperties,
                            meta: `variant=${block.variant}${Object.entries(block.props)
                              .map(([key, value]) => ` ${key}=${value}`)
                              .join('')}`,
                          },
                          children: [
                            {
                              type: 'text',
                              value: block.node.value,
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            };

            // Replace this single code block
            (parentNode.children as any)[codeBlocks[0].index] = dlElement;
          }
        }
      }
    });
  };
};
