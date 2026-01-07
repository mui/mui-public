import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import type { PhrasingContent, RootContent, Root } from 'mdast';
import * as md from '../syncPageIndex/createMarkdownNodes';
import type { TypesMeta } from './syncTypes';
import { prettyFormat, formatType } from './format';
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
    // Use data.name which has the full name like "Checkbox.Root"
    const aFullName = a.type === 'component' || a.type === 'hook' ? a.data.name : a.name;
    const bFullName = b.type === 'component' || b.type === 'hook' ? b.data.name : b.name;

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
        // Use md.raw() to prevent underscore escaping (e.g., PARENT_CHECKBOX)
        content.push(md.heading(3, md.raw(displayName)));

        // Add description if available - use plain text directly
        if (data.descriptionText) {
          const descriptionNodes = parseMarkdown(data.descriptionText);
          descriptionNodes.forEach((node) => content.push(node));
        }

        // Props table (for components)
        if (Object.keys(data.props || {}).length > 0) {
          // Create a proper heading with strong node
          content.push(md.paragraph([md.strong(`${displayName} Props:`)]));

          const propsRows = Object.entries(data.props).map(([propName, propDef]: [string, any]) => [
            propName,
            propDef.typeText ? md.inlineCode(propDef.typeText) : '-',
            propDef.defaultText ? md.inlineCode(propDef.defaultText) : '-',
            propDef.descriptionText ? parseInlineMarkdown(propDef.descriptionText) : '-',
          ]);

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

          const attrRows = Object.entries(data.dataAttributes).map(
            ([attrName, attrDef]: [string, any]) => [
              attrName,
              attrDef.type ? md.inlineCode(attrDef.type) : '-',
              attrDef.descriptionText ? parseInlineMarkdown(attrDef.descriptionText) : '-',
            ],
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

          const cssRows = Object.entries(data.cssVariables).map(
            ([variableName, variableDef]: [string, any]) => [
              md.inlineCode(variableName),
              md.inlineCode(variableDef.type || ''),
              variableDef.descriptionText ? parseInlineMarkdown(variableDef.descriptionText) : '-',
            ],
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
        // Use md.raw() to prevent underscore escaping
        content.push(md.heading(3, md.raw(part)));

        // Add description if available - use plain text directly
        if (data.descriptionText) {
          const descriptionNodes = parseMarkdown(data.descriptionText);
          descriptionNodes.forEach((node) => content.push(node));
        }

        // Parameters table (for hooks)
        if (Object.keys(data.parameters || {}).length > 0) {
          content.push(md.paragraph([md.strong(`${part} Parameters:`)]));

          const paramRows = Object.entries(data.parameters).map(([paramName, paramDef]) => {
            // Use typeText for efficient markdown generation
            const typeCell = paramDef.typeText ? md.inlineCode(paramDef.typeText) : '-';

            // Use descriptionText for efficient markdown generation
            const descriptionCell = paramDef.descriptionText
              ? parseInlineMarkdown(paramDef.descriptionText)
              : '-';

            return [
              paramName,
              typeCell,
              paramDef.defaultText ? md.inlineCode(paramDef.defaultText) : '-',
              descriptionCell,
            ];
          });

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

          // Check if it's a simple string type - use returnValueText
          if (typeof data.returnValue === 'string') {
            // It's a plain string type - use returnValueText
            const typeText = data.returnValueText || data.returnValue;
            const formattedReturnType = await prettyFormat(typeText, 'ReturnValue');
            content.push(md.code(formattedReturnType, 'tsx'));
          } else if (
            typeof data.returnValue === 'object' &&
            Object.keys(data.returnValue).length > 0
          ) {
            // It's a Record of properties - use text fields
            const returnRows = Object.entries(data.returnValue).map(
              ([returnName, returnDef]: [string, any]) => [
                returnName,
                returnDef.typeText ? md.inlineCode(returnDef.typeText) : '-',
                returnDef.descriptionText ? parseInlineMarkdown(returnDef.descriptionText) : '-',
              ],
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
      } else if (typeMeta.type === 'function') {
        const part = typeMeta.data.name;
        const data = typeMeta.data; // This is now properly typed as FunctionTypeMeta

        // Add subheading for the part
        // Use md.raw() to prevent underscore escaping
        content.push(md.heading(3, md.raw(part)));

        // Add description if available - use plain text directly
        if (data.descriptionText) {
          const descriptionNodes = parseMarkdown(data.descriptionText);
          descriptionNodes.forEach((node) => content.push(node));
        }

        // Parameters table (for functions)
        if (Object.keys(data.parameters || {}).length > 0) {
          content.push(md.paragraph([md.strong('Parameters:')]));

          const paramRows = Object.entries(data.parameters).map(([paramName, paramDef]) => {
            // Append ? suffix for optional parameters
            const displayName = paramDef.optional ? `${paramName}?` : paramName;

            // Use typeText for efficient markdown generation
            const typeCell = paramDef.typeText ? md.inlineCode(paramDef.typeText) : '-';

            // Use descriptionText for efficient markdown generation
            const descriptionCell = paramDef.descriptionText
              ? parseInlineMarkdown(paramDef.descriptionText)
              : '-';

            return [
              displayName,
              typeCell,
              paramDef.defaultText ? md.inlineCode(paramDef.defaultText) : '-',
              descriptionCell,
            ];
          });

          const alignments = ['left', 'left', 'left', 'left'];

          const tableNode = md.table(
            ['Parameter', 'Type', 'Default', 'Description'],
            paramRows as any,
            alignments as any,
          );
          content.push(tableNode);
        }

        // Return Value (for functions) - description + code block
        if (data.returnValue) {
          content.push(md.paragraph([md.strong('Return Value:')]));

          // Add description if available
          if (data.returnValueDescriptionText) {
            const descriptionNodes = parseMarkdown(data.returnValueDescriptionText);
            descriptionNodes.forEach((node) => content.push(node));
          }

          // Add type as code block (formatted through prettier)
          const formattedReturnType = await prettyFormat(data.returnValue, 'ReturnValue');
          content.push(md.code(formattedReturnType, 'tsx'));
        }
      } else {
        // For 'other' types (ExportNode)
        // For re-exports, use typeMeta.name (e.g., "Separator.Props") instead of typeMeta.data.name
        // which would be the raw export name (e.g., "SeparatorProps")
        const part = typeMeta.reExportOf ? typeMeta.name : typeMeta.data.name || 'Unknown';
        const data = typeMeta.data; // This is now properly typed as ExportNode

        // Strip common prefix from heading if applicable
        const displayName =
          commonPrefix && part.startsWith(`${commonPrefix}.`)
            ? part.slice(commonPrefix.length + 1) // Remove "Component." prefix
            : part;

        // Add subheading for the part using display name
        // Use md.raw() to prevent underscore escaping (e.g., PARENT_CHECKBOX)
        content.push(md.heading(3, md.raw(displayName)));

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

          const enumRows = data.type.members.map((member: any) => [
            member.name,
            member.value ? md.inlineCode(String(member.value)) : '-',
            member.documentation?.description
              ? parseInlineMarkdown(member.documentation.description)
              : '-',
          ]);

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
            let sourceTypeText = typeAsAny.expandedTypeText || typeAsAny.typeText;

            // Simplify expanded array types (e.g., AccordionValue = any[] that got fully expanded)
            // Check if this looks like an expanded Array interface with all the array methods
            if (sourceTypeText.includes('@iterator') && sourceTypeText.length > 500) {
              // This is likely an expanded array type - simplify to any[]
              sourceTypeText = 'any[]';
            }

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
                await prettyFormat(
                  formatType(data.type, true, undefined, true, [], typeNameMap),
                  'typeName' in data.type ? data.type.typeName?.name : undefined,
                ),
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
