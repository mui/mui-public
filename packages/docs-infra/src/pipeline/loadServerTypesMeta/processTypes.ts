import type { CompilerOptions } from 'typescript';
// eslint-disable-next-line n/prefer-node-protocol
import { fileURLToPath } from 'url';
import { parseFromProgram } from '@mui/internal-typescript-api-extractor';
import type { ExportNode } from '@mui/internal-typescript-api-extractor';
import ts from 'typescript';
import { createOptimizedProgram } from './createOptimizedProgram';
import { augmentComponentsWithInheritedProps } from './inheritedExternalProps';
import type { InheritedExternalPropsConfig } from './inheritedExternalProps';
import { findConstantNamespaces, foldConstantNamespaces } from './constantGroups';
import { resolveExportAliases } from './exportAliases';
import { PARSER_OPTIONS } from './constants';
import { extractJSDocText, isJSDocNodeArray } from './extractJSDocText';
import { PerformanceTracker } from './performanceTracking';
import type { PerformanceLog } from './performanceTracking';
import { nameMark } from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { computeTypeSlug, findComponentPrefix } from '../loadServerTypes/typeSlugs';

/**
 * Strips functions from objects so they can cross the worker boundary.
 * Structured clone can't handle functions but handles everything else fine.
 * Also normalizes typescript-api-extractor JSDoc description arrays to strings,
 * resolving `{@link}` references against `documentedNames` so only symbols with
 * a heading on the page become anchor links.
 */
function stripFunctions<T>(
  value: T,
  documentedNames?: ReadonlyMap<string, string>,
  visited = new WeakMap<object, unknown>(),
): T {
  // Primitives, null, undefined - return as-is
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }

  // Already processed - return cached result (handles circular refs)
  if (visited.has(value)) {
    return visited.get(value) as T;
  }

  // Arrays
  if (Array.isArray(value)) {
    // Normalize JSDoc description arrays to strings
    if (isJSDocNodeArray(value)) {
      return extractJSDocText(value, documentedNames) as T;
    }
    const result: unknown[] = [];
    visited.set(value, result);
    for (const item of value) {
      if (typeof item !== 'function') {
        result.push(stripFunctions(item, documentedNames, visited));
      }
    }
    return result as T;
  }

  // Objects - copy properties, skip functions
  const result: Record<string, unknown> = {};
  visited.set(value, result);
  for (const key of Object.keys(value)) {
    const propValue = (value as Record<string, unknown>)[key];
    if (typeof propValue !== 'function') {
      result[key] = stripFunctions(propValue, documentedNames, visited);
    }
  }
  return result as T;
}

/**
 * Collects every symbol name documented on this page - all exports across all variants - mapped
 * to the slug of the heading it links to. `{@link}` references are linked only when they hit
 * this map, since those are the names that get a heading (and thus an anchor). An alias links to
 * the heading of its canonical export.
 */
function collectDocumentedNames(variantData: Record<string, VariantResult>): Map<string, string> {
  const exportNames = Object.values(variantData).flatMap((variant) =>
    variant.exports.map((node) => node.name),
  );
  const componentPrefix = findComponentPrefix(exportNames);
  const names = new Map<string, string>();
  const addName = (name: string, target: string) => {
    if (!names.has(name)) {
      names.set(name, computeTypeSlug(target, componentPrefix));
    }
  };

  for (const name of exportNames) {
    addName(name, name);
    // Namespaced exports (e.g. "Menu.Root") are also referenced by their flat
    // ("MenuRoot") and leaf ("Root") forms in {@link} comments.
    if (name.includes('.')) {
      addName(name.replaceAll('.', ''), name);
      addName(name.slice(name.lastIndexOf('.') + 1), name);
    }
  }
  for (const variant of Object.values(variantData)) {
    for (const [aliasName, canonicalName] of Object.entries(variant.aliases ?? {})) {
      addName(aliasName, canonicalName);
    }
  }

  return names;
}

/**
 * Recursively collects all source file dependencies of a given source file.
 * This walks the import graph starting from the given file and collects all
 * non-declaration, non-node_modules files that it imports (directly or transitively).
 *
 * @param sourceFile - The starting source file
 * @param program - The TypeScript program
 * @param visited - Set of already visited file paths to prevent cycles
 * @returns Array of file paths that are dependencies of the source file
 */
function collectSourceFileDependencies(
  sourceFile: ts.SourceFile,
  program: ts.Program,
  visited: Set<string>,
): string[] {
  const dependencies: string[] = [];
  const checker = program.getTypeChecker();

  // Mark this file as visited to prevent cycles
  if (visited.has(sourceFile.fileName)) {
    return dependencies;
  }
  visited.add(sourceFile.fileName);

  // Walk through all import/export declarations in the source file
  ts.forEachChild(sourceFile, function visit(node) {
    let moduleSpecifier: ts.Expression | undefined;

    if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
      moduleSpecifier = node.moduleSpecifier;
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      moduleSpecifier = node.moduleSpecifier;
    }

    if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
      // Resolve the module to get the actual file path
      const symbol = checker.getSymbolAtLocation(moduleSpecifier);
      if (symbol) {
        const declarations = symbol.getDeclarations();
        if (declarations && declarations.length > 0) {
          const declSourceFile = declarations[0].getSourceFile();
          const fileName = declSourceFile.fileName;

          // Skip declaration files and node_modules
          if (!declSourceFile.isDeclarationFile && !fileName.includes('node_modules')) {
            dependencies.push(fileName);

            // Recursively collect dependencies of this file
            const nestedDeps = collectSourceFileDependencies(declSourceFile, program, visited);
            dependencies.push(...nestedDeps);
          }
        }
      }
    }
  });

  return dependencies;
}

/**
 * Extracts unique namespace names from exports.
 *
 * For example, from exports like ["Menu.Root", "Menu.Item", "Dialog.Root"],
 * this returns ["Menu", "Dialog"].
 */
function extractNamespaces(exports: ExportNode[]): string[] {
  const namespaces = new Set<string>();

  for (const exp of exports) {
    // Check if the export name contains a dot (indicating a namespace)
    const firstDot = exp.name.indexOf('.');
    if (firstDot !== -1) {
      namespaces.add(exp.name.substring(0, firstDot));
    }
  }

  return Array.from(namespaces);
}

// Worker returns raw export nodes and metadata for formatting in main thread
export interface VariantResult {
  exports: ExportNode[];
  /** Names of the exports folded from namespaces of constants (see `findConstantNamespaces`) */
  constantNamespaces: string[];
  namespaces: string[];
  /** Names of the exports the extractor marks as aliases, mapped to their canonical export's name */
  aliases?: Record<string, string>;
}

export interface WorkerRequest {
  requestId?: number; // Added by worker manager for request tracking
  projectPath: string;
  compilerOptions: CompilerOptions;
  /** Map serialized as array of [variantName, fileUrl] tuples where fileUrl uses file:// protocol */
  resolvedVariantMap: Array<[string, string]>;
  /** Dependency paths (filesystem paths, not URLs) */
  dependencies: string[];
  /** Root context directory path (must end with /) */
  rootContextDir: string;
  relativePath: string;
  /**
   * Props to re-include when inherited from these externally declared types,
   * keyed by the declaring type's name.
   */
  inheritedExternalProps?: InheritedExternalPropsConfig;
}

export interface WorkerResponse {
  requestId?: number; // Echoed back from request for tracking
  success: boolean;
  variantData?: Record<string, VariantResult>;
  /** All dependencies as filesystem paths (from TypeScript's program.getSourceFiles()) */
  allDependencies?: string[];
  performanceLogs?: PerformanceLog[];
  error?: string;
}

/**
 * Process TypeScript types for the given request.
 * This function creates a TypeScript program, parses exports, and returns type metadata.
 */
export async function processTypes(request: WorkerRequest): Promise<WorkerResponse> {
  const tracker = new PerformanceTracker();
  const functionName = '[Worker] Process Types';

  try {
    // Create optimized TypeScript program
    const programWrapperStart = tracker.mark(
      nameMark(functionName, 'Program Creation Start', [request.relativePath], true),
    );

    const program = createOptimizedProgram(
      request.projectPath,
      request.compilerOptions,
      request.resolvedVariantMap.map(([, fileUrl]) => fileURLToPath(fileUrl)),
      {},
      tracker,
      functionName,
      [request.relativePath],
    );

    const programWrapperEnd = tracker.mark(
      nameMark(functionName, 'Program Creation End', [request.relativePath], true),
    );
    tracker.measure(
      nameMark(functionName, 'Program Creation', [request.relativePath], true),
      programWrapperStart,
      programWrapperEnd,
    );

    // Process variants in parallel
    const resolvedVariantMap = new Map(request.resolvedVariantMap);
    const variantPromises = Array.from(resolvedVariantMap.entries()).map(
      async ([variantName, fileUrl]) => {
        const variantStart = tracker.mark(
          nameMark(functionName, `Variant ${variantName} Start`, [request.relativePath], true),
        );

        // Convert file:// URL to filesystem path for TypeScript
        const entrypoint = fileURLToPath(fileUrl);

        try {
          // Ensure the entrypoint exists and is accessible to the TypeScript program
          const sourceFile = program.getSourceFile(entrypoint);
          if (!sourceFile) {
            throw new Error(
              `Source file not found in TypeScript program: ${entrypoint}\n` +
                `Make sure the file exists and is included in the TypeScript compilation.`,
            );
          }

          const parseStart = tracker.mark(
            nameMark(functionName, `Variant ${variantName} Parse Start`, [request.relativePath]),
          );

          // Use parseFromProgram directly - it now handles namespace exports,
          // type aliases, and re-exports properly
          const parsed = parseFromProgram(entrypoint, program, PARSER_OPTIONS);

          // Exports reaching another export's declaration under a second name are
          // documented once, under the canonical name.
          const { exports: canonicalExports, aliases } = resolveExportAliases(parsed.exports);

          // Modules of constants exported as a namespace (`export * as ButtonDataAttributes`)
          // arrive flattened into one export per member; document each as a single group.
          const constantNamespaces = findConstantNamespaces(entrypoint, program);
          const exports = foldConstantNamespaces(canonicalExports, constantNamespaces);

          // Re-add configured props that the parser dropped because they are
          // inherited from an externally declared type in node_modules
          augmentComponentsWithInheritedProps(
            exports,
            program,
            sourceFile,
            request.inheritedExternalProps,
          );

          // Extract namespaces from the exports (e.g., "Menu" from "Menu.Root")
          const namespaces = extractNamespaces(exports);

          // Get all source files that are dependencies of this entrypoint
          // Include files from the TypeScript program for hot reloading support
          // We collect only files imported by THIS entrypoint, not all files in the program
          const entrypointDependencies = collectSourceFileDependencies(
            sourceFile,
            program,
            new Set(),
          );

          const dependencies = [...request.dependencies, entrypoint, ...entrypointDependencies];

          const parseEnd = tracker.mark(
            nameMark(functionName, `Variant ${variantName} Parsed`, [request.relativePath]),
          );
          tracker.measure(
            nameMark(functionName, `Variant ${variantName} Parsing`, [request.relativePath]),
            parseStart,
            parseEnd,
          );

          const variantEnd = tracker.mark(
            nameMark(functionName, `Variant ${variantName} Complete`, [request.relativePath], true),
          );
          tracker.measure(
            nameMark(functionName, `Variant ${variantName} Total`, [request.relativePath], true),
            variantStart,
            variantEnd,
          );

          return {
            variantName,
            variantData: {
              exports,
              constantNamespaces: Array.from(constantNamespaces.keys()),
              namespaces,
              aliases: aliases.size > 0 ? Object.fromEntries(aliases) : undefined,
            },
            dependencies,
          };
        } catch (error) {
          throw new Error(
            `Failed to parse variant ${variantName} (${fileUrl}): \n${error && typeof error === 'object' && 'message' in error && error.message}`,
          );
        }
      },
    );

    const variantResults = await Promise.all(variantPromises);

    // Process results and collect dependencies
    const variantData: Record<string, VariantResult> = {};
    const allDependencies: string[] = [];

    for (const result of variantResults) {
      if (result) {
        variantData[result.variantName] = result.variantData;
        result.dependencies.forEach((file: string) => {
          allDependencies.push(file);
        });
      }
    }

    // Strip functions so data can cross worker boundary (structured clone can't handle functions)
    const documentedNames = collectDocumentedNames(variantData);
    const serializedVariantData = stripFunctions(variantData, documentedNames);

    return {
      success: true,
      variantData: serializedVariantData,
      allDependencies,
      performanceLogs: tracker.getLogs(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      performanceLogs: tracker.getLogs(),
    };
  }
}
