// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import fs from 'fs/promises';

import { parseFromProgram } from 'typescript-api-extractor';
import type { VariantCode } from '../../CodeHighlighter/types';
import { parseCreateFactoryCall } from '../loadPrecomputedCodeHighlighter/parseCreateFactoryCall';
import { replacePrecomputeValue } from '../loadPrecomputedCodeHighlighter/replacePrecomputeValue';
import { getFileNameFromUrl, JAVASCRIPT_MODULE_EXTENSIONS } from '../loaderUtils';
import { createOptimizedProgram, MissingGlobalTypesError } from './createOptimizedProgram';

interface LoaderContext {
  resourcePath: string;
  addDependency(dependency: string): void;
  async(): (err?: Error | null, content?: string) => void;
  cacheable(): void;
  emitFile?(name: string, content: string): void;
  rootContext?: string;
}

/**
 * Webpack loader that processes types and precomputes meta.
 *
 * Finds createTypesMeta calls, loads and processes all component types,
 * then injects the precomputed type meta back into the source.
 *
 * Supports single component syntax: createTypesMeta(import.meta.url, Component)
 * And object syntax: createTypesMeta(import.meta.url, { Component1, Component2 })
 *
 * Automatically skips processing if skipPrecompute: true is set.
 */
export async function loadPrecomputedTypesMeta(this: LoaderContext, source: string): Promise<void> {
  const callback = this.async();
  this.cacheable();

  try {
    // Parse the source to find a single createTypesMeta call
    // TODO: our create factory parser doesn't appear to support external imports
    const typesMetaCall = await parseCreateFactoryCall(source, this.resourcePath, {
      allowExternalVariants: true,
    });

    // If no createTypesMeta call found, return the source unchanged
    if (!typesMetaCall) {
      callback(null, source);
      return;
    }

    // If skipPrecompute is true, return the source unchanged
    if (typesMetaCall.options.skipPrecompute) {
      callback(null, source);
      return;
    }

    // Load variant data for all variants
    const variantData: Record<string, any> = {};
    const allDependencies: string[] = [];

    // Resolve all variant entry point paths using import.meta.resolve
    const resolvedVariantMap = new Map<string, string>();
    if (typesMetaCall.variants) {
      const variantPromises = Object.entries(typesMetaCall.variants).map(
        async ([variantName, variantPath]) => {
          const resolvedPath = import.meta.resolve(variantPath);

          // Check all extensions in parallel
          const extensionResults = await Promise.all(
            JAVASCRIPT_MODULE_EXTENSIONS.map(async (ext) => {
              const fullPath = `${resolvedPath.replace('file://', '')}${ext}`;
              const exists = await fs
                .access(fullPath)
                .then(() => true)
                .catch(() => false);
              return exists ? fullPath : null;
            }),
          );

          // Find the first existing file
          const foundPath = extensionResults.find(Boolean);
          return foundPath ? ([variantName, foundPath] as const) : null;
        },
      );

      const variantResults = await Promise.all(variantPromises);

      // Add successful results to the map
      variantResults.forEach((result) => {
        if (result) {
          resolvedVariantMap.set(result[0], result[1]);
        }
      });
    }

    // Resolve tsconfig.json relative to the webpack project root (rootContext),
    // with graceful fallbacks to process.cwd().
    const tsconfigCandidates = [
      this.rootContext && path.join(this.rootContext, 'tsconfig.json'),
      path.join(process.cwd(), 'tsconfig.json'),
      // TODO: what if we need to load the tsconfig.json from an external project?
    ].filter(Boolean) as string[];

    const existsResults = await Promise.all(
      tsconfigCandidates.map(async (candidate) => {
        const exists = await fs
          .access(candidate)
          .then(() => true)
          .catch(() => false);
        return exists ? candidate : null;
      }),
    );
    const tsconfigPath = existsResults.find(Boolean);
    if (!tsconfigPath) {
      throw new Error(
        `Unable to locate tsconfig.json. Looked in: ${tsconfigCandidates.join(', ')}`,
      );
    }

    // Collect all entrypoints for optimized program creation
    const allEntrypoints = Array.from(resolvedVariantMap.values());

    const globalTypes = typesMetaCall?.structuredOptions?.globalTypes[0].map((s: any) =>
      s.replace(/['"]/g, ''),
    );

    // Create optimized TypeScript program
    // This provides 70%+ performance improvement by reducing file loading
    // from ~700+ files to ~80-100 files while maintaining type accuracy
    let program;
    try {
      program = createOptimizedProgram(tsconfigPath, allEntrypoints, {
        globalTypes,
      });
    } catch (error) {
      if (error instanceof MissingGlobalTypesError) {
        // Enhance the error message with context about the createTypesMeta call
        throw new Error(
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
        );
      }
      throw error;
    }

    // Process variants in parallel
    const variantPromises = Array.from(resolvedVariantMap.entries()).map(
      async ([variantName, fileUrl]) => {
        const namedExport = typesMetaCall.namedExports?.[variantName];
        const variant: VariantCode | string = fileUrl;
        if (namedExport) {
          const { fileName } = getFileNameFromUrl(variant);
          if (!fileName) {
            throw new Error(
              `Cannot determine fileName from URL "${variant}" for variant "${variantName}". ` +
                `Please ensure the URL has a valid file extension.`,
            );
          }
        }

        const entrypoint = fileUrl.replace('file://', '');
        try {
          // Ensure the entrypoint exists and is accessible to the TypeScript program
          const sourceFile = program.getSourceFile(entrypoint);
          if (!sourceFile) {
            throw new Error(
              `Source file not found in TypeScript program: ${entrypoint}\n` +
                `Make sure the file exists and is included in the TypeScript compilation.`,
            );
          }

          // Pass parser options with proper configuration
          const moduleInfo = parseFromProgram(entrypoint, program, {
            includeExternalTypes: false, // Only include project types
            shouldInclude: ({ depth }) => depth <= 10, // Limit depth
            shouldResolveObject: ({ propertyCount, depth }) => propertyCount <= 50 && depth <= 10,
          });

          // Get all source files that are dependencies of this entrypoint
          const dependencies = [entrypoint];

          if (sourceFile) {
            // Get all imported files from the TypeScript program
            // This includes all transitively imported files (imports within imports)
            const allSourceFiles = program.getSourceFiles();
            const projectFiles = allSourceFiles
              .map((sf) => sf.fileName)
              .filter(
                (fileName) =>
                  // Exclude TypeScript lib files but include everything else (including node_modules for pnpm workspaces)
                  !fileName.includes('lib.') &&
                  !fileName.includes('lib/') &&
                  (fileName.endsWith('.ts') || fileName.endsWith('.tsx')),
              );

            dependencies.push(...projectFiles);
          }

          return {
            variantName,
            variantData: {
              types: moduleInfo,
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
    for (const result of variantResults) {
      if (result) {
        variantData[result.variantName] = result.variantData;
        result.dependencies.forEach((file: string) => {
          allDependencies.push(file);
        });
      }
    }

    // Replace the factory function call with the actual precomputed data
    const modifiedSource = replacePrecomputeValue(source, variantData, typesMetaCall);

    // Add all dependencies to webpack's watch list
    allDependencies.forEach((dep) => {
      // Strip 'file://' prefix if present before adding to webpack's dependency tracking
      this.addDependency(dep.startsWith('file://') ? dep.slice(7) : dep);
    });

    callback(null, modifiedSource);
  } catch (error) {
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}
