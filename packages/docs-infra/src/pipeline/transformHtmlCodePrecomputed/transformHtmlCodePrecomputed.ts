import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Element, Text } from 'hast';
import { loadCodeVariant } from '../loadCodeVariant/loadCodeVariant';
import { createParseSource } from '../parseSource';
import { TypescriptToJavascriptTransformer } from '../transformTypescriptToJavascript';
import { parseImportsAndComments } from '../loaderUtils';
import {
  enhanceCodeEmphasis,
  EMPHASIS_COMMENT_PREFIX,
} from '../enhanceCodeEmphasis/enhanceCodeEmphasis';
import type { Code, SourceEnhancers } from '../../CodeHighlighter/types';

/**
 * Reserved data properties that are handled internally and should not be passed to userProps.
 * These are either processed by the transform pipeline or have special meaning.
 */
const RESERVED_DATA_PROPS = new Set([
  'dataFilename', // Used for fileName
  'dataVariant', // Used for variant name
  'dataTransform', // Used for skipTransforms
  'dataPrecompute', // The precomputed output itself
  'dataContentProps', // The serialized user props output
  'dataName', // Used for demo name
  'dataSlug', // Used for demo slug/URL
  'dataDisplayComments', // Used to preserve @highlight comments in displayed code
]);

/**
 * Extracts user-defined data properties from a code element.
 * Filters out reserved properties and returns remaining data-* attributes.
 * Converts from camelCase (dataTitle) to kebab-case keys (title).
 */
function extractUserProps(codeElement: Element): Record<string, string> | undefined {
  const props = codeElement.properties;
  if (!props) {
    return undefined;
  }

  const userProps: Record<string, string> = {};

  for (const [key, value] of Object.entries(props)) {
    // Only process data-* attributes (in camelCase form: dataXxx)
    if (key.startsWith('data') && key.length > 4 && !RESERVED_DATA_PROPS.has(key)) {
      // Convert dataTitle -> title, dataHighlight -> highlight
      const propName = key.charAt(4).toLowerCase() + key.slice(5);
      // Convert value to string
      userProps[propName] = String(value);
    }
  }

  return Object.keys(userProps).length > 0 ? userProps : undefined;
}

/**
 * Gets the filename from data-filename attribute only
 * Returns undefined if no explicit filename is provided
 */
function getFileName(codeElement: Element): string | undefined {
  // Check for explicit data-filename attribute
  const dataFilename = codeElement.properties?.dataFilename as string | undefined;
  if (dataFilename && typeof dataFilename === 'string') {
    return dataFilename;
  }

  return undefined;
}

/**
 * Extracts language from a className like "language-typescript" or "language-js"
 * Returns the language portion after "language-" prefix
 */
function extractLanguageFromClassName(
  className: string | string[] | undefined,
): string | undefined {
  if (!className) {
    return undefined;
  }

  const classes = Array.isArray(className) ? className : [className];

  for (const cls of classes) {
    if (typeof cls === 'string' && cls.startsWith('language-')) {
      return cls.slice('language-'.length);
    }
  }

  return undefined;
}

/**
 * Gets the language from class="language-*" attribute
 */
function getLanguage(codeElement: Element): string | undefined {
  const className = codeElement.properties?.className as string | string[] | undefined;
  return extractLanguageFromClassName(className);
}

/**
 * JSX languages where trailing semicolons on solo JSX expression lines
 * should be stripped. These are artifacts of how MDX/JSX is parsed.
 */
const JSX_LANGUAGES = new Set(['jsx', 'tsx']);

/**
 * Strips a trailing semicolon from a JSX expression.
 *
 * In JSX/TSX code blocks, expressions like `<Component />;` are common artifacts
 * from MDX parsing. If the source ends with `>;`, the trailing `;` is removed.
 */
function stripJsxExpressionSemicolon(source: string): string {
  if (source.endsWith('>;')) {
    return source.slice(0, -1);
  }
  return source;
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
): Array<{ codeElement: Element; filename?: string; language?: string; variantName?: string }> {
  const results: Array<{
    codeElement: Element;
    filename?: string;
    language?: string;
    variantName?: string;
  }> = [];

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
            language: extracted.language,
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
): { codeElement: Element; filename?: string; language?: string; variantName?: string } | null {
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
    // Extract language from className
    const language = getLanguage(codeElement);

    return {
      codeElement,
      filename,
      language,
      variantName,
    };
  }

  return null;
}

/**
 * Rehype plugin that transforms semantic HTML code structures to use loadCodeVariant
 *
 * This plugin:
 * 1. Finds section and dl elements in the HTML AST
 * 2. Extracts code elements from the semantic structure (figure/dl/dd/pre/code)
 * 3. Creates variants from multiple code elements or single Default variant
 * 4. Uses loadCodeVariant to process each variant
 * 5. Stores the combined precompute data on the root element
 * 6. Clears all code element contents and replaces with error message
 */
export const transformHtmlCodePrecomputed: Plugin = () => {
  return async (tree) => {
    const transformPromises: Promise<void>[] = [];

    // Get the source parser, transformers, and enhancers
    const sourceParser = createParseSource();
    const sourceTransformers = [TypescriptToJavascriptTransformer];
    const sourceEnhancers: SourceEnhancers = [enhanceCodeEmphasis];

    visit(tree, 'element', (node: Element) => {
      let extractedElements: Array<{
        codeElement: Element;
        filename?: string;
        language?: string;
        variantName?: string;
      }> = [];

      // Handle basic pre > code structure from standard markdown
      if (
        node.tagName === 'pre' &&
        node.children &&
        node.children.length > 0 &&
        !node.properties?.dataPrecompute // Don't process if already processed
      ) {
        // Look for direct code element in pre
        const codeElement = node.children.find(
          (child): child is Element => child.type === 'element' && child.tagName === 'code',
        );

        if (codeElement) {
          // Extract filename from data-filename attribute (explicit only)
          const filename = getFileName(codeElement);
          // Extract language from className
          const language = getLanguage(codeElement);

          extractedElements = [
            {
              codeElement,
              filename,
              language,
              variantName: undefined, // Basic pre > code doesn't have variants
            },
          ];
        }
      }
      // Look for section elements (multi-variant) or dl elements (single variant)
      else if (
        (node.tagName === 'section' || node.tagName === 'dl') &&
        node.children &&
        node.children.length > 0
      ) {
        // Extract code elements from semantic structure
        extractedElements = extractCodeFromSemanticStructure(node);
      }

      if (extractedElements.length > 0) {
        const transformPromise = (async () => {
          try {
            // Create variants from extracted elements
            const variants: Code = {};

            // Process each extracted element to extract comments and prepare variants
            const processElementForVariant = async (
              codeElement: Element,
              filename: string | undefined,
              language: string | undefined,
              explicitVariantName: string | undefined,
              index: number,
            ): Promise<{ variantName: string; variant: any }> => {
              let sourceCode = extractTextContent(codeElement);
              const derivedFilename = filename || getFileName(codeElement);

              // Strip trailing semicolon from JSX expressions
              if (language && JSX_LANGUAGES.has(language)) {
                sourceCode = stripJsxExpressionSemicolon(sourceCode);
              }

              // Check if displayComments is enabled - if so, don't strip comments
              const displayComments = codeElement.properties?.dataDisplayComments === 'true';

              // Parse the source to extract @highlight comments
              // When displayComments is true, we only collect comments but don't strip them
              const parseResult = await parseImportsAndComments(
                sourceCode,
                derivedFilename || 'code.txt',
                {
                  removeCommentsWithPrefix: displayComments ? undefined : [EMPHASIS_COMMENT_PREFIX],
                  notableCommentsPrefix: [EMPHASIS_COMMENT_PREFIX],
                },
              );

              // Use processed code (with comments stripped) or original
              const processedSource = parseResult.code ?? sourceCode;
              // Keep comments as 0-indexed - loadCodeVariant will convert to 1-indexed
              const comments = parseResult.comments;

              const variant: any = {
                source: processedSource,
                skipTransforms: !codeElement.properties?.dataTransform,
                comments, // Store comments for sourceEnhancers to use
              };

              // Add filename if available
              if (derivedFilename) {
                variant.fileName = derivedFilename;
              }

              // Add language if available (from className)
              if (language) {
                variant.language = language;
              }

              const variantName =
                explicitVariantName || (index === 0 ? 'Default' : `Variant ${index + 1}`);
              return { variantName, variant };
            };

            if (extractedElements.length === 1) {
              // Single element - use "Default" as variant name
              const { codeElement, filename, language } = extractedElements[0];
              const { variantName, variant } = await processElementForVariant(
                codeElement,
                filename,
                language,
                undefined,
                0,
              );
              variants[variantName] = variant;
            } else {
              // Multiple elements - use variant names
              const results = await Promise.all(
                extractedElements.map(({ codeElement, filename, language, variantName }, index) =>
                  processElementForVariant(codeElement, filename, language, variantName, index),
                ),
              );
              for (const { variantName, variant } of results) {
                variants[variantName] = variant;
              }
            }

            // Process each variant with loadCodeVariant
            const processedCode: Code = {};

            const variantPromises = Object.entries(variants).map(
              async ([variantName, variantData]) => {
                if (variantData && typeof variantData === 'object') {
                  const result = await loadCodeVariant(
                    undefined, // url - not needed for inline code
                    variantName,
                    variantData,
                    {
                      sourceParser,
                      loadSource: undefined, // loadSource - not needed since we have the data
                      loadVariantMeta: undefined, // loadVariantMeta - not needed since we have the data
                      sourceTransformers,
                      sourceEnhancers, // For @highlight emphasis comments
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

            // Extract user props from the first code element (they should be the same for all variants)
            const userProps = extractUserProps(extractedElements[0].codeElement);

            // Clear all code element contents
            extractedElements.forEach(({ codeElement }) => {
              codeElement.children = [];
            });

            // Replace the semantic structure with a <pre> element
            node.tagName = 'pre';
            node.children = [
              {
                type: 'text',
                value:
                  'Error: expected pre tag with precomputed data to be handled by the CodeHighlighter component',
              } as Text,
            ];

            // Set the precompute data on the pre element directly on properties for immediate HTML serialization
            if (!node.properties) {
              (node as any).properties = {};
            }
            (node as any).properties.dataPrecompute = JSON.stringify(processedCode);

            // Pass through name and slug if provided on the code element
            const firstCodeElement = extractedElements[0].codeElement;
            if (firstCodeElement.properties?.dataName) {
              (node as any).properties.dataName = firstCodeElement.properties.dataName;
            }
            if (firstCodeElement.properties?.dataSlug) {
              (node as any).properties.dataSlug = firstCodeElement.properties.dataSlug;
            }

            // Set user props if any exist
            if (userProps) {
              (node as any).properties.dataContentProps = JSON.stringify(userProps);
            }
          } catch (error) {
            console.warn('Failed to transform code block:', error);
          }
        })();

        transformPromises.push(transformPromise);
      }
    });

    // Wait for all transformations to complete
    await Promise.all(transformPromises);
  };
};
