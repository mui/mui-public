import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Element, Text } from 'hast';
import { loadVariant } from '../../CodeHighlighter/loadVariant';
import { createParseSource } from '../parseSource';
import { TypescriptToJavascriptTransformer } from '../transformTypescriptToJavascript';
import type { Code } from '../../CodeHighlighter/types';

/**
 * Maps common language class names to file extensions
 * Only includes languages that have corresponding grammars in parseSource/grammars.ts
 */
const LANGUAGE_TO_EXTENSION: Record<string, string> = {
  // JavaScript
  javascript: 'js',
  js: 'js',

  // TypeScript
  typescript: 'ts',
  ts: 'ts',

  // TSX/JSX
  tsx: 'tsx',
  jsx: 'jsx', // Maps to .jsx but uses tsx grammar

  // JSON
  json: 'json',

  // Markdown
  markdown: 'md',
  md: 'md',

  // MDX
  mdx: 'mdx',

  // HTML
  html: 'html',

  // CSS
  css: 'css',

  // Shell
  shell: 'sh',
  bash: 'sh',
  sh: 'sh',

  // YAML
  yaml: 'yaml',
  yml: 'yaml',
};

/**
 * Extracts the language from className attribute
 */
function extractLanguageFromClassName(className: string | string[] | undefined): string | null {
  if (!className) {
    return null;
  }

  // Handle array of class names (HAST format)
  const classString = Array.isArray(className) ? className.join(' ') : className;

  const match = classString.match(/(?:^|\s)language-(\w+)(?:\s|$)/);
  return match ? match[1] : null;
}

/**
 * Gets the filename from data-filename attribute or derives it from language
 * Returns undefined if no explicit filename and no recognizable language
 */
function getFileName(codeElement: Element): string | undefined {
  // Check for explicit data-filename attribute
  const dataFilename = codeElement.properties?.dataFilename as string | undefined;
  if (dataFilename && typeof dataFilename === 'string') {
    return dataFilename;
  }

  // Extract language from className
  const className = codeElement.properties?.className as string | undefined;
  const language = extractLanguageFromClassName(className);

  if (language && LANGUAGE_TO_EXTENSION[language]) {
    return `index.${LANGUAGE_TO_EXTENSION[language]}`;
  }

  // Return undefined instead of a fallback - let the system handle gracefully
  return undefined;
}

/**
 * Extracts text content from HAST nodes
 */
function extractTextContent(node: Element | Text): string {
  if (node.type === 'text') {
    return node.value;
  }

  if (node.type === 'element' && node.children) {
    return node.children.map((child) => extractTextContent(child as Element | Text)).join('');
  }

  return '';
}

/**
 * Extracts code elements and filenames from semantic HTML structure
 * Handles both section/figure/dl and standalone dl structures
 */
function extractCodeFromSemanticStructure(
  element: Element,
): Array<{ codeElement: Element; filename?: string; variantName?: string }> {
  const results: Array<{ codeElement: Element; filename?: string; variantName?: string }> = [];

  if (element.tagName === 'section') {
    // Handle section with multiple figures
    const figures = element.children.filter(
      (child): child is Element => child.type === 'element' && child.tagName === 'figure',
    );

    for (const figure of figures) {
      // Extract variant name from figcaption
      let variantName: string | undefined;
      const figcaption = figure.children.find(
        (child): child is Element => child.type === 'element' && child.tagName === 'figcaption',
      );
      if (figcaption && figcaption.children[0] && figcaption.children[0].type === 'text') {
        variantName = figcaption.children[0].value.replace(' variant', '');
      }

      // Find dl element in figure
      const dl = figure.children.find(
        (child): child is Element => child.type === 'element' && child.tagName === 'dl',
      );

      if (dl) {
        const extracted = extractFromDl(dl);
        if (extracted) {
          results.push({
            codeElement: extracted.codeElement,
            filename: extracted.filename,
            variantName: variantName || extracted.variantName,
          });
        }
      }
    }
  } else if (element.tagName === 'dl') {
    // Handle standalone dl
    const extracted = extractFromDl(element);
    if (extracted) {
      results.push(extracted);
    }
  }

  return results;
}

/**
 * Extracts code element and filename from a dl element
 */
function extractFromDl(
  dl: Element,
): { codeElement: Element; filename?: string; variantName?: string } | null {
  // Find dt for filename and dd for code
  let filename: string | undefined;
  let codeElement: Element | undefined;

  for (const child of dl.children) {
    if (child.type === 'element') {
      if (child.tagName === 'dt') {
        // Extract filename from dt > code
        const codeInDt = child.children.find(
          (dtChild): dtChild is Element => dtChild.type === 'element' && dtChild.tagName === 'code',
        );
        if (codeInDt && codeInDt.children[0] && codeInDt.children[0].type === 'text') {
          filename = codeInDt.children[0].value;
        }
      } else if (child.tagName === 'dd') {
        // Extract code from dd > pre > code
        const pre = child.children.find(
          (ddChild): ddChild is Element => ddChild.type === 'element' && ddChild.tagName === 'pre',
        );
        if (pre) {
          const code = pre.children.find(
            (preChild): preChild is Element =>
              preChild.type === 'element' && preChild.tagName === 'code',
          );
          if (code) {
            codeElement = code;
          }
        }
      }
    }
  }

  if (codeElement) {
    // Extract variant name from data-variant if available
    const variantName = codeElement.properties?.dataVariant as string | undefined;

    return {
      codeElement,
      filename,
      variantName,
    };
  }

  return null;
}

/**
 * Rehype plugin that transforms semantic HTML code structures to use loadVariant
 *
 * This plugin:
 * 1. Finds section and dl elements in the HTML AST
 * 2. Extracts code elements from the semantic structure (figure/dl/dd/pre/code)
 * 3. Creates variants from multiple code elements or single Default variant
 * 4. Uses loadVariant to process each variant
 * 5. Stores the combined precompute data on the root element
 * 6. Clears all code element contents and replaces with error message
 */
export const transformHtmlCodePrecomputed: Plugin = () => {
  return async (tree) => {
    const transformPromises: Promise<void>[] = [];

    // Get the source parser and transformers
    const sourceParser = createParseSource();
    const sourceTransformers = [TypescriptToJavascriptTransformer];

    visit(tree, 'element', (node: Element) => {
      // Look for section elements (multi-variant) or dl elements (single variant)
      if (
        (node.tagName === 'section' || node.tagName === 'dl') &&
        node.children &&
        node.children.length > 0
      ) {
        // Extract code elements from semantic structure
        const extractedElements = extractCodeFromSemanticStructure(node);

        if (extractedElements.length > 0) {
          const transformPromise = (async () => {
            try {
              // Create variants from extracted elements
              const variants: Code = {};

              if (extractedElements.length === 1) {
                // Single element - use "Default" as variant name
                const { codeElement, filename } = extractedElements[0];
                const sourceCode = extractTextContent(codeElement);

                const variant: any = {
                  source: sourceCode,
                  skipTransforms: !codeElement.properties?.dataTransform,
                };

                // Add filename if available (prefer explicit filename over derived)
                if (filename) {
                  variant.fileName = filename;
                } else {
                  const derivedFilename = getFileName(codeElement);
                  if (derivedFilename) {
                    variant.fileName = derivedFilename;
                  }
                }

                variants.Default = variant;
              } else {
                // Multiple elements - use variant names
                extractedElements.forEach(({ codeElement, filename, variantName }, index) => {
                  const sourceCode = extractTextContent(codeElement);

                  // Determine variant name
                  const finalVariantName = variantName || `Variant ${index + 1}`;

                  const variant: any = {
                    source: sourceCode,
                    skipTransforms: !codeElement.properties?.dataTransform,
                  };

                  // Add filename if available (prefer explicit filename over derived)
                  if (filename) {
                    variant.fileName = filename;
                  } else {
                    const derivedFilename = getFileName(codeElement);
                    if (derivedFilename) {
                      variant.fileName = derivedFilename;
                    }
                  }

                  variants[finalVariantName] = variant;
                });
              }

              // Process each variant with loadVariant
              const processedCode: Code = {};

              const variantPromises = Object.entries(variants).map(
                async ([variantName, variantData]) => {
                  if (variantData && typeof variantData === 'object') {
                    const result = await loadVariant(
                      undefined, // url - not needed for inline code
                      variantName,
                      variantData,
                      {
                        sourceParser,
                        loadSource: undefined, // loadSource - not needed since we have the data
                        loadVariantMeta: undefined, // loadVariantMeta - not needed since we have the data
                        sourceTransformers,
                        disableTransforms: variantData.skipTransforms || false,
                        // TODO: output option
                        output: 'hastGzip',
                      },
                    );

                    return { variantName, processedVariant: result.code };
                  }
                  return null;
                },
              );

              const variantResults = await Promise.all(variantPromises);

              for (const result of variantResults) {
                if (result) {
                  processedCode[result.variantName] = result.processedVariant;
                }
              }

              // Clear all code element contents
              extractedElements.forEach(({ codeElement }) => {
                codeElement.children = [];
              });

              // Replace root element children with error message for CodeHighlighter
              node.children = [
                {
                  type: 'text',
                  value: 'Error: expected semantic code structure to be handled by CodeHighlighter',
                } as Text,
              ];

              // Set the precompute data on the root element directly on properties for immediate HTML serialization
              if (!node.properties) {
                (node as any).properties = {};
              }
              (node as any).properties.dataPrecompute = JSON.stringify(processedCode);
            } catch (error) {
              console.warn('Failed to transform code block:', error);
            }
          })();

          transformPromises.push(transformPromise);
        }
      }
    });

    // Wait for all transformations to complete
    await Promise.all(transformPromises);
  };
};
