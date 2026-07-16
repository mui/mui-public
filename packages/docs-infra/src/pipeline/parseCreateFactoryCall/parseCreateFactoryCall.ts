import { parseSync } from 'oxc-parser';
import type { CallExpression } from 'oxc-parser';
import { parseImportsAndComments } from '../loaderUtils';
import type { ImportName, ImportsAndComments } from '../loaderUtils';
import {
  parseFunctionArguments,
  isTypeAssertion,
  isFunction,
  isGeneric,
  isArray,
  isArrowFunction,
  isObjectLiteral,
} from './parseFunctionArguments';
import type { SplitArguments } from './parseFunctionArguments';
import type { Externals } from '../../CodeHighlighter/types';

/**
 * Parse options for create* factory call parsing
 */
export interface ParseOptions {
  /**
   * Only extract metadata (url + options), skipping variant-import resolution.
   * Treats the call as `create*(url, options?)`. Implies {@link ParseOptions.noVariants}.
   */
  metadataOnly?: boolean;
  /**
   * The factory has no variants argument: its call shape is `create*(url, options?)`
   * (e.g. `createStream`), so the argument after `url` is the options
   * object rather than variants. Use this (with `replacePrecomputeValue`) to build
   * a precompute loader for a no-variants factory. Unlike `metadataOnly`, variant
   * resolution is simply not applicable rather than intentionally skipped.
   */
  noVariants?: boolean;
  allowExternalVariants?: boolean;
  allowMultipleFactories?: boolean;
}

export interface FactoryOptions {
  name?: string;
  slug?: string;
  skipPrecompute?: boolean;
  precompute?: any; // Can be true, false, or an object
}

export interface ParsedCreateFactory {
  functionName: string;
  url: string;
  variants: Record<string, string> | undefined;
  namedExports: Record<string, string | undefined> | undefined;
  options: FactoryOptions;
  fullMatch: string;
  hasOptions: boolean;
  externals: Externals;
  // For replacement purposes - positions in the original source code
  argumentsStartIndex: number; // Start position of the arguments (after opening parenthesis)
  argumentsEndIndex: number; // End position of the arguments (before closing parenthesis)
  // Structured data for serialization
  structuredUrl: string;
  structuredVariants: string | SplitArguments | Record<string, string> | undefined;
  structuredOptions?: Record<string, any>;
  // TypeScript generic definitions
  hasGenerics: boolean;
  structuredGenerics?: Record<string, any>; // Parsed generic type definitions
  // Remaining content after the function call
  remaining?: string;
  importsAndComments?: ImportsAndComments;
}

/** Resolved variants alongside the named export each variant maps to. */
interface ResolvedVariants {
  variants: Record<string, string>;
  namedExports: Record<string, string | undefined>;
}

/** Import name lookups keyed by local binding (alias when present). */
interface ImportLookup {
  /** Local name to the resolved module URL. */
  importMap: Map<string, string>;
  /** Local name to its original named export, or undefined for default/namespace imports. */
  namedExportsMap: Map<string, string | undefined>;
}

/** A `create*` factory call located in the source, with the positions needed downstream. */
interface FactoryMatch {
  functionName: string;
  fullMatch: string;
  urlArg: string;
  structuredVariants: string | SplitArguments | Record<string, string> | undefined;
  optionsStructured?: Record<string, any>;
  hasOptions: boolean;
  hasGenerics: boolean;
  structuredGenerics?: Record<string, any>;
  functionStartIndex: number;
  functionEndIndex: number;
  argumentsStartIndex: number;
  argumentsEndIndex: number;
}

/**
 * Helper function to extract string value from parser output, removing quotes if present
 */
function extractStringValue(value: any): string {
  if (typeof value !== 'string') {
    return String(value);
  }

  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'" || quote === '`') && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

/**
 * Convert a structured string to a boolean or number when it reads as one, keeping
 * version-like decimals (e.g. `1.0`) as strings.
 */
function coerceScalar(value: string): string | number | boolean {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  // Simple version patterns (`1.0`, `2.0`) stay strings; other numerics convert.
  if (!/^\d+(\.\d+)?$/.test(value) || /^\d{1,2}\.0$/.test(value)) {
    return value;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}

/**
 * Recursively render structured parser data for user consumption, turning the
 * tuple representations back into readable source-like strings and converting
 * quoted literals to plain values.
 */
function cleanStructuredData(data: any): any {
  const functionCall = isFunction(data);
  if (functionCall) {
    // Function call, e.g. "console.log('test')"
    const argStr = functionCall.arguments.flat().join(', ');
    return `${functionCall.name}(${argStr})`;
  }

  const generic = isGeneric(data);
  if (generic) {
    const genericsStr = generic.generics
      .map((param: any) => (typeof param === 'string' ? param : JSON.stringify(param)))
      .join(', ');
    // Function with generics, e.g. "Component<T>(args)", otherwise a type, e.g. "Component<T>"
    return generic.arguments?.length
      ? `${generic.name}<${genericsStr}>(${generic.arguments.join(', ')})`
      : `${generic.name}<${genericsStr}>`;
  }

  const typeAssertion = isTypeAssertion(data);
  if (typeAssertion) {
    return `${cleanStructuredData(typeAssertion.expression)} as ${typeAssertion.type}`;
  }

  const arrowFunction = isArrowFunction(data);
  if (arrowFunction) {
    const argsStr = arrowFunction.args.join(', ');
    const returnValue = cleanStructuredData(arrowFunction.returnValue);
    if (arrowFunction.types) {
      const [inputType, outputType] = arrowFunction.types;
      return `(${argsStr}: ${inputType}): ${outputType} => ${returnValue}`;
    }
    return `(${argsStr}) => ${returnValue}`;
  }

  const arrayLiteral = isArray(data);
  if (arrayLiteral) {
    return arrayLiteral.items[0].map(cleanStructuredData);
  }

  const objectLiteral = isObjectLiteral(data);
  if (objectLiteral) {
    return Object.fromEntries(
      Object.entries(objectLiteral.properties).map(([key, value]) => [
        key,
        cleanStructuredData(value),
      ]),
    );
  }

  if (typeof data === 'string') {
    return coerceScalar(extractStringValue(data));
  }

  // Fallbacks for values that match no structured pattern.
  if (Array.isArray(data)) {
    return data.map(cleanStructuredData);
  }
  if (data && typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, cleanStructuredData(value)]),
    );
  }

  return data;
}

/** Strip a trailing `as` assertion and a leading `typeof` from an expression. */
function stripTypeSyntax(expression: string): string {
  let result = expression.trim();

  const asIndex = result.indexOf(' as ');
  if (asIndex !== -1) {
    result = result.substring(0, asIndex).trim();
  }
  if (result.startsWith('typeof ')) {
    result = result.substring(7).trim();
  }

  return result;
}

/**
 * Resolve the local import name a structured variants value refers to, e.g.
 * `['as', 'React.FC<Props>', 'Component']` and `Component as React.FC<Props>`
 * both resolve to `Component`.
 */
function variantImportName(value: any): string {
  const typeAssertion = isTypeAssertion(value);
  if (typeAssertion) {
    return String(typeAssertion.expression);
  }

  if (typeof value === 'string') {
    return stripTypeSyntax(value);
  }

  // Function calls and generics carry the component in their name slot.
  const named = isFunction(value) || isGeneric(value);
  if (named) {
    return named.name;
  }

  const arrayLiteral = isArray(value);
  if (arrayLiteral) {
    return String(arrayLiteral.items[0]);
  }

  // Unrecognized structures fall back to their first element.
  const fallback = Array.isArray(value) && value.length > 0 ? value[0] : value;
  return stripTypeSyntax(String(fallback));
}

/** Look up a variant's import, throwing the shared error when it is not imported. */
function resolveVariant(
  target: ResolvedVariants,
  key: string,
  importName: string,
  { importMap, namedExportsMap }: ImportLookup,
  functionName: string,
  filePath: string,
): void {
  if (!importMap.has(importName)) {
    throw new Error(
      `Invalid variants argument in ${functionName} call in ${filePath}. ` +
        `Component '${importName}' is not imported. Make sure to import it first.`,
    );
  }

  target.variants[key] = importMap.get(importName)!;
  target.namedExports[key] = namedExportsMap.get(importName);
}

/**
 * Resolves a variants argument (object, list or single identifier) to the URLs of
 * the components it names, using pre-parsed structured data.
 */
function parseVariantsArgumentFromStructured(
  structuredVariants: string | SplitArguments | Record<string, string>,
  lookup: ImportLookup,
  functionName: string,
  filePath: string,
): ResolvedVariants {
  const resolved: ResolvedVariants = { variants: {}, namedExports: {} };

  // Single identifier, e.g. `createDemo(url, Component)`, optionally with a type
  // assertion, e.g. `createDemo(url, Component as React.FC)`. The assertion parses
  // into an `['as', type, expression]` tuple, so it is matched before plain lists.
  if (typeof structuredVariants === 'string' || isTypeAssertion(structuredVariants)) {
    const componentName = variantImportName(structuredVariants);
    resolveVariant(resolved, 'Default', componentName, lookup, functionName, filePath);
    return resolved;
  }

  // List of components, e.g. `createDemo(url, [ComponentA, ComponentB])`, keyed by name.
  if (Array.isArray(structuredVariants)) {
    for (const item of structuredVariants) {
      if (typeof item === 'string') {
        const importName = item.trim();
        resolveVariant(resolved, importName, importName, lookup, functionName, filePath);
      }
    }
    return resolved;
  }

  // Object mapping variant names to components.
  if (typeof structuredVariants === 'object' && structuredVariants !== null) {
    for (const [key, value] of Object.entries(structuredVariants)) {
      resolveVariant(resolved, key, variantImportName(value), lookup, functionName, filePath);
    }
    return resolved;
  }

  throw new Error(
    `Unexpected structured variants format in ${functionName} call in ${filePath}. ` +
      `Expected string, array, or object but got: ${typeof structuredVariants}`,
  );
}

/**
 * Build the local-name lookups for every import that may supply a variant.
 * External packages are only included when `allowExternalVariants` is set.
 */
function buildImportLookup(
  importResult: ImportsAndComments,
  allowExternalVariants?: boolean,
): ImportLookup {
  const importMap = new Map<string, string>();
  const namedExportsMap = new Map<string, string | undefined>();

  const addNames = (url: string, names: ImportName[]) => {
    names.forEach(({ name, alias, type }) => {
      const localName = alias || name;
      importMap.set(localName, url);
      // Only named imports map back to a specific export.
      namedExportsMap.set(localName, type === 'named' ? name : undefined);
    });
  };

  Object.values(importResult.relative).forEach(({ url, names }) => addNames(url, names));

  if (allowExternalVariants) {
    Object.entries(importResult.externals).forEach(([modulePath, externalImport]) => {
      if (externalImport?.names) {
        addNames(modulePath, externalImport.names);
      }
    });
  }

  return { importMap, namedExportsMap };
}

/**
 * Parse TypeScript generic definitions to extract variants mapping
 * e.g., "{ VariantA: ComponentA, VariantB: ComponentB }" -> { VariantA: "ComponentA", VariantB: "ComponentB" }
 * e.g., "Component" -> { Default: "Component" }
 */
function parseGenericDefinitions(genericContent: string): Record<string, any> {
  if (!genericContent.trim()) {
    return {};
  }

  const parsed = parseFunctionArguments(genericContent);

  if (parsed.length === 1) {
    const [only] = parsed;
    // A single object literal is already the variants mapping.
    if (typeof only === 'object' && !Array.isArray(only)) {
      return only as Record<string, any>;
    }
    // A single component becomes the default variant.
    if (typeof only === 'string') {
      return { Default: only };
    }
    return {};
  }

  // Multiple generics: merge objects and index bare components.
  const result: Record<string, any> = {};
  parsed.forEach((item, index) => {
    if (typeof item === 'string') {
      result[`Variant${index + 1}`] = item;
    } else if (typeof item === 'object' && item !== null) {
      Object.assign(result, item);
    }
  });
  return result;
}

/**
 * Validates that a URL argument follows the expected convention
 */
function validateUrlArgument(url: string, functionName: string, filePath: string): void {
  // Only accept import.meta.url
  if (url.trim() !== 'import.meta.url') {
    throw new Error(
      `Invalid URL argument in ${functionName} call in ${filePath}. ` +
        `Expected 'import.meta.url' but got: ${url.trim()}`,
    );
  }
}

/**
 * Validates that a variants argument is either an object mapping to imports or a single identifier
 */
function validateVariantsArgument(
  structuredVariants: string | SplitArguments | Record<string, string>,
  functionName: string,
  filePath: string,
): void {
  if (!structuredVariants) {
    throw new Error(
      `Invalid variants argument in ${functionName} call in ${filePath}. ` +
        `Expected an object mapping variant names to imports or a single component identifier.`,
    );
  }

  if (typeof structuredVariants === 'string') {
    const trimmed = structuredVariants.trim();
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) {
      throw new Error(
        `Invalid variants argument in ${functionName} call in ${filePath}. ` +
          `Expected a valid component identifier, but got: "${trimmed}"`,
      );
    }
    return;
  }

  // Arrays (structured literals) and objects (key-value pairs) are both valid shapes.
  if (typeof structuredVariants !== 'object') {
    throw new Error(
      `Invalid variants argument in ${functionName} call in ${filePath}. ` +
        `Expected an object mapping variant names to imports or a single component identifier, but got: ${typeof structuredVariants}`,
    );
  }
}

/**
 * Parses a file to extract a single create* factory call and its variants and options
 * Returns the parsed result with remaining content included
 * Returns null if no create* call is found
 */
export async function parseCreateFactoryCall(
  code: string,
  filePath: string,
  parseOptions: ParseOptions = {},
  importsAndComments?: ImportsAndComments,
): Promise<ParsedCreateFactory | null> {
  const match = findFirstCreateFactoryCall(code, filePath, parseOptions);

  if (!match) {
    return null;
  }

  if (!parseOptions.allowMultipleFactories) {
    const secondMatch = findFirstCreateFactoryCall(
      code,
      filePath,
      parseOptions,
      match.functionEndIndex + 1,
    );
    if (secondMatch) {
      throw new Error(
        `Multiple create* factory calls found in ${filePath}. Only one create* call per file is supported. Found 2 calls.`,
      );
    }
  }

  const imports = importsAndComments || parseImportsAndComments(code, filePath);
  const parsed = await processCreateFactoryMatch(match, filePath, parseOptions, imports);

  return {
    ...parsed,
    remaining: code.substring(match.functionEndIndex + 1),
    importsAndComments: imports, // Include import data for reuse
  };
}

/**
 * Parses all create* factory calls in a file sequentially
 * Returns a record of export names mapped to their parsed factory calls
 */
export async function parseAllCreateFactoryCalls(
  code: string,
  filePath: string,
  parseOptions: Omit<ParseOptions, 'allowMultipleFactories'> = {},
): Promise<Record<string, ParsedCreateFactory>> {
  const results: Record<string, ParsedCreateFactory> = {};
  let importsAndComments: ImportsAndComments | undefined;
  let searchIndex = 0;

  while (searchIndex < code.length) {
    const match = findFirstCreateFactoryCall(code, filePath, parseOptions, searchIndex);

    if (!match) {
      break;
    }

    const beforeMatch = code.substring(0, match.functionStartIndex);
    const exportMatch = beforeMatch.match(/export\s+const\s+(\w+)\s*=\s*$/m);
    const exportName = exportMatch?.[1] || 'unknown';

    importsAndComments = importsAndComments || parseImportsAndComments(code, filePath);

    // eslint-disable-next-line no-await-in-loop
    results[exportName] = await processCreateFactoryMatch(
      match,
      filePath,
      parseOptions,
      importsAndComments,
    );

    searchIndex = match.functionEndIndex + 1;
  }

  return results;
}

/**
 * Processes a matched create* factory call into a ParsedCreateFactory object
 * Handles all the common logic for validation, parsing, and transformation
 */
async function processCreateFactoryMatch(
  match: FactoryMatch,
  filePath: string,
  parseOptions: ParseOptions,
  importsAndComments: ImportsAndComments,
): Promise<ParsedCreateFactory> {
  const {
    functionName,
    fullMatch,
    urlArg,
    structuredVariants,
    optionsStructured,
    hasOptions,
    hasGenerics,
    structuredGenerics,
    argumentsStartIndex,
    argumentsEndIndex,
  } = match;

  const lookup = buildImportLookup(importsAndComments, parseOptions.allowExternalVariants);

  validateUrlArgument(urlArg, functionName, filePath);

  const { metadataOnly = false, noVariants = false } = parseOptions;
  const skipVariants = metadataOnly || noVariants;

  // Resolve variants from the variants argument, falling back to the generics when
  // the call carries no variants argument (e.g. `createDemo<{ A: Component }>(url)`).
  let resolved: ResolvedVariants | undefined;
  if (!skipVariants) {
    if (structuredVariants !== undefined) {
      validateVariantsArgument(structuredVariants, functionName, filePath);
      resolved = parseVariantsArgumentFromStructured(
        structuredVariants,
        lookup,
        functionName,
        filePath,
      );
    } else if (hasGenerics && structuredGenerics && Object.keys(structuredGenerics).length > 0) {
      resolved = parseVariantsArgumentFromStructured(
        structuredGenerics,
        lookup,
        functionName,
        filePath,
      );
    }
  }

  // Start from every option in the structured data, then refine the known fields.
  const options: FactoryOptions =
    optionsStructured && typeof optionsStructured === 'object'
      ? cleanStructuredData(optionsStructured)
      : {};

  if (optionsStructured && typeof optionsStructured === 'object') {
    if ('name' in optionsStructured) {
      options.name = extractStringValue(optionsStructured.name);
    }
    if ('slug' in optionsStructured) {
      options.slug = extractStringValue(optionsStructured.slug);
    }
    if ('skipPrecompute' in optionsStructured) {
      const value = optionsStructured.skipPrecompute;
      if (value === 'true' || value === true) {
        options.skipPrecompute = true;
      } else if (value === 'false' || value === false) {
        options.skipPrecompute = false;
      }
    }
    if ('precompute' in optionsStructured) {
      options.precompute = cleanStructuredData(optionsStructured.precompute);
    }
  }

  // Only side-effect imports (those with no names) are surfaced as externals.
  const transformedExternals: Externals = {};
  for (const [modulePath, externalImport] of Object.entries(importsAndComments.externals)) {
    if (externalImport.names.length === 0) {
      transformedExternals[modulePath] = [];
    }
  }

  return {
    functionName,
    url: urlArg.trim(),
    variants: resolved?.variants,
    namedExports: resolved?.namedExports,
    options,
    fullMatch,
    hasOptions,
    externals: transformedExternals,
    argumentsStartIndex,
    argumentsEndIndex,
    // Structured data keeps quotes so serialization can round-trip the source.
    structuredUrl: urlArg,
    structuredVariants,
    structuredOptions: optionsStructured,
    hasGenerics,
    structuredGenerics,
  };
}

/** A located `create*` factory call with the source positions needed downstream. */
interface FactoryCandidate {
  name: string;
  calleeStart: number;
  /** Position to start scanning for the opening parenthesis. */
  scanFrom: number;
  /** Content range between the generic angle brackets, if present. */
  genericRange?: [number, number];
  /** End of the call, just past the closing parenthesis. */
  end: number;
}

/**
 * Recursively collect all `create*(...)` factory calls in an AST subtree.
 *
 * Besides plain call expressions this also recognizes the comparison-chain shape
 * `(create* < {...}) > (args)` that generics containing expression-only syntax
 * (like `as` assertions) parse into.
 */
function collectCreateFactoryCalls(
  node: unknown,
  code: string,
  candidates: FactoryCandidate[],
): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectCreateFactoryCalls(item, code, candidates);
    }
    return;
  }

  if (node === null || typeof node !== 'object') {
    return;
  }

  const record = node as Record<string, unknown>;
  if (typeof record.type !== 'string') {
    return;
  }

  if (record.type === 'CallExpression') {
    const call = node as CallExpression;
    if (
      call.callee.type === 'Identifier' &&
      call.callee.name.startsWith('create') &&
      !call.optional
    ) {
      candidates.push({
        name: call.callee.name,
        calleeStart: call.callee.start,
        scanFrom: call.typeArguments?.end ?? call.callee.end,
        genericRange: call.typeArguments
          ? [call.typeArguments.start + 1, call.typeArguments.end - 1]
          : undefined,
        end: call.end,
      });
    }
  } else if (record.type === 'BinaryExpression') {
    const binary = node as {
      operator: string;
      left: { type: string; operator?: string; left?: any; right?: any };
      right: { type: string; start: number; end: number };
      end: number;
    };
    if (
      binary.operator === '>' &&
      binary.left.type === 'BinaryExpression' &&
      binary.left.operator === '<' &&
      binary.left.left?.type === 'Identifier' &&
      binary.left.left.name.startsWith('create') &&
      binary.right.type === 'ParenthesizedExpression'
    ) {
      const angleStart = code.indexOf('<', binary.left.left.end);
      const angleEnd = code.indexOf('>', binary.left.right.end);
      if (angleStart !== -1 && angleEnd !== -1) {
        candidates.push({
          name: binary.left.left.name,
          calleeStart: binary.left.left.start,
          scanFrom: angleEnd + 1,
          genericRange: [angleStart + 1, angleEnd],
          end: binary.end,
        });
      }
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (key !== 'type' && typeof value === 'object') {
      collectCreateFactoryCalls(value, code, candidates);
    }
  }
}

/**
 * Parse the code with oxc and return all `create*(...)` calls in source order.
 */
function parseCreateFactoryCandidates(code: string, filePath: string): FactoryCandidate[] {
  // Use the real file name when it carries a JS/TS extension so oxc picks the right dialect.
  const filename = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(filePath) ? filePath : 'file.tsx';
  const parsed = parseSync(filename, code);
  const candidates: FactoryCandidate[] = [];
  collectCreateFactoryCalls(parsed.program.body, code, candidates);
  return candidates.sort((a, b) => a.calleeStart - b.calleeStart);
}

/** Options must be an object literal; identifiers and other expressions are rejected. */
function validateOptionsArgument(
  optionsStructured: unknown,
  functionName: string,
  filePath: string,
): void {
  if (typeof optionsStructured === 'object' && optionsStructured !== null) {
    return;
  }

  throw new Error(
    `Invalid options argument in ${functionName} call in ${filePath}. ` +
      `Expected an object but got: ${typeof optionsStructured === 'string' ? optionsStructured : JSON.stringify(optionsStructured)}`,
  );
}

/** Narrow a structured argument to an options record, or undefined when it is not one. */
function asOptionsRecord(value: unknown): Record<string, any> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, any>) : undefined;
}

/**
 * Finds the first create* factory call in code, starting from a given index
 * Returns null if no create* call is found
 */
function findFirstCreateFactoryCall(
  code: string,
  filePath: string,
  parseOptions: ParseOptions = {},
  startIndex: number = 0,
): FactoryMatch | null {
  const candidates = parseCreateFactoryCandidates(code, filePath);

  let call: FactoryCandidate | undefined;
  let parenIndex = -1;
  for (const candidate of candidates) {
    if (candidate.calleeStart < startIndex) {
      continue;
    }
    // Require the opening parenthesis to directly follow the callee (or its type
    // arguments) with only whitespace in between.
    let currentIndex = candidate.scanFrom;
    while (currentIndex < code.length && /\s/.test(code[currentIndex])) {
      currentIndex += 1;
    }
    if (code[currentIndex] === '(') {
      call = candidate;
      parenIndex = currentIndex;
      break;
    }
  }

  if (!call) {
    return null;
  }

  const functionName = call.name;
  const endIndex = call.end - 1;
  const hasGenerics = Boolean(call.genericRange);
  const structuredGenerics = call.genericRange
    ? parseGenericDefinitions(code.substring(call.genericRange[0], call.genericRange[1]))
    : undefined;

  const structured = parseFunctionArguments(code.substring(parenIndex + 1, endIndex));
  const { metadataOnly = false, noVariants = false } = parseOptions;
  const skipVariants = metadataOnly || noVariants;

  if (skipVariants) {
    // No variants argument: expect (url, options?)
    if (structured.length < 1 || structured.length > 2) {
      throw new Error(
        `Invalid ${functionName} call in ${filePath}. ` +
          `Expected 1-2 arguments (url, options?) but got ${structured.length} arguments. ` +
          `For a no-variants factory, calls should follow: create*(url, options?)`,
      );
    }
  } else if (hasGenerics && structured.length <= 2) {
    // Generics supply the variants: expect (url, options?)
    if (structured.length < 1) {
      throw new Error(
        `Invalid ${functionName} call in ${filePath}. ` +
          `Expected 1-2 arguments (url, options?) but got ${structured.length} arguments. ` +
          `Functions with TypeScript generics should follow: create*<variants>(url, options?)`,
      );
    }
  } else if (!hasGenerics && (structured.length < 2 || structured.length > 3)) {
    // Normal mode: expect (url, variants, options?)
    throw new Error(
      `Invalid ${functionName} call in ${filePath}. ` +
        `Expected 2-3 arguments (url, variants, options?) but got ${structured.length} arguments. ` +
        `Functions starting with 'create' must follow the convention: create*(url, variants, options?)`,
    );
  }

  const [urlArg, secondArg, thirdArg] = structured;
  let structuredVariants: FactoryMatch['structuredVariants'];
  let optionsStructured: Record<string, any> | undefined;
  let hasOptions = false;

  if (skipVariants) {
    // (url, options?) — generics still describe the variants for serialization.
    structuredVariants = hasGenerics ? structuredGenerics : undefined;
    if (structured.length === 2) {
      validateOptionsArgument(secondArg, functionName, filePath);
      optionsStructured = asOptionsRecord(secondArg);
      hasOptions = true;
    }
  } else if (hasGenerics) {
    // (url, options?) with generics as variants, or an explicit (url, variants, options).
    if (structured.length === 2) {
      optionsStructured = asOptionsRecord(secondArg);
      hasOptions = true;
    } else if (structured.length === 3) {
      validateOptionsArgument(thirdArg, functionName, filePath);
      structuredVariants = secondArg;
      optionsStructured = asOptionsRecord(thirdArg);
      hasOptions = true;
    }
  } else {
    // (url, variants, options?)
    structuredVariants = secondArg;
    if (structured.length === 3) {
      validateOptionsArgument(thirdArg, functionName, filePath);
      optionsStructured = asOptionsRecord(thirdArg);
      hasOptions = true;
    }
  }

  return {
    functionName,
    fullMatch: code.substring(call.calleeStart, endIndex + 1),
    urlArg: typeof urlArg === 'string' ? urlArg.trim() : String(urlArg),
    structuredVariants,
    optionsStructured,
    hasOptions,
    hasGenerics,
    structuredGenerics,
    functionStartIndex: call.calleeStart,
    functionEndIndex: endIndex,
    argumentsStartIndex: parenIndex + 1,
    argumentsEndIndex: endIndex,
  };
}
