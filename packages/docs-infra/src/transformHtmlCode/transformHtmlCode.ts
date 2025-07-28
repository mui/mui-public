import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Element, Text } from 'hast';
import { loadVariant } from '../CodeHighlighter/loadVariant';
import { parseSourceFactory } from '../parseSource';
import { TsToJsTransformer } from '../transformTsToJs';
import type { Code } from '../CodeHighlighter/types';

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
 */
function getFileName(codeElement: Element): string {
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

  // Default fallback
  return 'index.txt';
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
 * Creates variants from multiple code elements within a pre element
 */
function createVariantsFromCodeElements(codeElements: Element[]): Code {
  const variants: Code = {};

  if (codeElements.length === 1) {
    // Single code element - use "Default" as variant name
    const codeElement = codeElements[0];
    const sourceCode = extractTextContent(codeElement);
    const fileName = getFileName(codeElement);

    variants.Default = {
      fileName,
      url: `file:///${fileName}`,
      source: sourceCode,
    };
  } else {
    // Multiple code elements - create appropriate variant names
    const languages = codeElements.map((element) => {
      const className = element.properties?.className as string | undefined;
      return extractLanguageFromClassName(className);
    });

    // Check if all languages are the same (or all null)
    const uniqueLanguages = Array.from(new Set(languages.filter(Boolean)));
    const shouldUseLanguageNames = uniqueLanguages.length > 1;

    codeElements.forEach((codeElement, index) => {
      const sourceCode = extractTextContent(codeElement);
      const fileName = getFileName(codeElement);

      // Check for explicit variant name
      const dataVariant = codeElement.properties?.dataVariant as string | undefined;
      let variantName: string;

      if (dataVariant && typeof dataVariant === 'string') {
        variantName = dataVariant;
      } else if (shouldUseLanguageNames && languages[index]) {
        // Use language name if languages differ
        variantName = languages[index]!.charAt(0).toUpperCase() + languages[index]!.slice(1);
      } else {
        // Use numbered variants if languages are the same or unknown
        variantName = `Variant ${index + 1}`;
      }

      const variantFileName = fileName; // Each code element already has the correct filename from getFileName()
      variants[variantName] = {
        fileName: variantFileName,
        url: `file:///${variantFileName}`,
        source: sourceCode,
      };
    });
  }

  return variants;
}

/**
 * Rehype plugin that transforms pre > code elements to use loadVariant
 *
 * This plugin:
 * 1. Finds pre elements in the HTML AST
 * 2. Collects all code children within each pre element
 * 3. Creates variants from multiple code elements or single Default variant
 * 4. Uses loadVariant to process each variant
 * 5. Stores the combined precompute data on the pre element
 * 6. Clears all code element contents
 */
export const transformHtmlCode: Plugin = () => {
  return async (tree) => {
    const transformPromises: Promise<void>[] = [];

    // Get the source parser and transformers
    const sourceParser = parseSourceFactory();
    const sourceTransformers = [TsToJsTransformer];

    visit(tree, 'element', (node: Element) => {
      // Look for pre elements
      if (node.tagName === 'pre' && node.children && node.children.length > 0) {
        // Find all code elements within this pre
        const codeElements = node.children.filter(
          (child): child is Element => child.type === 'element' && child.tagName === 'code',
        );

        if (codeElements.length > 0) {
          const transformPromise = (async () => {
            try {
              // Create variants from all code elements
              const variants = createVariantsFromCodeElements(codeElements);

              // Process each variant with loadVariant
              const processedCode: Code = {};

              const variantPromises = Object.entries(variants).map(
                async ([variantName, variantData]) => {
                  if (variantData && typeof variantData === 'object' && 'url' in variantData) {
                    try {
                      const result = await loadVariant(
                        variantData.url as string,
                        variantName,
                        variantData,
                        sourceParser,
                        undefined, // loadSource - not needed since we have the data
                        undefined, // loadVariantMeta - not needed since we have the data
                        sourceTransformers,
                      );

                      return { variantName, processedVariant: result.code };
                    } catch (error) {
                      console.warn(`Failed to process variant ${variantName}:`, error);
                      // Keep original variant on error
                      return { variantName, processedVariant: variantData };
                    }
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

              // Clear all code element contents and replace with error message
              codeElements.forEach((codeElement) => {
                codeElement.children = [];
              });

              // Replace pre element children with error message for CodeHighlighter
              node.children = [
                {
                  type: 'text',
                  value: 'Error: expected pre tag to be handled by CodeHighlighter',
                } as Text,
              ];

              // Set the precompute data on the pre element directly on properties for immediate HTML serialization
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
