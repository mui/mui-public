import { parseImports, type ParseImportsResult } from '../loaderUtils';
import {
  parseFunctionArguments,
  type SplitArguments,
  isTypeAssertion,
  isFunction,
  isGeneric,
  isArray,
  isArrowFunction,
  isObjectLiteral,
} from './parseFunctionArguments';
import type { Externals } from '../../CodeHighlighter/types';

/**
 * Parse options for create* factory call parsing
 */
export interface ParseOptions {
  metadataOnly?: boolean;
  allowExternalVariants?: boolean;
  allowMultipleFactories?: boolean;
}

/**
 * Helper function to extract string value from parser output, removing quotes if present
 */
function extractStringValue(value: any): string {
  if (typeof value !== 'string') {
    return String(value);
  }

  // Remove surrounding quotes if present
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  // Handle template literals
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

/**
 * Helper function to recursively clean up structured data from parser for user consumption,
 * removing quotes from strings and converting basic types
 */
function cleanStructuredData(data: any): any {
  // Check all structured data types first using the parser helpers

  // Check for function calls
  const functionCall = isFunction(data);
  if (functionCall) {
    // Build a function call string like "console.log('test')"
    const argStr = functionCall.arguments
      .map((arg: any) => {
        if (Array.isArray(arg)) {
          return arg.map((a: any) => (typeof a === 'string' ? a : String(a))).join(', ');
        }
        return typeof arg === 'string' ? arg : String(arg);
      })
      .join(', ');
    return `${functionCall.name}(${argStr})`;
  }

  // Check for generic structures
  const generic = isGeneric(data);
  if (generic) {
    // Build a generic string like "Component<{ foo: string }>"
    const genericsStr = generic.generics
      .map((g: any) => (typeof g === 'string' ? g : JSON.stringify(g)))
      .join(', ');
    if (generic.arguments && generic.arguments.length > 0) {
      // Function with generics: Component<T>(args)
      const argsStr = generic.arguments
        .map((p: any) => (typeof p === 'string' ? p : String(p)))
        .join(', ');
      return `${generic.name}<${genericsStr}>(${argsStr})`;
    }
    // Type with generics: Component<T>
    return `${generic.name}<${genericsStr}>`;
  }

  // Check for type assertions
  const typeAssertion = isTypeAssertion(data);
  if (typeAssertion) {
    const cleanedExpression = cleanStructuredData(typeAssertion.expression);
    return `${cleanedExpression} as ${typeAssertion.type}`;
  }

  // Check for arrow functions
  const arrowFunction = isArrowFunction(data);
  if (arrowFunction) {
    const argsStr = arrowFunction.args
      .map((p: any) => (typeof p === 'string' ? p : String(p)))
      .join(', ');

    if (arrowFunction.types) {
      // Typed arrow function
      const [inputType, outputType] = arrowFunction.types;
      const returnValue = cleanStructuredData(arrowFunction.returnValue);
      return `(${argsStr}: ${inputType}): ${outputType} => ${returnValue}`;
    }

    // Simple arrow function
    const returnValue = cleanStructuredData(arrowFunction.returnValue);
    return `(${argsStr}) => ${returnValue}`;
  }

  // Check for literal arrays
  const arrayLiteral = isArray(data);
  if (arrayLiteral) {
    return arrayLiteral.items[0].map(cleanStructuredData);
  }

  // Check for object literals
  const objectLiteral = isObjectLiteral(data);
  if (objectLiteral) {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(objectLiteral.properties)) {
      cleaned[key] = cleanStructuredData(value);
    }
    return cleaned;
  }

  // Handle basic types after structured data checks

  if (typeof data === 'string') {
    // First extract string value (handle quotes)
    const extracted = extractStringValue(data);

    // Then try type conversion
    if (extracted === 'true') {
      return true;
    }
    if (extracted === 'false') {
      return false;
    }

    // Check if it's a number (but be conservative about version strings like "1.0")
    if (/^\d+(\.\d+)?$/.test(extracted)) {
      const num = Number(extracted);
      if (!Number.isNaN(num) && Number.isFinite(num)) {
        // Don't convert simple version-like patterns (e.g., "1.0", "2.0", but convert "123.45")
        if (extracted.includes('.')) {
          // For decimals, only convert if it's not a simple version pattern
          // Version patterns are typically single digit followed by .0 or simple patterns
          if (!/^\d{1,2}\.0$/.test(extracted)) {
            return num;
          }
        } else {
          // Convert all integers
          return num;
        }
      }
    }

    return extracted;
  }

  if (Array.isArray(data)) {
    // Fallback for arrays that don't match structured patterns
    return data.map(cleanStructuredData);
  }

  if (data && typeof data === 'object') {
    // Fallback for objects that don't match structured patterns
    const cleaned: any = {};
    for (const [key, value] of Object.entries(data)) {
      cleaned[key] = cleanStructuredData(value);
    }
    return cleaned;
  }

  return data;
}

/**
 * Helper function to con    );
  }

  // Throw error if the identifier is not found in imports
  throw new Error(
    `Invalid variants arguments in ${functionName} call in ${filePath}. ` +
      `Component '${typeof structuredVariants === 'string' ? structuredVariants : JSON.stringify(structuredVariants)}' is not imported. Make sure to import it first.`,
  );
}

/**
 * Parse variants from object representation (new format)
 */
function parseVariantsObjectFromObject(
  obj: Record<string, any>,
  importMap: Map<string, string>,
  namedExportsMap: Map<string, string | undefined>,
  functionName: string,
  filePath: string,
): { variants: Record<string, string>; namedExports: Record<string, string | undefined> } {
  const demoImports: Record<string, string> = {};
  const namedExports: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Handle both string values and structured values (arrays for TypeScript generics)
    let importName: string;

    // Use type discriminators to determine the structure type
    const typeAssertion = isTypeAssertion(value);
    if (typeAssertion) {
      // This is a structured type assertion: ['as', 'React.FC<Props>', 'Component']
      // Extract the actual component name from the expression
      const { expression } = typeAssertion;
      importName = typeof expression === 'string' ? expression : String(expression);
    } else if (typeof value === 'string') {
      // Simple string value - strip TypeScript type assertions
      const asIndex = value.indexOf(' as ');
      importName = asIndex !== -1 ? value.substring(0, asIndex).trim() : value.trim();
    } else {
      // Handle other structured types (functions, generics, arrays)
      const functionCall = isFunction(value);
      const generic = isGeneric(value);
      const arrayLiteral = isArray(value);

      if (functionCall) {
        // Function call: ['Component', [...]]
        importName = functionCall.name;
      } else if (generic) {
        // Generic: ['Component', [...], [...]]
        importName = generic.name;
      } else if (arrayLiteral) {
        // Array literal: handle first element
        const firstItem = arrayLiteral.items[0];
        importName = typeof firstItem === 'string' ? firstItem : String(firstItem);
      } else if (Array.isArray(value) && value.length > 0) {
        // Fallback for unrecognized array structures
        const componentExpression = String(value[0]);
        const asIndex = componentExpression.indexOf(' as ');
        importName =
          asIndex !== -1
            ? componentExpression.substring(0, asIndex).trim()
            : componentExpression.trim();
      } else {
        // Final fallback - convert to string and extract
        const valueStr = String(value);
        const asIndex = valueStr.indexOf(' as ');
        importName = asIndex !== -1 ? valueStr.substring(0, asIndex).trim() : valueStr.trim();
      }
    }

    if (importMap.has(importName)) {
      demoImports[key] = importMap.get(importName)!;
      namedExports[key] = namedExportsMap.get(importName);
    } else {
      throw new Error(
        `Invalid variants argument in ${functionName} call in ${filePath}. ` +
          `Component '${importName}' is not imported. Make sure to import it first.`,
      );
    }
  }

  return { variants: demoImports, namedExports };
}

/**
 * Helper function to convert the new parseImports format to a Map
 * that maps import names to their resolved paths
 */
function buildImportMap(
  importResult: ParseImportsResult,
  allowExternalVariants?: boolean,
): Map<string, string> {
  const importMap = new Map<string, string>();

  Object.values(importResult.relative).forEach(({ path, names }) => {
    names.forEach(({ name, alias }) => {
      // Use alias if available, otherwise use the original name
      const nameToUse = alias || name;
      importMap.set(nameToUse, path);
    });
  });

  // Include external imports if allowExternalVariants is enabled
  if (allowExternalVariants) {
    Object.entries(importResult.externals).forEach(
      ([modulePath, externalImport]: [string, any]) => {
        if (externalImport && externalImport.names) {
          externalImport.names.forEach(
            ({ name, alias }: { name: string; alias?: string; type: string }) => {
              // Use alias if available, otherwise use the original name
              const nameToUse = alias || name;
              importMap.set(nameToUse, modulePath);
            },
          );
        }
      },
    );
  }

  return importMap;
}

/**
 * Helper function to build a mapping from import aliases to their original named exports
 */
function buildNamedExportsMap(
  importResult: ParseImportsResult,
  allowExternalVariants?: boolean,
): Map<string, string | undefined> {
  const namedExportsMap = new Map<string, string | undefined>();

  Object.values(importResult.relative).forEach(({ names }) => {
    names.forEach(({ name, alias, type }) => {
      // Use alias if available, otherwise use the original name as key
      const nameToUse = alias || name;

      // Only map to the original export name for named imports
      // Default imports should map to undefined since they don't have a specific named export
      if (type === 'named') {
        namedExportsMap.set(nameToUse, name);
      } else {
        namedExportsMap.set(nameToUse, undefined); // undefined for default/namespace imports
      }
    });
  });

  // Include external imports if allowExternalVariants is enabled
  if (allowExternalVariants) {
    Object.entries(importResult.externals).forEach(([, externalImport]: [string, any]) => {
      if (externalImport && externalImport.names) {
        externalImport.names.forEach(
          ({ name, alias, type }: { name: string; alias?: string; type: string }) => {
            // Use alias if available, otherwise use the original name as key
            const nameToUse = alias || name;

            // Only map to the original export name for named imports
            // Default imports should map to undefined since they don't have a specific named export
            if (type === 'named') {
              namedExportsMap.set(nameToUse, name);
            } else {
              namedExportsMap.set(nameToUse, undefined); // undefined for default/namespace imports
            }
          },
        );
      }
    });
  }

  return namedExportsMap;
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
  // Remaining content after the function call
  remaining?: string;
  parseImportsResult?: ParseImportsResult;
}

/**
 * Parses a variants object using pre-parsed structured data
 */
function parseVariantsObjectFromStructured(
  structuredData: SplitArguments,
  importMap: Map<string, string>,
  namedExportsMap: Map<string, string | undefined>,
  functionName: string,
  filePath: string,
): { variants: Record<string, string>; namedExports: Record<string, string | undefined> } {
  const demoImports: Record<string, string> = {};
  const namedExports: Record<string, string | undefined> = {};

  for (const item of structuredData) {
    // If it's a string, process it directly
    if (typeof item === 'string') {
      const trimmedPart = item.trim();

      // Check if this part contains a colon (key: value syntax)
      const colonIndex = trimmedPart.indexOf(':');

      if (colonIndex !== -1) {
        // Handle "key: value" syntax
        const key = trimmedPart.substring(0, colonIndex).trim();
        const valueExpression = trimmedPart.substring(colonIndex + 1).trim();

        // Strip TypeScript type assertions (e.g., "Component as React.ComponentType<...>" -> "Component")
        const asIndex = valueExpression.indexOf(' as ');
        const importName =
          asIndex !== -1 ? valueExpression.substring(0, asIndex).trim() : valueExpression;

        if (importMap.has(importName)) {
          demoImports[key] = importMap.get(importName)!;
          namedExports[key] = namedExportsMap.get(importName);
        } else {
          throw new Error(
            `Invalid variants argument in ${functionName} call in ${filePath}. ` +
              `Component '${importName}' is not imported. Make sure to import it first.`,
          );
        }
      } else {
        // Handle shorthand syntax (just the component name)
        const importName = trimmedPart;

        if (importMap.has(importName)) {
          demoImports[importName] = importMap.get(importName)!;
          namedExports[importName] = namedExportsMap.get(importName);
        } else {
          throw new Error(
            `Invalid variants argument in ${functionName} call in ${filePath}. ` +
              `Component '${importName}' is not imported. Make sure to import it first.`,
          );
        }
      }
    }
    // If it's an array (nested structure), we don't expect this in variants parsing
    // but we could handle it if needed in the future
  }

  return { variants: demoImports, namedExports };
}

/**
 * Parses variants argument using pre-parsed structured data
 */
function parseVariantsArgumentFromStructured(
  structuredVariants: string | SplitArguments | Record<string, string>,
  importMap: Map<string, string>,
  namedExportsMap: Map<string, string | undefined>,
  functionName: string,
  filePath: string,
): { variants: Record<string, string>; namedExports: Record<string, string | undefined> } {
  // If it's an object (Record<string, string>)
  if (typeof structuredVariants === 'object' && !Array.isArray(structuredVariants)) {
    // We have an object with key-value pairs
    return parseVariantsObjectFromObject(
      structuredVariants,
      importMap,
      namedExportsMap,
      functionName,
      filePath,
    );
  }

  // If it's an array (object literal parsed into structured data)
  if (Array.isArray(structuredVariants)) {
    // Parse the object contents using structured data
    return parseVariantsObjectFromStructured(
      structuredVariants,
      importMap,
      namedExportsMap,
      functionName,
      filePath,
    );
  }

  // If it's a single identifier string
  if (typeof structuredVariants === 'string') {
    const componentName = structuredVariants.trim();
    if (importMap.has(componentName)) {
      return {
        variants: {
          Default: importMap.get(componentName)!,
        },
        namedExports: {
          Default: namedExportsMap.get(componentName),
        },
      };
    }

    // Throw error if the identifier is not found in imports
    throw new Error(
      `Invalid variants argument in ${functionName} call in ${filePath}. ` +
        `Component '${componentName}' is not imported. Make sure to import it first.`,
    );
  }

  // If we reach here, the structured data format is unexpected
  throw new Error(
    `Unexpected structured variants format in ${functionName} call in ${filePath}. ` +
      `Expected string, array, or object but got: ${typeof structuredVariants}`,
  );
}

/**
 * Validates that a URL argument follows the expected convention
 */
function validateUrlArgument(url: string, functionName: string, filePath: string): void {
  const trimmedUrl = url.trim();

  // Only accept import.meta.url
  if (trimmedUrl === 'import.meta.url') {
    return;
  }

  // For error messages, show the argument as parsed by parseFunctionArguments
  // Simple string literals preserve their quotes, complex expressions are shown as parsed
  const errorUrl = trimmedUrl;

  throw new Error(
    `Invalid URL argument in ${functionName} call in ${filePath}. ` +
      `Expected 'import.meta.url' but got: ${errorUrl}`,
  );
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

  // Check if it's a valid single identifier (string)
  if (typeof structuredVariants === 'string') {
    const trimmed = structuredVariants.trim();
    if (!trimmed || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) {
      throw new Error(
        `Invalid variants argument in ${functionName} call in ${filePath}. ` +
          `Expected a valid component identifier, but got: "${trimmed}"`,
      );
    }
    return; // Valid identifier
  }

  // Check if it's an array (object literal structure) or object (parsed key-value pairs)
  if (
    Array.isArray(structuredVariants) ||
    (typeof structuredVariants === 'object' && structuredVariants !== null)
  ) {
    return; // Valid object structure
  }

  throw new Error(
    `Invalid variants argument in ${functionName} call in ${filePath}. ` +
      `Expected an object mapping variant names to imports or a single component identifier, but got: ${typeof structuredVariants}`,
  );
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
  parseImportsResult?: ParseImportsResult,
): Promise<(ParsedCreateFactory & { parseImportsResult?: ParseImportsResult }) | null> {
  // Find all create* calls in the code
  const createFactoryMatches = findCreateFactoryCalls(code, filePath, parseOptions);

  // Enforce single create* call per file unless allowMultipleFactories is true
  if (!parseOptions.allowMultipleFactories && createFactoryMatches.length > 1) {
    throw new Error(
      `Multiple create* factory calls found in ${filePath}. Only one create* call per file is supported. Found ${createFactoryMatches.length} calls.`,
    );
  }

  // Return null if no create* call found
  if (createFactoryMatches.length === 0) {
    return null;
  }

  const match = createFactoryMatches[0];
  const {
    functionName,
    fullMatch,
    urlArg,
    structuredVariants,
    optionsStructured,
    hasOptions,
    argumentsStartIndex,
    argumentsEndIndex,
  } = match;

  // Get import mappings from precomputed imports or parse them
  parseImportsResult = parseImportsResult || (await parseImports(code, filePath));

  const allowExternalVariants = parseOptions.allowExternalVariants || false;
  const importMap = buildImportMap(parseImportsResult, allowExternalVariants);
  const namedExportsMap = buildNamedExportsMap(parseImportsResult, allowExternalVariants);
  const externals = parseImportsResult.externals;

  // Validate URL argument
  validateUrlArgument(urlArg, functionName, filePath);

  // Validate variants argument (skip in metadata-only mode)
  const { metadataOnly = false } = parseOptions;
  if (!metadataOnly && structuredVariants !== undefined) {
    validateVariantsArgument(structuredVariants, functionName, filePath);
  }

  // Extract URL (typically import.meta.url)
  const url = urlArg.trim();

  // Resolve variants using structured data (skip in metadata-only mode)
  let variants: Record<string, string> | undefined;
  let namedExports: Record<string, string | undefined> | undefined;

  if (!metadataOnly && structuredVariants !== undefined) {
    const variantsResult = parseVariantsArgumentFromStructured(
      structuredVariants,
      importMap,
      namedExportsMap,
      functionName,
      filePath,
    );
    variants = variantsResult.variants;
    namedExports = variantsResult.namedExports;
  }

  // Parse options object
  // Initialize with all options from structured data, then override specific fields
  const options: FactoryOptions =
    optionsStructured && typeof optionsStructured === 'object'
      ? cleanStructuredData(optionsStructured)
      : {};

  // Override with specific processing for known fields that need special handling
  if (optionsStructured && typeof optionsStructured === 'object') {
    if ('name' in optionsStructured) {
      options.name = extractStringValue(optionsStructured.name);
    }

    if ('slug' in optionsStructured) {
      options.slug = extractStringValue(optionsStructured.slug);
    }

    if ('skipPrecompute' in optionsStructured) {
      const skipPrecomputeValue = optionsStructured.skipPrecompute;
      if (skipPrecomputeValue === 'true' || skipPrecomputeValue === true) {
        options.skipPrecompute = true;
      } else if (skipPrecomputeValue === 'false' || skipPrecomputeValue === false) {
        options.skipPrecompute = false;
      }
    }

    // Handle precompute from structured data - clean for user consumption
    if ('precompute' in optionsStructured) {
      options.precompute = cleanStructuredData(optionsStructured.precompute);
    }
  }

  // Transform externals from parseImports format to simplified format
  // Only include side-effect imports (where names array is empty)
  const transformedExternals: Externals = {};
  for (const [modulePath, externalImport] of Object.entries(externals)) {
    // Only include side-effect imports (empty names array)
    if (externalImport.names.length === 0) {
      transformedExternals[modulePath] = []; // Empty array for side-effect imports
    }
  }

  // Calculate remaining content after the function call
  const remaining = code.substring(match.functionEndIndex + 1);

  const parsed: ParsedCreateFactory = {
    functionName,
    url,
    variants,
    namedExports,
    options,
    fullMatch,
    hasOptions,
    externals: transformedExternals,
    argumentsStartIndex,
    argumentsEndIndex,
    // Add structured data for serialization - this preserves quotes for proper output
    structuredUrl: urlArg,
    structuredVariants,
    structuredOptions: optionsStructured, // Use original structured data, not cleaned options
    remaining,
    parseImportsResult, // Include import data for reuse
  };

  return parsed;
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

  // Process the code sequentially, reusing import data from the first call
  let currentCode = code;
  let parseImportsResult: ParseImportsResult | undefined;

  // Keep processing while there's code remaining
  while (currentCode.trim()) {
    // eslint-disable-next-line no-await-in-loop
    const result = await parseCreateFactoryCall(
      currentCode,
      filePath,
      { ...parseOptions, allowMultipleFactories: true }, // Allow multiple factories for this function
      parseImportsResult, // undefined for first call, reused for subsequent calls
    );

    if (!result) {
      // No create* call found in remaining code
      break;
    }

    // Extract export name from the function call context
    const exportMatch = currentCode.match(/export\s+const\s+(\w+)\s*=/);
    const exportName = exportMatch?.[1] || 'unknown';

    // Capture import data from the first successful call for reuse
    parseImportsResult = result.parseImportsResult || parseImportsResult;

    // Remove the parseImportsResult before storing (we don't need it in the final result)
    const {
      parseImportsResult: unusedResult,
      remaining: unusedRemaining,
      ...parsedFactory
    } = result;
    results[exportName] = parsedFactory;

    // Move to the remaining code after this export
    if (!result.remaining) {
      currentCode = '';
      break; // No remaining code
    }

    currentCode = result.remaining;
  }

  return results;
}

/**
 * Finds create* factory calls in code, handling multiline cases
 */
function findCreateFactoryCalls(
  code: string,
  filePath: string,
  parseOptions: ParseOptions = {},
): Array<{
  functionName: string;
  fullMatch: string;
  urlArg: string;
  structuredVariants: string | SplitArguments | Record<string, string> | undefined;
  optionsStructured?: Record<string, any>;
  hasOptions: boolean;
  // Position information in original source
  functionStartIndex: number;
  functionEndIndex: number;
  argumentsStartIndex: number;
  argumentsEndIndex: number;
}> {
  const results: Array<{
    functionName: string;
    fullMatch: string;
    urlArg: string;
    structuredVariants: string | SplitArguments | Record<string, string> | undefined;
    optionsStructured?: Record<string, any>;
    hasOptions: boolean;
    // Position information in original source
    functionStartIndex: number;
    functionEndIndex: number;
    argumentsStartIndex: number;
    argumentsEndIndex: number;
  }> = [];

  // Find all create* function calls
  const createFactoryRegex = /\b(create\w*)\s*\(/g;
  let match = createFactoryRegex.exec(code);

  while (match !== null) {
    const functionName = match[1];
    const startIndex = match.index;
    const parenIndex = match.index + match[0].length - 1; // Position of opening parenthesis

    // Find the matching closing parenthesis
    let parenCount = 0;
    let endIndex = -1;
    for (let i = parenIndex; i < code.length; i += 1) {
      if (code[i] === '(') {
        parenCount += 1;
      } else if (code[i] === ')') {
        parenCount -= 1;
        if (parenCount === 0) {
          endIndex = i;
          break;
        }
      }
    }

    if (endIndex === -1) {
      match = createFactoryRegex.exec(code);
      continue;
    }

    const fullMatch = code.substring(startIndex, endIndex + 1);
    const content = code.substring(parenIndex + 1, endIndex);

    // Split by commas at the top level, handling nested structures and comments
    const structured = parseFunctionArguments(content);

    // Validate the function follows the convention
    const { metadataOnly = false } = parseOptions;

    if (metadataOnly) {
      // For metadata-only mode: expect 1-2 arguments (url, options?)
      if (structured.length < 1 || structured.length > 2) {
        throw new Error(
          `Invalid ${functionName} call in ${filePath}. ` +
            `Expected 1-2 arguments (url, options?) but got ${structured.length} arguments. ` +
            `In metadata-only mode, functions should follow: create*(url, options?)`,
        );
      }
    } else if (structured.length < 2 || structured.length > 3) {
      // Normal mode: expect 2-3 arguments (url, variants, options?)
      throw new Error(
        `Invalid ${functionName} call in ${filePath}. ` +
          `Expected 2-3 arguments (url, variants, options?) but got ${structured.length} arguments. ` +
          `Functions starting with 'create' must follow the convention: create*(url, variants, options?)`,
      );
    }

    // Handle different argument patterns based on mode
    if (metadataOnly) {
      // Metadata-only mode: expect 1-2 arguments (url, options?)
      if (structured.length === 1) {
        const [urlArg] = structured;

        results.push({
          functionName,
          fullMatch,
          urlArg: typeof urlArg === 'string' ? urlArg.trim() : String(urlArg),
          structuredVariants: undefined, // No variants in metadata-only mode
          optionsStructured: undefined,
          hasOptions: false,
          functionStartIndex: startIndex,
          functionEndIndex: endIndex,
          argumentsStartIndex: parenIndex + 1,
          argumentsEndIndex: endIndex,
        });
      } else if (structured.length === 2) {
        const [urlArg, optionsStructured] = structured;

        // Options should be an object
        if (
          typeof optionsStructured === 'string' ||
          (!Array.isArray(optionsStructured) && typeof optionsStructured !== 'object')
        ) {
          throw new Error(
            `Invalid options argument in ${functionName} call in ${filePath}. ` +
              `Expected an object but got: ${typeof optionsStructured === 'string' ? optionsStructured : JSON.stringify(optionsStructured)}`,
          );
        }

        results.push({
          functionName,
          fullMatch,
          urlArg: typeof urlArg === 'string' ? urlArg.trim() : String(urlArg),
          structuredVariants: undefined, // No variants in metadata-only mode
          optionsStructured:
            typeof optionsStructured === 'object' && optionsStructured !== null
              ? optionsStructured
              : undefined,
          hasOptions: true,
          functionStartIndex: startIndex,
          functionEndIndex: endIndex,
          argumentsStartIndex: parenIndex + 1,
          argumentsEndIndex: endIndex,
        });
      }
    }

    // Normal mode: expect 2-3 arguments (url, variants, options?)
    if (!metadataOnly) {
      if (structured.length === 2) {
        const [urlArg, variantsStructured] = structured;

        results.push({
          functionName,
          fullMatch,
          urlArg: typeof urlArg === 'string' ? urlArg.trim() : String(urlArg),
          structuredVariants: variantsStructured,
          optionsStructured: undefined,
          hasOptions: false, // No options argument was provided
          functionStartIndex: startIndex,
          functionEndIndex: endIndex,
          argumentsStartIndex: parenIndex + 1,
          argumentsEndIndex: endIndex,
        });
      } else if (structured.length === 3) {
        const [urlArg, variantsStructured, optionsStructured] = structured;

        // Options should be an object (Record<string, any>) or an empty object
        if (
          typeof optionsStructured === 'string' ||
          (!Array.isArray(optionsStructured) && typeof optionsStructured !== 'object')
        ) {
          throw new Error(
            `Invalid options argument in ${functionName} call in ${filePath}. ` +
              `Expected an object but got: ${typeof optionsStructured === 'string' ? optionsStructured : JSON.stringify(optionsStructured)}`,
          );
        }

        results.push({
          functionName,
          fullMatch,
          urlArg: typeof urlArg === 'string' ? urlArg.trim() : String(urlArg),
          structuredVariants: variantsStructured,
          optionsStructured:
            typeof optionsStructured === 'object' && optionsStructured !== null
              ? optionsStructured
              : undefined,
          hasOptions: true, // Options argument was provided
          functionStartIndex: startIndex,
          functionEndIndex: endIndex,
          argumentsStartIndex: parenIndex + 1,
          argumentsEndIndex: endIndex,
        });
      }
    }

    match = createFactoryRegex.exec(code);
  }

  return results;
}
