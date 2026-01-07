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
import { createOptimizedProgram, MissingGlobalTypesError } from './createOptimizedProgram';
import { PerformanceTracker, type PerformanceLog } from './performanceTracking';
import { nameMark } from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { findMetaFiles } from './findMetaFiles';

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
  importedFrom: string;
  typeNameMap?: Record<string, string>; // Maps flat type names to dotted names (serializable across worker boundary)
}

export interface WorkerRequest {
  requestId?: number; // Added by worker manager for request tracking
  projectPath: string;
  compilerOptions: CompilerOptions;
  /** Entrypoints as filesystem paths */
  allEntrypoints: string[];
  globalTypes?: string[];
  /** Map serialized as array of [variantName, fileUrl] tuples where fileUrl uses file:// protocol */
  resolvedVariantMap: Array<[string, string]>;
  namedExports?: Record<string, string>;
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
    sourceFilePaths?: string[];
    metaFilesCount?: number;
    adjacentFilesCount?: number;
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

    let program;
    try {
      program = createOptimizedProgram(
        request.projectPath,
        request.compilerOptions,
        request.allEntrypoints,
        {
          globalTypes: request.globalTypes,
        },
        tracker,
        functionName,
        [request.relativePath],
      );
    } catch (error) {
      if (error instanceof MissingGlobalTypesError) {
        return {
          success: false,
          error:
            `${error.message}\n\n` +
            `To fix this, update your createTypesMeta call:\n` +
            `export default createTypesMeta(import.meta.url, YourComponent, {\n` +
            `  globalTypes: [${error.suggestions.map((s) => `'${s}'`).join(', ')}],\n` +
            `});\n\n` +
            `Common globalTypes values:\n` +
            `- 'react' for React components\n` +
            `- 'react-dom' for React DOM types\n` +
            `- 'node' for Node.js globals\n` +
            `- 'dom' for browser/DOM globals`,
        };
      }
      throw error;
    }

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

        const namedExport = request.namedExports?.[variantName];
        // Convert file:// URL to filesystem path for TypeScript
        const entrypoint = fileURLToPath(fileUrl);
        const entrypointDir = fileURLToPath(new URL('.', fileUrl));

        try {
          // Ensure the entrypoint exists and is accessible to the TypeScript program
          const sourceFile = program.getSourceFile(entrypoint);
          if (!sourceFile) {
            throw new Error(
              `Source file not found in TypeScript program: ${entrypoint}\n` +
                `Make sure the file exists and is included in the TypeScript compilation.`,
            );
          }

          let namespaces: string[] = [];
          const exportName = request.namedExports?.[variantName];
          if (exportName) {
            namespaces.push(exportName);
          }

          const parseStart = tracker.mark(
            nameMark(functionName, `Variant ${variantName} Parse Start`, [request.relativePath]),
          );

          // Use parseFromProgram directly - it now handles namespace exports,
          // type aliases, and re-exports properly
          const { exports } = parseFromProgram(entrypoint, program, parserOptions);

          // Extract namespaces from the exports (e.g., "Menu" from "Menu.Root")
          const extractedNamespaces = extractNamespaces(exports);
          if (extractedNamespaces.length > 0) {
            namespaces = extractedNamespaces;
          }

          // Build typeNameMap from exports (maps flat names to dotted names)
          const mergedTypeNameMap = buildTypeNameMap(exports);

          // Also collect type references from all exports to build a more complete map
          for (const exp of exports) {
            if ('type' in exp && exp.type) {
              collectTypeReferences(exp.type, mergedTypeNameMap, exports);
            }
          }

          // Get all source files that are dependencies of this entrypoint
          const dependencies = [...request.dependencies, entrypoint];

          // Get all imported files from the TypeScript program
          const allSourceFiles = program.getSourceFiles();
          const dependantFiles = allSourceFiles
            .map((sf) => sf.fileName)
            .filter((fileName) => !fileName.includes('node_modules/typescript/lib'));

          dependencies.push(...dependantFiles);

          // Collect adjacent files from the main entrypoint directory
          const adjacentFiles = dependantFiles.filter(
            (fileName) => fileName !== entrypoint && fileName.startsWith(entrypointDir),
          );

          // Also collect files from directories of all source files in the program
          // This handles re-exported modules' directories for DataAttributes/CssVars files
          // Only include files that are actually in a subdirectory of the entrypoint directory
          const allSourceFilePaths = dependantFiles.filter((fileName) =>
            fileName.startsWith(entrypointDir),
          );

          let metaFilesCount = 0;
          try {
            // For each source file path, find DataAttributes and CssVars files in that directory
            const metaFilesPromises = allSourceFilePaths.map((sourcePath: string) =>
              findMetaFiles(sourcePath),
            );
            const allMetaFiles = await Promise.all(metaFilesPromises);
            const flatMetaFiles = allMetaFiles.flat();
            metaFilesCount = flatMetaFiles.length;

            // Add meta files directly to adjacentFiles
            // These files aren't imported, so they won't be in dependantFiles
            flatMetaFiles.forEach((metaFile: string) => {
              if (!adjacentFiles.includes(metaFile)) {
                adjacentFiles.push(metaFile);
              }
            });
          } catch (error) {
            // If we can't find meta files, just continue with the basic adjacent files
            console.warn(
              `[processTypes] Failed to find meta files from re-export source paths:`,
              error instanceof Error ? error.message : error,
            );
          }

          const allInternalTypes = adjacentFiles.map((file) => {
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
              importedFrom: namedExport || 'default',
              // Convert Map to Record for serialization across worker boundary
              typeNameMap:
                mergedTypeNameMap.size > 0 ? Object.fromEntries(mergedTypeNameMap) : undefined,
            },
            dependencies,
            debug: {
              sourceFilePaths: allSourceFilePaths,
              metaFilesCount,
              adjacentFilesCount: adjacentFiles.length,
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
    const debugInfo: Record<
      string,
      { sourceFilePaths: string[]; metaFilesCount: number; adjacentFilesCount: number }
    > = {};

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
          importedFrom: data.importedFrom,
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
