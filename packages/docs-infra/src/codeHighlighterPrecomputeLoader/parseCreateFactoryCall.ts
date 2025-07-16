import { resolveImportMap } from '../resolveImports';
import { parseFunctionParameters } from './parseFunctionParameters';

export interface FactoryOptions {
  name?: string;
  slug?: string;
  precompute?: boolean;
}

export interface ParsedCreateFactory {
  functionName: string;
  url: string;
  variants: Record<string, string>;
  options: FactoryOptions;
  fullMatch: string;
  variantsObjectStr: string;
  optionsObjectStr: string;
}

/**
 * Parses a variants object string and maps variant names to their import paths
 */
function parseVariantsObject(
  variantsObjectStr: string,
  importMap: Map<string, string>,
): Record<string, string> {
  const demoImports: Record<string, string> = {};

  // Parse the demo object to extract key-value pairs
  // Handle both { Default: BasicCode } and { Default } syntax
  const objectContentRegex = /(\w+)(?:\s*:\s*(\w+))?/g;
  let objectMatch = objectContentRegex.exec(variantsObjectStr);

  while (objectMatch !== null) {
    const [, key, value] = objectMatch;
    const importName = value || key; // Use value if provided, otherwise use key (shorthand syntax)

    if (importMap.has(importName)) {
      demoImports[key] = importMap.get(importName)!;
    }

    objectMatch = objectContentRegex.exec(variantsObjectStr);
  }

  return demoImports;
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
 * Validates that a variants parameter is an object mapping to imports
 */
function validateVariantsParameter(
  variantsObjectStr: string,
  functionName: string,
  filePath: string,
): void {
  if (!variantsObjectStr || variantsObjectStr.trim() === '') {
    throw new Error(
      `Invalid variants parameter in ${functionName} call in ${filePath}. ` +
        `Expected an object mapping variant names to imports.`,
    );
  }

  // Basic validation that it looks like an object
  const trimmed = variantsObjectStr.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new Error(
      `Invalid variants parameter in ${functionName} call in ${filePath}. ` +
        `Expected an object but got: ${trimmed}`,
    );
  }
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
  const importMap = await resolveImportMap(code, filePath);

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
  const { functionName, fullMatch, urlParam, variantsObjectStr, optionsObjectStr } = match;

  // Validate URL parameter
  validateUrlParameter(urlParam, functionName, filePath);

  // Validate variants parameter
  validateVariantsParameter(variantsObjectStr, functionName, filePath);

  // Extract URL (typically import.meta.url)
  const url = urlParam.trim();

  // Resolve variants for this specific create* call
  const variants = parseVariantsObject(variantsObjectStr, importMap);

  // Parse options object
  const options: FactoryOptions = {};

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

  // Extract precompute
  const precomputeMatch = optionsObjectStr.match(/precompute\s*:\s*(true|false)/);
  if (precomputeMatch) {
    options.precompute = precomputeMatch[1] === 'true';
  }

  return {
    functionName,
    url,
    variants,
    options,
    fullMatch,
    variantsObjectStr,
    optionsObjectStr,
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
  variantsObjectStr: string;
  optionsObjectStr: string;
}> {
  const results: Array<{
    functionName: string;
    fullMatch: string;
    urlParam: string;
    variantsObjectStr: string;
    optionsObjectStr: string;
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

      // Extract the actual object string for variants
      const variantsObjectStr = objects[1];

      if (!variantsObjectStr) {
        throw new Error(
          `Invalid variants parameter in ${functionName} call in ${filePath}. ` +
            `Expected an object but could not parse: ${parts[1].trim()}`,
        );
      }

      results.push({
        functionName,
        fullMatch,
        urlParam: urlParam.trim(),
        variantsObjectStr,
        optionsObjectStr: '{}', // Default empty options
      });
    } else if (parts.length === 3) {
      const [urlParam] = parts;

      // Extract the actual object strings
      const variantsObjectStr = objects[1];
      const optionsObjectStr = objects[2];

      if (!variantsObjectStr) {
        throw new Error(
          `Invalid variants parameter in ${functionName} call in ${filePath}. ` +
            `Expected an object but could not parse: ${parts[1].trim()}`,
        );
      }

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
        variantsObjectStr,
        optionsObjectStr,
      });
    }

    match = createFactoryRegex.exec(code);
  }

  return results;
}
