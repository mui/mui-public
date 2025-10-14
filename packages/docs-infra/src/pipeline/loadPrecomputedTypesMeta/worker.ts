// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import { parentPort } from 'worker_threads';

import type { CompilerOptions } from 'typescript';
import { ExportNode, parseFromProgram, ParserOptions } from 'typescript-api-extractor';
import { createOptimizedProgram, MissingGlobalTypesError } from './createOptimizedProgram';
import { formatComponentData, isPublicComponent } from './formatComponent';
import { formatHookData, isPublicHook } from './formatHook';
import { parseExports } from './parseExports';
import { PerformanceTracker, type PerformanceLog } from './performanceTracking';
import { nameMark } from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { SocketClient, tryAcquireServerLock, releaseServerLock } from './socketClient';
import { SocketServer } from './socketServer';

console.warn('[Worker] Worker thread module loaded - Process ID:', process.pid);

export type TypesMeta =
  | {
      type: 'component';
      name: string;
      data: any;
    }
  | {
      type: 'hook';
      name: string;
      data: any;
    }
  | {
      type: 'other';
      name: string;
      data: ExportNode;
    };

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
  variantData?: Record<
    string,
    {
      types: TypesMeta[];
      importedFrom: string;
    }
  >;
  allDependencies?: string[];
  performanceLogs?: PerformanceLog[];
  error?: string;
}

async function processTypesInWorker(request: WorkerRequest): Promise<WorkerResponse> {
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
          nameMark(functionName, `Variant ${variantName} Start`, [request.relativePath]),
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

          const formatStart = tracker.mark(
            nameMark(functionName, `Variant ${variantName} Format Start`, [request.relativePath]),
          );
          const types: TypesMeta[] = await Promise.all(
            exports.map(async (exportNode) => {
              if (isPublicComponent(exportNode)) {
                const componentApiReference = await formatComponentData(
                  exportNode,
                  allTypes,
                  namespaces,
                );
                return { type: 'component', name: exportNode.name, data: componentApiReference };
              }

              if (isPublicHook(exportNode)) {
                const hookApiReference = await formatHookData(exportNode, []);
                return { type: 'hook', name: exportNode.name, data: hookApiReference };
              }

              return { type: 'other', name: exportNode.name, data: exportNode };
            }),
          );
          const formatEnd = tracker.mark(
            nameMark(functionName, `Variant ${variantName} Formatted`, [request.relativePath]),
          );
          tracker.measure(
            nameMark(functionName, `Variant ${variantName} Formatting`, [request.relativePath]),
            formatStart,
            formatEnd,
          );

          const variantEnd = tracker.mark(
            nameMark(functionName, `Variant ${variantName} Complete`, [request.relativePath]),
          );
          tracker.measure(
            nameMark(functionName, `Variant ${variantName} Total`, [request.relativePath]),
            variantStart,
            variantEnd,
          );

          return {
            variantName,
            variantData: {
              types,
              importedFrom: namedExport || 'default',
            },
            dependencies,
            namespaces,
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
    const variantData: Record<
      string,
      {
        types: TypesMeta[];
        importedFrom: string;
      }
    > = {};
    const allDependencies: string[] = [];

    if (
      variantResults.length === 1 &&
      variantResults[0]?.variantName === 'Default' &&
      variantResults[0]?.namespaces.length > 0
    ) {
      const defaultVariant = variantResults[0];
      const data = defaultVariant?.variantData;
      data.types.forEach((type) => {
        variantData[type.data.name] = { types: [type], importedFrom: data.importedFrom };
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

// Worker message handler
let socketClient: SocketClient | null = null;
let socketServer: SocketServer | null = null;

// Initialize socket connection
const initSocket = async () => {
  console.warn('[Worker] Initializing socket connection...');
  console.warn('[Worker] Process ID:', process.pid);

  // Try to acquire the server lock (only one worker will succeed)
  let shouldBeServer = await tryAcquireServerLock();

  if (shouldBeServer) {
    // This is the first worker - create a socket server
    console.warn('[Worker] This worker will act as the socket server');

    socketServer = new SocketServer(processTypesInWorker);
    await socketServer.start();
  } else {
    // Another worker is already running - wait a bit for it to start, then connect
    console.warn('[Worker] Another worker is the server, connecting as client...');

    // Wait for server to be ready
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });

    socketClient = new SocketClient();
    try {
      await socketClient.connect();
    } catch (error) {
      console.error('[Worker] Failed to connect to socket:', error);

      // Retry: Maybe no server exists yet, try to become the server ourselves
      console.warn('[Worker] Retrying lock acquisition in case no server exists...');
      shouldBeServer = await tryAcquireServerLock();

      if (shouldBeServer) {
        console.warn('[Worker] Successfully acquired lock on retry, becoming server');
        socketClient = null;
        socketServer = new SocketServer(processTypesInWorker);
        await socketServer.start();
      } else {
        console.warn(
          '[Worker] Lock still held by another worker, falling back to local processing',
        );
        // Fall back to processing locally
        socketClient = null;
      }
    }
  }
};

// Start initialization
const socketReady = initSocket();

if (parentPort) {
  parentPort.on('message', async (request: WorkerRequest) => {
    // Wait for socket initialization to complete
    await socketReady;

    let response: WorkerResponse;

    // If we have a socket client connection, forward the request
    if (socketClient) {
      try {
        response = await socketClient.sendRequest(request);
      } catch (error) {
        console.error('[Worker] Socket request failed, falling back to local processing:', error);
        socketClient = null; // Disconnect on error
        response = await processTypesInWorker(request);
      }
    } else {
      // Process locally (either server worker or standalone worker)
      response = await processTypesInWorker(request);
    }

    // Echo back the requestId for the worker manager to match responses
    parentPort?.postMessage({
      ...response,
      requestId: request.requestId,
    });
  });

  // Clean up on worker termination
  parentPort.on('close', () => {
    if (socketClient) {
      socketClient.close();
    }
    if (socketServer) {
      socketServer.shutdown();
      // Release lock asynchronously (fire and forget since worker is closing)
      releaseServerLock().catch((error) => {
        console.error('[Worker] Failed to release lock on close:', error);
      });
    }
  });
}
