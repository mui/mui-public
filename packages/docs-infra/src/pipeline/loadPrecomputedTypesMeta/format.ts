import { uniq, sortBy } from 'es-toolkit';
import prettier from 'prettier/standalone';
import prettierPluginEstree from 'prettier/plugins/estree';
import prettierPluginTypescript from 'prettier/plugins/typescript';
import type * as tae from 'typescript-api-extractor';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import type { Root as HastRoot } from 'hast';
import transformHtmlCodeInlineHighlighted, {
  ensureStarryNightInitialized,
} from '../transformHtmlCodeInlineHighlighted';

/**
 * Formatted property metadata with syntax-highlighted types and parsed markdown.
 */
export interface FormattedProperty {
  /** Syntax-highlighted type as HAST */
  type: HastRoot;
  /** Short simplified type for table display (e.g., "Union", "function") */
  shortType?: HastRoot;
  /** Plain text version of shortType for accessibility and text operations */
  shortTypeText?: string;
  /** Default value with syntax highlighting as HAST */
  default?: HastRoot;
  /** Plain text version of default for accessibility and text operations */
  defaultText?: string;
  /** Whether the property is required */
  required?: true;
  /** Description as parsed markdown HAST */
  description?: HastRoot;
  /** Example usage as parsed markdown HAST */
  example?: HastRoot;
  /** Detailed expanded type view (only when different from basic type) */
  detailedType?: HastRoot;
}

/**
 * Formatted enum member metadata.
 */
export interface FormattedEnumMember {
  /** Description of the enum member as parsed markdown HAST */
  description?: HastRoot;
  /** Type annotation from JSDoc @type tag */
  type?: string;
}

/**
 * Formatted parameter metadata for functions and hooks.
 */
export interface FormattedParameter {
  /** Syntax-highlighted type as HAST */
  type: HastRoot;
  /** Default value with syntax highlighting as HAST */
  default?: HastRoot;
  /** Plain text version of default for accessibility and text operations */
  defaultText?: string;
  /** Whether the parameter is optional */
  optional?: true;
  /** Description from JSDoc as parsed markdown HAST */
  description?: HastRoot;
  /** Example usage as parsed markdown HAST */
  example?: HastRoot;
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
 * Determines whether a property should display its full type definition or a simplified version.
 *
 * Properties with complex types (unions, callbacks, etc.) benefit from expandable detailed views,
 * while simple types (string, number, boolean) can be shown inline without expansion.
 */
function shouldShowDetailedType(name: string, type: string | undefined): boolean {
  // Event handlers and getters typically have complex function signatures
  if (/^(on|get)[A-Z].*/.test(name)) {
    return true;
  }

  if (type === undefined || type === null) {
    return false;
  }

  // className can be string or function, show details
  if (name === 'className') {
    return true;
  }

  // render prop can be ReactElement or function, show details
  if (name === 'render') {
    return true;
  }

  // Simple types and short unions don't need expansion
  if (
    name.endsWith('Ref') ||
    name === 'children' ||
    type === 'boolean' ||
    type === 'string' ||
    type === 'number' ||
    type.indexOf(' | ') === -1 ||
    (type.split('|').length < 3 && type.length < 30)
  ) {
    return false;
  }

  // Complex unions benefit from detailed expansion
  return true;
}

/**
 * Gets the short representation of a type for display in tables.
 * Returns a simplified type string for complex types (e.g., "Union", "function").
 */
function getShortTypeString(name: string, typeText: string): string | undefined {
  // Event handlers and getters show as "function"
  if (/^(on|get)[A-Z].*/.test(name)) {
    return 'function';
  }

  // className can be string or function
  if (name === 'className') {
    return 'string | function';
  }

  // render can be ReactElement or function
  if (name === 'render') {
    return 'ReactElement | function';
  }

  // Complex unions show as "Union"
  if (shouldShowDetailedType(name, typeText)) {
    return 'Union';
  }

  // Simple types don't need a short version
  return undefined;
}

/**
 * Converts markdown text to HAST (HTML Abstract Syntax Tree) with syntax-highlighted code blocks.
 *
 * This enables rendering rich formatted descriptions including code examples, lists, and links
 * while preserving all markdown features and applying syntax highlighting to code blocks.
 */
export async function parseMarkdownToHast(markdown: string): Promise<HastRoot> {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype).freeze();

  const mdast = processor.parse(markdown);
  const result = await processor.run(mdast);

  return result;
}

/**
 * Formats an inline type string with syntax highlighting.
 *
 * This function transforms type strings (like `string`, `number | null`, etc.) into
 * syntax-highlighted HAST nodes. It ensures proper TypeScript context by prefixing
 * the type with `type _ = ` before highlighting, then removes the prefix from the result.
 *
 * @param typeText - The type string to format (e.g., "string | number")
 * @returns A promise that resolves to a HAST root containing highlighted nodes
 *
 * @example
 * ```ts
 * await formatInlineTypeAsHast('string | number')
 * // Returns HAST nodes with syntax highlighting for "string | number"
 * ```
 */
async function formatInlineTypeAsHast(typeText: string): Promise<HastRoot> {
  // Construct HAST with a code element
  // Add dataHighlightingPrefix so the plugin can temporarily wrap the type in valid syntax
  const hast: HastRoot = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: {
          className: ['language-ts'],
          dataHighlightingPrefix: 'type _ = ',
        },
        children: [{ type: 'text', value: typeText }],
      },
    ],
  };

  // Apply inline syntax highlighting
  const processor = unified().use(transformHtmlCodeInlineHighlighted).freeze();

  const result = (await processor.run(hast)) as HastRoot;

  return result;
}

/**
 * Formats TypeScript type text as HAST with full syntax highlighting in a code block.
 * This is used for detailed/expanded type displays (equivalent to triple backticks in MDX).
 * Unlike formatInlineTypeAsHast which uses <code>, this creates a <pre><code> structure.
 */
async function formatDetailedTypeAsHast(typeText: string): Promise<HastRoot> {
  // Construct HAST with a pre > code structure for block-level display
  const hast: HastRoot = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'code',
            properties: {
              className: ['language-ts'],
              dataHighlightingPrefix: 'type _ = ',
            },
            children: [{ type: 'text', value: typeText }],
          },
        ],
      },
    ],
  };

  // Apply inline syntax highlighting
  const processor = unified().use(transformHtmlCodeInlineHighlighted).freeze();

  const result = (await processor.run(hast)) as HastRoot;

  return result;
}

async function prettyFormat(type: string, typeName?: string) {
  const formattedType = await prettier.format(`type ${typeName || '_'} = ${type}`, {
    plugins: [prettierPluginEstree, prettierPluginTypescript],
    parser: 'typescript',
    singleQuote: true,
    semi: true,
    printWidth: 85,
  });

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
      const firstLine = lines[0].replace(/^type _ = /, '');
      codeLines = [firstLine, ...lines.slice(1)];
    }
    const nonEmptyLines = codeLines.filter((l) => l.trim() !== '');
    if (nonEmptyLines.length > 0) {
      const minIndent = Math.min(...nonEmptyLines.map((l) => l.match(/^\s*/)?.[0].length ?? 0));

      if (Number.isFinite(minIndent) && minIndent > 0) {
        type = codeLines.map((l) => l.substring(minIndent)).join('\n');
      } else {
        type = codeLines.join('\n');
      }
    } else {
      type = codeLines.join('\n');
    }
  }

  return type;
}

/**
 * Formats component or hook properties into a structured object with syntax-highlighted types.
 *
 * Each property includes its type (as HAST for rendering), description (parsed markdown),
 * default value, and optionally a detailed expanded type view for complex types.
 *
 * This function handles the conversion of TypeScript type information into a format
 * suitable for documentation display with proper syntax highlighting.
 */
export async function formatProperties(
  props: tae.PropertyNode[],
  exportNames: string[],
  allExports: tae.ExportNode[] | undefined = undefined,
): Promise<Record<string, FormattedProperty>> {
  // Ensure Starry Night is initialized for inline code highlighting
  await ensureStarryNightInitialized();

  const propEntries = await Promise.all(
    props.map(async (prop) => {
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
      );

      const needsDetailedType = shouldShowDetailedType(prop.name, formattedType);

      let detailedTypeText = formattedType;
      if (needsDetailedType) {
        if (prop.name !== 'className' && prop.name !== 'render' && allExports) {
          detailedTypeText = formatDetailedType(prop.type, allExports, exportNames);
        } else {
          detailedTypeText = formatType(
            prop.type,
            prop.optional,
            prop.documentation?.tags,
            false,
            exportNames,
          );
        }
        detailedTypeText = await prettyFormat(detailedTypeText);
      }

      // Parse description as markdown and convert to HAST for rich rendering
      const description = prop.documentation?.description
        ? await parseMarkdownToHast(prop.documentation.description)
        : undefined;

      // Parse example as markdown if present
      const example = exampleTag ? await parseMarkdownToHast(exampleTag) : undefined;

      // Get short type string if this prop needs one
      const shortTypeString = getShortTypeString(prop.name, formattedType);

      // Convert types to HAST for syntax highlighting
      // Use inline highlighting for simple types, detailed highlighting for expanded types
      const type = await formatInlineTypeAsHast(formattedType);
      const shortType = shortTypeString ? await formatInlineTypeAsHast(shortTypeString) : undefined;
      const detailedType =
        needsDetailedType && detailedTypeText !== formattedType
          ? await formatDetailedTypeAsHast(detailedTypeText)
          : undefined;

      // Format default value with syntax highlighting if present
      const defaultValueText =
        prop.documentation?.defaultValue !== undefined
          ? String(prop.documentation.defaultValue)
          : undefined;
      const defaultValue = defaultValueText
        ? await formatInlineTypeAsHast(defaultValueText)
        : undefined;

      const resultObject: FormattedProperty = {
        type,
        required: !prop.optional || undefined,
        description,
        example,
      };

      // Only include shortType and shortTypeText if they exist
      if (shortType && shortTypeString) {
        resultObject.shortType = shortType;
        resultObject.shortTypeText = shortTypeString;
      }

      // Only include default and defaultText if they exist
      if (defaultValue && defaultValueText) {
        resultObject.default = defaultValue;
        resultObject.defaultText = defaultValueText;
      }

      // Only include detailedType if it differs from the basic type
      if (detailedType) {
        resultObject.detailedType = detailedType;
      }

      return [prop.name, resultObject] as const;
    }),
  );

  return Object.fromEntries(propEntries);
}

/**
 * Formats function or hook parameters into a structured object.
 *
 * Each parameter includes its type (as string), description (parsed markdown as HAST),
 * default value, and whether it's optional.
 */
export async function formatParameters(
  params: tae.Parameter[],
  exportNames: string[] = [],
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

      // Format default value with syntax highlighting if present
      const defaultValueText =
        param.defaultValue !== undefined ? String(param.defaultValue) : undefined;
      const defaultValue = defaultValueText
        ? await formatInlineTypeAsHast(defaultValueText)
        : undefined;

      const paramResult: FormattedParameter = {
        type: await formatTypeAsHast(
          param.type,
          param.optional,
          param.documentation?.tags,
          true,
          exportNames,
        ),
        optional: param.optional || undefined,
        description,
        example,
      };

      // Only include default and defaultText if they exist
      if (defaultValue && defaultValueText) {
        paramResult.default = defaultValue;
        paramResult.defaultText = defaultValueText;
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
  visited = new Set<string>(),
): string {
  // Prevent infinite recursion
  if (isExternalType(type)) {
    const qualifiedName = getFullyQualifiedName(type.typeName, exportNames);
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
      formatDetailedType(t, allExports, exportNames, visited),
    );
    return uniq(memberTypes).join(' | ');
  }

  if (isIntersectionType(type)) {
    const memberTypes = type.types.map((t) =>
      formatDetailedType(t, allExports, exportNames, visited),
    );
    return uniq(memberTypes).join(' & ');
  }

  // For objects and everything else, reuse existing formatter with object expansion enabled
  return formatType(type, false, undefined, true, exportNames);
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
      const description = member.documentation?.description
        ? await parseMarkdownToHast(member.documentation.description)
        : undefined;

      result[member.value] = {
        description,
        type: member.documentation?.tags?.find((tag) => tag.name === 'type')?.value,
      };
    }),
  );

  return result;
}

/**
 * Formats an object type (like `typeof DataAttributes`) into enum member format.
 *
 * This handles cases where data attributes or similar enums are defined as const objects
 * with `typeof`, converting the object's properties into the same format as enum members.
 * Properties with JSDoc comments become descriptions.
 */
export async function formatObjectAsEnum(
  objectNode: tae.ObjectNode,
): Promise<Record<string, FormattedEnumMember>> {
  const result: Record<string, FormattedEnumMember> = {};

  await Promise.all(
    sortBy(objectNode.properties, ['name']).map(async (property) => {
      const description = property.documentation?.description
        ? await parseMarkdownToHast(property.documentation.description)
        : undefined;

      result[property.name] = {
        description,
        type: property.documentation?.tags?.find((tag) => tag.name === 'type')?.value,
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
 * with a prefix (`type _ = `) for better syntax highlighting, then removes the prefix from
 * the highlighted output.
 */
export function formatType(
  type: tae.AnyType,
  removeUndefined: boolean,
  jsdocTags: tae.DocumentationTag[] | undefined = undefined,
  expandObjects: boolean = false,
  exportNames: string[] = [],
  allExports?: tae.ExportNode[],
): string {
  const typeTag = jsdocTags?.find?.((tag) => tag.name === 'type');
  const typeValue = typeTag?.value;

  if (typeValue) {
    return typeValue;
  }

  if (isEnumType(type)) {
    if (type.typeName) {
      return getFullyQualifiedName(type.typeName, exportNames);
    }

    // Format enum as union of member values
    return type.members.map((m) => normalizeQuotes(m.value)).join(' | ');
  }

  if (isExternalType(type)) {
    if (/^ReactElement(<.*>)?/.test(type.typeName.name || '')) {
      return 'ReactElement';
    }

    if (type.typeName.namespaces?.length === 1 && type.typeName.namespaces[0] === 'React') {
      return createNameWithTypeArguments(type.typeName, exportNames);
    }

    // If allExports is provided, try to resolve the external reference
    if (allExports) {
      const exportNode = allExports.find((node) => node.name === type.typeName.name);
      if (exportNode) {
        return formatType(
          exportNode.type as unknown as tae.AnyType,
          removeUndefined,
          jsdocTags,
          expandObjects,
          exportNames,
          allExports,
        );
      }
    }

    return getFullyQualifiedName(type.typeName, exportNames);
  }

  if (isIntrinsicType(type)) {
    return type.typeName ? getFullyQualifiedName(type.typeName, exportNames) : type.intrinsic;
  }

  if (isUnionType(type)) {
    if (type.typeName) {
      return getFullyQualifiedName(type.typeName, exportNames);
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
        formatType(t, removeUndefined, undefined, expandObjects, exportNames),
      ),
    );

    return formattedMemeberTypes.join(' | ');
  }

  if (isIntersectionType(type)) {
    if (type.typeName) {
      return getFullyQualifiedName(type.typeName, exportNames);
    }

    return orderMembers(type.types)
      .map((t) => formatType(t, false, undefined, expandObjects, exportNames))
      .join(' & ');
  }

  if (isObjectType(type)) {
    // Always expand objects with the special __object typename (from typeof const objects)
    const shouldExpand = expandObjects || type.typeName?.name === '__object';

    if (type.typeName && !shouldExpand) {
      return getFullyQualifiedName(type.typeName, exportNames);
    }

    if (isObjectEmpty(type.properties)) {
      return '{}';
    }

    return `{ ${type.properties
      .map((m) => {
        // Property names with hyphens or other special characters need quotes
        const propertyName = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(m.name) ? m.name : `'${m.name}'`;
        return `${propertyName}${m.optional ? '?' : ''}: ${formatType(m.type, m.optional, undefined, expandObjects, exportNames)}`;
      })
      .join(', ')} }`;
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
      return getFullyQualifiedName(type.typeName, exportNames);
    }

    const functionSignature = type.callSignatures
      .map((s) => {
        const params = s.parameters
          .map((p, index, allParams) => {
            let paramType = formatType(p.type, false, undefined, expandObjects, exportNames);

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
        );
        return `(${params}) => ${returnType}`;
      })
      .join(' | ');
    return `(${functionSignature})`;
  }

  if (isTupleType(type)) {
    if (type.typeName) {
      return getFullyQualifiedName(type.typeName, exportNames);
    }

    return `[${type.types.map((member: tae.AnyType) => formatType(member, false, undefined, expandObjects, exportNames)).join(', ')}]`;
  }

  if (isTypeParameterType(type)) {
    return type.constraint !== undefined
      ? formatType(type.constraint, removeUndefined, undefined, expandObjects, exportNames)
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

/**
 * Formats a TypeScript type into syntax-highlighted HAST nodes.
 *
 * This is a convenience wrapper around `formatType()` that applies syntax highlighting
 * to the resulting type string. It delegates to `formatType()` for the core type
 * processing, then converts the output to HAST nodes with inline syntax highlighting.
 */
export async function formatTypeAsHast(...args: Parameters<typeof formatType>): Promise<HastRoot> {
  const typeString = formatType(...args);
  return formatInlineTypeAsHast(typeString);
}

function getFullyQualifiedName(typeName: tae.TypeName, exportNames: string[]): string {
  const nameWithTypeArgs = createNameWithTypeArguments(typeName, exportNames);

  // Check if this type belongs to the current component's namespace
  // by checking if any export name appears in the type name followed by more text
  for (const exportName of exportNames) {
    // Pattern: {Namespace}{ExportName}{Rest} where ExportName is "Root", "Trigger", etc.
    // and Rest is "State", "Props", "ChangeEventDetails", etc.

    // Find if exportName appears in the type name followed by an uppercase letter
    const exportNameIndex = nameWithTypeArgs.indexOf(exportName);
    if (exportNameIndex !== -1) {
      const afterExportName = nameWithTypeArgs.slice(exportNameIndex + exportName.length);
      // Check if what follows starts with uppercase (indicates a suffix like State, Props, etc.)
      if (
        afterExportName.length > 0 &&
        afterExportName.charAt(0) === afterExportName.charAt(0).toUpperCase()
      ) {
        // Extract namespace prefix if present (everything before the exportName)
        const beforeExportName = nameWithTypeArgs.slice(0, exportNameIndex);

        // Build the fully qualified name with namespace
        if (beforeExportName.length > 0) {
          // Has a namespace prefix: Component + Root + State → Component.Root.State
          return `${beforeExportName}.${exportName}.${afterExportName}`;
        }

        // No namespace prefix, but check if TypeScript reported namespaces
        if (typeName.namespaces && typeName.namespaces.length > 0) {
          return `${typeName.namespaces.join('.')}.${exportName}.${afterExportName}`;
        }

        // No namespace at all: Root + State → Root.State
        return `${exportName}.${afterExportName}`;
      }
    }
  }

  if (!typeName.namespaces || typeName.namespaces.length === 0) {
    return nameWithTypeArgs;
  }

  // Our components are defined in the source as [ComponentName][Part], but exported as [ComponentName].[Part].
  // The following code adjusts the namespaces to match the exported names.
  const joinedNamespaces = typeName.namespaces.map((namespace) => {
    const exportNameInNamespace = exportNames.find((exportName) =>
      new RegExp(`^${exportName}[A-Z]`).test(namespace),
    );

    if (exportNameInNamespace) {
      const dotPosition = exportNameInNamespace.length;
      return `${namespace.substring(0, dotPosition)}.${namespace.substring(dotPosition)}`;
    }

    return namespace;
  });

  return `${joinedNamespaces}.${nameWithTypeArgs}`;
}

function createNameWithTypeArguments(typeName: tae.TypeName, exportNames: string[] = []) {
  if (
    typeName.typeArguments &&
    typeName.typeArguments.length > 0 &&
    typeName.typeArguments.some((ta) => ta.equalToDefault === false)
  ) {
    return `${typeName.name}<${typeName.typeArguments.map((ta) => formatType(ta.type, false, undefined, false, exportNames)).join(', ')}>`;
  }

  return typeName.name;
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
