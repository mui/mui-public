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
import { formatType, getFullyQualifiedName } from './formatType';
import type { ExternalTypesCollector } from './externalTypes';
import {
  isExternalType,
  isUnionType,
  isIntersectionType,
  isObjectType,
  isAnonymousObjectType,
  isTypeParameterType,
} from './typeGuards';

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
  /** @see references as parsed markdown HAST */
  see?: HastRoot;
  /** Plain text version of @see references for markdown generation */
  seeText?: string;
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
  /** @see references as parsed markdown HAST */
  see?: HastRoot;
  /** Plain text version of @see references for markdown generation */
  seeText?: string;
}

/**
 * Extract a human-readable label from a URL (e.g. "github.com" from "http://github.com/foo").
 */
function labelFromUrl(url: string): string {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Transform a single JSDoc `@see` tag value into a markdown list-item string.
 *
 * Supported input forms:
 * - `{@link http://example.com}` → `- See [example.com](http://example.com)`
 * - `{@link http://example.com|My Label}` → `- See [My Label](http://example.com)`
 * - `{@link http://example.com} trailing text` → `- See [example.com](http://example.com) trailing text`
 * - `http://example.com` (bare URL) → `- See [example.com](http://example.com)`
 * - `plain text` (no link) → `- See plain text`
 */
function formatSeeTag(value: string): string {
  let trimmed = value.trim();

  // Workaround: TypeScript's parser splits `@see https://example.com` into
  // tag.name="https" and tag.comment="://example.com", so the extractor may
  // deliver a truncated value starting with "://".  Restore the protocol.
  // TODO: fix this in typescript-api-extractor
  if (trimmed.startsWith('://')) {
    trimmed = `https${trimmed}`;
  }

  // Replace all {@link ...} occurrences
  const linkPattern = /\{@link\s+([^|}]+?)(?:\|([^}]+))?\}/g;
  if (linkPattern.test(trimmed)) {
    // Reset lastIndex after test
    linkPattern.lastIndex = 0;
    const replaced = trimmed.replace(linkPattern, (_match, url: string, text?: string) => {
      const linkUrl = url.trim();
      const linkText = text ? text.trim() : labelFromUrl(linkUrl);
      return `[${linkText}](${linkUrl})`;
    });
    return `- See ${replaced}`;
  }

  // Bare URL (no {@link ...} wrapper)
  const bareUrlMatch = trimmed.match(/^(https?:\/\/\S+)(.*)$/);
  if (bareUrlMatch) {
    const url = bareUrlMatch[1];
    const rest = bareUrlMatch[2];
    return `- See [${labelFromUrl(url)}](${url})${rest}`;
  }

  // Plain text reference
  return `- See ${trimmed}`;
}

/**
 * Transform an array of raw `@see` tag values into a markdown bullet list.
 * Returns `undefined` when the input is empty.
 */
export function formatSeeTags(values: (string | undefined)[]): string | undefined {
  const items = values.filter((v): v is string => v != null && v.trim().length > 0);
  if (items.length === 0) {
    return undefined;
  }
  return items.map(formatSeeTag).join('\n');
}

/**
 * Formats an array of type arguments into a type parameter declaration string.
 *
 * Only includes entries that are `TypeParameterNode`s (i.e., actual type parameters
 * like `T`, not concrete type arguments like `string`). Each parameter is formatted
 * with its constraint and default value when present.
 *
 * @returns A string like `<T, K extends string>` or `''` if there are no type parameters.
 */
export function formatTypeParameterDeclaration(
  typeArguments: readonly tae.TypeArgument[],
  typeNameMap: Record<string, string> = {},
): string {
  const typeParams = typeArguments
    .filter((arg): arg is tae.TypeArgument & { type: tae.TypeParameterNode } =>
      isTypeParameterType(arg.type),
    )
    .map((arg) => {
      const param = arg.type;
      let result = param.name;

      if (param.constraint !== undefined) {
        const constraintStr = formatType(param.constraint, {
          exportNames: [],
          typeNameMap,
        });
        result += ` extends ${constraintStr}`;
      }

      if (param.defaultValue !== undefined) {
        const defaultStr = formatType(param.defaultValue, { exportNames: [], typeNameMap });
        result += ` = ${defaultStr}`;
      }

      return result;
    });

  if (typeParams.length === 0) {
    return '';
  }

  return `<${typeParams.join(', ')}>`;
}

/**
 * Extracts type parameter declarations from an AnyType node.
 *
 * Reads `typeName.typeArguments` from types that carry a `typeName` property
 * (ObjectNode, UnionNode, IntersectionNode) and formats them as a declaration string.
 *
 * @returns A string like `<T, K extends string>` or `''` if the type has no type parameters.
 */
export function extractTypeParameters(
  type: tae.AnyType,
  typeNameMap: Record<string, string> = {},
): string {
  const typeWithName = type as { typeName?: tae.TypeName };
  if (!typeWithName.typeName?.typeArguments?.length) {
    return '';
  }

  return formatTypeParameterDeclaration(typeWithName.typeName.typeArguments, typeNameMap);
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
    .use(remarkTypography, [])
    .use(remarkRehype)
    .freeze();

  const mdast = processor.parse(markdown);
  const result = await processor.run(mdast);

  return result;
}

/**
 * Ensures an @example tag value is wrapped in a code fence.
 * If the text already contains triple-backtick fences, it's returned as-is.
 * Otherwise, wraps it in ```tsx fences.
 */
function ensureExampleFenced(exampleText: string): string {
  if (exampleText.includes('```')) {
    return exampleText;
  }
  return `\`\`\`tsx\n${exampleText.trim()}\n\`\`\``;
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

export async function prettyFormat(type: string, typeName?: string | null, printWidth = 100) {
  let formattedType: string;
  // When typeName is null, format the code directly without any prefix
  // When typeName is undefined, use a placeholder '_' that will be stripped later
  // When typeName is a string, keep the full `type X = ` prefix in output
  const usePrefix = typeName !== null;
  const codePrefix = usePrefix ? `type ${typeName || '_'} = ` : '';

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

  // When typeName is null, return the formatted code directly (no prefix was added)
  if (typeName === null) {
    return formattedType.trimEnd();
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
  exportNames: string[];
  typeNameMap: Record<string, string>;
  isComponentContext?: boolean;
  /** Options for inline type formatting (e.g., unionPrintWidth) */
  formatting?: FormatInlineTypeOptions;
  /** Collector for external types discovered during formatting */
  externalTypes?: ExternalTypesCollector;
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
  options: FormatPropertiesOptions = {} as FormatPropertiesOptions,
): Promise<Record<string, FormattedProperty>> {
  const { exportNames, typeNameMap, isComponentContext = false, externalTypes } = options;
  // Filter out props that should not be documented:
  // - `ref` is typically forwarded and not useful in component API docs
  // - Props with @ignore tag are intentionally hidden from documentation
  const filteredProps = props.filter((prop) => {
    // Skip `ref` for components (when isComponentContext is true)
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
      const rawExampleTag = prop.documentation?.tags
        ?.filter((tag) => tag.name === 'example')
        .map((tag) => tag.value)
        .join('\n');
      const exampleTag = rawExampleTag ? ensureExampleFenced(rawExampleTag) : undefined;

      const seeTagValues =
        prop.documentation?.tags?.filter((tag) => tag.name === 'see').map((tag) => tag.value) ?? [];
      const seeText = formatSeeTags(seeTagValues);

      const formattedType = formatType(prop.type, {
        removeUndefined: prop.optional,
        jsdocTags: prop.documentation?.tags,
        exportNames,
        typeNameMap,
        externalTypesCollector: externalTypes,
      });

      // Parse description as markdown and convert to HAST for rich rendering
      const description = prop.documentation?.description
        ? await parseMarkdownToHast(prop.documentation.description)
        : undefined;

      // Parse example as markdown if present
      // Use fenced exampleTag so that parseMarkdownToHast produces <pre><code> HAST.
      // This ensures transformHtmlCodePrecomputed in highlightTypes can process it.
      const example = exampleTag ? await parseMarkdownToHast(exampleTag) : undefined;

      // Parse @see references as markdown if present
      const see = seeText ? await parseMarkdownToHast(seeText) : undefined;

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
        see,
        seeText,
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
 * Options for formatting parameters.
 */
export interface FormatParametersOptions {
  exportNames: string[];
  typeNameMap: Record<string, string>;
  /** Options for inline type formatting (e.g., unionPrintWidth) */
  formatting?: FormatInlineTypeOptions;
  /** Collector for external types discovered during formatting */
  externalTypes?: ExternalTypesCollector;
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
  options: FormatParametersOptions = {} as FormatParametersOptions,
): Promise<Record<string, FormattedParameter>> {
  const { exportNames, typeNameMap, externalTypes } = options;
  const result: Record<string, FormattedParameter> = {};

  await Promise.all(
    params.map(async (param) => {
      const rawExampleTag = param.documentation?.tags
        ?.filter((tag) => tag.name === 'example')
        .map((tag) => tag.value)
        .join('\n');
      const exampleTag = rawExampleTag ? ensureExampleFenced(rawExampleTag) : undefined;

      const seeTagValues =
        param.documentation?.tags?.filter((tag) => tag.name === 'see').map((tag) => tag.value) ??
        [];
      const seeText = formatSeeTags(seeTagValues);

      const description = param.documentation?.description
        ? await parseMarkdownToHast(param.documentation.description)
        : undefined;

      // Use fenced exampleTag so that parseMarkdownToHast produces <pre><code> HAST.
      // This ensures transformHtmlCodePrecomputed in highlightTypes can process it.
      const example = exampleTag ? await parseMarkdownToHast(exampleTag) : undefined;

      // Parse @see references as markdown if present
      const see = seeText ? await parseMarkdownToHast(seeText) : undefined;

      // Get default value as plain text if present
      const defaultValueText =
        param.defaultValue !== undefined ? String(param.defaultValue) : undefined;

      // Format type as plain text
      // Only expand anonymous object types (no type name) — named types like
      // `ExportConfig` should be shown as type references, not expanded inline.
      const shouldExpand = isObjectType(param.type) && isAnonymousObjectType(param.type);
      const typeText = formatType(param.type, {
        removeUndefined: param.optional,
        jsdocTags: param.documentation?.tags,
        expandObjects: shouldExpand,
        exportNames,
        typeNameMap,
        externalTypesCollector: externalTypes,
      });

      const paramResult: FormattedParameter = {
        typeText,
        optional: param.optional || undefined,
        description,
        descriptionText: param.documentation?.description,
        example,
        exampleText: exampleTag,
        see,
        seeText,
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
 * Options for formatting detailed types.
 */
export interface FormatDetailedTypeOptions {
  allExports: tae.ExportNode[];
  exportNames: string[];
  typeNameMap: Record<string, string>;
  /** @internal Used for cycle detection in recursive calls */
  visited?: Set<string>;
}

/**
 * Recursively expands type aliases and external type references to their full definitions.
 *
 * This function resolves external types by looking them up in the provided exports,
 * and recursively expands union and intersection types. It includes cycle detection
 * to prevent infinite recursion on self-referential types.
 */
export function formatDetailedType(type: tae.AnyType, options: FormatDetailedTypeOptions): string {
  const { allExports, exportNames, typeNameMap, visited = new Set<string>() } = options;
  // Prevent infinite recursion
  if (isExternalType(type)) {
    const qualifiedName = getFullyQualifiedName(type.typeName, exportNames, typeNameMap);
    if (visited.has(qualifiedName)) {
      return qualifiedName;
    }
    visited.add(qualifiedName);

    const exportNode = allExports.find((node) => node.name === type.typeName.name);
    if (exportNode) {
      return formatDetailedType((exportNode.type as unknown as tae.AnyType) ?? type, {
        allExports,
        exportNames,
        typeNameMap,
        visited,
      });
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
      formatDetailedType(t, { allExports, exportNames, typeNameMap, visited }),
    );
    return uniq(memberTypes).join(' | ');
  }

  if (isIntersectionType(type)) {
    const memberTypes = type.types.map((t) =>
      formatDetailedType(t, { allExports, exportNames, typeNameMap, visited }),
    );
    return uniq(memberTypes).join(' & ');
  }

  // For objects and everything else, reuse existing formatter with object expansion enabled
  return formatType(type, { expandObjects: true, exportNames, typeNameMap });
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
