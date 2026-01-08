import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import type { PhrasingContent, RootContent, Root } from 'mdast';
import * as md from '../syncPageIndex/createMarkdownNodes';
import type { TypesMeta } from './syncTypes';
import { prettyFormat, prettyFormatMarkdown, formatType } from './format';
import { namespaceParts, typeSuffixes } from './order';

/**
 * Sort types for documentation generation using structured ordering.
 *
 * Sorting rules:
 * 1. Top-level components are sorted by componentExports order
 * 2. Namespace parts (Component.Part) are sorted by namespaceParts order
 * 3. Type suffixes (Component.PartProps, Component.PartState) are sorted by typeSuffixes order
 * 4. DataAttributes and CssVars are sorted by typeSuffixes order
 */
function sortTypes(types: TypesMeta[]): TypesMeta[] {
  const getOrderIndex = (arr: string[], value: string | null): number => {
    if (value === null) {
      return arr.indexOf('__EVERYTHING_ELSE__');
    }
    const idx = arr.indexOf(value);
    return idx === -1 ? arr.indexOf('__EVERYTHING_ELSE__') : idx;
  };

  const parseName = (fullName: string, isComponentOrHook: boolean) => {
    // fullName is like: "Checkbox.Root", "Checkbox.Root.Props", "Checkbox.Indicator.State"
    // We need to extract: component, part, suffix

    // Components/hooks are never parsed for suffixes (Slider.Value is a component part, not a type suffix)
    if (isComponentOrHook) {
      const lastDotIndex = fullName.lastIndexOf('.');
      if (lastDotIndex > 0) {
        const component = fullName.substring(0, lastDotIndex);
        const part = fullName.substring(lastDotIndex + 1);
        return { component, part, suffix: null };
      }
      return { component: null, part: fullName, suffix: null };
    }

    // For types (not components/hooks), check if we have Component.Part.Suffix structure
    // Count dots to determine structure
    const parts = fullName.split('.');

    if (parts.length === 3) {
      // "Slider.Root.Props" or "Slider.Root.CommitEventDetails"
      // component = "Slider", part = "Root", suffix = "Props" or "CommitEventDetails"
      return { component: parts[0], part: parts[1], suffix: parts[2] };
    }

    if (parts.length === 2) {
      // "Slider.Value" (a type, not component) or "Tab.Value"
      // component = "Slider", part = null, suffix = "Value"
      // BUT: Only treat second part as suffix if it's in typeSuffixes array
      // Otherwise treat as: component = "Slider", part = "Value", suffix = null
      if (typeSuffixes.includes(parts[1])) {
        return { component: parts[0], part: null, suffix: parts[1] };
      }
      return { component: parts[0], part: parts[1], suffix: null };
    }

    if (parts.length === 1) {
      // "DirectionProvider" - standalone type
      return { component: null, part: parts[0], suffix: null };
    }

    // Fallback for > 3 parts (shouldn't happen, but handle gracefully)
    const lastDotIndex = fullName.lastIndexOf('.');
    if (lastDotIndex > 0) {
      const component = fullName.substring(0, lastDotIndex);
      const part = fullName.substring(lastDotIndex + 1);
      return { component, part, suffix: null };
    }
    return { component: null, part: fullName, suffix: null };
  };

  return types.slice().sort((a, b) => {
    // Use typeMeta.name for all types (already transformed to dotted format like "Component.Root")
    const aFullName = a.name;
    const bFullName = b.name;

    const aIsComponentOrHook = a.type === 'component' || a.type === 'hook';
    const bIsComponentOrHook = b.type === 'component' || b.type === 'hook';

    const aParsed = parseName(aFullName, aIsComponentOrHook);
    const bParsed = parseName(bFullName, bIsComponentOrHook);

    // For types with suffixes (like DirectionProvider.Props), group them with their base type
    // by comparing base names first, then suffixes
    const aBaseName = aParsed.suffix
      ? aFullName.substring(0, aFullName.length - aParsed.suffix.length - 1)
      : aFullName;
    const bBaseName = bParsed.suffix
      ? bFullName.substring(0, bFullName.length - bParsed.suffix.length - 1)
      : bFullName;

    // First, compare by base name (without suffix) to keep related types together
    if (aBaseName !== bBaseName) {
      // Sort by the part name (e.g., "Root", "Trigger", "Value", etc.)
      // This ensures proper ordering based on namespaceParts configuration
      const aPartIdx = getOrderIndex(namespaceParts, aParsed.part);
      const bPartIdx = getOrderIndex(namespaceParts, bParsed.part);

      if (aPartIdx !== bPartIdx) {
        return aPartIdx - bPartIdx;
      }

      // Fallback to alphabetical for base names
      return aBaseName.localeCompare(bBaseName);
    }

    // Same base name - sort by suffix (Props, State, DataAttributes, etc.)
    // Items with no suffix should come first (before .Props, .State, etc.)
    const aSuffixIdx = aParsed.suffix === null ? -1 : getOrderIndex(typeSuffixes, aParsed.suffix);
    const bSuffixIdx = bParsed.suffix === null ? -1 : getOrderIndex(typeSuffixes, bParsed.suffix);
    return aSuffixIdx - bSuffixIdx;
  });
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

export async function generateTypesMarkdown(
  name: string,
  types: TypesMeta[],
  typeNameMap: Record<string, string> = {},
): Promise<string> {
  // Header chunk
  const headerChunk = markdownChunk([
    md.heading(1, name),
    md.comment('<-- Autogenerated By (do not edit the following markdown directly)', 'types.ts'),
    md.heading(2, 'API Reference'),
  ]);

  // Sort types before processing
  const sortedTypes = sortTypes(types);

  // For blocks pattern: determine if we should strip the common prefix from component names
  // E.g., if we have "Component.Root", "Component.Part" but NO standalone "Component" component,
  // strip the "Component." prefix so they display as just "Root", "Part"
  // However, if we have multiple namespaces like "Button.Root" and "Checkbox.Root",
  // keep the prefixes to distinguish them

  // Find all dotted component names
  const dottedComponents = types
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
      const hasStandaloneComponent = types.some((t) => {
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

  // Process all types in parallel, each returning its chunks
  const typeChunksArrays = await Promise.all(
    sortedTypes.map(async (typeMeta): Promise<MarkdownChunk[]> => {
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

      if (typeMeta.type === 'component') {
        // Use transformed name (e.g., "Component.Part" instead of "ComponentPart")
        const part = typeMeta.name;
        const data = typeMeta.data; // This is now properly typed as ComponentTypeMeta

        // Strip common prefix from component heading if applicable
        const displayName =
          commonPrefix && part.startsWith(`${commonPrefix}.`)
            ? part.slice(commonPrefix.length + 1)
            : part;

        addHeading(3, displayName);

        if (data.descriptionText) {
          nodes.push(...parseMarkdown(data.descriptionText));
        }

        // Props table
        if (Object.keys(data.props || {}).length > 0) {
          nodes.push(md.paragraph([md.strong(`${displayName} Props:`)]));
          const propsRows = Object.entries(data.props).map(([propName, propDef]: [string, any]) => [
            propName,
            propDef.typeText ? md.inlineCode(propDef.typeText) : '-',
            propDef.defaultText ? md.inlineCode(propDef.defaultText) : '-',
            propDef.descriptionText ? parseInlineMarkdown(propDef.descriptionText) : '-',
          ]);
          nodes.push(
            md.table(
              ['Prop', 'Type', 'Default', 'Description'],
              propsRows as any,
              ['left', 'left', 'left', 'left'] as any,
            ),
          );
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

        addHeading(3, part);

        if (data.descriptionText) {
          nodes.push(...parseMarkdown(data.descriptionText));
        }

        // Parameters table
        if (Object.keys(data.parameters || {}).length > 0) {
          nodes.push(md.paragraph([md.strong(`${part} Parameters:`)]));
          const paramRows = Object.entries(data.parameters).map(([paramName, paramDef]) => [
            paramName,
            paramDef.typeText ? md.inlineCode(paramDef.typeText) : '-',
            paramDef.defaultText ? md.inlineCode(paramDef.defaultText) : '-',
            paramDef.descriptionText ? parseInlineMarkdown(paramDef.descriptionText) : '-',
          ]);
          nodes.push(
            md.table(
              ['Parameter', 'Type', 'Default', 'Description'],
              paramRows as any,
              ['left', 'left', 'left', 'left'] as any,
            ),
          );
        }

        // Return Value
        if (data.returnValue) {
          nodes.push(md.paragraph([md.strong(`${part} Return Value:`)]));

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

        addHeading(3, part);

        if (data.descriptionText) {
          nodes.push(...parseMarkdown(data.descriptionText));
        }

        // Parameters table
        if (Object.keys(data.parameters || {}).length > 0) {
          nodes.push(md.paragraph([md.strong('Parameters:')]));
          const paramRows = Object.entries(data.parameters).map(([paramName, paramDef]) => {
            const displayName = paramDef.optional ? `${paramName}?` : paramName;
            return [
              displayName,
              paramDef.typeText ? md.inlineCode(paramDef.typeText) : '-',
              paramDef.defaultText ? md.inlineCode(paramDef.defaultText) : '-',
              paramDef.descriptionText ? parseInlineMarkdown(paramDef.descriptionText) : '-',
            ];
          });
          nodes.push(
            md.table(
              ['Parameter', 'Type', 'Default', 'Description'],
              paramRows as any,
              ['left', 'left', 'left', 'left'] as any,
            ),
          );
        }

        // Return Value
        if (data.returnValue) {
          nodes.push(md.paragraph([md.strong('Return Value:')]));
          if (data.returnValueDescriptionText) {
            nodes.push(...parseMarkdown(data.returnValueDescriptionText));
          }
          const formattedReturnType = await prettyFormat(data.returnValue, 'ReturnValue');
          addCodeBlock(formattedReturnType, 'tsx');
        }
      } else {
        // For 'other' types (ExportNode)
        // Use typeMeta.name which has been transformed to dotted format (e.g., "Component.Root.State")
        // For re-exports, typeMeta.name is also already in the correct format
        const part = typeMeta.name;
        const data = typeMeta.data; // This is now properly typed as ExportNode

        const displayName =
          commonPrefix && part.startsWith(`${commonPrefix}.`)
            ? part.slice(commonPrefix.length + 1)
            : part;

        addHeading(3, displayName);

        if (typeMeta.reExportOf) {
          const componentDisplayName =
            commonPrefix && typeMeta.reExportOf.startsWith(`${commonPrefix}.`)
              ? typeMeta.reExportOf.slice(commonPrefix.length + 1)
              : typeMeta.reExportOf;
          const anchorId = componentDisplayName.toLowerCase().replace(/\./g, '');
          nodes.push(
            md.paragraph([
              md.text('Re-export of '),
              md.link(`#${anchorId}`, componentDisplayName),
              md.text(' props.'),
            ]),
          );
        } else if (part.endsWith('.DataAttributes')) {
          const componentName = part.replace('.DataAttributes', '');
          const anchorId = componentName.toLowerCase().replace(/\./g, '');
          nodes.push(
            md.paragraph([
              md.text('Data attributes for '),
              md.link(`#${anchorId}`, componentName),
              md.text(' component.'),
            ]),
          );
        } else if (part.endsWith('.CssVars')) {
          const componentName = part.replace('.CssVars', '');
          const anchorId = componentName.toLowerCase().replace(/\./g, '');
          nodes.push(
            md.paragraph([
              md.text('CSS variables for '),
              md.link(`#${anchorId}`, componentName),
              md.text(' component.'),
            ]),
          );
        } else if (data.type.kind === 'enum' && data.type.members && data.type.members.length > 0) {
          if (data.documentation?.description) {
            nodes.push(...parseMarkdown(data.documentation.description));
          }
          const enumRows = data.type.members.map((member: any) => [
            member.name,
            member.value ? md.inlineCode(String(member.value)) : '-',
            member.documentation?.description
              ? parseInlineMarkdown(member.documentation.description)
              : '-',
          ]);
          nodes.push(
            md.table(
              ['Member', 'Value', 'Description'],
              enumRows as any,
              ['left', 'left', 'left'] as any,
            ),
          );
        } else {
          if (data.documentation?.description) {
            nodes.push(...parseMarkdown(data.documentation.description));
          }

          const typeAsAny = data.type as any;
          if (typeAsAny.kind === 'typeAlias' && typeof typeAsAny.typeText === 'string') {
            let sourceTypeText = typeAsAny.expandedTypeText || typeAsAny.typeText;
            if (sourceTypeText.includes('@iterator') && sourceTypeText.length > 500) {
              sourceTypeText = 'any[]';
            }

            let transformedTypeText = sourceTypeText;
            if (typeNameMap) {
              const namespaceMatch = part.match(/^([^.]+)\./);
              const currentNamespace = namespaceMatch ? namespaceMatch[1] : null;
              if (currentNamespace) {
                for (const [, dottedName] of Object.entries(typeNameMap)) {
                  const nameParts = dottedName.split('.');
                  if (nameParts.length >= 2 && nameParts[0] === currentNamespace) {
                    const memberName = nameParts.slice(1).join('.');
                    const memberPattern = `\\w+\\.${memberName.replace(/\./g, '\\.')}`;
                    const regex = new RegExp(memberPattern, 'g');
                    transformedTypeText = transformedTypeText.replace(regex, dottedName);
                  }
                }
              }
            }

            // Format with prettyFormat to show the type declaration
            // Use the ORIGINAL flat type name (e.g., "ComponentRootChangeEventDetails") not the dotted name
            // Reconstruct from typeName.namespaces + typeName.name if available
            let originalTypeName: string;
            const typeName = typeAsAny.typeName;
            if (typeName && typeName.namespaces && typeName.namespaces.length > 0) {
              // Construct flat name: namespaces joined + name (e.g., ComponentRoot + State = ComponentRootState)
              originalTypeName = typeName.namespaces.join('') + typeName.name;
            } else if (typeName && typeName.name) {
              originalTypeName = typeName.name;
            } else {
              // Fallback for tests without proper typeName
              originalTypeName = typeMeta.name.replace(/\./g, '');
            }
            const typeParams = typeAsAny.typeParameters || '';
            const fullTypeName = `${originalTypeName}${typeParams}`;

            const formattedType = await prettyFormat(transformedTypeText, fullTypeName);
            addCodeBlock(formattedType, 'typescript');
          } else {
            // For non-typeAlias types, use the original flat type name
            // Reconstruct from typeName.namespaces + typeName.name if available
            let originalTypeName: string;
            const typeName = (data.type as any).typeName;
            if (typeName && typeName.namespaces && typeName.namespaces.length > 0) {
              originalTypeName = typeName.namespaces.join('') + typeName.name;
            } else if (typeName && typeName.name) {
              originalTypeName = typeName.name;
            } else {
              // Fallback for tests without proper typeName
              originalTypeName = typeMeta.name.replace(/\./g, '');
            }
            const formattedType = await prettyFormat(
              formatType(data.type, true, undefined, true, [], typeNameMap, data.name),
              originalTypeName,
            );
            addCodeBlock(formattedType, 'typescript');
          }
        }
      }

      flush();
      return chunks;
    }),
  );

  // Flatten all chunks and format with prettier where needed
  const allChunks = [headerChunk, ...typeChunksArrays.flat()];
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
