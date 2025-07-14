import { serverLoadVariantCodeWithOptions } from '../serverLoadVariantCode';
import { loadVariant } from '../CodeHighlighter/loadVariant';
import { parseSource } from '../parseSource';
import { transformTsToJs } from '../transformTsToJs';
import type { SourceTransformers } from '../CodeHighlighter/types';

interface LoaderContext {
  resourcePath: string;
  addDependency(dependency: string): void;
  async(): (err?: Error | null, content?: string) => void;
  cacheable(): void;
}

interface DemoMetadata {
  name?: string;
  slug?: string;
  precompute?: boolean;
}

interface ParsedCreateDemo {
  url: string;
  variants: Record<string, string>;
  metadata: DemoMetadata;
  fullMatch: string;
  variantsObjectStr: string;
  metadataObjectStr: string;
}

/**
 * Parses a file to extract createDemo calls and their variants and metadata
 */
function parseCreateDemoCalls(code: string, filePath: string): ParsedCreateDemo[] {
  const results: ParsedCreateDemo[] = [];

  // First, build an import map to resolve variant references
  const importMap = buildImportMap(code, filePath);

  // Match createDemo calls with three parameters: url, variants object, and metadata object
  // Updated approach to handle multiline calls and nested objects properly
  const createDemoMatches = findCreateDemoCalls(code);

  for (const match of createDemoMatches) {
    const { fullMatch, urlParam, variantsObjectStr, metadataObjectStr } = match;

    // Extract URL (typically import.meta.url)
    const url = urlParam.trim();

    // Parse variants object to extract key-value pairs
    const variants: Record<string, string> = {};
    const objectContentRegex = /(\w+)(?:\s*:\s*(\w+))?/g;
    let variantMatch = objectContentRegex.exec(variantsObjectStr);

    while (variantMatch !== null) {
      const [, key, value] = variantMatch;
      const importName = value || key; // Use value if provided, otherwise use key (shorthand syntax)

      if (importMap.has(importName)) {
        variants[key] = importMap.get(importName)!;
      }

      variantMatch = objectContentRegex.exec(variantsObjectStr);
    }

    // Parse metadata object
    const metadata: DemoMetadata = {};

    // Extract name
    const nameMatch = metadataObjectStr.match(/name\s*:\s*['"`]([^'"`]+)['"`]/);
    if (nameMatch) {
      metadata.name = nameMatch[1];
    }

    // Extract slug
    const slugMatch = metadataObjectStr.match(/slug\s*:\s*['"`]([^'"`]+)['"`]/);
    if (slugMatch) {
      metadata.slug = slugMatch[1];
    }

    // Extract precompute
    const precomputeMatch = metadataObjectStr.match(/precompute\s*:\s*(true|false)/);
    if (precomputeMatch) {
      metadata.precompute = precomputeMatch[1] === 'true';
    }

    results.push({
      url,
      variants,
      metadata,
      fullMatch,
      variantsObjectStr,
      metadataObjectStr,
    });
  }

  return results;
}

/**
 * Finds createDemo calls in code, handling multiline cases
 */
function findCreateDemoCalls(code: string): Array<{
  fullMatch: string;
  urlParam: string;
  variantsObjectStr: string;
  metadataObjectStr: string;
}> {
  const results: Array<{
    fullMatch: string;
    urlParam: string;
    variantsObjectStr: string;
    metadataObjectStr: string;
  }> = [];

  // Find all createDemo function calls
  const createDemoRegex = /createDemo\s*\(/g;
  let match = createDemoRegex.exec(code);

  while (match !== null) {
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
      match = createDemoRegex.exec(code);
      continue;
    }

    const fullMatch = code.substring(startIndex, endIndex + 1);
    const content = code.substring(parenIndex + 1, endIndex);

    // Split by commas at the top level, handling nested structures and comments
    const parts = splitByTopLevelCommas(content);

    if (parts.length === 3) {
      const [urlParam, variantsContent, metadataContent] = parts;

      // Extract the actual object strings
      const variantsObjectStr = extractBalancedBraces(variantsContent.trim());
      const metadataObjectStr = extractBalancedBraces(metadataContent.trim());

      if (variantsObjectStr && metadataObjectStr) {
        results.push({
          fullMatch,
          urlParam: urlParam.trim(),
          variantsObjectStr,
          metadataObjectStr,
        });
      }
    }

    match = createDemoRegex.exec(code);
  }

  return results;
}

/**
 * Splits content by top-level commas, respecting nested structures and comments
 */
function splitByTopLevelCommas(str: string): string[] {
  const parts: string[] = [];
  let current = '';
  let parenCount = 0;
  let braceCount = 0;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < str.length; i += 1) {
    const char = str[i];
    const nextChar = str[i + 1];

    // Handle comments
    if (!inString && !inSingleLineComment && !inMultiLineComment) {
      if (char === '/' && nextChar === '/') {
        inSingleLineComment = true;
        current += char;
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inMultiLineComment = true;
        current += char;
        continue;
      }
    }

    if (inSingleLineComment && char === '\n') {
      inSingleLineComment = false;
      current += char;
      continue;
    }

    if (inMultiLineComment && char === '*' && nextChar === '/') {
      inMultiLineComment = false;
      current += char + nextChar;
      i += 1; // Skip next character
      continue;
    }

    if (inSingleLineComment || inMultiLineComment) {
      current += char;
      continue;
    }

    // Handle strings
    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
      current += char;
      continue;
    }

    if (inString && char === stringChar && str[i - 1] !== '\\') {
      inString = false;
      stringChar = '';
      current += char;
      continue;
    }

    if (inString) {
      current += char;
      continue;
    }

    // Handle brackets and parentheses
    if (char === '(') {
      parenCount += 1;
    } else if (char === ')') {
      parenCount -= 1;
    } else if (char === '{') {
      braceCount += 1;
    } else if (char === '}') {
      braceCount -= 1;
    } else if (char === ',' && parenCount === 0 && braceCount === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

/**
 * Builds a map of import names to their resolved file paths
 */
function buildImportMap(code: string, filePath: string): Map<string, string> {
  const importMap = new Map<string, string>();
  const importRegex = /import\s+(?:(\w+)|\*\s+as\s+(\w+)|{[^}]+})\s+from\s+['"]([^'"]+)['"]/g;
  let importMatch = importRegex.exec(code);

  while (importMatch !== null) {
    const [fullMatch, defaultImport, namespaceImport, modulePath] = importMatch;

    if (modulePath.startsWith('.')) {
      const basePath = filePath.substring(0, filePath.lastIndexOf('/'));
      const resolvedPath = new URL(modulePath, `file://${basePath}/`).pathname;

      if (defaultImport) {
        importMap.set(defaultImport, resolvedPath);
      } else if (namespaceImport) {
        importMap.set(namespaceImport, resolvedPath);
      } else if (fullMatch.includes('{')) {
        // Handle named imports like { ComponentName }
        const namedImportsMatch = fullMatch.match(/{\s*([^}]+)\s*}/);
        if (namedImportsMatch) {
          const namedImports = namedImportsMatch[1].split(',').map((s) => s.trim());
          namedImports.forEach((namedImport) => {
            const cleanImport = namedImport.split(' as ')[0].trim();
            importMap.set(cleanImport, resolvedPath);
          });
        }
      }
    }
    importMatch = importRegex.exec(code);
  }

  return importMap;
}

/**
 * Extracts a balanced brace object from a string, handling leading whitespace and comments
 */
function extractBalancedBraces(str: string): string | null {
  // Find the first opening brace, skipping whitespace and comments
  let startIndex = -1;
  let inSingleLineComment = false;
  let inMultiLineComment = false;

  for (let i = 0; i < str.length; i += 1) {
    const char = str[i];
    const nextChar = str[i + 1];

    // Handle comments
    if (!inSingleLineComment && !inMultiLineComment) {
      if (char === '/' && nextChar === '/') {
        inSingleLineComment = true;
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inMultiLineComment = true;
        i += 1; // Skip next character
        continue;
      }
    }

    if (inSingleLineComment && char === '\n') {
      inSingleLineComment = false;
      continue;
    }

    if (inMultiLineComment && char === '*' && nextChar === '/') {
      inMultiLineComment = false;
      i += 1; // Skip next character
      continue;
    }

    if (inSingleLineComment || inMultiLineComment) {
      continue;
    }

    // Skip whitespace
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      continue;
    }

    // Found first non-whitespace, non-comment character
    if (char === '{') {
      startIndex = i;
      break;
    } else {
      // If it's not a brace, this isn't a valid object
      return null;
    }
  }

  if (startIndex === -1) {
    return null;
  }

  let braceCount = 0;
  let endIndex = -1;

  for (let i = startIndex; i < str.length; i += 1) {
    if (str[i] === '{') {
      braceCount += 1;
    } else if (str[i] === '}') {
      braceCount -= 1;
      if (braceCount === 0) {
        endIndex = i;
        break;
      }
    }
  }

  return endIndex !== -1 ? str.substring(startIndex, endIndex + 1) : null;
}

/**
 * Webpack loader that processes demo files and precomputes variant data.
 *
 * This loader:
 * 1. Parses demo files to find createDemo calls with precompute: true
 * 2. Loads all variant code and dependencies using serverLoadVariantCodeWithOptions
 * 3. Processes code with parseSource (syntax highlighting) and transformTsToJs (TypeScript to JavaScript conversion)
 * 4. Adds all dependencies to webpack's watch list
 * 5. Replaces precompute: true with the actual precomputed data
 *
 * Features:
 * - Syntax highlighting using Starry Night (via parseSource)
 * - TypeScript to JavaScript transformation (via transformTsToJs)
 * - Recursive dependency loading
 * - Webpack dependency tracking for hot reloading
 *
 * Example input:
 * ```typescript
 * import { createDemo } from '@/functions/createDemo';
 * import CssModules from './CssModules';
 * import Tailwind from './Tailwind';
 *
 * export const CodeDemo = createDemo(
 *   import.meta.url,
 *   { CssModules, Tailwind },
 *   {
 *     name: 'Basic Code Block',
 *     slug: 'code',
 *     precompute: true,
 *   },
 * );
 * ```
 *
 * Example output (precompute: true replaced with processed data):
 * The precompute property is replaced with an object containing:
 * - fileName: The main file name
 * - source: HAST nodes with syntax highlighting applied
 * - extraFiles: Object containing additional dependency files
 * - transforms: Object with language variants (e.g., JavaScript version from TypeScript)
 */
export async function loadDemoCode(this: LoaderContext, source: string): Promise<void> {
  const callback = this.async();
  this.cacheable();

  try {
    // Parse the source to find createDemo calls
    const demoCalls = parseCreateDemoCalls(source, this.resourcePath);

    // Process each demo call
    let modifiedSource = source;

    // Process all demo calls
    const demoProcessPromises = demoCalls.map(async (demoCall) => {
      // Only process if precompute is explicitly true
      if (!demoCall.metadata.precompute) {
        return { demoCall, modifiedCall: null };
      }

      // Load variant data for all variants
      const variantData: Record<string, any> = {};
      const allVisitedFiles = new Set<string>();

      // Process variants in parallel
      const variantEntries = Object.entries(demoCall.variants);
      const variantPromises = variantEntries.map(async ([variantName, variantPath]) => {
        try {
          // Load the variant code with dependencies using the current file path
          // Since demoCall.url is typically "import.meta.url", we use this.resourcePath instead
          const variantResult = await serverLoadVariantCodeWithOptions(
            variantName,
            `file://${this.resourcePath}`, // Use the current file being processed by the loader
            {
              includeDependencies: true,
              maxDepth: 5,
              maxFiles: 50,
            },
          );

          // Setup source transformers for TypeScript to JavaScript conversion
          const sourceTransformers: SourceTransformers = [
            { extensions: ['ts', 'tsx'], transformer: transformTsToJs },
          ];

          // Use loadVariant to process the code with parsing and transformations
          // This applies:
          // 1. parseSource: Converts source code to HAST nodes with syntax highlighting
          // 2. transformTsToJs: Creates JavaScript variants for TypeScript files
          // 3. Processes all extra files with the same transformations
          const { code: processedVariant } = await loadVariant(
            variantName,
            `file://${this.resourcePath}`, // Use the current file path consistently
            variantResult.variant, // Use the variant property from the new interface
            parseSource,
            undefined, // loadSource - not needed since we already have the variant
            undefined, // loadVariantCode - not needed since we already have the variant
            sourceTransformers,
          );

          return {
            variantName,
            variantData: processedVariant, // processedVariant is already a clean VariantCode
            visitedFiles: variantResult.visitedFiles || [],
          };
        } catch (error) {
          console.warn(`Failed to load variant ${variantName} from ${variantPath}:`, error);
          return null;
        }
      });

      const variantResults = await Promise.all(variantPromises);

      // Process results and collect dependencies
      const dependencies: string[] = [];
      for (const result of variantResults) {
        if (result) {
          variantData[result.variantName] = result.variantData;
          result.visitedFiles.forEach((file) => {
            allVisitedFiles.add(file);
            dependencies.push(file);
          });
        }
      }

      // Replace precompute: true with the actual data
      const newMetadata = {
        ...demoCall.metadata,
        precompute: variantData,
      };

      // Reconstruct the metadata object string
      const metadataEntries = [];
      if (newMetadata.name) {
        metadataEntries.push(`name: '${newMetadata.name}'`);
      }
      if (newMetadata.slug) {
        metadataEntries.push(`slug: '${newMetadata.slug}'`);
      }
      metadataEntries.push(`precompute: ${JSON.stringify(newMetadata.precompute, null, 2)}`);

      const newMetadataStr = `{\n    ${metadataEntries.join(',\n    ')}\n  }`;

      // Create the new createDemo call
      const newCreateDemoCall = `createDemo(\n  ${demoCall.url},\n  ${demoCall.variantsObjectStr},\n  ${newMetadataStr}\n)`;

      return {
        demoCall,
        modifiedCall: newCreateDemoCall,
        dependencies,
      };
    });

    const processedDemos = await Promise.all(demoProcessPromises);

    // Apply modifications and add dependencies
    for (const processed of processedDemos) {
      if (processed.modifiedCall) {
        modifiedSource = modifiedSource.replace(
          processed.demoCall.fullMatch,
          processed.modifiedCall,
        );
      }
      if (processed.dependencies) {
        processed.dependencies.forEach((dep) => this.addDependency(dep));
      }
    }

    callback(null, modifiedSource);
  } catch (error) {
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}

// Default export for webpack loader
export default loadDemoCode;
