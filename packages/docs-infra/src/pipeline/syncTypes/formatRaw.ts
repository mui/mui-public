import * as tae from 'typescript-api-extractor';
import {
  prettyFormat,
  formatType,
  parseMarkdownToHast,
  FormatInlineTypeOptions,
  rewriteTypeStringsDeep,
  TypeRewriteContext,
  isEnumType,
} from './format';
import type { HastRoot } from '../../CodeHighlighter/types';

/**
 * Information about a re-exported type.
 */
export interface ReExportInfo {
  /** Display name of the component (e.g., "Trigger" from "Accordion.Trigger") */
  name: string;
  /** Anchor slug for linking (e.g., "#trigger") */
  slug: string;
  /** What kind of type this re-exports */
  suffix: 'props' | 'css-variables' | 'data-attributes';
}

/**
 * Formatted raw type metadata with the type declaration as a formatted code string.
 *
 * Used for types that don't fit into component/hook/function categories,
 * such as type aliases, interfaces, and enums.
 *
 * Type highlighting (formattedCode → HAST) is deferred to the loadServerTypes
 * stage via highlightTypesMeta() after highlightTypes().
 */
export type RawTypeMeta = {
  /** Display name for this type (may include dots like "Component.Root.State") */
  name: string;
  /** Description parsed from JSDoc as HAST */
  description?: HastRoot;
  /** Plain text version of description for markdown generation */
  descriptionText?: string;
  /**
   * The formatted type declaration as plain text (e.g., "type ButtonProps = { ... }").
   * Will be highlighted to HAST in loadServerTypes.
   */
  formattedCode: string;
  /**
   * For enum types, the individual members with their values and descriptions.
   * When present, indicates this type should be rendered as an enum table.
   */
  enumMembers?: EnumMemberMeta[];
  /**
   * For re-exports, information about the component this type re-exports from.
   * When set, indicates this should be rendered as a link to the component.
   */
  reExportOf?: ReExportInfo;
  /**
   * For DataAttributes types, the component name this type belongs to.
   */
  dataAttributesOf?: string;
  /**
   * For CssVars types, the component name this type belongs to.
   */
  cssVarsOf?: string;
};

/**
 * Enum member metadata for raw type enum rendering.
 */
export interface EnumMemberMeta {
  name: string;
  value?: string | number;
  description?: HastRoot;
  descriptionText?: string;
}

export interface FormatRawOptions {
  /** Options for inline type formatting (e.g., unionPrintWidth) */
  formatting?: FormatInlineTypeOptions;
}

/**
 * Formats a raw type export into a structured metadata object with formatted code.
 *
 * @param exportNode - The export node from typescript-api-extractor
 * @param displayName - The display name (e.g., "Component.Root.State")
 * @param typeNameMap - Map for transforming type names
 * @param rewriteContext - Context for type string rewriting
 * @param options - Formatting options
 * @returns Formatted raw type metadata with the type declaration as formatted code
 */
export async function formatRawData(
  exportNode: tae.ExportNode,
  displayName: string,
  typeNameMap: Record<string, string>,
  rewriteContext: TypeRewriteContext,
  _options: FormatRawOptions = {},
): Promise<RawTypeMeta> {
  const descriptionText = exportNode.documentation?.description;
  const description = descriptionText ? await parseMarkdownToHast(descriptionText) : undefined;

  // Handle enum types specially - they get a table of members
  if (
    isEnumType(exportNode.type) &&
    exportNode.type.members &&
    exportNode.type.members.length > 0
  ) {
    const enumMembers = await Promise.all(
      exportNode.type.members.map(async (member): Promise<EnumMemberMeta> => {
        const memberDescriptionText = member.documentation?.description;
        return {
          name: member.name,
          value: member.value,
          description: memberDescriptionText
            ? await parseMarkdownToHast(memberDescriptionText)
            : undefined,
          descriptionText: memberDescriptionText,
        };
      }),
    );

    // For enums, still generate the code block but also include members
    const formattedCode = await generateFormattedCode(exportNode, displayName, typeNameMap);

    // Rewrite type names in descriptions (but NOT in formattedCode which is valid TypeScript syntax)
    const rewrittenDescriptionText = descriptionText
      ? rewriteTypeStringsDeep(descriptionText, rewriteContext)
      : undefined;

    const raw: RawTypeMeta = {
      name: displayName,
      description,
      descriptionText: rewrittenDescriptionText,
      formattedCode,
      enumMembers,
    };

    return raw;
  }

  // Handle DataAttributes types
  if (displayName.endsWith('.DataAttributes')) {
    const componentName = displayName.replace('.DataAttributes', '');
    const formattedCode = await generateFormattedCode(exportNode, displayName, typeNameMap);

    const rewrittenDescriptionText = descriptionText
      ? rewriteTypeStringsDeep(descriptionText, rewriteContext)
      : undefined;

    const raw: RawTypeMeta = {
      name: displayName,
      description,
      descriptionText: rewrittenDescriptionText,
      formattedCode,
      dataAttributesOf: componentName,
    };

    return raw;
  }

  // Handle CssVars types
  if (displayName.endsWith('.CssVars')) {
    const componentName = displayName.replace('.CssVars', '');
    const formattedCode = await generateFormattedCode(exportNode, displayName, typeNameMap);

    const rewrittenDescriptionText = descriptionText
      ? rewriteTypeStringsDeep(descriptionText, rewriteContext)
      : undefined;

    const raw: RawTypeMeta = {
      name: displayName,
      description,
      descriptionText: rewrittenDescriptionText,
      formattedCode,
      cssVarsOf: componentName,
    };

    return raw;
  }

  // Generate formatted code for regular types
  const formattedCode = await generateFormattedCode(exportNode, displayName, typeNameMap);

  const rewrittenDescriptionText = descriptionText
    ? rewriteTypeStringsDeep(descriptionText, rewriteContext)
    : undefined;

  const raw: RawTypeMeta = {
    name: displayName,
    description,
    descriptionText: rewrittenDescriptionText,
    formattedCode,
  };

  return raw;
}

/**
 * Generate the formatted code string for a type declaration.
 */
async function generateFormattedCode(
  exportNode: tae.ExportNode,
  displayName: string,
  typeNameMap: Record<string, string>,
): Promise<string> {
  const typeAsAny = exportNode.type as any;

  // Compute the original flat type name for the declaration.
  // The displayName uses dots (e.g., "Toolbar.Root.State") but the actual
  // TypeScript declaration needs the original name without dots (e.g., "ToolbarRootState").
  //
  // We prefer displayName with dots removed because:
  // - exportNode.name for namespaced exports is just the short name ("State")
  // - displayName.replace(/\./g, '') gives us the full concatenated name ("ToolbarRootState")
  const originalTypeName = displayName.replace(/\./g, '');

  // Handle typeAlias types
  if (typeAsAny.kind === 'typeAlias' && typeof typeAsAny.typeText === 'string') {
    let sourceTypeText = typeAsAny.expandedTypeText || typeAsAny.typeText;

    // Detect self-referencing types: when expandedTypeText is just a qualified name
    // that resolves to the same type we're defining
    if (typeAsAny.expandedTypeText) {
      const expandedWithoutDots = typeAsAny.expandedTypeText.replace(/\./g, '');
      const partWithoutDots = displayName.replace(/\./g, '');
      if (expandedWithoutDots === partWithoutDots) {
        sourceTypeText = typeAsAny.typeText;
      }
    }

    // Sanitize extremely complex iterator types
    if (sourceTypeText.includes('@iterator') && sourceTypeText.length > 500) {
      sourceTypeText = 'any[]';
    }

    // Transform type names using typeNameMap
    let transformedTypeText = sourceTypeText;
    if (typeNameMap) {
      const namespaceMatch = displayName.match(/^([^.]+)\./);
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

    const typeParams = typeAsAny.typeParameters || '';
    const fullTypeName = `${originalTypeName}${typeParams}`;

    return prettyFormat(transformedTypeText, fullTypeName);
  }

  // For non-typeAlias types, use formatType
  return prettyFormat(
    formatType(exportNode.type, true, undefined, true, [], typeNameMap, exportNode.name),
    originalTypeName,
  );
}

/**
 * Type guard to check if an export node represents a "raw" type that should be
 * formatted as a code block (i.e., not a component, hook, or function).
 *
 * @param exportNode - The export node to check
 * @param isComponent - Whether the node has been identified as a component
 * @param isHook - Whether the node has been identified as a hook
 * @param isFunction - Whether the node has been identified as a function
 * @returns true if the export should be formatted as a raw type
 */
export function isRawType(
  exportNode: tae.ExportNode,
  isComponent: boolean,
  isHook: boolean,
  isFunction: boolean,
): boolean {
  return !isComponent && !isHook && !isFunction;
}

/**
 * Formats re-export information for a type that re-exports another component's props.
 */
export async function formatReExportData(
  exportNode: tae.ExportNode,
  displayName: string,
  reExportOf: ReExportInfo,
  typeNameMap: Record<string, string>,
  rewriteContext: TypeRewriteContext,
): Promise<RawTypeMeta> {
  const descriptionText = exportNode.documentation?.description;
  const description = descriptionText ? await parseMarkdownToHast(descriptionText) : undefined;

  // Still generate the code for reference
  const formattedCode = await generateFormattedCode(exportNode, displayName, typeNameMap);

  // Rewrite type names in descriptions (but NOT in formattedCode which is valid TypeScript syntax)
  const rewrittenDescriptionText = descriptionText
    ? rewriteTypeStringsDeep(descriptionText, rewriteContext)
    : undefined;

  const raw: RawTypeMeta = {
    name: displayName,
    description,
    descriptionText: rewrittenDescriptionText,
    formattedCode,
    reExportOf,
  };

  return raw;
}
