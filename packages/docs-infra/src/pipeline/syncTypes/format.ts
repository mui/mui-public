import { uniq, sortBy } from 'es-toolkit';
import prettier from 'prettier/standalone';
import prettierPluginEstree from 'prettier/plugins/estree';
import prettierPluginTypescript from 'prettier/plugins/typescript';
import prettierPluginMarkdown from 'prettier/plugins/markdown';
import type * as tae from 'typescript-api-extractor';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkTypography from 'remark-typography';
import remarkRehype from 'remark-rehype';
import type { Root as HastRoot } from 'hast';
import transformMarkdownCode from '../transformMarkdownCode';

/**
 * Formatted property metadata with plain text types and parsed markdown descriptions.
 *
 * Type highlighting (type → HAST, shortType, detailedType) is deferred to
 * the loadServerTypes stage via highlightTypesMeta() after highlightTypes().
 */
export interface FormattedProperty {
  /** Plain text type string */
  typeText: string;
  /** Plain text default value */
  defaultText?: string;
  /** Whether the property is required */
  required?: true;
  /** Description as parsed markdown HAST */
  description?: HastRoot;
  /** Plain text version of description for markdown generation */
  descriptionText?: string;
  /** Example usage as parsed markdown HAST */
  example?: HastRoot;
  /** Plain text version of example for markdown generation */
  exampleText?: string;
}

/**
 * Formatted enum member metadata.
 */
export interface FormattedEnumMember {
  /** Description of the enum member as parsed markdown HAST */
  description?: HastRoot;
  /** Plain text version of description for markdown generation */
  descriptionText?: string;
  /** Type annotation from JSDoc @type tag */
  type?: string;
}

/**
 * Formatted parameter metadata for functions and hooks.
 *
 * Type highlighting is deferred to the loadServerTypes stage via
 * highlightTypesMeta() after highlightTypes().
 */
export interface FormattedParameter {
  /** Plain text type string */
  typeText: string;
  /** Plain text default value */
  defaultText?: string;
  /** Whether the parameter is optional */
  optional?: true;
  /** Description from JSDoc as parsed markdown HAST */
  description?: HastRoot;
  /** Plain text version of description for markdown generation */
  descriptionText?: string;
  /** Example usage as parsed markdown HAST */
  example?: HastRoot;
  /** Plain text version of example for markdown generation */
  exampleText?: string;
}

/**
 * Base type guard helper to check if a value has a specific kind property.
 * Validates that the value is an object with a 'kind' property matching the expected value.
 */
function hasKind(value: unknown, kind: string): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === kind
  );
}

/**
 * Type guard to check if a type node is an external type reference.
 * Works with both class instances and serialized objects from typescript-api-extractor.
 */
export function isExternalType(type: unknown): type is tae.ExternalTypeNode {
  return hasKind(type, 'external');
}

/**
 * Type guard to check if a type node is an intrinsic (built-in) type.
 */
export function isIntrinsicType(type: unknown): type is tae.IntrinsicNode {
  return hasKind(type, 'intrinsic');
}

/**
 * Type guard to check if a type node is a union type.
 */
export function isUnionType(type: unknown): type is tae.UnionNode {
  return hasKind(type, 'union');
}

/**
 * Type guard to check if a type node is an intersection type.
 */
export function isIntersectionType(type: unknown): type is tae.IntersectionNode {
  return hasKind(type, 'intersection');
}

/**
 * Type guard to check if a type node is an object type.
 */
export function isObjectType(type: unknown): type is tae.ObjectNode {
  return hasKind(type, 'object');
}

/**
 * Type guard to check if a type node is an array type.
 */
export function isArrayType(type: unknown): type is tae.ArrayNode {
  return hasKind(type, 'array');
}

/**
 * Type guard to check if a type node is a function type.
 */
export function isFunctionType(type: unknown): type is tae.FunctionNode {
  return hasKind(type, 'function');
}

/**
 * Type guard to check if a type node is a literal type.
 */
export function isLiteralType(type: unknown): type is tae.LiteralNode {
  return hasKind(type, 'literal');
}

/**
 * Type guard to check if a type node is an enum type.
 */
export function isEnumType(type: unknown): type is tae.EnumNode {
  return hasKind(type, 'enum');
}

/**
 * Type guard to check if a type node is a tuple type.
 */
export function isTupleType(type: unknown): type is tae.TupleNode {
  return hasKind(type, 'tuple');
}

/**
 * Type guard to check if a type node is a type parameter.
 */
export function isTypeParameterType(type: unknown): type is tae.TypeParameterNode {
  return hasKind(type, 'typeParameter');
}

/**
 * Type guard to check if a type node is a component type.
 */
export function isComponentType(type: unknown): type is tae.ComponentNode {
  return hasKind(type, 'component');
}

/**
 * Converts markdown text to HAST (HTML Abstract Syntax Tree) with syntax-highlighted code blocks.
 *
 * This enables rendering rich formatted descriptions including code examples, lists, and links
 * while preserving all markdown features and applying syntax highlighting to code blocks.
 */
export async function parseMarkdownToHast(markdown: string): Promise<HastRoot> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(transformMarkdownCode)
    // @ts-expect-error - remark-typography types are incompatible with unified
    .use(remarkTypography)
    .use(remarkRehype)
    .freeze();

  const mdast = processor.parse(markdown);
  const result = await processor.run(mdast);

  return result;
}

/**
 * Options for formatting inline types as HAST.
 */
export interface FormatInlineTypeOptions {
  /**
   * Maximum line width before union types in shortType fields are split across multiple lines.
   * When a union type exceeds this width, it will be formatted with each
   * member on a separate line with leading pipe characters.
   * @default 40
   */
  shortTypeUnionPrintWidth?: number;
  /**
   * Maximum line width before union types in defaultValue fields are split across multiple lines.
   * When a union type exceeds this width, it will be formatted with each
   * member on a separate line with leading pipe characters.
   * @default 40
   */
  defaultValueUnionPrintWidth?: number;
  /**
   * Maximum line width for Prettier formatting of detailed/expanded type definitions.
   * @default 40
   */
  detailedTypePrintWidth?: number;
}

/**
 * Formats a TypeScript type string with Prettier, optionally preserving the type declaration.
 *
 * This function wraps the type in a `type Name = ...` declaration, formats it with Prettier,
 * and then removes or preserves the prefix based on the provided typeName and formatting.
 *
 * @param type - The type string to format
 * @param typeName - Optional type name to use in the declaration. If provided and the type
 *                   is multi-line, the `type Name = ...` prefix will be preserved.
 * @param printWidth - Optional maximum line width for Prettier formatting (default: 100)
 * @returns The formatted type string
 */
/**
 * Formats a markdown string with Prettier's markdown parser.
 * Used for non-code sections of generated markdown to ensure consistent formatting.
 *
 * @param markdown - The markdown string to format
 * @param printWidth - Optional maximum line width for Prettier formatting (default: 100)
 * @returns The formatted markdown string
 */
export async function prettyFormatMarkdown(markdown: string, printWidth = 100): Promise<string> {
  try {
    const prettierOptions: Parameters<typeof prettier.format>[1] = {
      plugins: [prettierPluginEstree, prettierPluginTypescript, prettierPluginMarkdown],
      parser: 'markdown',
      singleQuote: true,
      trailingComma: 'all',
      printWidth,
    };
    return (await prettier.format(markdown, prettierOptions)).trimEnd();
  } catch (error) {
    console.warn(
      `[prettyFormatMarkdown] Prettier failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return markdown;
  }
}

export async function prettyFormat(type: string, typeName?: string, printWidth = 100) {
  let formattedType: string;
  const codePrefix = `type ${typeName || '_'} = `;

  try {
    // Format as a markdown code block so the output matches what prettier
    // produces when formatting the final markdown file with embedded TypeScript.
    // We format twice because prettier is not idempotent for certain patterns:
    // - First pass: expands single-line types to multi-line
    // - Second pass: collapses unnecessary line breaks (e.g., single param functions)
    const markdown = `\`\`\`tsx\n${codePrefix}${type}\n\`\`\``;
    const prettierOptions: Parameters<typeof prettier.format>[1] = {
      plugins: [prettierPluginEstree, prettierPluginTypescript, prettierPluginMarkdown],
      parser: 'markdown',
      singleQuote: true,
      trailingComma: 'all',
      printWidth,
    };
    let formattedMarkdown = await prettier.format(markdown, prettierOptions);
    formattedMarkdown = await prettier.format(formattedMarkdown, prettierOptions);
    // Extract the TypeScript code from the formatted markdown
    const match = formattedMarkdown.match(/```tsx\n([\s\S]*?)\n```/);
    formattedType = match ? match[1] : `${codePrefix}${type}`;
  } catch (error) {
    // If Prettier fails on extremely complex types, return the original type
    console.warn(
      `[prettyFormat] Prettier failed for type "${typeName || 'unknown'}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return type;
  }

  if (typeName) {
    return formattedType.trimEnd();
  }

  // Improve readability by formatting complex types with Prettier.
  // Prettier either formats the type on a single line or multiple lines.
  // If it's on a single line, we remove the `type _ = ` prefix.
  // If it's on multiple lines, we remove the `type _ = ` prefix but keep the rest of the first line.
  const lines = formattedType.trimEnd().split('\n');
  if (lines.length === 1) {
    type = lines[0].replace(/^type _ = /, '');
  } else {
    let codeLines: string[];
    if (typeName) {
      codeLines = lines;
    } else {
      // For multi-line types without a typeName, replace the `type _ = ` prefix
      // on the first line, but keep the rest of the line (e.g., opening parenthesis)
      const firstLine = lines[0].replace(/^type _ = ?/, '');
      codeLines = [firstLine, ...lines.slice(1)];
    }
    const nonEmptyLines = codeLines.filter((l) => l.trim() !== '');
    if (nonEmptyLines.length > 0) {
      const minIndent = Math.min(...nonEmptyLines.map((l) => l.match(/^\s*/)?.[0].length ?? 0));

      if (Number.isFinite(minIndent) && minIndent > 0) {
        type = nonEmptyLines.map((l) => l.substring(minIndent)).join('\n');
      } else {
        type = nonEmptyLines.join('\n');
      }
    } else {
      type = '';
    }
  }

  return type;
}

/**
 * Options for formatting properties.
 */
export interface FormatPropertiesOptions {
  /** Options for inline type formatting (e.g., unionPrintWidth) */
  formatting?: FormatInlineTypeOptions;
}

/**
 * Formats component or hook properties into a structured object with plain text types.
 *
 * Each property includes its type (as plain text), description (parsed markdown),
 * and default value. Type highlighting (type → HAST, shortType, detailedType) is
 * deferred to the loadServerTypes stage via highlightTypesMeta() after highlightTypes().
 *
 * This function handles the conversion of TypeScript type information into a format
 * suitable for documentation display.
 */
export async function formatProperties(
  props: tae.PropertyNode[],
  exportNames: string[],
  typeNameMap: Record<string, string>,
  allExports: tae.ExportNode[] | undefined = undefined,
  _options: FormatPropertiesOptions = {},
): Promise<Record<string, FormattedProperty>> {
  // Filter out props that should not be documented:
  // - `ref` is typically forwarded and not useful in component API docs
  // - Props with @ignore tag are intentionally hidden from documentation
  const isComponentContext = allExports !== undefined && allExports.length > 0;
  const filteredProps = props.filter((prop) => {
    // Skip `ref` for components (when allExports indicates component context)
    if (prop.name === 'ref' && isComponentContext) {
      return false;
    }
    // Skip props marked with @ignore
    // Check both hasTag method (from tae.Documentation class) and tags array (for plain objects)
    const hasIgnoreTag =
      prop.documentation?.hasTag?.('ignore') ||
      prop.documentation?.tags?.some((tag) => tag.name === 'ignore');
    if (hasIgnoreTag) {
      return false;
    }
    return true;
  });

  const propEntries = await Promise.all(
    filteredProps.map(async (prop) => {
      const exampleTag = prop.documentation?.tags
        ?.filter((tag) => tag.name === 'example')
        .map((tag) => tag.value)
        .join('\n');

      const formattedType = formatType(
        prop.type,
        prop.optional,
        prop.documentation?.tags,
        false,
        exportNames,
        typeNameMap,
      );

      // Parse description as markdown and convert to HAST for rich rendering
      const description = prop.documentation?.description
        ? await parseMarkdownToHast(prop.documentation.description)
        : undefined;

      // Parse example as markdown if present
      const example = exampleTag ? await parseMarkdownToHast(exampleTag) : undefined;

      // Get default value as plain text if present
      const defaultValueText =
        prop.documentation?.defaultValue !== undefined
          ? String(prop.documentation.defaultValue)
          : undefined;

      const resultObject: FormattedProperty = {
        typeText: formattedType,
        required: !prop.optional || undefined,
        description,
        descriptionText: prop.documentation?.description,
        example,
        exampleText: exampleTag,
      };

      // Only include defaultText if it exists
      if (defaultValueText) {
        resultObject.defaultText = defaultValueText;
      }

      // For optional props, append `| undefined` to typeText if not already present.
      // formatType strips `| undefined` for cleaner markdown display, but we want
      // the full type available for HAST highlighting.
      if (prop.optional && !resultObject.typeText.endsWith('| undefined')) {
        resultObject.typeText = `${resultObject.typeText} | undefined`;
      }

      return [prop.name, resultObject] as const;
    }),
  );

  return Object.fromEntries(propEntries);
}

/**
 * Formats function or hook parameters into a structured object.
 *
 * Each parameter includes its type (as plain text string), description (parsed markdown as HAST),
 * default value, and whether it's optional. Type highlighting is deferred to the
 * loadServerTypes stage via highlightTypesMeta() after highlightTypes().
 */
export async function formatParameters(
  params: tae.Parameter[],
  exportNames: string[],
  typeNameMap: Record<string, string>,
  _options: FormatPropertiesOptions = {},
): Promise<Record<string, FormattedParameter>> {
  const result: Record<string, FormattedParameter> = {};

  await Promise.all(
    params.map(async (param) => {
      const exampleTag = param.documentation?.tags
        ?.filter((tag) => tag.name === 'example')
        .map((tag) => tag.value)
        .join('\n');

      const description = param.documentation?.description
        ? await parseMarkdownToHast(param.documentation.description)
        : undefined;

      const example = exampleTag ? await parseMarkdownToHast(exampleTag) : undefined;

      // Get default value as plain text if present
      const defaultValueText =
        param.defaultValue !== undefined ? String(param.defaultValue) : undefined;

      // Format type as plain text
      const typeText = formatType(
        param.type,
        param.optional,
        param.documentation?.tags,
        true,
        exportNames,
        typeNameMap,
      );

      const paramResult: FormattedParameter = {
        typeText,
        optional: param.optional || undefined,
        description,
        descriptionText: param.documentation?.description,
        example,
        exampleText: exampleTag,
      };

      // Only include defaultText if it exists
      if (defaultValueText) {
        paramResult.defaultText = defaultValueText;
      }

      // For optional params, append `| undefined` to typeText if not already present.
      // formatType strips `| undefined` for cleaner markdown display, but we want
      // the full type available for HAST highlighting.
      if (param.optional && !paramResult.typeText.endsWith('| undefined')) {
        paramResult.typeText = `${paramResult.typeText} | undefined`;
      }

      result[param.name] = paramResult;
    }),
  );

  return result;
}

/**
 * Recursively expands type aliases and external type references to their full definitions.
 *
 * This function resolves external types by looking them up in the provided exports,
 * and recursively expands union and intersection types. It includes cycle detection
 * to prevent infinite recursion on self-referential types.
 */
export function formatDetailedType(
  type: tae.AnyType,
  allExports: tae.ExportNode[],
  exportNames: string[],
  typeNameMap: Record<string, string>,
  visited = new Set<string>(),
): string {
  // Prevent infinite recursion
  if (isExternalType(type)) {
    const qualifiedName = getFullyQualifiedName(type.typeName, exportNames, typeNameMap);
    if (visited.has(qualifiedName)) {
      return qualifiedName;
    }
    visited.add(qualifiedName);

    const exportNode = allExports.find((node) => node.name === type.typeName.name);
    if (exportNode) {
      return formatDetailedType(
        (exportNode.type as unknown as tae.AnyType) ?? type,
        allExports,
        exportNames,
        typeNameMap,
        visited,
      );
    }

    // Manually expand known external aliases when declaration is not in local exports
    switch (true) {
      case qualifiedName.endsWith('Padding'):
        return '{ top?: number; right?: number; bottom?: number; left?: number } | number';
      default:
        return qualifiedName;
    }
  }

  if (isUnionType(type)) {
    const memberTypes = type.types.map((t) =>
      formatDetailedType(t, allExports, exportNames, typeNameMap, visited),
    );
    return uniq(memberTypes).join(' | ');
  }

  if (isIntersectionType(type)) {
    const memberTypes = type.types.map((t) =>
      formatDetailedType(t, allExports, exportNames, typeNameMap, visited),
    );
    return uniq(memberTypes).join(' & ');
  }

  // For objects and everything else, reuse existing formatter with object expansion enabled
  return formatType(type, false, undefined, true, exportNames, typeNameMap);
}

/**
 * Formats an enum type into a structured object mapping enum values to their metadata.
 *
 * The result includes each enum member's description (parsed markdown as HAST) and type
 * information from JSDoc tags. Members are sorted by their value for consistent output.
 */
export async function formatEnum(
  enumNode: tae.EnumNode,
): Promise<Record<string, FormattedEnumMember>> {
  const result: Record<string, FormattedEnumMember> = {};

  await Promise.all(
    sortBy(enumNode.members, ['value']).map(async (member) => {
      const descriptionText = member.documentation?.description;
      const description = descriptionText ? await parseMarkdownToHast(descriptionText) : undefined;

      result[member.value] = {
        description,
        descriptionText,
        type: member.documentation?.tags?.find((tag) => tag.name === 'type')?.value,
      };
    }),
  );

  return result;
}

/**
 * Formats a TypeScript type into a string representation for documentation display.
 *
 * This function recursively processes various type nodes (intrinsic types, unions, intersections,
 * objects, arrays, functions, etc.) and formats them into human-readable strings. It handles
 * complex scenarios like optional properties, type parameters, and nested structures.
 *
 * For inline code contexts (when `inline: true`), the function generates type expressions
 * with a prefix (`type _ =`) for better syntax highlighting, then removes the prefix from
 * the highlighted output.
 *
 * @param selfName - Optional name of the type being defined, used to prevent circular
 *                   references like `type Foo = Foo` when a type's typeName matches itself.
 */
export function formatType(
  type: tae.AnyType,
  removeUndefined: boolean,
  jsdocTags: tae.DocumentationTag[] | undefined,
  expandObjects: boolean,
  exportNames: string[],
  typeNameMap: Record<string, string>,
  selfName?: string,
): string {
  const typeTag = jsdocTags?.find?.((tag) => tag.name === 'type');
  const typeValue = typeTag?.value;

  if (typeValue) {
    return typeValue;
  }

  if (isExternalType(type)) {
    if (/^ReactElement(<.*>)?/.test(type.typeName.name || '')) {
      return 'ReactElement';
    }

    if (type.typeName.namespaces?.length === 1 && type.typeName.namespaces[0] === 'React') {
      return createNameWithTypeArguments(type.typeName, exportNames, typeNameMap);
    }

    return getFullyQualifiedName(type.typeName, exportNames, typeNameMap);
  }

  if (isIntrinsicType(type)) {
    return type.typeName
      ? getFullyQualifiedName(type.typeName, exportNames, typeNameMap)
      : type.intrinsic;
  }

  if (isUnionType(type)) {
    // For union types with a type alias name, always prefer showing the alias name
    // (e.g., 'StoreAtMode' instead of expanding to "'canonical' | 'import' | 'flat'")
    // The expandObjects flag is primarily for object types where showing the structure is valuable
    // But skip if the type name matches selfName to avoid circular references like `type Foo = Foo`
    if (type.typeName) {
      const qualifiedName = getFullyQualifiedName(type.typeName, exportNames, typeNameMap);
      // Check both the simple name AND the fully qualified name against selfName
      // selfName can be either format depending on context
      if (type.typeName.name !== selfName && qualifiedName !== selfName) {
        return qualifiedName;
      }
    }

    let memberTypes = type.types;

    if (removeUndefined) {
      memberTypes = memberTypes.filter((t) => !(isIntrinsicType(t) && t.intrinsic === 'undefined'));
    }

    // Deduplicates types in unions.
    // Plain unions are handled by TypeScript API Extractor, but we also display unions in type parameters constraints,
    // so we need to merge those here.
    const flattenedMemberTypes = memberTypes.flatMap((t) => {
      if (isUnionType(t)) {
        return t.typeName ? t : t.types;
      }

      if (isTypeParameterType(t) && isUnionType(t.constraint)) {
        return t.constraint.types;
      }

      return t;
    });

    const formattedMemeberTypes = uniq(
      orderMembers(flattenedMemberTypes).map((t) =>
        // Use expandObjects=false for nested types to prevent deep expansion
        formatType(t, removeUndefined, undefined, false, exportNames, typeNameMap),
      ),
    );

    return formattedMemeberTypes.join(' | ');
  }

  if (isIntersectionType(type)) {
    // For intersection types with a type alias name, always prefer showing the alias name
    // The expandObjects flag is primarily for object types where showing the structure is valuable
    // But skip if the type name matches selfName to avoid circular references like `type Foo = Foo`
    if (type.typeName) {
      const qualifiedName = getFullyQualifiedName(type.typeName, exportNames, typeNameMap);
      // Check both the simple name AND the fully qualified name against selfName
      // selfName can be either format depending on context
      if (type.typeName.name !== selfName && qualifiedName !== selfName) {
        return qualifiedName;
      }
    }

    const formattedMembers = orderMembers(type.types)
      // Use expandObjects=false for nested types to prevent deep expansion
      .map((t) => formatType(t, false, undefined, false, exportNames, typeNameMap))
      // Filter out empty objects (e.g., `& {}` from generic defaults)
      .filter((formatted) => formatted !== '{}' && formatted !== '{ }');

    // If all members were filtered out, return empty object
    if (formattedMembers.length === 0) {
      return '{}';
    }

    // If only one member remains, return it without intersection
    if (formattedMembers.length === 1) {
      return formattedMembers[0];
    }

    return formattedMembers.join(' & ');
  }

  if (isObjectType(type)) {
    // Check if the object has an index signature
    const indexSignature = (
      type as tae.ObjectNode & {
        indexSignature?: { keyName?: string; keyType: string; valueType: tae.AnyType };
      }
    ).indexSignature;

    if (type.typeName && !expandObjects) {
      return getFullyQualifiedName(type.typeName, exportNames, typeNameMap);
    }

    if (isObjectEmpty(type.properties) && !indexSignature) {
      return '{}';
    }

    const parts: string[] = [];

    // Add index signature if present
    if (indexSignature) {
      const valueTypeStr = formatType(
        indexSignature.valueType,
        false,
        undefined,
        expandObjects,
        exportNames,
        typeNameMap,
      );
      // Use the original key name if available, otherwise fall back to 'key'
      const keyName = indexSignature.keyName || 'key';
      parts.push(`[${keyName}: ${indexSignature.keyType}]: ${valueTypeStr}`);
    }

    // Add regular properties
    parts.push(
      ...type.properties.map((m) => {
        // Property names with hyphens or other special characters need quotes
        const propertyName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(m.name) ? m.name : `'${m.name}'`;
        return `${propertyName}${m.optional ? '?' : ''}: ${formatType(m.type, m.optional, undefined, expandObjects, exportNames, typeNameMap)}`;
      }),
    );

    return `{ ${parts.join('; ')} }`;
  }

  if (isLiteralType(type)) {
    return normalizeQuotes(type.value as string);
  }

  if (isArrayType(type)) {
    const formattedMemberType = formatType(
      type.elementType,
      false,
      undefined,
      expandObjects,
      exportNames,
      typeNameMap,
    );

    if (formattedMemberType.includes(' ')) {
      return `(${formattedMemberType})[]`;
    }

    return `${formattedMemberType}[]`;
  }

  if (isFunctionType(type)) {
    // If object expansion is requested, we want to fully expand the function signature instead
    // of returning the aliased type name (e.g., OffsetFunction).
    if (!expandObjects && type.typeName && !type.typeName.name?.startsWith('ComponentRenderFn')) {
      return getFullyQualifiedName(type.typeName, exportNames, typeNameMap);
    }

    const signatures = type.callSignatures.map((s) => {
      const params = s.parameters
        .map((p, index, allParams) => {
          let paramType = formatType(
            p.type,
            false,
            undefined,
            expandObjects,
            exportNames,
            typeNameMap,
          );

          // Check if the type includes undefined
          const hasUndefined =
            paramType.includes('| undefined') || paramType.includes('undefined |');

          // Use ?: syntax for optional parameters only if all following parameters are also optional
          // This ensures we maintain valid TypeScript syntax (optional params must come last)
          if (p.optional || hasUndefined) {
            const remainingParams = allParams.slice(index + 1);
            const allRemainingAreOptional = remainingParams.every((remaining) => {
              // If the parameter is explicitly marked as optional, we don't need to check the type
              if (remaining.optional) {
                return true;
              }
              // Only check the type if the parameter is not explicitly optional
              // Check if it's a union with undefined without formatting the entire type
              if (isUnionType(remaining.type)) {
                return remaining.type.types.some(
                  (t) => isIntrinsicType(t) && t.intrinsic === 'undefined',
                );
              }
              return false;
            });

            if (allRemainingAreOptional) {
              // Remove | undefined from the type since we're using ?:
              paramType = paramType
                .replace(/\s*\|\s*undefined\s*$/, '')
                .replace(/^\s*undefined\s*\|\s*/, '')
                .trim();
              return `${p.name}?: ${paramType}`;
            }
          }

          return `${p.name}: ${paramType}`;
        })
        .join(', ');
      const returnType = formatType(
        s.returnValueType,
        false,
        undefined,
        expandObjects,
        exportNames,
        typeNameMap,
      );
      return `(${params}) => ${returnType}`;
    });

    // When there are multiple signatures (overloads), each function type must be
    // parenthesized before joining with | to avoid ambiguous parsing
    // e.g., ((a: string) => void) | ((b: number) => void)
    const functionSignature =
      signatures.length > 1
        ? signatures.map((sig) => `(${sig})`).join(' | ')
        : signatures.join(' | ');
    return `(${functionSignature})`;
  }

  if (isTupleType(type)) {
    if (type.typeName) {
      return getFullyQualifiedName(type.typeName, exportNames, typeNameMap);
    }

    return `[${type.types.map((member: tae.AnyType) => formatType(member, false, undefined, expandObjects, exportNames, typeNameMap)).join(', ')}]`;
  }

  if (isTypeParameterType(type)) {
    return type.constraint !== undefined
      ? formatType(
          type.constraint,
          removeUndefined,
          undefined,
          expandObjects,
          exportNames,
          typeNameMap,
        )
      : type.name;
  }

  return 'unknown';
}

/**
 * Formats a TypeScript type into a prettified string representation.
 *
 * This is a convenience wrapper around `formatType()` that applies Prettier formatting
 * to the resulting type string. It delegates to `formatType()` for the core type
 * processing, then runs the output through `prettyFormat()` for consistent styling.
 */
export async function prettyFormatType(...args: Parameters<typeof formatType>) {
  return prettyFormat(
    formatType(...args),
    args[0].kind === 'object' ? args[0].typeName?.name : undefined,
  );
}

function getFullyQualifiedName(
  typeName: tae.TypeName,
  exportNames: string[],
  typeNameMap: Record<string, string>,
): string {
  const nameWithTypeArgs = createNameWithTypeArguments(typeName, exportNames, typeNameMap);

  // Construct the flat name (what parseExports would have created)
  const flatName =
    typeName.namespaces && typeName.namespaces.length > 0
      ? typeName.namespaces.join('') + typeName.name
      : typeName.name;

  // Check if this type is in our map (exact match)
  if (typeNameMap[flatName]) {
    // This is one of our component types - use the mapped dotted name
    const typeArgsStart = nameWithTypeArgs.indexOf('<');

    if (typeArgsStart !== -1) {
      // Preserve type arguments
      return typeNameMap[flatName] + nameWithTypeArgs.slice(typeArgsStart);
    }
    return typeNameMap[flatName];
  }

  // Check if flatName matches a dotted export with dots removed
  // e.g., ComponentPartState -> Component.Part.State (if that export exists)
  for (const dottedName of Object.values(typeNameMap)) {
    if (dottedName.replace(/\./g, '') === flatName) {
      const typeArgsStart = nameWithTypeArgs.indexOf('<');
      if (typeArgsStart !== -1) {
        return dottedName + nameWithTypeArgs.slice(typeArgsStart);
      }
      return dottedName;
    }
  }

  // Check if we have a namespaced reference where the namespace itself needs transformation
  // E.g., MenuRoot.Actions.Handler where MenuRoot → Menu.Root → Menu.Root.Actions.Handler
  // This check comes BEFORE flat prefix matching to preserve namespace structure
  if (typeName.namespaces && typeName.namespaces.length > 0) {
    // Check if any namespace part is in the typeNameMap
    const transformedNamespaces = typeName.namespaces.map((ns) => typeNameMap[ns] || ns);
    const hasTransformation = transformedNamespaces.some((ns, i) => ns !== typeName.namespaces![i]);

    if (hasTransformation) {
      // Build the transformed name: TransformedNamespace.Member
      const transformedName = [...transformedNamespaces, typeName.name].join('.');
      const typeArgsStart = nameWithTypeArgs.indexOf('<');

      if (typeArgsStart !== -1) {
        // Preserve type arguments
        return transformedName + nameWithTypeArgs.slice(typeArgsStart);
      }
      return transformedName;
    }
  }

  // Check if flatName starts with a known component prefix
  // e.g., "ComponentPartState" starts with "ComponentPart" -> "Component.Part", so becomes "Component.Part.State"
  // This handles types that don't have namespace structure (already flattened)
  const sortedEntries = Object.entries(typeNameMap).sort((a, b) => b[0].length - a[0].length);
  for (const [flat, dotted] of sortedEntries) {
    if (flatName.startsWith(flat) && flatName.length > flat.length) {
      const suffix = flatName.slice(flat.length);
      const dottedName = `${dotted}.${suffix}`;
      const typeArgsStart = nameWithTypeArgs.indexOf('<');
      if (typeArgsStart !== -1) {
        return dottedName + nameWithTypeArgs.slice(typeArgsStart);
      }
      return dottedName;
    }
  }

  // No transformation needed - return as-is
  if (typeName.namespaces && typeName.namespaces.length > 0) {
    const typeArgsStart = nameWithTypeArgs.indexOf('<');
    if (typeArgsStart !== -1) {
      return flatName + nameWithTypeArgs.slice(typeArgsStart);
    }
    return flatName;
  }

  // Not in the map and no namespaces - it's an external type (React, HTMLElement, etc.)
  return nameWithTypeArgs;
}

function createNameWithTypeArguments(
  typeName: tae.TypeName,
  exportNames: string[],
  typeNameMap: Record<string, string>,
) {
  const prefix =
    typeName.namespaces && typeName.namespaces.length > 0
      ? `${typeName.namespaces.join('.')}.`
      : '';

  if (
    typeName.typeArguments &&
    typeName.typeArguments.length > 0 &&
    typeName.typeArguments.some((ta) => ta.equalToDefault === false)
  ) {
    return `${prefix}${typeName.name}<${typeName.typeArguments.map((ta) => formatType(ta.type, false, undefined, false, exportNames, typeNameMap)).join(', ')}>`;
  }

  return `${prefix}${typeName.name}`;
}

/**
 * Looks for 'any', 'null' and 'undefined' types and moves them to the end of the array of types.
 */
function orderMembers(members: readonly tae.AnyType[]): readonly tae.AnyType[] {
  let orderedMembers = pushToEnd(members, 'any');
  orderedMembers = pushToEnd(orderedMembers, 'null');
  orderedMembers = pushToEnd(orderedMembers, 'undefined');
  return orderedMembers;
}

function pushToEnd(members: readonly tae.AnyType[], name: string): readonly tae.AnyType[] {
  const index = members.findIndex((member: tae.AnyType) => {
    return isIntrinsicType(member) && member.intrinsic === name;
  });

  if (index !== -1) {
    const member = members[index];
    return [...members.slice(0, index), ...members.slice(index + 1), member];
  }

  return members;
}

function isObjectEmpty(object: Record<any, any>) {
  // eslint-disable-next-line
  for (const _ in object) {
    return false;
  }
  return true;
}

function normalizeQuotes(str: string) {
  if (str.startsWith('"') && str.endsWith('"')) {
    return str
      .replaceAll("'", "\\'")
      .replaceAll('\\"', '"')
      .replace(/^"(.*)"$/, "'$1'");
  }

  return str;
}
