import { parseImports } from '../loaderUtils';
import { parseFunctionParameters, extractBalancedBraces } from './parseFunctionParameters';
import type { Externals } from '../CodeHighlighter/types';

/**
 * Helper function to convert the new parseImports format to a Map
 * that maps import names to their resolved paths
 */
function buildImportMap(importResult: {
  relative: Record<
    string,
    { path: string; names: { name: string; alias?: string; type: string }[] }
  >;
  externals: any;
}): Map<string, string> {
  const importMap = new Map<string, string>();

  Object.values(importResult.relative).forEach(({ path, names }) => {
    names.forEach(({ name, alias }) => {
      // Use alias if available, otherwise use the original name
      const nameToUse = alias || name;
      importMap.set(nameToUse, path);
    });
  });

  return importMap;
}

/**
 * Helper function to build a mapping from import aliases to their original named exports
 */
function buildNamedExportsMap(importResult: {
  relative: Record<
    string,
    { path: string; names: { name: string; alias?: string; type: string }[] }
  >;
  externals: any;
}): Map<string, string | undefined> {
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
  variants: Record<string, string>;
  namedExports: Record<string, string | undefined>;
  options: FactoryOptions;
  fullMatch: string;
  variantsObjectStr: string;
  optionsObjectStr: string;
  hasOptions: boolean;
  hasPrecompute: boolean;
  precomputeValue?: any;
  externals: Externals;
  live: boolean; // True if the function name contains "live"
  // For replacement purposes
  precomputeKeyStart?: number; // Start index of "precompute" in optionsObjectStr
  precomputeValueStart?: number; // Start index of the value in optionsObjectStr
  precomputeValueEnd?: number; // End index of the value in optionsObjectStr
}

/**
 * Parses a variants object string and maps variant names to their import paths
 */
function parseVariantsObject(
  variantsObjectStr: string,
  importMap: Map<string, string>,
  namedExportsMap: Map<string, string | undefined>,
  functionName: string,
  filePath: string,
): { variants: Record<string, string>; namedExports: Record<string, string | undefined> } {
  const demoImports: Record<string, string> = {};
  const namedExports: Record<string, string | undefined> = {};

  // Parse the demo object to extract key-value pairs
  // Handle both { Default: BasicCode } and { Default } syntax
  const objectContentRegex = /(\w+)(?:\s*:\s*(\w+))?/g;
  let objectMatch = objectContentRegex.exec(variantsObjectStr);

  while (objectMatch !== null) {
    const [, key, value] = objectMatch;
    const importName = value || key; // Use value if provided, otherwise use key (shorthand syntax)

    if (importMap.has(importName)) {
      demoImports[key] = importMap.get(importName)!;
      namedExports[key] = namedExportsMap.get(importName);
    } else {
      // Throw error if any variant component is not imported
      throw new Error(
        `Invalid variants parameter in ${functionName} call in ${filePath}. ` +
          `Component '${importName}' is not imported. Make sure to import it first.`,
      );
    }

    objectMatch = objectContentRegex.exec(variantsObjectStr);
  }

  return { variants: demoImports, namedExports };
}

/**
 * Parses variants parameter which can be either an object literal or a single component identifier
 */
function parseVariantsParameter(
  variantsParam: string,
  importMap: Map<string, string>,
  namedExportsMap: Map<string, string | undefined>,
  functionName: string,
  filePath: string,
): { variants: Record<string, string>; namedExports: Record<string, string | undefined> } {
  const trimmed = variantsParam.trim();

  // If it's an object literal, use existing logic
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return parseVariantsObject(trimmed, importMap, namedExportsMap, functionName, filePath);
  }

  // If it's a single identifier, map it to "Default"
  if (importMap.has(trimmed)) {
    return {
      variants: {
        Default: importMap.get(trimmed)!,
      },
      namedExports: {
        Default: namedExportsMap.get(trimmed),
      },
    };
  }

  // Throw error if the identifier is not found in imports
  throw new Error(
    `Invalid variants parameter in ${functionName} call in ${filePath}. ` +
      `Component '${trimmed}' is not imported. Make sure to import it first.`,
  );
}

/**
 * Validates that a URL parameter follows the expected convention
 */
function validateUrlParameter(url: string, functionName: string, filePath: string): void {
  const trimmedUrl = url.trim();

  // Check for import.meta.url
  if (trimmedUrl === 'import.meta.url') {
    return;
  }

  // Check for CJS equivalent: require('url').pathToFileURL(__filename).toString()
  // https://github.com/javiertury/babel-plugin-transform-import-meta#importmetaurl
  const cjsPattern =
    /require\s*\(\s*['"`]url['"`]\s*\)\s*\.\s*pathToFileURL\s*\(\s*__filename\s*\)\s*\.\s*toString\s*\(\s*\)/;
  if (cjsPattern.test(trimmedUrl)) {
    return;
  }

  throw new Error(
    `Invalid URL parameter in ${functionName} call in ${filePath}. ` +
      `Expected 'import.meta.url' or 'require('url').pathToFileURL(__filename).toString()' but got: ${trimmedUrl}`,
  );
}

/**
 * Validates that a variants parameter is either an object mapping to imports or a single identifier
 */
function validateVariantsParameter(
  variantsParam: string,
  functionName: string,
  filePath: string,
): void {
  if (!variantsParam || variantsParam.trim() === '') {
    throw new Error(
      `Invalid variants parameter in ${functionName} call in ${filePath}. ` +
        `Expected an object mapping variant names to imports or a single component identifier.`,
    );
  }

  const trimmed = variantsParam.trim();

  // Check if it's an object literal
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return; // Valid object literal
  }

  // Check if it's a valid identifier (single component)
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) {
    return; // Valid identifier
  }

  throw new Error(
    `Invalid variants parameter in ${functionName} call in ${filePath}. ` +
      `Expected an object mapping variant names to imports or a single component identifier, but got: ${trimmed}`,
  );
}

/**
 * Parses a file to extract a single create* factory call and its variants and options
 * Only supports one create* call per file - will throw an error if multiple are found
 * Returns null if no create* call is found
 */
export async function parseCreateFactoryCall(
  code: string,
  filePath: string,
): Promise<ParsedCreateFactory | null> {
  // Get import mappings once for the entire file
  const { relative: importResult, externals } = await parseImports(code, filePath);
  const importMap = buildImportMap({ relative: importResult, externals });
  const namedExportsMap = buildNamedExportsMap({ relative: importResult, externals });

  // Find all create* calls in the code
  const createFactoryMatches = findCreateFactoryCalls(code, filePath);

  // Enforce single create* call per file
  if (createFactoryMatches.length > 1) {
    throw new Error(
      `Multiple create* factory calls found in ${filePath}. Only one create* call per file is supported. Found ${createFactoryMatches.length} calls.`,
    );
  }

  // Return null if no create* call found
  if (createFactoryMatches.length === 0) {
    return null;
  }

  const match = createFactoryMatches[0];
  const { functionName, fullMatch, urlParam, variantsParam, optionsObjectStr, hasOptions } = match;

  // Validate URL parameter
  validateUrlParameter(urlParam, functionName, filePath);

  // Validate variants parameter
  validateVariantsParameter(variantsParam, functionName, filePath);

  // Extract URL (typically import.meta.url)
  const url = urlParam.trim();

  // Resolve variants for this specific create* call
  const { variants, namedExports } = parseVariantsParameter(
    variantsParam,
    importMap,
    namedExportsMap,
    functionName,
    filePath,
  );

  // Parse options object
  const options: FactoryOptions = {};
  let hasPrecompute = false;
  let precomputeValue: any;
  let precomputeKeyStart: number | undefined;
  let precomputeValueStart: number | undefined;
  let precomputeValueEnd: number | undefined;

  // Extract name
  const nameMatch = optionsObjectStr.match(/name\s*:\s*['"`]([^'"`]+)['"`]/);
  if (nameMatch) {
    options.name = nameMatch[1];
  }

  // Extract slug
  const slugMatch = optionsObjectStr.match(/slug\s*:\s*['"`]([^'"`]+)['"`]/);
  if (slugMatch) {
    options.slug = slugMatch[1];
  }

  // Extract skipPrecompute
  const skipPrecomputeMatch = optionsObjectStr.match(/skipPrecompute\s*:\s*(true|false)/);
  if (skipPrecomputeMatch) {
    options.skipPrecompute = skipPrecomputeMatch[1] === 'true';
  }

  // Extract precompute value using robust parsing
  const precomputeInfo = extractPrecomputeFromOptions(optionsObjectStr);
  if (precomputeInfo) {
    hasPrecompute = true;
    precomputeKeyStart = precomputeInfo.keyStart;
    precomputeValueStart = precomputeInfo.valueStart;
    precomputeValueEnd = precomputeInfo.valueEnd;
    precomputeValue = precomputeInfo.value;
    options.precompute = precomputeValue;
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

  // Detect if this is a live demo based on function name containing "Live" as a distinct component
  // This catches: createLive, createLiveDemo, createDemoLive, etc.
  // But avoids false positives like: createDelivery, delivery, etc.
  const live = /Live/.test(functionName);

  return {
    functionName,
    url,
    variants,
    namedExports,
    options,
    fullMatch,
    variantsObjectStr: variantsParam,
    optionsObjectStr,
    hasOptions,
    hasPrecompute,
    precomputeValue: hasPrecompute ? precomputeValue : undefined,
    externals: transformedExternals,
    live,
    precomputeKeyStart: hasPrecompute ? precomputeKeyStart : undefined,
    precomputeValueStart: hasPrecompute ? precomputeValueStart : undefined,
    precomputeValueEnd: hasPrecompute ? precomputeValueEnd : undefined,
  };
}

/**
 * Finds create* factory calls in code, handling multiline cases
 */
function findCreateFactoryCalls(
  code: string,
  filePath: string,
): Array<{
  functionName: string;
  fullMatch: string;
  urlParam: string;
  variantsParam: string;
  optionsObjectStr: string;
  hasOptions: boolean;
}> {
  const results: Array<{
    functionName: string;
    fullMatch: string;
    urlParam: string;
    variantsParam: string;
    optionsObjectStr: string;
    hasOptions: boolean;
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
    const { parts, objects } = parseFunctionParameters(content);

    // Validate the function follows the convention
    if (parts.length < 2 || parts.length > 3) {
      throw new Error(
        `Invalid ${functionName} call in ${filePath}. ` +
          `Expected 2-3 parameters (url, variants, options?) but got ${parts.length} parameters. ` +
          `Functions starting with 'create' must follow the convention: create*(url, variants, options?)`,
      );
    }

    if (parts.length === 2) {
      const [urlParam] = parts;

      // The variants parameter can be either an object literal or a single identifier
      const variantsParam = objects[1] || parts[1].trim();

      results.push({
        functionName,
        fullMatch,
        urlParam: urlParam.trim(),
        variantsParam,
        optionsObjectStr: '{}', // Default empty options
        hasOptions: false, // No options parameter was provided
      });
    } else if (parts.length === 3) {
      const [urlParam] = parts;

      // The variants parameter can be either an object literal or a single identifier
      const variantsParam = objects[1] || parts[1].trim();
      const optionsObjectStr = objects[2];

      if (!optionsObjectStr) {
        throw new Error(
          `Invalid options parameter in ${functionName} call in ${filePath}. ` +
            `Expected an object but could not parse: ${parts[2].trim()}`,
        );
      }

      results.push({
        functionName,
        fullMatch,
        urlParam: urlParam.trim(),
        variantsParam,
        optionsObjectStr,
        hasOptions: true, // Options parameter was provided
      });
    }

    match = createFactoryRegex.exec(code);
  }

  return results;
}

/**
 * Extracts precompute property from options object using robust parsing
 */
function extractPrecomputeFromOptions(optionsObjectStr: string): {
  keyStart: number;
  valueStart: number;
  valueEnd: number;
  value: any;
} | null {
  // Find the precompute property using regex
  const precomputeMatch = optionsObjectStr.match(/precompute\s*:\s*/);
  if (!precomputeMatch) {
    return null;
  }

  const keyStart = precomputeMatch.index!;
  const valueStartIndex = keyStart + precomputeMatch[0].length;

  // Extract the remaining part after "precompute:"
  const remainingStr = optionsObjectStr.substring(valueStartIndex);

  // Try to extract a balanced object first
  const objectValue = extractBalancedBraces(remainingStr);

  if (objectValue) {
    // It's an object value
    let actualValueStart = valueStartIndex;
    while (
      actualValueStart < optionsObjectStr.length &&
      /\s/.test(optionsObjectStr[actualValueStart])
    ) {
      actualValueStart += 1;
    }

    const valueEnd = actualValueStart + objectValue.length;

    return {
      keyStart,
      valueStart: actualValueStart,
      valueEnd,
      value: objectValue, // Keep object as string
    };
  }

  // It's a simple value (true, false, etc.)
  // Parse until comma, newline, or closing brace
  let i = 0;
  let inString = false;
  let stringChar = '';

  while (i < remainingStr.length) {
    const char = remainingStr[i];

    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && remainingStr[i - 1] !== '\\') {
      inString = false;
      stringChar = '';
    } else if (!inString && (char === ',' || char === '}' || char === '\n')) {
      break;
    }

    i += 1;
  }

  const valueStr = remainingStr.substring(0, i).trim();

  // Calculate precise boundaries
  let actualValueStart = valueStartIndex;
  while (
    actualValueStart < optionsObjectStr.length &&
    /\s/.test(optionsObjectStr[actualValueStart])
  ) {
    actualValueStart += 1;
  }

  const valueEnd = actualValueStart + valueStr.length;

  // Parse the value
  let parsedValue: any;
  if (valueStr === 'true') {
    parsedValue = true;
  } else if (valueStr === 'false') {
    parsedValue = false;
  } else {
    parsedValue = valueStr;
  }

  return {
    keyStart,
    valueStart: actualValueStart,
    valueEnd,
    value: parsedValue,
  };
}
