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
  namespaces: string[];
  importedFrom: string;
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
          if (reExportResults && reExportResults.length > 0) {
            namespaces = reExportResults.map((result) => result.name).filter(Boolean);
          }

          // Flatten all exports from the re-export results
          const exports = reExportResults.flatMap((result) => result.exports);

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
      // Split exports by name for the Default variant case
      data.exports.forEach((exportNode) => {
        variantData[exportNode.name] = {
          exports: [exportNode],
          allTypes: data.allTypes,
          namespaces: data.namespaces,
          importedFrom: data.importedFrom,
        };
      });
      defaultVariant.dependencies.forEach((file: string) => {
        allDependencies.push(file);
      });
    } else {
      for (const result of variantResults) {
        if (result) {
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
