import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import type { PhrasingContent, RootContent, Root } from 'mdast';
import * as md from '../syncPageIndex/createMarkdownNodes';
import {
  type TypesMeta,
  prettyFormat,
  prettyFormatMarkdown,
  type FormattedProperty,
} from '../loadServerTypesMeta';
import { type OrganizeTypesResult } from '../loadServerTypesText';

/**
 * Strip trailing `| undefined` from a type string.
 * Used for cleaner markdown display of optional props/params.
 */
function stripTrailingUndefined(typeText: string): string {
  return typeText.endsWith(' | undefined') ? typeText.slice(0, -' | undefined'.length) : typeText;
}

/**
 * Parse a markdown string into an AST
 * @param {string} markdown - Markdown string to parse
 * @returns {Object} The root content node of the parsed AST
 */
function parseMarkdown(markdown: string): RootContent[] {
  // Parse markdown into an AST
  const processor = unified().use(remarkParse);
  const result = processor.parse(markdown);
  return result.children as RootContent[];
}

// Phrasing content types that are allowed in table cells
const PHRASING_TYPES = new Set([
  'text',
  'inlineCode',
  'emphasis',
  'strong',
  'link',
  'break',
  'delete', // strikethrough
]);

/**
 * Recursively extract phrasing content from any node.
 * Block-level nodes are flattened to their inline content.
 * Adds line breaks between block-level siblings.
 */
function extractPhrasingContent(
  node: RootContent,
  result: PhrasingContent[],
  isTopLevel: boolean = false,
): void {
  if (PHRASING_TYPES.has(node.type)) {
    result.push(node as PhrasingContent);
  } else if ('children' in node && Array.isArray(node.children)) {
    // Add line breaks between top-level block elements (paragraphs, etc.)
    if (isTopLevel && result.length > 0) {
      result.push(md.hardBreak());
      result.push(md.hardBreak());
    }
    for (const child of node.children) {
      extractPhrasingContent(child as RootContent, result, false);
    }
  }
}

/**
 * Parse a markdown string and extract only the inline content (for table cells).
 * Block-level elements are flattened to their inline content.
 * @param markdown - Markdown string to parse
 * @returns Array of phrasing content nodes
 */
function parseInlineMarkdown(markdown: string): PhrasingContent[] {
  const nodes = parseMarkdown(markdown);
  const result: PhrasingContent[] = [];

  for (const node of nodes) {
    extractPhrasingContent(node, result, true);
  }

  return result.length > 0 ? result : [md.text(markdown)];
}

/**
 * Stringify AST nodes to markdown using remark.
 * Note: remark-stringify will escape underscores in text nodes.
 */
function stringifyToMarkdown(nodes: RootContent[]): string {
  const root: Root = { type: 'root', children: nodes };
  return unified()
    .use(remarkGfm)
    .use(remarkStringify, {
      bullet: '-',
      emphasis: '*',
      strong: '*',
      fence: '`',
      fences: true,
      listItemIndent: 'one',
      rule: '-',
      quote: "'",
    })
    .stringify(root);
}

/**
 * A chunk of markdown content.
 * - `needsPrettier: true` - needs to be formatted with prettier's markdown parser
 * - `needsPrettier: false` - already formatted (e.g., code blocks that went through prettyFormat)
 */
type MarkdownChunk = { content: string; needsPrettier: boolean };

/** Create a markdown chunk from AST nodes (needs prettier formatting) */
function markdownChunk(nodes: RootContent[]): MarkdownChunk {
  const content = stringifyToMarkdown(nodes);
  return { content: `${content.trimEnd()}\n`, needsPrettier: true };
}

/** Create a code block chunk (already formatted, skip prettier) */
function codeBlockChunk(code: string, language: string): MarkdownChunk {
  return { content: `\`\`\`${language}\n${code}\n\`\`\`\n`, needsPrettier: false };
}

/**
 * Create a heading chunk as a raw string (bypasses remark-gfm escaping).
 * remark-gfm escapes `w.` patterns (e.g., "Arrow.Props" → "Arrow\.Props")
 * because they look like www. URLs. Headings don't need GFM features,
 * so we build them directly as strings.
 */
function headingChunk(depth: 1 | 2 | 3 | 4 | 5 | 6, text: string): MarkdownChunk {
  const prefix = '#'.repeat(depth);
  return { content: `${prefix} ${text}\n`, needsPrettier: false };
}

/**
 * Options for generating types markdown.
 */
export interface GenerateTypesMarkdownOptions {
  /** The name/title to use for the markdown document */
  name: string;
  /** Pre-organized types from organizeTypesByExport */
  organized: OrganizeTypesResult<TypesMeta>;
  /** Map from flat type names to canonical dotted names */
  typeNameMap?: Record<string, string>;
  /** External types referenced in props/params but not publicly exported */
  externalTypes?: Record<string, string>;
  /**
   * Relative path to the types file (e.g., "react/components/accordion/types.mdx").
   * Used to generate a helpful hint in the autogenerated comment pointing users
   * to the validate command (e.g., `pnpm docs:validate <path>`).
   */
  path?: string;
}

export async function generateTypesMarkdown(
  options: GenerateTypesMarkdownOptions,
): Promise<string> {
  const { name, organized, typeNameMap = {}, externalTypes = {}, path: filePath } = options;

  // Build the autogenerated comment with an optional validate command hint
  const normalizedPath = typeof filePath === 'string' ? filePath.replace(/\\/g, '/') : undefined;
  const trimmedPath = normalizedPath
    ?.replace(/^(src\/app\/|app\/)/, '')
    .replace(/\/types\.md$/, '');
  const quotedPath = trimmedPath && /[()]/.test(trimmedPath) ? `"${trimmedPath}"` : trimmedPath;
  const commentText = quotedPath
    ? `<-- Autogenerated By (do not edit the following markdown directly), run: pnpm docs:validate ${quotedPath}`
    : '<-- Autogenerated By (do not edit the following markdown directly)';

  // Header chunk
  const headerChunk = markdownChunk([
    md.heading(1, name),
    md.comment(commentText, 'types.ts'),
    md.heading(2, 'API Reference'),
  ]);

  // Get the organized exports and additional types (already sorted by organizeTypesByExport)
  const { exports: organizedExports, additionalTypes } = organized;

  // Collect all types for common prefix detection
  const allTypes = [
    ...Object.values(organizedExports).map((exportEntry) => exportEntry.type),
    ...Object.values(organizedExports).flatMap((exportEntry) => exportEntry.additionalTypes),
  ];

  // For blocks pattern: determine if we should strip the common prefix from component names
  // E.g., if we have "Component.Root", "Component.Part" but NO standalone "Component" component,
  // strip the "Component." prefix so they display as just "Root", "Part"
  // However, if we have multiple namespaces like "Button.Root" and "Checkbox.Root",
  // keep the prefixes to distinguish them

  // Find all dotted component names
  const dottedComponents = allTypes
    .filter((t) => t.type === 'component' || t.type === 'hook')
    .map((t) => t.name)
    .filter((componentName) => componentName.includes('.'));

  let commonPrefix: string | null = null;
  if (dottedComponents.length > 0) {
    // Extract the prefix before the first dot from each name
    const prefixes = dottedComponents.map((componentName) => componentName.split('.')[0]);
    // Get unique prefixes
    const uniquePrefixes = Array.from(new Set(prefixes));

    // Only strip the prefix if ALL components share the SAME prefix
    if (uniquePrefixes.length === 1) {
      const singlePrefix = uniquePrefixes[0];

      // Check if there's a standalone component with this exact name
      const hasStandaloneComponent = allTypes.some((t) => {
        if (t.type !== 'component' && t.type !== 'hook') {
          return false;
        }
        if (t.name !== singlePrefix) {
          return false;
        }
        // For components: check if it has actual content
        if (t.type === 'component') {
          const hasProps = t.data.props && Object.keys(t.data.props).length > 0;
          const hasDataAttrs =
            t.data.dataAttributes && Object.keys(t.data.dataAttributes).length > 0;
          const hasCssVars = t.data.cssVariables && Object.keys(t.data.cssVariables).length > 0;
          return hasProps || hasDataAttrs || hasCssVars || !!t.data.description;
        }
        return true; // Hooks always have content
      });

      if (!hasStandaloneComponent) {
        commonPrefix = singlePrefix;
      }
    }
    // If there are multiple unique prefixes, don't strip anything
  }

  // Helper function to generate markdown chunks for a single type
  // When useFullName is true, the type name is not stripped of the common prefix
  async function generateSingleTypeMarkdown(
    typeMeta: TypesMeta,
    useFullName = false,
  ): Promise<MarkdownChunk[]> {
    const chunks: MarkdownChunk[] = [];
    const nodes: RootContent[] = [];

    // Helper to flush pending nodes to a chunk
    const flush = () => {
      if (nodes.length > 0) {
        chunks.push(markdownChunk([...nodes]));
        nodes.length = 0;
      }
    };

    // Helper to add a code block (flushes nodes first)
    const addCodeBlock = (code: string, language: string) => {
      flush();
      chunks.push(codeBlockChunk(code, language));
    };

    // Helper to add a heading (flushes nodes first, bypasses remark-gfm escaping)
    const addHeading = (depth: 1 | 2 | 3 | 4 | 5 | 6, text: string) => {
      flush();
      chunks.push(headingChunk(depth, text));
    };

    // Helper to get display name - either full name or stripped prefix
    const getDisplayName = (part: string): string => {
      if (useFullName) {
        return part;
      }
      return commonPrefix && part.startsWith(`${commonPrefix}.`)
        ? part.slice(commonPrefix.length + 1)
        : part;
    };

    if (typeMeta.type === 'component') {
      // Use transformed name (e.g., "Component.Part" instead of "ComponentPart")
      const part = typeMeta.name;
      const data = typeMeta.data; // This is now properly typed as ComponentTypeMeta

      // Strip common prefix from component heading if applicable
      const displayName = getDisplayName(part);

      addHeading(3, displayName);

      if (data.descriptionText) {
        nodes.push(...parseMarkdown(data.descriptionText));
      }

      // Props table
      if (Object.keys(data.props || {}).length > 0) {
        nodes.push(md.paragraph([md.strong(`${displayName} Props:`)]));
        const propsRows = Object.entries(data.props).map(([propName, propDef]: [string, any]) => {
          // Use * to indicate required props
          const propDisplayName = propDef.required ? `${propName}*` : propName;
          // Strip `| undefined` from optional props for cleaner markdown display
          const displayType = propDef.required
            ? propDef.typeText
            : stripTrailingUndefined(propDef.typeText);
          return [
            propDisplayName,
            displayType ? md.inlineCode(displayType) : '-',
            propDef.defaultText ? md.inlineCode(propDef.defaultText) : '-',
            propDef.descriptionText ? parseInlineMarkdown(propDef.descriptionText) : '-',
          ];
        });
        nodes.push(
          md.table(
            ['Prop', 'Type', 'Default', 'Description'],
            propsRows as any,
            ['left', 'left', 'left', 'left'] as any,
          ),
        );

        // Prop examples (after the props table)
        const propsWithExamples = Object.entries(data.props)
          .filter(([, propDef]: [string, any]) => propDef.exampleText)
          .map(([propName, propDef]: [string, any]) => {
            // Parse the example markdown to extract code block content and language
            const codeBlockMatch = propDef.exampleText.match(/```(\w*)\n([\s\S]*?)\n```/);
            if (codeBlockMatch) {
              return {
                propName,
                language: codeBlockMatch[1] || 'tsx',
                code: codeBlockMatch[2],
              };
            }
            return null;
          })
          .filter(Boolean) as { propName: string; language: string; code: string }[];

        // Format all examples in parallel
        const formattedExamples = await Promise.all(
          propsWithExamples.map(async ({ propName, language, code }) => ({
            propName,
            language,
            formattedCode: await prettyFormat(code, null),
          })),
        );

        // Add formatted examples to the output
        for (const { propName, language, formattedCode } of formattedExamples) {
          nodes.push(
            md.paragraph([md.strong([md.inlineCode(propName), md.text(' Prop Example:')])]),
          );
          addCodeBlock(formattedCode, language);
        }

        // Prop references (after the prop examples)
        const propsWithRefs = Object.entries(data.props).filter(([, propDef]) => propDef.seeText);
        for (const [propName, propDef] of propsWithRefs) {
          nodes.push(
            md.paragraph([md.strong([md.inlineCode(propName), md.text(' Prop References:')])]),
          );
          nodes.push(...parseMarkdown(propDef.seeText!));
        }
      }

      // Data attributes table
      if (Object.keys(data.dataAttributes || {}).length > 0) {
        nodes.push(md.paragraph([md.strong(`${displayName} Data Attributes:`)]));
        const attrRows = Object.entries(data.dataAttributes).map(
          ([attrName, attrDef]: [string, any]) => [
            attrName,
            attrDef.type ? md.inlineCode(attrDef.type) : '-',
            attrDef.descriptionText ? parseInlineMarkdown(attrDef.descriptionText) : '-',
          ],
        );
        nodes.push(
          md.table(
            ['Attribute', 'Type', 'Description'],
            attrRows as any,
            ['left', 'left', 'left'] as any,
          ),
        );
      }

      // CSS variables table
      if (Object.keys(data.cssVariables || {}).length > 0) {
        nodes.push(md.paragraph([md.strong(`${displayName} CSS Variables:`)]));
        const cssRows = Object.entries(data.cssVariables).map(
          ([variableName, variableDef]: [string, any]) => [
            md.inlineCode(variableName),
            md.inlineCode(variableDef.type || ''),
            variableDef.descriptionText ? parseInlineMarkdown(variableDef.descriptionText) : '-',
          ],
        );
        nodes.push(
          md.table(
            ['Variable', 'Type', 'Description'],
            cssRows as any,
            ['left', 'left', 'left'] as any,
          ),
        );
      }
    } else if (typeMeta.type === 'hook') {
      // Use transformed name for hooks as well
      const part = typeMeta.name;
      const data = typeMeta.data; // This is now properly typed as HookTypeMeta
      const hookDisplayName = getDisplayName(part);

      addHeading(3, hookDisplayName);

      if (data.descriptionText) {
        nodes.push(...parseMarkdown(data.descriptionText));
      }

      // Parameters table or Properties table (when single object param was expanded)
      const paramsOrProps = data.properties ?? data.parameters ?? {};
      if (Object.keys(paramsOrProps).length > 0) {
        const isProperties = Boolean(data.properties);
        const sectionLabel = isProperties ? 'Properties' : 'Parameters';
        const columnLabel = isProperties ? 'Property' : 'Parameter';
        nodes.push(md.paragraph([md.strong(`${hookDisplayName} ${sectionLabel}:`)]));
        const paramRows = Object.entries(paramsOrProps).map(
          ([paramName, paramDef]: [string, any]) => {
            // Use * to indicate required parameters
            const displayName = paramDef.required ? `${paramName}*` : paramName;
            // Strip `| undefined` from optional params for cleaner markdown display
            const displayType = paramDef.required
              ? paramDef.typeText
              : stripTrailingUndefined(paramDef.typeText);
            return [
              displayName,
              displayType ? md.inlineCode(displayType) : '-',
              paramDef.defaultText ? md.inlineCode(paramDef.defaultText) : '-',
              paramDef.descriptionText ? parseInlineMarkdown(paramDef.descriptionText) : '-',
            ];
          },
        );
        nodes.push(
          md.table(
            [columnLabel, 'Type', 'Default', 'Description'],
            paramRows as any,
            ['left', 'left', 'left', 'left'] as any,
          ),
        );

        // Parameter examples (after the parameters table)
        const paramsWithExamples = Object.entries(paramsOrProps)
          .filter(([, paramDef]: [string, any]) => paramDef.exampleText)
          .map(([paramName, paramDef]: [string, any]) => {
            const codeBlockMatch = paramDef.exampleText.match(/```(\w*)\n([\s\S]*?)\n```/);
            if (codeBlockMatch) {
              return {
                paramName,
                language: codeBlockMatch[1] || 'tsx',
                code: codeBlockMatch[2],
              };
            }
            return null;
          })
          .filter(Boolean) as { paramName: string; language: string; code: string }[];

        const formattedParamExamples = await Promise.all(
          paramsWithExamples.map(async ({ paramName, language, code }) => ({
            paramName,
            language,
            formattedCode: await prettyFormat(code, null),
          })),
        );

        for (const { paramName, language, formattedCode } of formattedParamExamples) {
          nodes.push(
            md.paragraph([md.strong([md.inlineCode(paramName), md.text(' Parameter Example:')])]),
          );
          addCodeBlock(formattedCode, language);
        }

        // Parameter references (after the parameter examples)
        const paramsWithRefs = Object.entries(paramsOrProps).filter(
          ([, paramDef]) => paramDef.seeText,
        );
        for (const [paramName, paramDef] of paramsWithRefs) {
          nodes.push(
            md.paragraph([
              md.strong([md.inlineCode(paramName), md.text(' Parameter References:')]),
            ]),
          );
          nodes.push(...parseMarkdown(paramDef.seeText!));
        }
      }

      // Return Value
      if (data.returnValue) {
        nodes.push(md.paragraph([md.strong(`${hookDisplayName} Return Value:`)]));
        if (data.returnValueDescriptionText) {
          nodes.push(...parseMarkdown(data.returnValueDescriptionText));
        }

        if (typeof data.returnValue === 'string') {
          const typeText = data.returnValueText || data.returnValue;
          const formattedReturnType = await prettyFormat(typeText, 'ReturnValue');
          addCodeBlock(formattedReturnType, 'tsx');
        } else if (
          typeof data.returnValue === 'object' &&
          Object.keys(data.returnValue).length > 0
        ) {
          const returnRows = Object.entries(data.returnValue).map(
            ([returnName, returnDef]: [string, any]) => [
              returnName,
              returnDef.typeText ? md.inlineCode(returnDef.typeText) : '-',
              returnDef.descriptionText ? parseInlineMarkdown(returnDef.descriptionText) : '-',
            ],
          );
          nodes.push(
            md.table(
              ['Property', 'Type', 'Description'],
              returnRows as any,
              ['left', 'left', 'left'] as any,
            ),
          );
        }
      }
    } else if (typeMeta.type === 'function') {
      const part = typeMeta.data.name;
      const data = typeMeta.data;

      const displayName = getDisplayName(part);

      addHeading(3, displayName);

      if (data.descriptionText) {
        nodes.push(...parseMarkdown(data.descriptionText));
      }

      // Parameters or Properties table
      const paramsOrProps = data.properties ?? data.parameters ?? {};
      const isProperties = Boolean(data.properties);
      if (Object.keys(paramsOrProps).length > 0) {
        if (isProperties) {
          // Properties table (expanded from single anonymous object parameter)
          nodes.push(md.paragraph([md.strong(`${displayName} Properties:`)]));
          const propRows = Object.entries(paramsOrProps).map(
            ([propName, propDef]: [string, any]) => {
              // Use * to indicate required properties
              const propDisplayName = propDef.required ? `${propName}*` : propName;
              // Strip `| undefined` from optional props for cleaner markdown display
              const displayType = propDef.required
                ? propDef.typeText
                : stripTrailingUndefined(propDef.typeText);
              return [
                propDisplayName,
                displayType ? md.inlineCode(displayType) : '-',
                propDef.defaultText ? md.inlineCode(propDef.defaultText) : '-',
                propDef.descriptionText ? parseInlineMarkdown(propDef.descriptionText) : '-',
              ];
            },
          );
          nodes.push(
            md.table(
              ['Property', 'Type', 'Default', 'Description'],
              propRows as any,
              ['left', 'left', 'left', 'left'] as any,
            ),
          );
        } else {
          // Standard parameters table
          nodes.push(md.paragraph([md.strong('Parameters:')]));
          const paramRows = Object.entries(paramsOrProps).map(
            ([paramName, paramDef]: [string, any]) => {
              // Use ? to indicate optional parameters (TypeScript convention)
              const paramDisplayName = paramDef.optional ? `${paramName}?` : paramName;
              // Strip `| undefined` from optional params for cleaner markdown display
              const displayType = paramDef.optional
                ? stripTrailingUndefined(paramDef.typeText)
                : paramDef.typeText;
              return [
                paramDisplayName,
                displayType ? md.inlineCode(displayType) : '-',
                paramDef.defaultText ? md.inlineCode(paramDef.defaultText) : '-',
                paramDef.descriptionText ? parseInlineMarkdown(paramDef.descriptionText) : '-',
              ];
            },
          );
          nodes.push(
            md.table(
              ['Parameter', 'Type', 'Default', 'Description'],
              paramRows as any,
              ['left', 'left', 'left', 'left'] as any,
            ),
          );
        }

        // Parameter/Property examples (after the table)
        const paramsWithExamples = Object.entries(paramsOrProps)
          .filter(([, paramDef]: [string, any]) => paramDef.exampleText)
          .map(([paramName, paramDef]: [string, any]) => {
            const codeBlockMatch = paramDef.exampleText!.match(/```(\w*)\n([\s\S]*?)\n```/);
            if (codeBlockMatch) {
              return {
                paramName,
                language: codeBlockMatch[1] || 'tsx',
                code: codeBlockMatch[2],
              };
            }
            return null;
          })
          .filter(Boolean) as { paramName: string; language: string; code: string }[];

        const formattedParamExamples = await Promise.all(
          paramsWithExamples.map(async ({ paramName, language, code }) => ({
            paramName,
            language,
            formattedCode: await prettyFormat(code, null),
          })),
        );

        const exampleLabel = isProperties ? 'Property' : 'Parameter';
        for (const { paramName, language, formattedCode } of formattedParamExamples) {
          nodes.push(
            md.paragraph([
              md.strong([md.inlineCode(paramName), md.text(` ${exampleLabel} Example:`)]),
            ]),
          );
          addCodeBlock(formattedCode, language);
        }

        // Parameter/Property references (after the examples)
        const funcParamsWithRefs = Object.entries(paramsOrProps).filter(
          ([, paramDef]: [string, any]) => paramDef.seeText,
        );
        const refLabel = isProperties ? 'Property' : 'Parameter';
        for (const [paramName, paramDef] of funcParamsWithRefs) {
          nodes.push(
            md.paragraph([
              md.strong([md.inlineCode(paramName), md.text(` ${refLabel} References:`)]),
            ]),
          );
          nodes.push(...parseMarkdown((paramDef as any).seeText!));
        }
      }

      // Return Value
      if (data.returnValue) {
        nodes.push(md.paragraph([md.strong('Return Value:')]));
        if (data.returnValueDescriptionText) {
          nodes.push(...parseMarkdown(data.returnValueDescriptionText));
        }
        if (typeof data.returnValue === 'string') {
          const formattedReturnType = await prettyFormat(data.returnValue, 'ReturnValue');
          addCodeBlock(formattedReturnType, 'tsx');
        } else {
          // Object return value - generate a table like hooks (no Default column)
          const returnProps = data.returnValue as Record<string, FormattedProperty>;
          const returnRows = Object.entries(returnProps).map(([propName, prop]) => [
            md.inlineCode(propName),
            md.inlineCode(
              prop.typeText.length > 60 ? `${prop.typeText.slice(0, 60)}...` : prop.typeText,
            ),
            prop.descriptionText ? parseInlineMarkdown(prop.descriptionText) : '-',
          ]);
          nodes.push(
            md.table(
              ['Property', 'Type', 'Description'],
              returnRows as any,
              ['left', 'left', 'left'] as any,
            ),
          );
        }
      }
    } else if (typeMeta.type === 'class') {
      // For 'class' types (ClassTypeMeta)
      const part = typeMeta.data.name;
      const data = typeMeta.data;

      const displayName = getDisplayName(part);

      addHeading(3, displayName);

      if (data.descriptionText) {
        nodes.push(...parseMarkdown(data.descriptionText));
      }

      // Static Methods (before constructor, as they're often factory methods)
      const staticMethods = Object.entries(data.methods || {}).filter(
        ([, methodDef]) => methodDef.isStatic,
      );
      if (staticMethods.length > 0) {
        nodes.push(md.paragraph([md.strong('Static Methods:')]));

        // Format all method signatures in parallel
        const formattedStaticMethods = await Promise.all(
          staticMethods.map(async ([methodName, methodDef]) => {
            const paramSignature = Object.entries(methodDef.parameters)
              .map(([pName, pDef]) => {
                const optional = pDef.optional ? '?' : '';
                return `${pName}${optional}: ${pDef.typeText}`;
              })
              .join(', ');
            const signature = `function ${methodName}(${paramSignature}): ${methodDef.returnValue}`;
            const formattedSignature = await prettyFormat(signature, null);
            return { methodName, formattedSignature, descriptionText: methodDef.descriptionText };
          }),
        );

        for (const { formattedSignature, descriptionText } of formattedStaticMethods) {
          addCodeBlock(formattedSignature, 'typescript');
          if (descriptionText) {
            nodes.push(...parseMarkdown(descriptionText));
          }
        }
      }

      // Constructor parameters table
      if (Object.keys(data.constructorParameters || {}).length > 0) {
        nodes.push(md.paragraph([md.strong('Constructor Parameters:')]));
        const paramRows = Object.entries(data.constructorParameters).map(
          ([paramName, paramDef]) => {
            const paramDisplayName = paramDef.optional ? `${paramName}?` : paramName;
            const displayType = paramDef.optional
              ? stripTrailingUndefined(paramDef.typeText)
              : paramDef.typeText;
            return [
              paramDisplayName,
              displayType ? md.inlineCode(displayType) : '-',
              paramDef.defaultText ? md.inlineCode(paramDef.defaultText) : '-',
              paramDef.descriptionText ? parseInlineMarkdown(paramDef.descriptionText) : '-',
            ];
          },
        );
        nodes.push(
          md.table(
            ['Parameter', 'Type', 'Default', 'Description'],
            paramRows as any,
            ['left', 'left', 'left', 'left'] as any,
          ),
        );
      }

      // Properties table
      if (Object.keys(data.properties || {}).length > 0) {
        nodes.push(md.paragraph([md.strong('Properties:')]));
        const propRows = Object.entries(data.properties).map(([propName, propDef]) => {
          const propDisplayName = propDef.optional ? `${propName}?` : propName;
          const displayType = propDef.optional
            ? stripTrailingUndefined(propDef.typeText)
            : propDef.typeText;
          const modifiers: string[] = [];
          if (propDef.isStatic) {
            modifiers.push('static');
          }
          if (propDef.readonly) {
            modifiers.push('readonly');
          }
          const modifiersText = modifiers.join(', ') || '-';

          const descriptionCell: PhrasingContent[] | string = propDef.descriptionText
            ? parseInlineMarkdown(propDef.descriptionText)
            : '-';

          return [
            propDisplayName,
            displayType ? md.inlineCode(displayType) : '-',
            modifiersText,
            descriptionCell,
          ];
        });
        nodes.push(
          md.table(
            ['Property', 'Type', 'Modifiers', 'Description'],
            propRows as any,
            ['left', 'left', 'left', 'left'] as any,
          ),
        );
      }

      // Methods (instance methods)
      const instanceMethods = Object.entries(data.methods || {}).filter(
        ([, methodDef]) => !methodDef.isStatic,
      );
      if (instanceMethods.length > 0) {
        nodes.push(md.paragraph([md.strong('Methods:')]));

        // Format all method signatures in parallel
        const formattedInstanceMethods = await Promise.all(
          instanceMethods.map(async ([methodName, methodDef]) => {
            const paramSignature = Object.entries(methodDef.parameters)
              .map(([pName, pDef]) => {
                const optional = pDef.optional ? '?' : '';
                return `${pName}${optional}: ${pDef.typeText}`;
              })
              .join(', ');
            const signature = `function ${methodName}(${paramSignature}): ${methodDef.returnValue}`;
            const formattedSignature = await prettyFormat(signature, null);
            return { methodName, formattedSignature, descriptionText: methodDef.descriptionText };
          }),
        );

        for (const { formattedSignature, descriptionText } of formattedInstanceMethods) {
          addCodeBlock(formattedSignature, 'typescript');
          if (descriptionText) {
            nodes.push(...parseMarkdown(descriptionText));
          }
        }
      }
    } else {
      // For 'raw' types (RawTypeMeta)
      // The formatting is already done in formatRaw.ts, we just need to output it
      const part = typeMeta.name;
      const data = typeMeta.data;

      const displayName = getDisplayName(part);

      addHeading(3, displayName);

      if (data.reExportOf) {
        nodes.push(
          md.paragraph([
            md.text('Re-export of '),
            md.link(data.reExportOf.slug, data.reExportOf.name),
            md.text(` ${data.reExportOf.suffix}.`),
          ]),
        );
      } else if (data.dataAttributesOf) {
        const componentName = data.dataAttributesOf;
        const anchorId = componentName.toLowerCase().replace(/\./g, '');
        nodes.push(
          md.paragraph([
            md.text('Data attributes for '),
            md.link(`#${anchorId}`, componentName),
            md.text(' component.'),
          ]),
        );
      } else if (data.cssVarsOf) {
        const componentName = data.cssVarsOf;
        const anchorId = componentName.toLowerCase().replace(/\./g, '');
        nodes.push(
          md.paragraph([
            md.text('CSS variables for '),
            md.link(`#${anchorId}`, componentName),
            md.text(' component.'),
          ]),
        );
      } else if (data.enumMembers && data.enumMembers.length > 0) {
        // Render enum as a table
        if (data.descriptionText) {
          nodes.push(...parseMarkdown(data.descriptionText));
        }
        const enumRows = data.enumMembers.map((member) => [
          member.name,
          member.value !== undefined ? md.inlineCode(String(member.value)) : '-',
          member.descriptionText ? parseInlineMarkdown(member.descriptionText) : '-',
        ]);
        nodes.push(
          md.table(
            ['Member', 'Value', 'Description'],
            enumRows as any,
            ['left', 'left', 'left'] as any,
          ),
        );
      } else {
        // Regular raw type - output description and pre-formatted code
        if (data.descriptionText) {
          nodes.push(...parseMarkdown(data.descriptionText));
        }
        // The formattedCode is already formatted by prettyFormat in formatRaw.ts
        addCodeBlock(data.formattedCode, 'typescript');
      }
    }

    flush();
    return chunks;
  }

  // Process all exports in parallel, each export generating chunks for its main type and additionalTypes
  const exportChunksArrays = await Promise.all(
    Object.values(organizedExports).map(async (exportData) => {
      // Generate chunks for the main type
      const mainTypeChunks = await generateSingleTypeMarkdown(exportData.type);

      // Generate chunks for additional types (Props, State, etc.)
      const additionalTypeChunks = await Promise.all(
        exportData.additionalTypes.map((additionalType) =>
          generateSingleTypeMarkdown(additionalType),
        ),
      );

      return [...mainTypeChunks, ...additionalTypeChunks.flat()];
    }),
  );

  // Process additional types (non-namespaced types like InputType) if any
  let additionalTypesChunks: MarkdownChunk[] = [];
  if (additionalTypes.length > 0) {
    // Add the "## Additional Types" heading
    additionalTypesChunks.push(headingChunk(2, 'Additional Types'));

    // Process each additional type using the same helper, but with full names
    const additionalTypeChunksArrays = await Promise.all(
      additionalTypes.map((typeMeta) => generateSingleTypeMarkdown(typeMeta, true)),
    );

    additionalTypesChunks = additionalTypesChunks.concat(additionalTypeChunksArrays.flat());
  }

  // Process external types if any
  const externalTypesChunks: MarkdownChunk[] = [];
  const externalTypeEntries = Object.entries(externalTypes);
  if (externalTypeEntries.length > 0) {
    // Add the "## External Types" heading
    externalTypesChunks.push(headingChunk(2, 'External Types'));

    // Process each external type
    for (const [typeName, definition] of externalTypeEntries) {
      // Add type heading
      externalTypesChunks.push(headingChunk(3, typeName));

      // Add type definition as code block (definition is the full declaration from prettyFormat)
      externalTypesChunks.push(codeBlockChunk(definition, 'typescript'));
    }
  }

  // Build human-readable metadata sections (Export Groups and Canonical Types)
  const metadataChunks: MarkdownChunk[] = [];

  // Determine if we have multiple variants (not just "Default")
  const variantNames = Object.keys(organized.variantTypeNames);
  const hasMultipleVariants =
    variantNames.length > 1 || (variantNames.length === 1 && variantNames[0] !== 'Default');

  if (hasMultipleVariants) {
    // Build Export Groups section: variant name -> array of type names
    // Format: - `VariantName`: `Type1`, `Type2` (or just `- VariantName` if key equals single value)
    const exportGroupsItems = Object.entries(organized.variantTypeNames).map(
      ([variantName, typeNames]) => {
        if (typeNames.length === 1 && typeNames[0] === variantName) {
          // Key equals single value, omit the value
          return md.listItem([md.inlineCode(variantName)]);
        }
        // Build: `VariantName`: `Type1`, `Type2`
        const children: PhrasingContent[] = [md.inlineCode(variantName), md.text(': ')];
        typeNames.forEach((typeName, i) => {
          if (i > 0) {
            children.push(md.text(', '));
          }
          children.push(md.inlineCode(typeName));
        });
        return md.listItem(children);
      },
    );
    metadataChunks.push(headingChunk(2, 'Export Groups'));
    metadataChunks.push(markdownChunk([md.list(exportGroupsItems)]));
  }

  // Build Canonical Types section: invert typeNameMap to group keys by canonical name
  // Also track which variant each type belongs to via variantTypeNameMapKeys
  if (Object.keys(typeNameMap).length > 0) {
    // Invert typeNameMap: canonical name -> array of flat names
    const canonicalToFlat: Record<string, string[]> = {};
    for (const [flatName, canonicalName] of Object.entries(typeNameMap)) {
      if (!canonicalToFlat[canonicalName]) {
        canonicalToFlat[canonicalName] = [];
      }
      canonicalToFlat[canonicalName].push(flatName);
    }

    // Build variantTypeNameMapKeys for determining which variants each key belongs to
    const keyToVariants: Record<string, string[]> = {};
    if (hasMultipleVariants) {
      for (const [variantName, perVariantMap] of Object.entries(organized.variantTypeNameMaps)) {
        for (const key of Object.keys(perVariantMap)) {
          if (!keyToVariants[key]) {
            keyToVariants[key] = [];
          }
          keyToVariants[key].push(variantName);
        }
      }
    }

    // Build the Canonical Types list items
    const canonicalTypesItems = Object.entries(canonicalToFlat).map(
      ([canonicalName, flatNames]) => {
        // Determine the variant annotation for this canonical type
        // We use the variants of the first flat name (they should all be the same)
        const variants = keyToVariants[flatNames[0]] || [];

        // Build the list item content
        const children: PhrasingContent[] = [md.inlineCode(canonicalName)];

        // Only show variant annotation if:
        // 1. There are multiple variants
        // 2. This canonical type is NOT available in ALL export groups
        if (variants.length > 0 && hasMultipleVariants) {
          const isInAllVariants = variantNames.every((v) => variants.includes(v));
          if (!isInAllVariants) {
            children.push(md.text(' ('));
            variants.forEach((variant, i) => {
              if (i > 0) {
                children.push(md.text(', '));
              }
              children.push(md.inlineCode(variant));
            });
            children.push(md.text(')'));
          }
        }

        children.push(md.text(': '));
        flatNames.forEach((flatName, i) => {
          if (i > 0) {
            children.push(md.text(', '));
          }
          children.push(md.inlineCode(flatName));
        });

        return md.listItem(children);
      },
    );

    metadataChunks.push(headingChunk(2, 'Canonical Types'));
    metadataChunks.push(
      markdownChunk([
        md.paragraph([
          md.text('Maps '),
          md.inlineCode('Canonical'),
          md.text(': '),
          md.inlineCode('Alias'),
          md.text(' — rename aliases to their canonical form for consistent usage.'),
        ]),
      ]),
    );
    metadataChunks.push(markdownChunk([md.list(canonicalTypesItems)]));
  }

  // Flatten all chunks and format with prettier where needed
  const allChunks = [
    headerChunk,
    ...exportChunksArrays.flat(),
    ...additionalTypesChunks,
    ...externalTypesChunks,
    ...metadataChunks,
  ];
  const formattedChunks = await Promise.all(
    allChunks.map(async (chunk) => {
      if (chunk.needsPrettier) {
        return prettyFormatMarkdown(chunk.content);
      }
      return chunk.content.trimEnd();
    }),
  );

  // Join all chunks with double newlines to ensure proper spacing in markdown
  return `${formattedChunks.join('\n\n')}\n`;
}
