import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Element, Text } from 'hast';
import { getHastTextContent } from '../loadServerTypes/hastTypeUtils';
import { loadIsomorphicCodeVariant } from '../loadIsomorphicCodeVariant/loadIsomorphicCodeVariant';
import { createParseSource } from '../parseSource';
import { TypescriptToJavascriptTransformer } from '../transformTypescriptToJavascript';
import { IGNORE_COMMENT_PREFIXES, parseImportsAndComments } from '../loaderUtils';
import {
  createEnhanceCodeEmphasis,
  EMPHASIS_COMMENT_PREFIX,
  FOCUS_COMMENT_PREFIX,
} from '../enhanceCodeEmphasis/enhanceCodeEmphasis';
import type {
  Code,
  SourceComments,
  SourceEnhancers,
  VariantCode,
  VariantExtraFiles,
} from '../../CodeHighlighter/types';

const DEFAULT_PADDING_FRAME_MAX_SIZE = 25;
const DEFAULT_FOCUS_FRAMES_MAX_SIZE = 60;

export type TransformHtmlCodeBlockOptions = {
  /**
   * Maximum number of context lines to keep visible above and below focused regions.
   * These values act as site-wide defaults for authored inline code blocks.
   * Per-block `@padding` directives still take precedence.
   * @default 25
   */
  paddingFrameMaxSize?: number;
  /**
   * Maximum number of visible lines to keep in a focused region before collapsing the rest.
   * These values act as site-wide defaults for authored inline code blocks.
   * Per-block `@min` directives still take precedence.
   * @default 60
   */
  focusFramesMaxSize?: number;
  /**
   * How to handle a focused region larger than `focusFramesMaxSize`:
   * `'truncate'` (default) keeps the first `focusFramesMaxSize` lines visible and
   * hides the overflow; `'hide'` produces no visible window so the block collapses
   * to nothing (`focusedLines === 0`, still `collapsible`) and expanding reveals
   * the whole source. Applies to oversized `@highlight` / `@focus` regions and the
   * auto-focus-from-line-1 case.
   * @default 'truncate'
   */
  oversizedFocus?: 'truncate' | 'hide';
  /**
   * Render-time default for "collapse to empty": when `true`, every authored code
   * block collapses to an empty window (hidden until expanded) unless the block
   * sets its own flag (` ```ts collapseToEmpty ` to force it, ` ```ts collapseToEmpty=false `
   * to opt out). Runtime-only — the precomputed HAST is unchanged.
   * @default false
   */
  collapseToEmpty?: boolean;
  /**
   * Render-time default for "initial expanded": when `true`, every authored code
   * block starts expanded unless the block sets its own flag
   * (` ```ts initialExpanded ` / ` ```ts initialExpanded=false `). Runtime-only —
   * the precomputed HAST is unchanged.
   * @default false
   */
  initialExpanded?: boolean;
};

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
  if (source.endsWith('>;\n')) {
    return source.slice(0, -2);
  }
  if (source.endsWith('>;')) {
    return source.slice(0, -1);
  }
  return source;
}

/**
 * A single code element extracted from a dl pair (dt for the filename, dd for the code).
 * Multiple files may belong to the same variant.
 */
type ExtractedFile = {
  codeElement: Element;
  filename?: string;
  language?: string;
};

/**
 * A variant extracted from the semantic structure. A variant maps to one figure
 * inside a section (multi-variant) or to a single standalone dl/pre (single variant).
 * The first entry in `files` is treated as the variant's main source; any
 * subsequent entries become `extraFiles`.
 */
type ExtractedVariant = {
  variantName?: string;
  files: ExtractedFile[];
};

/**
 * Extracts variants and their files from semantic HTML structure.
 * Handles both `<section>` (with one or more `<figure>` children) and standalone `<dl>`.
 */
function extractCodeFromSemanticStructure(element: Element): ExtractedVariant[] {
  const results: ExtractedVariant[] = [];

  if (element.tagName === 'section') {
    // Handle section with multiple figures
    const figures = element.children.filter(
      (child): child is Element => child.type === 'element' && child.tagName === 'figure',
    );

    for (const figure of figures) {
      // Extract variant name from figcaption (the literal " variant" suffix is stripped)
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
        const files = extractFromDl(dl);
        if (files.length > 0) {
          // figcaption takes precedence; data-variant on the first code element is a fallback.
          const firstDataVariant = files[0].codeElement.properties?.dataVariant as
            | string
            | undefined;
          results.push({
            variantName: variantName || firstDataVariant,
            files,
          });
        }
      }
    }
  } else if (element.tagName === 'dl') {
    // Handle standalone dl
    const files = extractFromDl(element);
    if (files.length > 0) {
      const firstDataVariant = files[0].codeElement.properties?.dataVariant as string | undefined;
      results.push({
        variantName: firstDataVariant,
        files,
      });
    }
  }

  return results;
}

/**
 * Extracts every dt/dd pair from a `<dl>` element.
 * Pairs are matched positionally: each `<dt>` is bound to the first subsequent
 * `<dd>` containing a `<pre><code>` element. A `<dd>` without a preceding `<dt>`
 * is treated as a file with no explicit filename.
 */
function extractFromDl(dl: Element): ExtractedFile[] {
  const files: ExtractedFile[] = [];
  let pendingFilename: string | undefined;
  let hasPendingFilename = false;

  for (const child of dl.children) {
    if (child.type !== 'element') {
      continue;
    }

    if (child.tagName === 'dt') {
      // Extract filename from dt > code
      const codeInDt = child.children.find(
        (dtChild): dtChild is Element => dtChild.type === 'element' && dtChild.tagName === 'code',
      );
      if (codeInDt && codeInDt.children[0] && codeInDt.children[0].type === 'text') {
        pendingFilename = codeInDt.children[0].value;
      } else {
        pendingFilename = undefined;
      }
      hasPendingFilename = true;
    } else if (child.tagName === 'dd') {
      // Extract code from dd > pre > code
      const pre = child.children.find(
        (ddChild): ddChild is Element => ddChild.type === 'element' && ddChild.tagName === 'pre',
      );
      if (!pre) {
        continue;
      }
      const codeElement = pre.children.find(
        (preChild): preChild is Element =>
          preChild.type === 'element' && preChild.tagName === 'code',
      );
      if (!codeElement) {
        continue;
      }

      files.push({
        codeElement,
        filename: hasPendingFilename ? pendingFilename : undefined,
        language: getLanguage(codeElement),
      });

      pendingFilename = undefined;
      hasPendingFilename = false;
    }
  }

  return files;
}

/**
 * Rehype plugin that transforms semantic HTML code structures to use loadIsomorphicCodeVariant
 *
 * This plugin:
 * 1. Finds section and dl elements in the HTML AST
 * 2. Extracts code elements from the semantic structure (figure/dl/dd/pre/code)
 * 3. Creates variants from multiple code elements or single Default variant
 * 4. Uses loadIsomorphicCodeVariant to process each variant
 * 5. Stores the combined precompute data on the root element
 * 6. Clears all code element contents and replaces with error message
 */
export const transformHtmlCodeBlock: Plugin<[TransformHtmlCodeBlockOptions?]> = (options = {}) => {
  return async (tree) => {
    const transformPromises: Promise<void>[] = [];

    // Get the source parser, transformers, and enhancers
    const sourceParser = createParseSource();
    const sourceTransformers = [TypescriptToJavascriptTransformer];
    const sourceEnhancers: SourceEnhancers = [
      createEnhanceCodeEmphasis({
        paddingFrameMaxSize: options.paddingFrameMaxSize ?? DEFAULT_PADDING_FRAME_MAX_SIZE,
        focusFramesMaxSize: options.focusFramesMaxSize ?? DEFAULT_FOCUS_FRAMES_MAX_SIZE,
        oversizedFocus: options.oversizedFocus,
      }),
    ];

    visit(tree, 'element', (node: Element) => {
      let extractedVariants: ExtractedVariant[] = [];

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

          extractedVariants = [
            {
              variantName: undefined, // Basic pre > code doesn't have variants
              files: [{ codeElement, filename, language }],
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
        // Extract variants (each with one or more files) from semantic structure
        extractedVariants = extractCodeFromSemanticStructure(node);
      }

      if (extractedVariants.length > 0) {
        const transformPromise = (async () => {
          try {
            // Process a single file (dt/dd pair or bare pre>code) into the fields
            // needed to populate a VariantCode `source` or `extraFiles` entry.
            const processFile = async (
              file: ExtractedFile,
            ): Promise<{
              fileName?: string;
              language?: string;
              source: string;
              comments: SourceComments | undefined;
              skipTransforms: boolean;
            }> => {
              let sourceCode = getHastTextContent(file.codeElement);
              const derivedFilename = file.filename || getFileName(file.codeElement);

              // Strip trailing semicolon from JSX expressions
              if (file.language && JSX_LANGUAGES.has(file.language)) {
                sourceCode = stripJsxExpressionSemicolon(sourceCode);
              }

              // Check if displayComments is enabled - if so, don't strip comments
              const displayComments = file.codeElement.properties?.dataDisplayComments === 'true';

              // Parse the source to extract @highlight comments
              // When displayComments is true, we only collect comments but don't strip them
              const parseResult = await parseImportsAndComments(
                sourceCode,
                derivedFilename || 'code.txt',
                {
                  removeCommentsWithPrefix: displayComments
                    ? undefined
                    : [EMPHASIS_COMMENT_PREFIX, FOCUS_COMMENT_PREFIX, ...IGNORE_COMMENT_PREFIXES],
                  notableCommentsPrefix: [EMPHASIS_COMMENT_PREFIX, FOCUS_COMMENT_PREFIX],
                },
              );

              return {
                fileName: derivedFilename,
                language: file.language,
                source: parseResult.code ?? sourceCode,
                comments: parseResult.comments,
                skipTransforms: !file.codeElement.properties?.dataTransform,
              };
            };

            // Build a VariantCode for each extracted variant. The first file
            // populates `source`/`fileName`/`language`/`comments`; any additional
            // files become `extraFiles` entries on the same variant.
            const buildVariant = async (
              extracted: ExtractedVariant,
              index: number,
            ): Promise<{ variantName: string; variant: VariantCode }> => {
              const processedFiles = await Promise.all(extracted.files.map(processFile));
              const [mainFile, ...restFiles] = processedFiles;

              const variant: VariantCode = {
                source: mainFile.source,
                skipTransforms: mainFile.skipTransforms,
                comments: mainFile.comments,
              };
              if (mainFile.fileName) {
                variant.fileName = mainFile.fileName;
              }
              if (mainFile.language) {
                variant.language = mainFile.language;
              }

              if (restFiles.length > 0) {
                const extraFiles: VariantExtraFiles = {};
                for (const extra of restFiles) {
                  // Files without an explicit filename can't be addressed as extra files; skip.
                  if (!extra.fileName) {
                    continue;
                  }
                  const entry: Record<string, unknown> = {
                    source: extra.source,
                    skipTransforms: extra.skipTransforms,
                  };
                  if (extra.language) {
                    entry.language = extra.language;
                  }
                  if (extra.comments) {
                    entry.comments = extra.comments;
                  }
                  extraFiles[extra.fileName] = entry as VariantExtraFiles[string];
                }
                if (Object.keys(extraFiles).length > 0) {
                  variant.extraFiles = extraFiles;
                }
              }

              const variantName =
                extracted.variantName || (index === 0 ? 'Default' : `Variant ${index + 1}`);
              return { variantName, variant };
            };

            const builtVariants = await Promise.all(extractedVariants.map(buildVariant));

            const variants: Code = {};
            for (const { variantName, variant } of builtVariants) {
              variants[variantName] = variant;
            }

            // Process each variant with loadIsomorphicCodeVariant
            const processedCode: Code = {};

            const variantPromises = Object.entries(variants).map(
              async ([variantName, variantData]) => {
                if (variantData && typeof variantData === 'object') {
                  const result = await loadIsomorphicCodeVariant(
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
                      output: 'hastCompressed',
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

            // The first code element of the first variant carries the
            // top-level metadata (user props, name, slug) for the demo.
            const firstCodeElement = extractedVariants[0].files[0].codeElement;

            // Extract user props from the first code element. Per-block render
            // flags (e.g. ` ```ts collapseToEmpty ` / ` ```ts initialExpanded `)
            // arrive as `data-*` attributes and flow through here as content
            // props. When the block sets no flag, fall back to the transform's
            // matching option so it can default every block.
            let userProps = extractUserProps(firstCodeElement);
            if (
              firstCodeElement.properties?.dataCollapseToEmpty === undefined &&
              options.collapseToEmpty
            ) {
              userProps = { ...(userProps ?? {}), collapseToEmpty: 'true' };
            }
            if (
              firstCodeElement.properties?.dataInitialExpanded === undefined &&
              options.initialExpanded
            ) {
              userProps = { ...(userProps ?? {}), initialExpanded: 'true' };
            }

            // Clear all code element contents (across every variant and every file)
            for (const extracted of extractedVariants) {
              for (const file of extracted.files) {
                file.codeElement.children = [];
              }
            }

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
