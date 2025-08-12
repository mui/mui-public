import ts from 'typescript';
import { loadConfig, parseFromProgram, type ModuleNode } from 'typescript-api-extractor';
import path from 'path';
import fs from 'fs';
import type { VariantCode } from '../../CodeHighlighter/types';
import { parseCreateFactoryCall } from '../loadPrecomputedCodeHighlighter/parseCreateFactoryCall';
import { resolveVariantPathsWithFs } from '../loaderUtils/resolveModulePathWithFs';
import { replacePrecomputeValue } from '../loadPrecomputedCodeHighlighter/replacePrecomputeValue';
import { getFileNameFromUrl } from '../loaderUtils';

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
  // this.cacheable(); TODO: we need parseFromProgram to return all dependencies

  try {
    // Parse the source to find a single createDemo call
    const demoCall = await parseCreateFactoryCall(source, this.resourcePath);

    // If no createDemo call found, return the source unchanged
    if (!demoCall) {
      callback(null, source);
      return;
    }

    // If skipPrecompute is true, return the source unchanged
    if (demoCall.options.skipPrecompute) {
      callback(null, source);
      return;
    }

    // Load variant data for all variants
    const variantData: Record<string, any> = {};
    const allDependencies: string[] = [];

    // Resolve all variant entry point paths using resolveVariantPathsWithFs
    const resolvedVariantMap = await resolveVariantPathsWithFs(demoCall.variants);

    // Resolve tsconfig.json relative to the webpack project root (rootContext),
    // with graceful fallbacks to process.cwd().
    const tsconfigCandidates = [
      this.rootContext && path.join(this.rootContext, 'tsconfig.json'),
      path.join(process.cwd(), 'tsconfig.json'),
    ].filter(Boolean) as string[];

    const tsconfigPath = tsconfigCandidates.find((p) => p && fs.existsSync(p));
    if (!tsconfigPath) {
      throw new Error(
        `Unable to locate tsconfig.json. Looked in: ${tsconfigCandidates.join(', ')}`,
      );
    }

    const config = loadConfig(tsconfigPath);
    const program = ts.createProgram(config.fileNames, config.options);

    // Process variants in parallel
    const variantPromises = Array.from(resolvedVariantMap.entries()).map(
      async ([variantName, fileUrl]) => {
        const namedExport = demoCall.namedExports[variantName];
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

        const moduleInfo: ModuleNode = parseFromProgram(fileUrl.replace('file://', ''), program);

        return {
          variantName,
          variantData: {
            types: {
              [namedExport || 'default']: moduleInfo,
            },
          },
          dependencies: [],
        };
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
    const modifiedSource = replacePrecomputeValue(source, variantData, demoCall);

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
