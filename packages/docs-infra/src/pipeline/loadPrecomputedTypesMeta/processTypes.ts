import type { CompilerOptions } from 'typescript';
import { ExportNode, parseFromProgram, ParserOptions } from 'typescript-api-extractor';
import { createOptimizedProgram, MissingGlobalTypesError } from './createOptimizedProgram';
import { parseExports } from './parseExports';
import { PerformanceTracker, type PerformanceLog } from './performanceTracking';
import { nameMark } from '../loadPrecomputedCodeHighlighter/performanceLogger';

// Worker returns raw export nodes and metadata for formatting in main thread
export interface VariantResult {
  exports: ExportNode[];
  allTypes: ExportNode[]; // All exports including internal types for reference resolution
  namespaces: string[]; // Part names like "Root", "Part" for type formatting
  namespaceName?: string; // Namespace prefix like "Component" for data attributes lookup
  importedFrom: string;
  allExportNames?: string[]; // All export names from the original parse (for namespace resolution)
}

export interface WorkerRequest {
  requestId?: number; // Added by worker manager for request tracking
  projectPath: string;
  compilerOptions: CompilerOptions;
  allEntrypoints: string[];
  globalTypes?: string[];
  resolvedVariantMap: Array<[string, string]>; // Map serialized as array of tuples
  namedExports?: Record<string, string>;
  dependencies: string[];
  rootContext: string;
  relativePath: string;
}

export interface WorkerResponse {
  requestId?: number; // Echoed back from request for tracking
  success: boolean;
  variantData?: Record<string, VariantResult>;
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
    const checker = program.getTypeChecker();

    // Process variants in parallel
    const resolvedVariantMap = new Map(request.resolvedVariantMap);
    const variantPromises = Array.from(resolvedVariantMap.entries()).map(
      async ([variantName, fileUrl]) => {
        const variantStart = tracker.mark(
          nameMark(functionName, `Variant ${variantName} Start`, [request.relativePath], true),
        );

        const namedExport = request.namedExports?.[variantName];
        const entrypoint = fileUrl.replace('file://', '');
        const entrypointDir = new URL('.', fileUrl).pathname;

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

          const reExportResults = parseExports(sourceFile, checker, program, parserOptions);

          // Extract namespace information from re-export results
          let namespaceName: string | undefined;

          if (reExportResults && reExportResults.length > 0) {
            // Set namespaceName to the first namespace found (for backward compatibility)
            const firstNamedResult = reExportResults.find((result) => result.name);
            if (firstNamedResult) {
              namespaceName = firstNamedResult.name;
            }

            // Extract the base export names (without dots) from all exports
            // e.g., "Root", "Part" from ["Root", "Root.State", "Part", "Part.State"]
            const exportNamesSet = new Set<string>();
            reExportResults.forEach((result) => {
              result.exports.forEach((exp) => {
                // Get the base name (before any dots)
                const baseName = exp.name.split('.')[0];
                exportNamesSet.add(baseName);
              });
            });
            namespaces = Array.from(exportNamesSet);
          }

          // Flatten all exports from the re-export results
          // For multi-namespace exports, store namespace info on a separate property
          let exports = reExportResults.flatMap((result) => {
            if (result.name) {
              // This result has a namespace - store it on the export node
              return result.exports.map((exp) => {
                // Create a new export node with namespace metadata
                const exportWithNamespace = Object.create(Object.getPrototypeOf(exp));
                Object.assign(exportWithNamespace, exp);
                // Store namespace on a custom property instead of encoding in the name
                (exportWithNamespace as ExportNode & { exportNamespace: string }).exportNamespace =
                  result.name;
                return exportWithNamespace;
              });
            }
            // No namespace - return exports as-is
            return result.exports;
          });

          // Deduplicate: remove flat types that are redundant with namespaced types
          // e.g., remove "AccordionRootState" if we have "Root.State" in the Accordion namespace
          if (namespaces.length > 0) {
            const namespacedTypes: string[] = [];

            // Collect all namespaced export names
            exports.forEach((exp) => {
              if (exp.name.includes('.')) {
                namespacedTypes.push(exp.name);
              }
            });

            // Filter out flat types that have namespaced equivalents
            // e.g., if we have "Root.State", remove "AccordionRootState"
            exports = exports.filter((exp) => {
              if (!exp.name.includes('.')) {
                // This is a flat export - check if there's a namespaced version
                // Pattern: if we have "Root.State" and this is "AccordionRootState"
                // where namespace is "Accordion", then this is redundant
                for (const ns of namespaces) {
                  // Check if this name starts with the namespace prefix
                  if (exp.name.startsWith(ns)) {
                    // Get the part after the namespace: "RootState" from "AccordionRootState"
                    const withoutNamespace = exp.name.slice(ns.length);
                    // Check if there's a namespaced equivalent with dots
                    // e.g., "Root.State" should match "AccordionRootState" (both become "RootState" without dots/namespace)
                    for (const namespacedType of namespacedTypes) {
                      const namespacedWithoutDots = namespacedType.replace(/\./g, '');
                      if (namespacedWithoutDots === withoutNamespace) {
                        // This flat type is redundant with a namespaced type
                        return false;
                      }
                    }
                  }
                }
              }
              return true;
            });
          }

          // Get all source files that are dependencies of this entrypoint
          const dependencies = [...request.dependencies, entrypoint];

          // Get all imported files from the TypeScript program
          const allSourceFiles = program.getSourceFiles();
          const dependantFiles = allSourceFiles
            .map((sf) => sf.fileName)
            .filter((fileName) => !fileName.includes('node_modules/typescript/lib'));

          dependencies.push(...dependantFiles);

          const adjacentFiles = dependantFiles.filter(
            (fileName) => fileName !== entrypoint && fileName.startsWith(entrypointDir),
          );

          const allInternalTypes = adjacentFiles.map((file) => {
            if (internalTypesCache[file]) {
              return internalTypesCache[file];
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
              namespaceName,
              importedFrom: namedExport || 'default',
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

    if (
      variantResults.length === 1 &&
      variantResults[0]?.variantName === 'Default' &&
      variantResults[0]?.variantData.namespaces.length > 0
    ) {
      const defaultVariant = variantResults[0];
      const data = defaultVariant.variantData;
      // Collect all export names for namespace resolution
      const allExportNames = data.exports.map((exp) => exp.name);

      // Group exports by their namespace
      // For multi-namespace files (e.g., both Checkbox and Button exports),
      // each namespace gets its own variant with all its exports
      const exportsByNamespace = new Map<string, ExportNode[]>();

      data.exports.forEach((exportNode) => {
        // Extract the namespace from the metadata property
        const exportNamespaceName =
          (exportNode as ExportNode & { exportNamespace?: string }).exportNamespace ||
          data.namespaceName ||
          'Default';

        if (!exportsByNamespace.has(exportNamespaceName)) {
          exportsByNamespace.set(exportNamespaceName, []);
        }

        exportsByNamespace.get(exportNamespaceName)!.push(exportNode);
      });

      // Determine if we have multiple namespaces (need prefixing) or single namespace (no prefixing)
      const hasMultipleNamespaces = exportsByNamespace.size > 1;

      // Create a variant for each namespace
      exportsByNamespace.forEach((exports, namespaceName) => {
        // Transform export names based on whether we have multiple namespaces
        const transformedExports = exports.map((exportNode) => {
          // Create a copy with the appropriate name
          const transformedExport = Object.create(Object.getPrototypeOf(exportNode));
          Object.assign(transformedExport, exportNode);

          if (hasMultipleNamespaces) {
            // Multiple namespaces: prefix with namespace (e.g., "Button.Root")
            transformedExport.name = `${namespaceName}.${exportNode.name}`;
          }
          // else: Single namespace: keep the name as-is (no prefix needed)

          return transformedExport;
        });

        variantData[namespaceName] = {
          exports: transformedExports,
          allTypes: data.allTypes,
          namespaces: data.namespaces,
          namespaceName, // Use the namespace as the variant key
          importedFrom: data.importedFrom,
          allExportNames, // Include all export names for namespace resolution
        };
      });

      defaultVariant.dependencies.forEach((file: string) => {
        allDependencies.push(file);
      });
    } else {
      // For multi-variant requests, normalize namespaceName across all results
      // If one variant has a namespaceName, all variants from the same file should share it
      const namespaceNamesByFile = new Map<string, string>();

      // First pass: collect namespaceName from each file
      for (const result of variantResults) {
        if (result?.variantData.namespaceName) {
          const fileUrl = resolvedVariantMap.get(result.variantName);
          if (fileUrl) {
            namespaceNamesByFile.set(fileUrl, result.variantData.namespaceName);
          }
        }
      }

      // Second pass: apply namespaceName to all variants from the same file
      for (const result of variantResults) {
        if (result) {
          const fileUrl = resolvedVariantMap.get(result.variantName);
          if (fileUrl && !result.variantData.namespaceName) {
            // If this variant doesn't have a namespaceName but another variant from the same file does, use it
            const sharedNamespaceName = namespaceNamesByFile.get(fileUrl);
            if (sharedNamespaceName) {
              result.variantData.namespaceName = sharedNamespaceName;
            }
          }

          variantData[result.variantName] = result.variantData;
          result.dependencies.forEach((file: string) => {
            allDependencies.push(file);
          });
        }
      }
    }

    return {
      success: true,
      variantData,
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
