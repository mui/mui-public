import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import rehypeRemark from 'rehype-remark';
import type { PhrasingContent, RootContent, Root } from 'mdast';
import type { HastRoot } from '../../CodeHighlighter/types';
import * as md from './createMarkdownNodes';
import type { TypesMeta } from './loadPrecomputedTypesMeta';
import { prettyFormatType, parseMarkdownToHast, prettyFormat } from './format';
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

  const parseName = (fullName: string) => {
    // fullName is like: "Checkbox.Root", "Checkbox.Root.Props", "Checkbox.Indicator.State"
    // We need to extract: component, part, suffix

    let suffix = null;
    let baseName = fullName;

    // Check if it ends with a known suffix like ".Props", ".State", etc.
    for (const suf of typeSuffixes) {
      if (suf === '__EVERYTHING_ELSE__') {
        continue;
      }
      if (fullName.endsWith(`.${suf}`)) {
        suffix = suf;
        baseName = fullName.substring(0, fullName.length - suf.length - 1); // Remove ".Suffix"
        break;
      }
    }

    // Now baseName is like "Checkbox.Root" or "Checkbox.Indicator"
    // Parse component.part structure
    const lastDotIndex = baseName.lastIndexOf('.');
    if (lastDotIndex > 0) {
      const component = baseName.substring(0, lastDotIndex);
      const part = baseName.substring(lastDotIndex + 1);
      return { component, part, suffix };
    }

    // No dot found - treat as just a part or component
    return { component: null, part: baseName, suffix };
  };

  return types.slice().sort((a, b) => {
    // Use data.name which has the full name like "Checkbox.Root"
    const aFullName = a.type === 'component' || a.type === 'hook' ? a.data.name : a.name;
    const bFullName = b.type === 'component' || b.type === 'hook' ? b.data.name : b.name;

    const aParsed = parseName(aFullName);
    const bParsed = parseName(bFullName);

    // First, sort by part (Root, Trigger, Indicator, etc.)
    const aPartIdx = getOrderIndex(namespaceParts, aParsed.part);
    const bPartIdx = getOrderIndex(namespaceParts, bParsed.part);

    if (aPartIdx !== bPartIdx) {
      return aPartIdx - bPartIdx;
    }

    // Then by suffix (Props, State, DataAttributes, etc.)
    // Items with no suffix should come first (before .Props, .State, etc.)
    const aSuffixIdx = aParsed.suffix === null ? -1 : getOrderIndex(typeSuffixes, aParsed.suffix);
    const bSuffixIdx = bParsed.suffix === null ? -1 : getOrderIndex(typeSuffixes, bParsed.suffix);
    if (aSuffixIdx !== bSuffixIdx) {
      return aSuffixIdx - bSuffixIdx;
    }

    // Finally, by original name as fallback
    if (aFullName < bFullName) {
      return -1;
    }
    if (aFullName > bFullName) {
      return 1;
    }

    return 0;
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

/**
 * Convert HAST (HTML AST) back to MDAST (Markdown AST)
 * @param hast - HAST root node
 * @returns Array of MDAST root content nodes
 */
async function hastToMdast(hast: HastRoot): Promise<RootContent[]> {
  const processor = unified().use(rehypeRemark);
  const result = (await processor.run(hast)) as Root;
  return result.children as RootContent[];
}

/**
 * Parse a markdown string and extract only the inline content (for table cells)
 * @param markdown - Markdown string to parse
 * @returns Array of phrasing content nodes
 */
function parseInlineMarkdown(markdown: string): PhrasingContent[] {
  const nodes = parseMarkdown(markdown);
  // If it's a single paragraph, return its children
  if (nodes.length === 1 && nodes[0].type === 'paragraph') {
    return (nodes[0] as any).children || [md.text(markdown)];
  }
  // Otherwise, convert to text
  return [md.text(markdown)];
}

/**
 * Convert HAST to inline markdown content (for table cells)
 * @param hast - HAST root node
 * @returns Array of phrasing content nodes
 */
async function hastToInlineMdast(hast: HastRoot): Promise<PhrasingContent[]> {
  const nodes = await hastToMdast(hast);

  return nodes.flatMap((node) => {
    // Handle paragraphs - extract their inline children
    if (node.type === 'paragraph') {
      return (node as any).children || [];
    }

    // Handle code blocks - convert to inline code
    if (node.type === 'code') {
      return [md.inlineCode((node as any).value || '')];
    }

    // Handle lists - convert to comma-separated inline content
    if (node.type === 'list') {
      const items = (node as any).children || [];
      const listContent: PhrasingContent[] = [];

      items.forEach((item: any, index: number) => {
        if (item.type === 'listItem') {
          const itemChildren = item.children || [];
          // Recursively flatten list item content
          itemChildren.forEach((child: any) => {
            if (child.type === 'paragraph') {
              listContent.push(...(child.children || []));
            }
          });

          // Add comma separator between items (but not after last item)
          if (index < items.length - 1) {
            listContent.push(md.text(', '));
          }
        }
      });

      return listContent;
    }

    // For other block-level content (headings, etc.), try to extract text
    if ('children' in node && Array.isArray((node as any).children)) {
      return (node as any).children.filter(
        (child: any) => child.type === 'text' || child.type === 'inlineCode',
      );
    }

    // Fallback: return empty array for unhandled node types
    return [];
  });
}

export async function generateTypesMarkdown(
  name: string,
  types: TypesMeta[],
  typeNameMap: Record<string, string> = {},
): Promise<string> {
  const tables: RootContent[] = [
    md.heading(1, name),
    md.comment('<-- Autogenerated By (do not edit the following markdown directly)', 'types.ts'),
    md.heading(2, 'API Reference'),
  ];

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

  let commonPrefix = null;
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

  const typeContents = await Promise.all(
    sortedTypes.map(async (typeMeta): Promise<RootContent[]> => {
      const content: RootContent[] = [];

      if (typeMeta.type === 'component') {
        const part = typeMeta.data.name;
        const data = typeMeta.data; // This is now properly typed as ComponentTypeMeta

        // Strip common prefix from component heading if applicable
        // E.g., "Component.Root" -> "Root" (when no standalone "Component" exists)
        // But "DirectionProvider.Props" stays as "DirectionProvider" (if DirectionProvider component exists)
        const displayName =
          commonPrefix && part.startsWith(`${commonPrefix}.`)
            ? part.slice(commonPrefix.length + 1) // Remove "Component." prefix
            : part;

        // Add subheading for the part using display name
        content.push(md.heading(3, displayName));

        // Add description if available
        if (data.description) {
          // Convert HAST to MDAST and add all content directly
          const descriptionNodes = await hastToMdast(data.description);
          descriptionNodes.forEach((node) => content.push(node));
        }

        // Props table (for components)
        if (Object.keys(data.props || {}).length > 0) {
          // Create a proper heading with strong node
          content.push(md.paragraph([md.strong(`${displayName} Props:`)]));

          const propsRows = await Promise.all(
            Object.entries(data.props).map(async ([propName, propDef]: [string, any]) => [
              propName,
              propDef.type ? await hastToInlineMdast(propDef.type) : '-',
              propDef.defaultText ? md.inlineCode(propDef.defaultText) : '-',
              propDef.description ? await hastToInlineMdast(propDef.description) : '-',
            ]),
          );

          // Define column alignments: prop name left-aligned, others left-aligned
          const alignments = ['left', 'left', 'left', 'left'];

          const tableNode = md.table(
            ['Prop', 'Type', 'Default', 'Description'],
            propsRows as any,
            alignments as any,
          );
          content.push(tableNode);
        }

        // Data attributes table (for components)
        if (Object.keys(data.dataAttributes || {}).length > 0) {
          content.push(md.paragraph([md.strong(`${displayName} Data Attributes:`)]));

          const attrRows = await Promise.all(
            Object.entries(data.dataAttributes).map(async ([attrName, attrDef]: [string, any]) => [
              attrName,
              attrDef.type ? md.inlineCode(attrDef.type) : '-',
              attrDef.description ? await hastToInlineMdast(attrDef.description) : '-',
            ]),
          );

          // Define column alignments
          const alignments = ['left', 'left', 'left'];

          const tableNode = md.table(
            ['Attribute', 'Type', 'Description'],
            attrRows as any,
            alignments as any,
          );
          content.push(tableNode);
        }

        // CSS variables table (for components)
        if (Object.keys(data.cssVariables || {}).length > 0) {
          content.push(md.paragraph([md.strong(`${displayName} CSS Variables:`)]));

          const cssRows = await Promise.all(
            Object.entries(data.cssVariables).map(
              async ([variableName, variableDef]: [string, any]) => [
                md.inlineCode(variableName),
                md.inlineCode(variableDef.type || ''),
                variableDef.description ? await hastToInlineMdast(variableDef.description) : '-',
              ],
            ),
          );

          // Define column alignments
          const alignments = ['left', 'left', 'left'];

          const tableNode = md.table(
            ['Variable', 'Type', 'Description'],
            cssRows as any,
            alignments as any,
          );
          content.push(tableNode);
        }
      } else if (typeMeta.type === 'hook') {
        const part = typeMeta.data.name;
        const data = typeMeta.data; // This is now properly typed as HookTypeMeta

        // Add subheading for the part
        content.push(md.heading(3, part));

        // Add description if available
        if (data.description) {
          // Convert HAST to MDAST and add all content directly
          const descriptionNodes = await hastToMdast(data.description);
          descriptionNodes.forEach((node) => content.push(node));
        }

        // Parameters table (for hooks)
        if (Object.keys(data.parameters || {}).length > 0) {
          content.push(md.paragraph([md.strong(`${part} Parameters:`)]));

          const paramRows = await Promise.all(
            Object.entries(data.parameters).map(async ([paramName, paramDef]) => {
              // Handle type (can be string or HastRoot)
              let typeCell: any;
              if (!paramDef.type) {
                typeCell = '-';
              } else if (typeof paramDef.type === 'string') {
                typeCell = md.inlineCode(paramDef.type);
              } else {
                typeCell = await hastToInlineMdast(paramDef.type);
              }

              // Handle description (can be string or HastRoot)
              let descriptionCell: any;
              if (!paramDef.description) {
                descriptionCell = '-';
              } else if (typeof paramDef.description === 'string') {
                descriptionCell = parseInlineMarkdown(paramDef.description);
              } else {
                descriptionCell = await hastToInlineMdast(paramDef.description);
              }

              return [
                paramName,
                typeCell,
                paramDef.defaultText ? md.inlineCode(paramDef.defaultText) : '-',
                descriptionCell,
              ];
            }),
          );

          const alignments = ['left', 'left', 'left', 'left'];

          const tableNode = md.table(
            ['Parameter', 'Type', 'Default', 'Description'],
            paramRows as any,
            alignments as any,
          );
          content.push(tableNode);
        }

        // Return Value (for hooks)
        if (data.returnValue) {
          content.push(md.paragraph([md.strong(`${part} Return Value:`)]));

          // Check if it's a HastRoot (simple type)
          if (
            typeof data.returnValue === 'object' &&
            'type' in data.returnValue &&
            data.returnValue.type === 'root'
          ) {
            // It's a HastRoot - convert to inline markdown
            const inlineType = await hastToInlineMdast(data.returnValue as HastRoot);
            content.push(md.paragraph(inlineType));
          } else if (
            typeof data.returnValue === 'object' &&
            Object.keys(data.returnValue).length > 0
          ) {
            // It's a Record of properties
            const returnRows = await Promise.all(
              Object.entries(data.returnValue).map(
                async ([returnName, returnDef]: [string, any]) => [
                  returnName,
                  returnDef.type ? await hastToInlineMdast(returnDef.type) : '-',
                  returnDef.description ? await hastToInlineMdast(returnDef.description) : '-',
                ],
              ),
            );

            const alignments = ['left', 'left', 'left'];

            const tableNode = md.table(
              ['Property', 'Type', 'Description'],
              returnRows as any,
              alignments as any,
            );
            content.push(tableNode);
          }
        }
      } else {
        // For 'other' types (ExportNode)
        // For re-exports, use typeMeta.name (e.g., "Separator.Props") instead of typeMeta.data.name
        // which would be the raw export name (e.g., "SeparatorProps")
        const part = typeMeta.reExportOf ? typeMeta.name : typeMeta.data.name || 'Unknown';
        const data = typeMeta.data; // This is now properly typed as ExportNode

        // Debug: check for double dots
        if (part.includes('..')) {
          console.warn('[generateTypesMarkdown] Double dots detected:', {
            part,
            'typeMeta.name': typeMeta.name,
            'typeMeta.data.name': typeMeta.data.name,
            'typeMeta.reExportOf': typeMeta.reExportOf,
          });
        }

        // Strip common prefix from heading if applicable
        const displayName =
          commonPrefix && part.startsWith(`${commonPrefix}.`)
            ? part.slice(commonPrefix.length + 1) // Remove "Component." prefix
            : part;

        // Add subheading for the part using display name
        content.push(md.heading(3, displayName));

        // Check if this is a re-export of another type
        if (typeMeta.reExportOf) {
          // Add a note that this is a re-export with a link back to the original
          // Strip common prefix from the component name for the anchor (same as component headings)
          const componentDisplayName =
            commonPrefix && typeMeta.reExportOf.startsWith(`${commonPrefix}.`)
              ? typeMeta.reExportOf.slice(commonPrefix.length + 1)
              : typeMeta.reExportOf;

          // Convert to anchor format: lowercase and remove dots
          const anchorId = componentDisplayName.toLowerCase().replace(/\./g, '');
          const reExportNote = md.paragraph([
            md.text('Re-export of '),
            md.link(`#${anchorId}`, componentDisplayName),
            md.text(' props.'),
          ]);
          content.push(reExportNote);
        } else if (part.endsWith('.DataAttributes')) {
          // This is a namespace member DataAttributes - link to the component's data attributes table
          const componentName = part.replace('.DataAttributes', '');
          // Convert to anchor format: remove dots for the link, keep dots for display
          const anchorId = componentName.toLowerCase().replace(/\./g, '');
          const reExportNote = md.paragraph([
            md.text('Data attributes for '),
            md.link(`#${anchorId}`, `${componentName}`),
            md.text(' component.'),
          ]);
          content.push(reExportNote);
        } else if (part.endsWith('.CssVars')) {
          // This is a namespace member CssVars - link to the component's CSS variables table
          const componentName = part.replace('.CssVars', '');
          // Convert to anchor format: remove dots for the link, keep dots for display
          const anchorId = componentName.toLowerCase().replace(/\./g, '');
          const reExportNote = md.paragraph([
            md.text('CSS variables for '),
            md.link(`#${anchorId}`, `${componentName}`),
            md.text(' component.'),
          ]);
          content.push(reExportNote);
        } else if (data.type.kind === 'enum' && data.type.members && data.type.members.length > 0) {
          // Format enum as a table (external references are already resolved in the loader)
          // Add description if available
          if (data.documentation?.description) {
            const descriptionNodes = parseMarkdown(data.documentation.description);
            descriptionNodes.forEach((node) => content.push(node));
          }

          const enumRows = await Promise.all(
            data.type.members.map(async (member: any) => [
              member.name,
              member.value ? md.inlineCode(String(member.value)) : '-',
              member.documentation?.description
                ? await hastToInlineMdast(
                    await parseMarkdownToHast(member.documentation.description),
                  )
                : '-',
            ]),
          );

          const alignments = ['left', 'left', 'left'];

          const tableNode = md.table(
            ['Member', 'Value', 'Description'],
            enumRows as any,
            alignments as any,
          );
          content.push(tableNode);
        } else {
          // Add description if available
          if (data.documentation?.description) {
            // Parse the description as markdown and add all content directly
            const descriptionNodes = parseMarkdown(data.documentation.description);
            descriptionNodes.forEach((node) => content.push(node));
          }

          // Check if this is a type alias with raw type text
          // (workaround for typescript-api-extractor not supporting type aliases)
          // TODO: Remove this when typescript-api-extractor supports type aliases
          const typeAsAny = data.type as any;
          if (typeAsAny.kind === 'typeAlias' && typeof typeAsAny.typeText === 'string') {
            // Prefer expanded type text if available, otherwise use basic typeText
            const sourceTypeText = typeAsAny.expandedTypeText || typeAsAny.typeText;

            // Apply typeNameMap transformations to the type text
            let transformedTypeText = sourceTypeText;
            if (typeNameMap) {
              // Get the current namespace from the export name (e.g., "Input.ChangeEventDetails" -> "Input")
              const namespaceMatch = part.match(/^([^.]+)\./);
              const currentNamespace = namespaceMatch ? namespaceMatch[1] : null;

              // Strategy: For each dotted type reference in typeText (e.g., "FieldControl.ChangeEventReason"),
              // check if there's a corresponding entry in typeNameMap with the same member name
              // (e.g., "Input.ChangeEventReason") and replace it
              if (currentNamespace) {
                for (const [, dottedName] of Object.entries(typeNameMap)) {
                  // Extract member name from the typeNameMap value (e.g., "Input.ChangeEventReason" -> "ChangeEventReason")
                  const nameParts = dottedName.split('.');
                  if (nameParts.length >= 2 && nameParts[0] === currentNamespace) {
                    const memberName = nameParts.slice(1).join('.'); // e.g., "ChangeEventReason"

                    // Build a regex to match any qualified reference to this member
                    // e.g., match "FieldControl.ChangeEventReason" or "SomeOther.ChangeEventReason"
                    const memberPattern = `\\w+\\.${memberName.replace(/\./g, '\\.')}`;
                    const regex = new RegExp(memberPattern, 'g');

                    transformedTypeText = transformedTypeText.replace(regex, dottedName);
                  }
                }
              }
            }

            // Format with prettyFormat to show the type declaration
            // Convert dotted name to flat TypeScript identifier
            // e.g., "Checkbox.Root.ChangeEventReason" → "CheckboxRootChangeEventReason"
            const flatTypeName = data.name.replace(/\./g, '');
            const typeParams = typeAsAny.typeParameters || '';
            const fullTypeName = `${flatTypeName}${typeParams}`;

            const formattedType = await prettyFormat(transformedTypeText, fullTypeName);
            content.push(md.code(formattedType, 'typescript'));
          } else {
            content.push(
              md.code(
                await prettyFormatType(data.type, true, undefined, true, [], typeNameMap),
                'typescript',
              ),
            );
          }
        }
      }

      return content;
    }),
  );

  // Merge all type contents in order
  typeContents.forEach((content) => {
    content.forEach((node) => tables.push(node));
  });

  const root: Root = { type: 'root', children: tables };

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
