import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, RootContent, Table, Paragraph } from 'mdast';
import type { Root as HastRoot } from 'hast';
import remarkTypography from 'remark-typography';
import remarkRehype from 'remark-rehype';
import transformMarkdownCode from '../transformMarkdownCode';
import type {
  TypesMeta,
  ComponentTypeMeta,
  HookTypeMeta,
  FunctionTypeMeta,
  RawTypeMeta,
  FormattedProperty,
  FormattedEnumMember,
  FormattedParameter,
} from '../loadServerTypesMeta';
import { organizeTypesByExport, type OrganizeTypesResult } from './organizeTypesByExport';

/**
 * Variant data structure for a single variant.
 * Contains the types and optional typeNameMap specific to that variant.
 */
export interface VariantData {
  types: TypesMeta[];
  typeNameMap?: Record<string, string>;
}

/**
 * Common data returned by both syncTypes and loadServerTypesText.
 * This is the shared contract consumed by loadServerTypes.
 */
export interface TypesSourceData extends OrganizeTypesResult<TypesMeta> {
  /** External types discovered in the file */
  externalTypes: Record<string, string>;
  /**
   * Type name map (merged across all variants).
   * Maps flat names (like "AccordionTriggerState") to dotted names (like "Accordion.Trigger.State").
   */
  typeNameMap: Record<string, string>;
  /** All dependencies that should be watched for changes */
  allDependencies: string[];
  /** Whether the types.md file was updated (false if loaded from existing file) */
  updated: boolean;
}

/**
 * Decode HTML entities commonly found in markdown.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/"/g, '"') // Left double quote
    .replace(/"/g, '"'); // Right double quote
}

/**
 * Extract text content from markdown AST nodes recursively.
 */
function extractText(node: RootContent | RootContent[]): string {
  if (Array.isArray(node)) {
    return node.map(extractText).join('');
  }
  if ('value' in node) {
    return node.value;
  }
  if ('children' in node) {
    return (node.children as RootContent[]).map(extractText).join('');
  }
  return '';
}

/**
 * Extract text content while preserving markdown link syntax.
 */
function extractTextWithLinks(node: RootContent | RootContent[]): string {
  if (Array.isArray(node)) {
    return node.map(extractTextWithLinks).join('');
  }
  if (node.type === 'link') {
    const linkText = (node.children as RootContent[]).map(extractTextWithLinks).join('');
    return `[${linkText}](${node.url})`;
  }
  if ('value' in node) {
    return node.value;
  }
  if ('children' in node) {
    return (node.children as RootContent[]).map(extractTextWithLinks).join('');
  }
  return '';
}

/**
 * Extract inline code content from a node, or return the text if not inline code.
 */
function extractInlineCodeOrText(node: RootContent | RootContent[]): string {
  if (Array.isArray(node)) {
    return node.map(extractInlineCodeOrText).join('');
  }
  if (node.type === 'inlineCode') {
    return decodeHtmlEntities(node.value);
  }
  if ('value' in node) {
    return decodeHtmlEntities(node.value);
  }
  if ('children' in node) {
    return (node.children as RootContent[]).map(extractInlineCodeOrText).join('');
  }
  return '';
}

/**
 * A target for batch HAST conversion: a setter to assign the result and the mdast nodes to convert.
 */
type DescriptionTarget = [setter: (hast: HastRoot) => void, mdast: RootContent[]];

/**
 * Append reference items from a markdown list node to a prop/parameter's see fields.
 * Extracts each list item preserving link syntax and pushes a HAST conversion target.
 */
function appendListReferences(
  entry: { see?: HastRoot; seeText?: string },
  listNode: RootContent,
  targets: DescriptionTarget[],
): void {
  if (!('children' in listNode)) {
    return;
  }
  const items = (listNode as { children: RootContent[] }).children
    .map((li: RootContent) => {
      if (li.type === 'listItem' && 'children' in li && li.children) {
        return extractTextWithLinks(li.children as RootContent[]);
      }
      return '';
    })
    .filter(Boolean)
    .map((item: string) => `- ${item}`);
  const listText = items.join('\n');
  const existing = entry.seeText;
  entry.seeText = existing ? `${existing}\n${listText}` : listText;
  targets.push([
    (hast) => {
      entry.see = hast;
    },
    [listNode],
  ]);
}

/**
 * Append a text reference (from a paragraph node) to a prop/parameter's see fields.
 */
function appendTextReference(
  entry: { see?: HastRoot; seeText?: string },
  text: string,
  node: RootContent,
  targets: DescriptionTarget[],
): void {
  const existing = entry.seeText;
  entry.seeText = existing ? `${existing}\n\n${text}` : text;
  targets.push([
    (hast) => {
      entry.see = hast;
    },
    [node],
  ]);
}

/**
 * Strip positional data from a HAST tree.
 * Positions reference source locations in the original markdown file
 * and are not used downstream, so removing them reduces noise and data size.
 */
function stripPositions(node: HastRoot): HastRoot {
  delete node.position;
  if ('children' in node) {
    for (const child of node.children) {
      stripPositions(child as unknown as HastRoot);
    }
  }
  return node;
}

/**
 * Convert all collected mdast description nodes to HAST in parallel.
 * Runs only the transform plugins (transformMarkdownCode → remarkTypography → remarkRehype)
 * on mdast nodes that were already parsed, avoiding a redundant text → mdast re-parse.
 */
async function convertDescriptions(targets: DescriptionTarget[]): Promise<void> {
  const processor = unified()
    .use(transformMarkdownCode)
    .use(remarkTypography, [])
    .use(remarkRehype);

  await Promise.all(
    targets.map(async ([setter, children]) => {
      const root: Root = { type: 'root', children };
      setter(stripPositions((await processor.run(root)) as HastRoot));
    }),
  );
}

/**
 * Check if a node is a bold/strong heading pattern like "**Name Props:**"
 */
function isBoldHeading(node: RootContent): node is Paragraph {
  if (node.type !== 'paragraph') {
    return false;
  }
  const children = node.children;
  if (children.length === 0) {
    return false;
  }
  const first = children[0];
  return first.type === 'strong';
}

/**
 * Extract the heading type from a bold heading like "**Root Props:**" or "**`children` Prop Example:**"
 */
function parseBoldHeading(node: Paragraph): {
  name: string;
  type:
    | 'props'
    | 'data-attributes'
    | 'css-variables'
    | 'parameters'
    | 'properties'
    | 'return-value'
    | 'prop-example'
    | 'param-example'
    | 'prop-references'
    | 'param-references'
    | null;
} | null {
  const strong = node.children[0];
  if (strong.type !== 'strong') {
    return null;
  }

  const text = extractText(strong.children);

  // Check for prop/param example patterns: "`propName` Prop Example:" or "`paramName` Parameter Example:"
  if (text.endsWith(' Prop Example:')) {
    // Extract prop name from the inline code
    const strongChildren = strong.children;
    if (strongChildren.length >= 1 && strongChildren[0].type === 'inlineCode') {
      return { name: strongChildren[0].value, type: 'prop-example' };
    }
  }
  if (text.endsWith(' Parameter Example:')) {
    const strongChildren = strong.children;
    if (strongChildren.length >= 1 && strongChildren[0].type === 'inlineCode') {
      return { name: strongChildren[0].value, type: 'param-example' };
    }
  }

  // Check for prop/param reference patterns: "`propName` Prop References:" or "`paramName` Parameter References:"
  if (text.endsWith(' Prop References:')) {
    const strongChildren = strong.children;
    if (strongChildren.length >= 1 && strongChildren[0].type === 'inlineCode') {
      return { name: strongChildren[0].value, type: 'prop-references' };
    }
  }
  if (text.endsWith(' Parameter References:')) {
    const strongChildren = strong.children;
    if (strongChildren.length >= 1 && strongChildren[0].type === 'inlineCode') {
      return { name: strongChildren[0].value, type: 'param-references' };
    }
  }

  // Standard patterns
  if (text.endsWith(' Props:')) {
    return { name: text.slice(0, -' Props:'.length), type: 'props' };
  }
  if (text.endsWith(' Data Attributes:')) {
    return { name: text.slice(0, -' Data Attributes:'.length), type: 'data-attributes' };
  }
  if (text.endsWith(' CSS Variables:')) {
    return { name: text.slice(0, -' CSS Variables:'.length), type: 'css-variables' };
  }
  if (text.endsWith(' Parameters:') || text === 'Parameters:') {
    const name = text === 'Parameters:' ? '' : text.slice(0, -' Parameters:'.length);
    return { name, type: 'parameters' };
  }
  if (text.endsWith(' Properties:') || text === 'Properties:') {
    const name = text === 'Properties:' ? '' : text.slice(0, -' Properties:'.length);
    return { name, type: 'properties' };
  }
  if (text.endsWith(' Return Value:') || text === 'Return Value:') {
    const name = text === 'Return Value:' ? '' : text.slice(0, -' Return Value:'.length);
    return { name, type: 'return-value' };
  }

  return null;
}

/**
 * Parse a props/parameters table into FormattedProperty records.
 */
function parsePropsTable(
  table: Table,
  targets: DescriptionTarget[],
): Record<string, FormattedProperty> {
  const props: Record<string, FormattedProperty> = {};
  const rows = table.children;

  // Skip header row
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.type !== 'tableRow') {
      continue;
    }

    const cells = row.children;
    if (cells.length < 4) {
      continue;
    }

    // Prop | Type | Default | Description
    let propName = extractText(cells[0].children);
    const typeText = extractInlineCodeOrText(cells[1].children);
    const defaultText = extractInlineCodeOrText(cells[2].children);
    const descriptionText = extractText(cells[3].children);

    // Handle required marker (*)
    const required = propName.endsWith('*');
    if (required) {
      propName = propName.slice(0, -1);
    }

    // Handle optional marker (?)
    const optional = propName.endsWith('?');
    if (optional) {
      propName = propName.slice(0, -1);
    }

    const prop: FormattedProperty = {
      typeText: typeText === '-' ? '' : typeText,
    };

    if (required) {
      prop.required = true;
    }

    if (defaultText && defaultText !== '-') {
      prop.defaultText = defaultText;
    }

    if (descriptionText && descriptionText !== '-') {
      prop.descriptionText = descriptionText;
      targets.push([
        (hast) => {
          prop.description = hast;
        },
        [{ type: 'paragraph', children: cells[3].children } as RootContent],
      ]);
    }

    props[propName] = prop;
  }

  return props;
}

/**
 * Parse a parameters table into FormattedParameter records.
 */
function parseParametersTable(
  table: Table,
  targets: DescriptionTarget[],
): Record<string, FormattedParameter> {
  const params: Record<string, FormattedParameter> = {};
  const rows = table.children;

  // Skip header row
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.type !== 'tableRow') {
      continue;
    }

    const cells = row.children;
    if (cells.length < 4) {
      continue;
    }

    // Parameter | Type | Default | Description
    let paramName = extractText(cells[0].children);
    const typeText = extractInlineCodeOrText(cells[1].children);
    const defaultText = extractInlineCodeOrText(cells[2].children);
    const descriptionText = extractText(cells[3].children);

    // Handle required marker (*)
    const required = paramName.endsWith('*');
    if (required) {
      paramName = paramName.slice(0, -1);
    }

    // Handle optional marker (?)
    const optional = paramName.endsWith('?');
    if (optional) {
      paramName = paramName.slice(0, -1);
    }

    const param: FormattedParameter = {
      typeText: typeText === '-' ? '' : typeText,
    };

    if (optional) {
      param.optional = true;
    }

    if (defaultText && defaultText !== '-') {
      param.defaultText = defaultText;
    }

    if (descriptionText && descriptionText !== '-') {
      param.descriptionText = descriptionText;
      targets.push([
        (hast) => {
          param.description = hast;
        },
        [{ type: 'paragraph', children: cells[3].children } as RootContent],
      ]);
    }

    params[paramName] = param;
  }

  return params;
}

/**
 * Parse a data attributes table into FormattedEnumMember records.
 */
function parseDataAttributesTable(
  table: Table,
  targets: DescriptionTarget[],
): Record<string, FormattedEnumMember> {
  const attrs: Record<string, FormattedEnumMember> = {};
  const rows = table.children;

  // Skip header row
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.type !== 'tableRow') {
      continue;
    }

    const cells = row.children;
    if (cells.length < 3) {
      continue;
    }

    // Attribute | Type | Description
    const attrName = extractText(cells[0].children);
    const type = extractInlineCodeOrText(cells[1].children);
    const descriptionText = extractText(cells[2].children);

    const attr: FormattedEnumMember = {};

    if (type && type !== '-') {
      attr.type = type;
    }

    if (descriptionText && descriptionText !== '-') {
      attr.descriptionText = descriptionText;
      targets.push([
        (hast) => {
          attr.description = hast;
        },
        [{ type: 'paragraph', children: cells[2].children } as RootContent],
      ]);
    }

    attrs[attrName] = attr;
  }

  return attrs;
}

/**
 * Parse a CSS variables table into FormattedEnumMember records.
 */
function parseCssVariablesTable(
  table: Table,
  targets: DescriptionTarget[],
): Record<string, FormattedEnumMember> {
  const vars: Record<string, FormattedEnumMember> = {};
  const rows = table.children;

  // Skip header row
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.type !== 'tableRow') {
      continue;
    }

    const cells = row.children;
    if (cells.length < 3) {
      continue;
    }

    // Variable | Type | Description
    const varName = extractInlineCodeOrText(cells[0].children);
    const type = extractInlineCodeOrText(cells[1].children);
    const descriptionText = extractText(cells[2].children);

    const cssVar: FormattedEnumMember = {};

    if (type && type !== '-') {
      cssVar.type = type;
    }

    if (descriptionText && descriptionText !== '-') {
      cssVar.descriptionText = descriptionText;
      targets.push([
        (hast) => {
          cssVar.description = hast;
        },
        [{ type: 'paragraph', children: cells[2].children } as RootContent],
      ]);
    }

    vars[varName] = cssVar;
  }

  return vars;
}

/**
 * Parse a return value table into FormattedProperty records.
 */
function parseReturnValueTable(
  table: Table,
  targets: DescriptionTarget[],
): Record<string, FormattedProperty> {
  const props: Record<string, FormattedProperty> = {};
  const rows = table.children;

  // Skip header row
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.type !== 'tableRow') {
      continue;
    }

    const cells = row.children;
    if (cells.length < 3) {
      continue;
    }

    // Property | Type | Description
    const propName = extractInlineCodeOrText(cells[0].children);
    const typeText = extractInlineCodeOrText(cells[1].children);
    const descriptionText = extractText(cells[2].children);

    const prop: FormattedProperty = {
      typeText: typeText === '-' ? '' : typeText,
    };

    if (descriptionText && descriptionText !== '-') {
      prop.descriptionText = descriptionText;
      targets.push([
        (hast) => {
          prop.description = hast;
        },
        [{ type: 'paragraph', children: cells[2].children } as RootContent],
      ]);
    }

    props[propName] = prop;
  }

  return props;
}

/**
 * Determine the type of a section based on its content.
 * Returns 'component', 'hook', 'function', or 'raw'.
 */
function determineTypeKind(
  name: string,
  hasProps: boolean,
  hasDataAttrs: boolean,
  hasCssVars: boolean,
  hasParams: boolean,
  hasReturnValue: boolean,
  hasCodeBlock: boolean,
  isReExport: boolean,
): 'component' | 'hook' | 'function' | 'raw' {
  // Re-exports are raw types
  if (isReExport) {
    return 'raw';
  }

  // Hooks start with 'use'
  if (name.startsWith('use')) {
    return 'hook';
  }

  // Components have props, data attributes, or CSS variables
  if (hasProps || hasDataAttrs || hasCssVars) {
    return 'component';
  }

  // Functions have parameters
  if (hasParams || hasReturnValue) {
    return 'function';
  }

  // Raw types are code blocks or re-exports
  if (hasCodeBlock) {
    return 'raw';
  }

  // Default to component if nothing else matches
  return 'component';
}

/**
 * Load and parse a types.md file into TypesMeta[].
 *
 * @param fileUrl - file:// URL to the types.md file
 * @returns Parsed types and external types
 */
export async function loadServerTypesText(fileUrl: string): Promise<TypesSourceData> {
  // Read the file
  const filePath = fileURLToPath(fileUrl);
  const content = await readFile(filePath, 'utf-8');

  return {
    ...(await parseTypesMarkdown(content)),
    allDependencies: [filePath],
    updated: false,
  };
}

/**
 * Parse types.md content into TypesMeta[].
 * Exported for testing.
 */
export async function parseTypesMarkdown(content: string) {
  // Parse markdown into AST
  const processor = unified().use(remarkParse).use(remarkGfm);
  const ast = processor.parse(content) as Root;

  const allTypes: TypesMeta[] = [];
  const descriptionTargets: DescriptionTarget[] = [];
  const externalTypes: Record<string, string> = {};

  // Track current context
  let currentH3Name: string | null = null;
  let currentDescription: string[] = [];
  let currentDescriptionNodes: RootContent[] = [];
  let currentProps: Record<string, FormattedProperty> = {};
  let currentDataAttrs: Record<string, FormattedEnumMember> = {};
  let currentCssVars: Record<string, FormattedEnumMember> = {};
  let currentParams: Record<string, FormattedParameter> = {};
  let currentProperties: Record<string, FormattedProperty> = {};
  let currentReturnValue: Record<string, FormattedProperty> | string | null = null;
  let currentReturnValueDescription: string | null = null;
  let currentReturnValueDescriptionNode: RootContent | null = null;
  let currentCodeBlock: string | null = null;
  let isReExport = false;
  let lastBoldHeadingType: string | null = null;
  let lastPropExampleName: string | null = null;
  let lastParamExampleName: string | null = null;
  let lastPropReferencesName: string | null = null;
  let lastParamReferencesName: string | null = null;

  // Helper to flush the current section
  const flushSection = () => {
    if (!currentH3Name) {
      return;
    }

    const kind = determineTypeKind(
      currentH3Name,
      Object.keys(currentProps).length > 0,
      Object.keys(currentDataAttrs).length > 0,
      Object.keys(currentCssVars).length > 0,
      Object.keys(currentParams).length > 0 || Object.keys(currentProperties).length > 0,
      currentReturnValue !== null,
      currentCodeBlock !== null,
      isReExport,
    );

    const descriptionText =
      currentDescription.length > 0 ? currentDescription.join('\n\n') : undefined;

    if (kind === 'component') {
      const componentMeta: ComponentTypeMeta = {
        name: currentH3Name,
        props: currentProps,
        dataAttributes: currentDataAttrs,
        cssVariables: currentCssVars,
      };
      if (descriptionText) {
        componentMeta.descriptionText = descriptionText;
        descriptionTargets.push([
          (hast) => {
            componentMeta.description = hast;
          },
          currentDescriptionNodes,
        ]);
      }
      allTypes.push({ type: 'component', name: currentH3Name, data: componentMeta });
    } else if (kind === 'hook') {
      const hookMeta: HookTypeMeta = {
        name: currentH3Name,
        ...(Object.keys(currentProperties).length > 0
          ? { properties: currentProperties }
          : { parameters: currentParams }),
        returnValue: currentReturnValue || {},
      };
      if (descriptionText) {
        hookMeta.descriptionText = descriptionText;
        descriptionTargets.push([
          (hast) => {
            hookMeta.description = hast;
          },
          currentDescriptionNodes,
        ]);
      }
      if (currentReturnValueDescription) {
        hookMeta.returnValueDescriptionText = currentReturnValueDescription;
        if (currentReturnValueDescriptionNode) {
          descriptionTargets.push([
            (hast) => {
              hookMeta.returnValueDescription = hast;
            },
            [currentReturnValueDescriptionNode],
          ]);
        }
      }
      allTypes.push({ type: 'hook', name: currentH3Name, data: hookMeta });
    } else if (kind === 'function') {
      const funcMeta: FunctionTypeMeta = {
        name: currentH3Name,
        ...(Object.keys(currentProperties).length > 0
          ? { properties: currentProperties }
          : { parameters: currentParams }),
        returnValue: currentReturnValue || {},
      };
      if (descriptionText) {
        funcMeta.descriptionText = descriptionText;
        descriptionTargets.push([
          (hast) => {
            funcMeta.description = hast;
          },
          currentDescriptionNodes,
        ]);
      }
      if (currentReturnValueDescription) {
        funcMeta.returnValueDescriptionText = currentReturnValueDescription;
        if (currentReturnValueDescriptionNode) {
          descriptionTargets.push([
            (hast) => {
              funcMeta.returnValueDescription = hast;
            },
            [currentReturnValueDescriptionNode],
          ]);
        }
      }
      allTypes.push({ type: 'function', name: currentH3Name, data: funcMeta });
    } else if (kind === 'raw') {
      const rawMeta: RawTypeMeta = {
        name: currentH3Name,
        formattedCode: currentCodeBlock || '',
      };
      if (descriptionText) {
        rawMeta.descriptionText = descriptionText;
        descriptionTargets.push([
          (hast) => {
            rawMeta.description = hast;
          },
          currentDescriptionNodes,
        ]);
      }
      if (isReExport) {
        // Parse re-export info from description like "Re-export of [Root](#root) props."
        const reExportMatch = descriptionText?.match(/Re-export of \[([^\]]+)\]\(#([^)]+)\)/);
        if (reExportMatch) {
          rawMeta.reExportOf = {
            name: reExportMatch[1],
            slug: reExportMatch[2],
            suffix: 'props',
          };
        }
      }
      allTypes.push({ type: 'raw', name: currentH3Name, data: rawMeta });
    }

    // Reset state
    currentH3Name = null;
    currentDescription = [];
    currentDescriptionNodes = [];
    currentProps = {};
    currentDataAttrs = {};
    currentCssVars = {};
    currentParams = {};
    currentProperties = {};
    currentReturnValue = null;
    currentReturnValueDescription = null;
    currentReturnValueDescriptionNode = null;
    currentCodeBlock = null;
    isReExport = false;
    lastBoldHeadingType = null;
    lastPropExampleName = null;
    lastParamExampleName = null;
    lastPropReferencesName = null;
    lastParamReferencesName = null;
  };

  // Track if we're in the External Types section
  let inExternalTypes = false;
  let currentExternalTypeName: string | null = null;

  // Process nodes
  for (const node of ast.children) {
    // Handle ## headings
    if (node.type === 'heading' && node.depth === 2) {
      flushSection();
      const text = extractText(node.children);
      if (text === 'External Types') {
        inExternalTypes = true;
      } else if (text === 'Additional Types') {
        inExternalTypes = false;
      } else if (text === 'Export Groups' || text === 'Canonical Types') {
        // Skip metadata sections - they are parsed separately
        inExternalTypes = false;
      }
      continue;
    }

    // Handle ### headings (component/hook/type names)
    if (node.type === 'heading' && node.depth === 3) {
      flushSection();
      inExternalTypes = false;
      currentH3Name = extractText(node.children);
      continue;
    }

    // Handle #### headings in External Types section
    if (node.type === 'heading' && node.depth === 4 && inExternalTypes) {
      currentExternalTypeName = extractText(node.children);
      continue;
    }

    // Handle code blocks
    if (node.type === 'code') {
      if (inExternalTypes && currentExternalTypeName) {
        // External type definition
        externalTypes[currentExternalTypeName] = node.value;
        currentExternalTypeName = null;
      } else if (currentH3Name) {
        if (lastBoldHeadingType === 'return-value') {
          // Return value code block
          currentReturnValue = node.value;
        } else if (lastPropExampleName) {
          // Prop example code block
          if (currentProps[lastPropExampleName]) {
            currentProps[lastPropExampleName].exampleText =
              `\`\`\`${node.lang || 'tsx'}\n${node.value}\n\`\`\``;
          }
          lastPropExampleName = null;
        } else if (lastParamExampleName) {
          // Parameter example code block
          if (currentParams[lastParamExampleName]) {
            currentParams[lastParamExampleName].exampleText =
              `\`\`\`${node.lang || 'tsx'}\n${node.value}\n\`\`\``;
          }
          lastParamExampleName = null;
        } else {
          // Raw type code block
          currentCodeBlock = node.value;
        }
      }
      continue;
    }

    // Handle bold headings and tables within a section
    if (currentH3Name) {
      // Check for bold heading patterns
      if (isBoldHeading(node)) {
        const parsed = parseBoldHeading(node);
        if (parsed) {
          lastBoldHeadingType = parsed.type;
          lastPropReferencesName = null;
          lastParamReferencesName = null;
          if (parsed.type === 'prop-example') {
            lastPropExampleName = parsed.name;
          } else if (parsed.type === 'param-example') {
            lastParamExampleName = parsed.name;
          } else if (parsed.type === 'prop-references') {
            lastPropReferencesName = parsed.name;
          } else if (parsed.type === 'param-references') {
            lastParamReferencesName = parsed.name;
          }
        }
        continue;
      }

      // Handle tables
      if (node.type === 'table') {
        if (lastBoldHeadingType === 'props') {
          currentProps = parsePropsTable(node, descriptionTargets);
        } else if (lastBoldHeadingType === 'parameters') {
          currentParams = parseParametersTable(node, descriptionTargets);
        } else if (lastBoldHeadingType === 'properties') {
          // Properties are expanded parameters — parse as props table
          currentProperties = parsePropsTable(node, descriptionTargets);
        } else if (lastBoldHeadingType === 'data-attributes') {
          currentDataAttrs = parseDataAttributesTable(node, descriptionTargets);
        } else if (lastBoldHeadingType === 'css-variables') {
          currentCssVars = parseCssVariablesTable(node, descriptionTargets);
        } else if (lastBoldHeadingType === 'return-value') {
          currentReturnValue = parseReturnValueTable(node, descriptionTargets);
        }
        continue;
      }

      // Handle list nodes for references (@see tags produce bullet lists)
      if (node.type === 'list' && currentH3Name) {
        if (lastPropReferencesName && currentProps[lastPropReferencesName]) {
          appendListReferences(currentProps[lastPropReferencesName], node, descriptionTargets);
          continue;
        }
        if (lastParamReferencesName && currentParams[lastParamReferencesName]) {
          appendListReferences(currentParams[lastParamReferencesName], node, descriptionTargets);
          continue;
        }
      }

      // Handle paragraphs as description (including non-bold paragraphs)
      // Note: isBoldHeading already checked paragraphs and returned early if true
      if ('children' in node && node.type !== 'blockquote') {
        const text = extractTextWithLinks(node.children as RootContent[]);
        // Check for re-export pattern
        if (text.startsWith('Re-export of ')) {
          isReExport = true;
          currentDescription.push(text);
          currentDescriptionNodes.push(node);
        } else if (lastPropReferencesName && currentProps[lastPropReferencesName]) {
          appendTextReference(currentProps[lastPropReferencesName], text, node, descriptionTargets);
        } else if (lastParamReferencesName && currentParams[lastParamReferencesName]) {
          appendTextReference(
            currentParams[lastParamReferencesName],
            text,
            node,
            descriptionTargets,
          );
        } else if (!lastBoldHeadingType) {
          // Only add to description if we haven't seen a bold heading yet
          currentDescription.push(text);
          currentDescriptionNodes.push(node);
        } else if (lastBoldHeadingType === 'return-value' && !currentReturnValue) {
          // Return value description before the code block/table
          currentReturnValueDescription = text;
          currentReturnValueDescriptionNode = node;
        }
      }
    }
  }

  // Flush the last section
  flushSection();

  // Parse metadata from human-readable sections instead of JSON comments
  // The new format uses "## Export Groups" and "## Canonical Types" sections

  // Parse Export Groups section
  // Format: - `VariantName`: `Type1`, `Type2` (or just `- VariantName` if key equals single value)
  let variantTypes: Record<string, string[]> | null = null;
  const exportGroupsMatch = content.match(/## Export Groups\n([\s\S]*?)(?=\n## |$)/);
  if (exportGroupsMatch) {
    variantTypes = {};
    const lines = exportGroupsMatch[1].trim().split('\n');
    for (const line of lines) {
      // Match: - `VariantName`: `Type1`, `Type2` OR - `VariantName`
      const withValuesMatch = line.match(/^- `([^`]+)`:\s*(.+)$/);
      const singleMatch = line.match(/^- `([^`]+)`$/);

      if (withValuesMatch) {
        const variantName = withValuesMatch[1];
        // Extract all backtick-wrapped values
        const values = withValuesMatch[2].match(/`([^`]+)`/g);
        variantTypes[variantName] = values ? values.map((v) => v.slice(1, -1)) : [];
      } else if (singleMatch) {
        // Key equals value - the variant name IS the single type
        const variantName = singleMatch[1];
        variantTypes[variantName] = [variantName];
      }
    }
    // Only keep variantTypes if we found entries
    if (Object.keys(variantTypes).length === 0) {
      variantTypes = null;
    }
  }

  // Parse Canonical Types section
  // Format: - `CanonicalName` (`Variant1`, `Variant2`): `FlatName1`, `FlatName2`
  // OR:     - `CanonicalName`: `FlatName1`, `FlatName2` (no variant annotation)
  const typeNameMap: Record<string, string> = {};
  let variantTypeNameMapKeys: Record<string, string[]> | null = null;
  const canonicalTypesMatch = content.match(/## Canonical Types\n([\s\S]*?)(?=\n## |$)/);
  if (canonicalTypesMatch) {
    variantTypeNameMapKeys = {};
    const lines = canonicalTypesMatch[1].trim().split('\n');
    for (const line of lines) {
      // Match: - `CanonicalName` (`Variant1`, `Variant2`): `FlatName1`, `FlatName2`
      // OR:    - `CanonicalName`: `FlatName1`, `FlatName2`
      const withVariantMatch = line.match(/^- `([^`]+)`\s+\(([^)]+)\):\s*(.+)$/);
      const withoutVariantMatch = line.match(/^- `([^`]+)`:\s*(.+)$/);

      let canonicalName: string;
      let flatNamesStr: string;
      let variants: string[] = [];

      if (withVariantMatch) {
        canonicalName = withVariantMatch[1];
        // Extract variants from parentheses
        const variantStr = withVariantMatch[2];
        const variantMatches = variantStr.match(/`([^`]+)`/g);
        variants = variantMatches ? variantMatches.map((v) => v.slice(1, -1)) : [];
        flatNamesStr = withVariantMatch[3];
      } else if (withoutVariantMatch) {
        canonicalName = withoutVariantMatch[1];
        flatNamesStr = withoutVariantMatch[2];
        // No variant annotation - applies to all variants
      } else {
        continue;
      }

      // Extract all flat names
      const flatNameMatches = flatNamesStr.match(/`([^`]+)`/g);
      const flatNames = flatNameMatches ? flatNameMatches.map((v) => v.slice(1, -1)) : [];

      // Build typeNameMap (flat name -> canonical name)
      for (const flatName of flatNames) {
        typeNameMap[flatName] = canonicalName;
      }

      // Build variantTypeNameMapKeys (variant -> list of keys)
      // If no variants specified, we don't track variant-specific keys
      if (variants.length > 0) {
        for (const variant of variants) {
          if (!variantTypeNameMapKeys[variant]) {
            variantTypeNameMapKeys[variant] = [];
          }
          for (const flatName of flatNames) {
            variantTypeNameMapKeys[variant].push(flatName);
          }
        }
      }
    }
    // Only keep variantTypeNameMapKeys if we found entries
    if (Object.keys(variantTypeNameMapKeys).length === 0) {
      variantTypeNameMapKeys = null;
    }
  }

  // Legacy: Also try parsing JSON comments for backward compatibility
  if (!variantTypes) {
    const variantTypesMatch = content.match(/\[\/\/\]: # 'variantTypes: (.+)'/);
    if (variantTypesMatch) {
      try {
        variantTypes = JSON.parse(variantTypesMatch[1]) as Record<string, string[]>;
      } catch {
        // Ignore parse errors
      }
    }
  }

  if (!variantTypeNameMapKeys) {
    const variantTypeNameMapKeysMatch = content.match(/\[\/\/\]: # 'variantTypeNameMapKeys: (.+)'/);
    if (variantTypeNameMapKeysMatch) {
      try {
        variantTypeNameMapKeys = JSON.parse(variantTypeNameMapKeysMatch[1]) as Record<
          string,
          string[]
        >;
      } catch {
        // Ignore parse errors
      }
    }
  }

  if (Object.keys(typeNameMap).length === 0) {
    const typeNameMapMatch = content.match(/\[\/\/\]: # 'typeNameMap: (.+)'/);
    if (typeNameMapMatch) {
      try {
        const parsed = JSON.parse(typeNameMapMatch[1]) as Record<string, string>;
        Object.assign(typeNameMap, parsed);
      } catch {
        // Ignore parse errors
      }
    }
  }

  // Convert all description mdast nodes to HAST in parallel
  await convertDescriptions(descriptionTargets);

  // Build a map from type name to TypesMeta for quick lookup
  const typesByName = new Map<string, TypesMeta>();
  for (const typeMeta of allTypes) {
    typesByName.set(typeMeta.name, typeMeta);
  }

  // Reconstruct variantData from the parsed metadata
  let variantData: Record<string, VariantData>;

  if (variantTypes) {
    // Reconstruct variantData from the embedded metadata
    variantData = {};
    for (const [variantName, typeNames] of Object.entries(variantTypes)) {
      const types = typeNames
        .map((name) => {
          // Try exact match first
          const exact = typesByName.get(name);
          if (exact) {
            return exact;
          }
          // If the name is dotted (e.g. "Component.Root"), try the last part ("Root")
          // since H3 headings in the markdown may use the short name
          const dotIndex = name.lastIndexOf('.');
          if (dotIndex > 0) {
            return typesByName.get(name.slice(dotIndex + 1));
          }
          return undefined;
        })
        .filter((t): t is TypesMeta => t !== undefined);

      // Derive per-variant typeNameMap by filtering the merged typeNameMap using the keys
      let variantTypeNameMap: Record<string, string> | undefined;
      const keys = variantTypeNameMapKeys?.[variantName];
      if (keys && keys.length > 0) {
        variantTypeNameMap = {};
        for (const key of keys) {
          if (key in typeNameMap) {
            variantTypeNameMap[key] = typeNameMap[key];
          }
        }
      }

      variantData[variantName] = {
        types,
        typeNameMap: variantTypeNameMap,
      };
    }
  } else {
    // No variant metadata - create a single "Default" variant with all types
    variantData = {
      Default: {
        types: allTypes,
        typeNameMap: Object.keys(typeNameMap).length > 0 ? typeNameMap : undefined,
      },
    };
  }

  // Organize types into exports structure for UI consumption
  const organized = organizeTypesByExport(variantData, typeNameMap);

  return {
    exports: organized.exports,
    additionalTypes: organized.additionalTypes,
    externalTypes,
    typeNameMap,
    variantTypeNameMaps: organized.variantTypeNameMaps,
    variantTypeNames: organized.variantTypeNames,
  };
}
