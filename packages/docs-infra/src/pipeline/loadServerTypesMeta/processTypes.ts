import type { CompilerOptions } from 'typescript';
// eslint-disable-next-line n/prefer-node-protocol
import { fileURLToPath } from 'url';
import {
  ExportNode,
  parseFromProgram,
  ParserOptions,
  TypeName,
  AnyType,
} from 'typescript-api-extractor';
import ts from 'typescript';
import { createOptimizedProgram } from './createOptimizedProgram';
import { PerformanceTracker, type PerformanceLog } from './performanceTracking';
import { nameMark } from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { formatClassData, isPublicClass } from './formatClass';
import { formatComponentData, isPublicComponent } from './formatComponent';
import { formatHookData, isPublicHook } from './formatHook';
import { formatFunctionData, isPublicFunction } from './formatFunction';
import { formatRawData } from './formatRaw';
import { prettyFormat } from './format';
import { buildTypeCompatibilityMap } from './rewriteTypes';
import type { ExternalTypeMeta, ExternalTypesCollector } from './externalTypes';
import type { BaseTypeMeta } from '../loadServerTypesText/organizeTypesByExport';

/**
 * Extracts text content from a JSDoc description array.
 * typescript-api-extractor returns description as an array of JSDoc nodes
 * when the comment contains @link tags.
 */
function extractJSDocText(nodes: unknown[]): string {
  return nodes
    .map((node) => {
      if (typeof node === 'object' && node !== null) {
        // Regular text nodes have a 'text' property with content
        if ('text' in node) {
          const text = (node as { text?: unknown }).text;
          if (typeof text === 'string' && text) {
            return text;
          }
        }
        // JSDocLink nodes (kind 325) have the symbol name in name.escapedText
        // Convert {@link symbolName} to [`symbolName`](#symbolName) markdown link
        if ('name' in node) {
          const name = (node as { name?: { escapedText?: string } }).name;
          if (name && typeof name.escapedText === 'string') {
            return `[\`${name.escapedText}\`](#${name.escapedText.toLowerCase()})`;
          }
        }
      }
      return '';
    })
    .join('');
}

/**
 * Checks if an array looks like JSDoc description nodes from typescript-api-extractor.
 * These have properties like 'pos', 'end', 'kind', 'text' from the TypeScript AST.
 */
function isJSDocNodeArray(value: unknown[]): boolean {
  if (value.length === 0) {
    return false;
  }
  const first = value[0];
  return (
    typeof first === 'object' &&
    first !== null &&
    'pos' in first &&
    'end' in first &&
    'kind' in first
  );
}

/**
 * Strips functions from objects so they can cross the worker boundary.
 * Structured clone can't handle functions but handles everything else fine.
 * Also normalizes typescript-api-extractor JSDoc description arrays to strings.
 */
function stripFunctions<T>(value: T, visited = new WeakMap<object, unknown>()): T {
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
      return extractJSDocText(value) as T;
    }
    const result: unknown[] = [];
    visited.set(value, result);
    for (const item of value) {
      if (typeof item !== 'function') {
        result.push(stripFunctions(item, visited));
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
      result[key] = stripFunctions(propValue, visited);
    }
  }
  return result as T;
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
 * Builds a mapping from flat type names to dotted namespace names.
 *
 * typescript-api-extractor now returns exports with proper dotted names like
 * "Component.Root.Props" directly. This function builds a map from the flat
 * equivalent names to the dotted names for type reference transformation.
 *
 * For each dotted export like "Component.Root.Props", we create a mapping:
 *   ComponentRootProps -> Component.Root.Props
 *
 * BUT only if the flat name is ALSO exported (e.g., there's an actual
 * `export type ComponentRootProps = ...` in the entrypoint).
 */
function buildTypeNameMap(exports: ExportNode[]): Map<string, string> {
  const typeNameMap = new Map<string, string>();

  // Build a set of all export names
  const exportNames = new Set(exports.map((exp) => exp.name));

  for (const exp of exports) {
    if (exp.name.includes('.')) {
      // e.g., "Component.Root.Props" -> flatName "ComponentRootProps"
      const flatName = exp.name.replace(/\./g, '');
      // Only add if the flat name is ALSO an export
      if (exportNames.has(flatName)) {
        typeNameMap.set(flatName, exp.name);
      }
    }
  }

  return typeNameMap;
}

/**
 * Recursively collects all type references from a type tree.
 * This helps build a more complete typeNameMap by finding all referenced types.
 * Only adds entries if the flat name is also an export.
 */
function collectTypeReferences(
  type: AnyType,
  typeNameMap: Map<string, string>,
  exportNames: Set<string>,
): void {
  if (!type) {
    return;
  }

  // Check if this type has a typeName with namespaces
  if ('typeName' in type && type.typeName) {
    const typeName = type.typeName as TypeName;
    if (typeName.namespaces && typeName.namespaces.length > 0) {
      const flatName = typeName.namespaces.join('') + typeName.name;
      const dottedName = [...typeName.namespaces, typeName.name].join('.');

      // Only add if the flat name is different from dotted name,
      // it's not already in the map, AND it's actually an export
      if (flatName !== dottedName && !typeNameMap.has(flatName) && exportNames.has(flatName)) {
        typeNameMap.set(flatName, dottedName);
      }
    }
  }

  // Recursively process nested types
  if ('types' in type && Array.isArray(type.types)) {
    for (const t of type.types) {
      collectTypeReferences(t, typeNameMap, exportNames);
    }
  }
  if ('properties' in type && Array.isArray(type.properties)) {
    for (const prop of type.properties) {
      if ('type' in prop) {
        collectTypeReferences(prop.type as AnyType, typeNameMap, exportNames);
      }
    }
  }
  if ('props' in type && Array.isArray(type.props)) {
    for (const prop of type.props) {
      if ('type' in prop) {
        collectTypeReferences(prop.type as AnyType, typeNameMap, exportNames);
      }
    }
  }
  if ('callSignatures' in type && Array.isArray(type.callSignatures)) {
    for (const sig of type.callSignatures) {
      if ('parameters' in sig && Array.isArray(sig.parameters)) {
        for (const param of sig.parameters) {
          if ('type' in param) {
            collectTypeReferences(param.type as AnyType, typeNameMap, exportNames);
          }
        }
      }
      if ('returnValue' in sig && sig.returnValue) {
        const returnValue = sig.returnValue as { type?: AnyType };
        if (returnValue.type) {
          collectTypeReferences(returnValue.type, typeNameMap, exportNames);
        }
      }
    }
  }
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

// Raw variant data before formatting (internal to processTypes)
interface RawVariantResult {
  exports: ExportNode[];
  allTypes: ExportNode[];
  namespaces: string[];
  typeNameMap?: Record<string, string>;
}

// Formatted variant data returned across the wire
export interface VariantResult {
  types: BaseTypeMeta[];
  typeNameMap?: Record<string, string>;
}

export interface WorkerRequest {
  requestId?: number; // Added by worker manager for request tracking
  projectPath: string;
  compilerOptions: CompilerOptions;
  /** All files for the TypeScript program (entrypoints + meta files) */
  allEntrypoints: string[];
  /** Meta files (DataAttributes, CssVars) - not entrypoints, just additional type info */
  metaFiles: string[];
  /** Map serialized as array of [variantName, fileUrl] tuples where fileUrl uses file:// protocol */
  resolvedVariantMap: Array<[string, string]>;
  /** Dependency paths (filesystem paths, not URLs) */
  dependencies: string[];
  /** Root context directory path (must end with /) */
  rootContextDir: string;
  relativePath: string;
  formattingOptions?: any;
  descriptionReplacements?: any;
  externalTypesPattern?: string;
  ordering?: any;
}

export interface WorkerResponse {
  requestId?: number; // Echoed back from request for tracking
  success: boolean;
  variantData?: Record<string, VariantResult>;
  /** All dependencies as filesystem paths (from TypeScript's program.getSourceFiles()) */
  allDependencies?: string[];
  externalTypes?: Record<string, string>;
  performanceLogs?: PerformanceLog[];
  error?: string;
  debug?: {
    metaFilesCount?: number;
  };
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
      request.allEntrypoints,
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

    const internalTypesCache: Record<string, ExportNode[]> = {};
    const parserOptions: ParserOptions = {
      includeExternalTypes: false,
      shouldInclude: ({ depth }) => depth <= 15,
      shouldResolveObject: ({ propertyCount, depth }) => propertyCount <= 50 && depth <= 15,
    };

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
          const { exports } = parseFromProgram(entrypoint, program, parserOptions);

          // Extract namespaces from the exports (e.g., "Menu" from "Menu.Root")
          const namespaces = extractNamespaces(exports);

          // Build a set of all export names for filtering
          const exportNames = new Set(exports.map((exp) => exp.name));

          // Build typeNameMap from exports (maps flat names to dotted names)
          // Only includes entries where the flat name is also an export
          const mergedTypeNameMap = buildTypeNameMap(exports);

          // Also collect type references from all exports to build a more complete map
          for (const exp of exports) {
            if ('type' in exp && exp.type) {
              collectTypeReferences(exp.type, mergedTypeNameMap, exportNames);
            }
          }

          // Get all source files that are dependencies of this entrypoint
          // Include files from the TypeScript program for hot reloading support
          // We collect only files imported by THIS entrypoint, not all files in the program
          const entrypointDependencies = collectSourceFileDependencies(
            sourceFile,
            program,
            new Set(),
          );

          const dependencies = [
            ...request.dependencies,
            entrypoint,
            ...request.metaFiles,
            ...entrypointDependencies,
          ];

          // Parse meta files (DataAttributes, CssVars) for additional type information
          const allInternalTypes = request.metaFiles.map((file) => {
            if (internalTypesCache[file]) {
              return internalTypesCache[file];
            }

            // Ensure the file is loaded in the program first
            // This is important for meta files (DataAttributes, CssVars) that aren't imported
            const fileSourceFile = program.getSourceFile(file);
            if (!fileSourceFile) {
              console.warn(`[processTypes] ${variantName} - Could not load source file: ${file}`);
              return [];
            }

            const { exports: internalExport } = parseFromProgram(file, program, parserOptions);

            internalTypesCache[file] = internalExport;
            return internalExport;
          });

          const internalTypes = allInternalTypes.reduce((acc, cur) => {
            acc.push(...cur);
            return acc;
          }, []);
          const allTypes = [...exports, ...internalTypes];

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
              allTypes,
              namespaces,
              // Convert Map to Record for serialization across worker boundary
              typeNameMap:
                mergedTypeNameMap.size > 0 ? Object.fromEntries(mergedTypeNameMap) : undefined,
            },
            dependencies,
            debug: {
              metaFilesCount: request.metaFiles.length,
            },
          };
        } catch (error) {
          throw new Error(
            `Failed to parse variant ${variantName} (${fileUrl}): \n${error && typeof error === 'object' && 'message' in error && error.message}`,
          );
        }
      },
    );

    const variantResults = await Promise.all(variantPromises);

    // Process results and collect dependencies and debug info
    const rawVariantData: Record<string, RawVariantResult> = {};
    const allDependencies: string[] = [];
    const debugInfo: Record<string, { metaFilesCount: number }> = {};

    for (const result of variantResults) {
      if (result) {
        rawVariantData[result.variantName] = result.variantData;
        result.dependencies.forEach((file: string) => {
          allDependencies.push(file);
        });
        if (result.debug) {
          debugInfo[result.variantName] = result.debug;
        }
      }
    }

    // === IN-WORKER FORMAT STAGE ===
    // Formatting moved worker-side to avoid serializing raw `allTypes` (45+ MB per chart
    // component) across the IPC socket. Only the compact formatted result crosses the wire.
    const formatStart = tracker.mark(
      nameMark(functionName, 'Format Start', [request.relativePath], true),
    );

    const collectedExternalTypes = new Map<string, ExternalTypeMeta>();
    const externalTypesPatternRegex = request.externalTypesPattern
      ? new RegExp(request.externalTypesPattern)
      : undefined;
    const allRawExports = Object.values(rawVariantData).flatMap((v) => v.allTypes);
    const allExportNames = Array.from(new Set(allRawExports.map((exp) => exp.name)));
    const typeCompatibilityMap = buildTypeCompatibilityMap(allRawExports, allExportNames);
    const mergedTypeNameMapForRewrite: Record<string, string> = {};
    for (const variant of Object.values(rawVariantData)) {
      if (variant.typeNameMap) {
        Object.assign(mergedTypeNameMapForRewrite, variant.typeNameMap);
      }
    }
    const rewriteContext = {
      typeCompatibilityMap,
      exportNames: allExportNames,
      typeNameMap:
        Object.keys(mergedTypeNameMapForRewrite).length > 0
          ? mergedTypeNameMapForRewrite
          : undefined,
    };

    const formattedVariantData: Record<string, any> = {};
    await Promise.all(
      Object.entries(rawVariantData).map(async ([variantName, variantResult]) => {
        const externalTypesCollector: ExternalTypesCollector = {
          collected: collectedExternalTypes,
          allExports: variantResult.allTypes,
          pattern: externalTypesPatternRegex,
          typeNameMap: variantResult.typeNameMap,
        };
        const types = await Promise.all(
          variantResult.exports.map(async (exportNode) => {
            if (isPublicComponent(exportNode)) {
              return {
                type: 'component' as const,
                name: exportNode.name,
                data: await formatComponentData(
                  exportNode,
                  variantResult.allTypes,
                  variantResult.typeNameMap || {},
                  rewriteContext,
                  {
                    formatting: request.formattingOptions,
                    externalTypes: externalTypesCollector,
                    ordering: request.ordering,
                    descriptionReplacements: request.descriptionReplacements,
                  },
                ),
              };
            }
            if (isPublicHook(exportNode)) {
              return {
                type: 'hook' as const,
                name: exportNode.name,
                data: await formatHookData(
                  exportNode,
                  variantResult.typeNameMap || {},
                  rewriteContext,
                  {
                    formatting: request.formattingOptions,
                    externalTypes: externalTypesCollector,
                    descriptionReplacements: request.descriptionReplacements,
                  },
                ),
              };
            }
            if (isPublicFunction(exportNode)) {
              return {
                type: 'function' as const,
                name: exportNode.name,
                data: await formatFunctionData(
                  exportNode,
                  variantResult.typeNameMap || {},
                  rewriteContext,
                  {
                    formatting: request.formattingOptions,
                    externalTypes: externalTypesCollector,
                    descriptionReplacements: request.descriptionReplacements,
                  },
                ),
              };
            }
            if (isPublicClass(exportNode)) {
              return {
                type: 'class' as const,
                name: exportNode.name,
                data: await formatClassData(
                  exportNode,
                  variantResult.typeNameMap || {},
                  rewriteContext,
                  {
                    formatting: request.formattingOptions,
                    externalTypes: externalTypesCollector,
                    descriptionReplacements: request.descriptionReplacements,
                  },
                ),
              };
            }
            return {
              type: 'raw' as const,
              name: exportNode.name,
              data: await formatRawData(
                exportNode,
                exportNode.name,
                variantResult.typeNameMap || {},
                rewriteContext,
                {
                  formatting: request.formattingOptions,
                  externalTypes: externalTypesCollector,
                  descriptionReplacements: request.descriptionReplacements,
                },
              ),
            };
          }),
        );
        formattedVariantData[variantName] = {
          types,
          typeNameMap: variantResult.typeNameMap,
        };
      }),
    );

    const externalTypes: Record<string, string> = {};
    await Promise.all(
      Array.from(collectedExternalTypes.entries()).map(async ([name, meta]) => {
        const formatted = await prettyFormat(meta.definition, name);
        externalTypes[name] = formatted.trimEnd();
      }),
    );

    const formatEnd = tracker.mark(
      nameMark(functionName, 'Format End', [request.relativePath], true),
    );
    tracker.measure(
      nameMark(functionName, 'Format', [request.relativePath], true),
      formatStart,
      formatEnd,
    );

    const serializedVariantData = stripFunctions(formattedVariantData);
    return {
      success: true,
      variantData: serializedVariantData,
      externalTypes,
      allDependencies,
      performanceLogs: tracker.getLogs(),
      debug: Object.keys(debugInfo).length > 0 ? debugInfo[Object.keys(debugInfo)[0]] : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      performanceLogs: tracker.getLogs(),
    };
  }
}
