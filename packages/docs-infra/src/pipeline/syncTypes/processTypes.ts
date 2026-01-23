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
 */
function buildTypeNameMap(exports: ExportNode[]): Map<string, string> {
  const typeNameMap = new Map<string, string>();

  for (const exp of exports) {
    if (exp.name.includes('.')) {
      // e.g., "Component.Root.Props" -> flatName "ComponentRootProps"
      const flatName = exp.name.replace(/\./g, '');
      typeNameMap.set(flatName, exp.name);
    }
  }

  return typeNameMap;
}

/**
 * Recursively collects all type references from a type tree.
 * This helps build a more complete typeNameMap by finding all referenced types.
 */
function collectTypeReferences(
  type: AnyType,
  typeNameMap: Map<string, string>,
  _exports: ExportNode[],
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

      // Only add if the flat name is different from dotted name
      if (flatName !== dottedName && !typeNameMap.has(flatName)) {
        typeNameMap.set(flatName, dottedName);
      }
    }
  }

  // Recursively process nested types
  if ('types' in type && Array.isArray(type.types)) {
    for (const t of type.types) {
      collectTypeReferences(t, typeNameMap, _exports);
    }
  }
  if ('properties' in type && Array.isArray(type.properties)) {
    for (const prop of type.properties) {
      if ('type' in prop) {
        collectTypeReferences(prop.type as AnyType, typeNameMap, _exports);
      }
    }
  }
  if ('props' in type && Array.isArray(type.props)) {
    for (const prop of type.props) {
      if ('type' in prop) {
        collectTypeReferences(prop.type as AnyType, typeNameMap, _exports);
      }
    }
  }
  if ('callSignatures' in type && Array.isArray(type.callSignatures)) {
    for (const sig of type.callSignatures) {
      if ('parameters' in sig && Array.isArray(sig.parameters)) {
        for (const param of sig.parameters) {
          if ('type' in param) {
            collectTypeReferences(param.type as AnyType, typeNameMap, _exports);
          }
        }
      }
      if ('returnValue' in sig && sig.returnValue) {
        const returnValue = sig.returnValue as { type?: AnyType };
        if (returnValue.type) {
          collectTypeReferences(returnValue.type, typeNameMap, _exports);
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

// Worker returns raw export nodes and metadata for formatting in main thread
export interface VariantResult {
  exports: ExportNode[];
  allTypes: ExportNode[]; // All exports including internal types for reference resolution
  namespaces: string[];
  typeNameMap?: Record<string, string>; // Maps flat type names to dotted names (serializable across worker boundary)
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
}

export interface WorkerResponse {
  requestId?: number; // Echoed back from request for tracking
  success: boolean;
  variantData?: Record<string, VariantResult>;
  /** All dependencies as filesystem paths (from TypeScript's program.getSourceFiles()) */
  allDependencies?: string[];
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
      shouldInclude: ({ depth }) => depth <= 10,
      shouldResolveObject: ({ propertyCount, depth }) => propertyCount <= 50 && depth <= 10,
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

          // Build typeNameMap from exports (maps flat names to dotted names)
          const mergedTypeNameMap = buildTypeNameMap(exports);

          // Also collect type references from all exports to build a more complete map
          for (const exp of exports) {
            if ('type' in exp && exp.type) {
              collectTypeReferences(exp.type, mergedTypeNameMap, exports);
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
    const variantData: Record<string, VariantResult> = {};
    const allDependencies: string[] = [];
    const debugInfo: Record<string, { metaFilesCount: number }> = {};

    if (
      variantResults.length === 1 &&
      variantResults[0]?.variantName === 'Default' &&
      variantResults[0]?.variantData.namespaces.length > 0
    ) {
      const defaultVariant = variantResults[0];
      const data = defaultVariant.variantData;

      // Split exports by name for the Default variant case
      data.exports.forEach((exportNode) => {
        variantData[exportNode.name] = {
          exports: [exportNode],
          allTypes: data.allTypes,
          namespaces: data.namespaces,
          typeNameMap: data.typeNameMap, // ✅ Include typeNameMap for namespace exports
        };
      });
      defaultVariant.dependencies.forEach((file: string) => {
        allDependencies.push(file);
      });
      if (defaultVariant.debug) {
        debugInfo.Default = defaultVariant.debug;
      }
    } else {
      for (const result of variantResults) {
        if (result) {
          variantData[result.variantName] = result.variantData;
          result.dependencies.forEach((file: string) => {
            allDependencies.push(file);
          });
          if (result.debug) {
            debugInfo[result.variantName] = result.debug;
          }
        }
      }
    }

    return {
      success: true,
      variantData,
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
