// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import { pathToFileURL } from 'url';

import type { LoaderContext } from 'webpack';
import { extractNameAndSlugFromUrl } from '../loaderUtils';
import {
  createPerformanceLogger,
  logPerformance,
  nameMark,
  performanceMeasure,
} from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { parseCreateFactoryCall } from '../loadPrecomputedCodeHighlighter/parseCreateFactoryCall';
import { replacePrecomputeValue } from '../loadPrecomputedCodeHighlighter/replacePrecomputeValue';
import type { TypesTableMeta } from '../../abstractCreateTypes';
import type { FormatInlineTypeOptions } from '../loadServerTypesMeta/format';
import { loadServerTypesMeta, type TypesMeta } from '../loadServerTypesMeta';

export type { TypesMeta };

export type LoaderOptions = {
  performance?: {
    logging?: boolean;
    notableMs?: number;
    showWrapperMeasures?: boolean;
    significantDependencyCountThreshold?: number;
  };
  /** Options for formatting types in tables */
  formatting?: FormatInlineTypeOptions;
  /**
   * Directory path for socket and lock files used for IPC between workers.
   * Useful for Windows where the default temp directory may not support Unix domain sockets.
   * @example '.next/cache/docs-infra/types-meta-worker'
   */
  socketDir?: string;
};

const functionName = 'Load Precomputed Types Meta';

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
export async function loadPrecomputedTypesMeta(
  this: LoaderContext<LoaderOptions>,
  source: string,
): Promise<void> {
  const callback = this.async();
  this.cacheable();

  const options = this.getOptions();
  const performanceNotableMs = options.performance?.notableMs ?? 100;
  const performanceShowWrapperMeasures = options.performance?.showWrapperMeasures ?? false;

  const resourceName = extractNameAndSlugFromUrl(
    new URL('.', pathToFileURL(this.resourcePath)).pathname,
  ).name;

  // Ensure rootContext always ends with / for correct URL resolution
  const rootContext = this.rootContext || process.cwd();

  const relativePath = path.relative(rootContext, this.resourcePath);

  let observer: PerformanceObserver | undefined = undefined;
  if (options.performance?.logging) {
    observer = new PerformanceObserver(
      createPerformanceLogger(performanceNotableMs, performanceShowWrapperMeasures, relativePath),
    );
    observer.observe({ entryTypes: ['measure'] });
  }

  let currentMark = nameMark(functionName, 'Start Loading', [relativePath]);
  performance.mark(currentMark);

  try {
    // Parse the source to find a single createTypesMeta call
    const typesMetaCall = await parseCreateFactoryCall(source, this.resourcePath, {
      allowExternalVariants: true,
    });

    currentMark = performanceMeasure(
      currentMark,
      { mark: 'Parsed Factory', measure: 'Factory Parsing' },
      [functionName, relativePath],
    );

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

    // Resolve socket directory from loader options
    const socketDir = options.socketDir ? path.resolve(rootContext, options.socketDir) : undefined;

    // Call the core server-side logic
    const result = await loadServerTypesMeta({
      resourcePath: this.resourcePath,
      resourceName,
      rootContext,
      relativePath,
      typesMetaCall,
      formattingOptions: options.formatting,
      socketDir,
      performanceLogging: options.performance?.logging,
    });

    currentMark = performanceMeasure(
      currentMark,
      {
        mark: 'server types meta loaded',
        measure: 'server types meta loading',
      },
      [functionName, relativePath],
      true,
    );

    // Determine if the factory was written with a single component or multiple components (object form)
    // createTypes(import.meta.url, Checkbox) => 'Checkbox'
    // createTypes(import.meta.url, { Checkbox, Button }) => undefined
    const singleComponentName =
      typeof typesMetaCall.structuredVariants === 'string'
        ? typesMetaCall.structuredVariants
        : undefined;

    const precompute: TypesTableMeta['precompute'] = {
      exports: result.highlightedVariantData,
      singleComponentName,
    };

    // Replace the factory function call with the actual precomputed data
    const modifiedSource = replacePrecomputeValue(source, precompute, typesMetaCall);

    performanceMeasure(
      currentMark,
      { mark: 'replaced precompute', measure: 'precompute replacement' },
      [functionName, relativePath],
    );

    // Add all dependencies to webpack's watch list
    // Dependencies are already paths from TypeScript's program.getSourceFiles()
    result.allDependencies.forEach((dep) => {
      this.addDependency(dep);
    });

    if (options.performance?.logging) {
      if (
        options.performance?.significantDependencyCountThreshold &&
        result.allDependencies.length > options.performance.significantDependencyCountThreshold
      ) {
        // eslint-disable-next-line no-console
        console.log(
          `[${functionName}] ${relativePath} - added ${result.allDependencies.length} dependencies to watch:\n\n${result.allDependencies.map((dep) => `- ${path.relative(rootContext, dep)}`).join('\n')}\n`,
        );
      }
    }

    // log any pending performance entries before completing
    observer
      ?.takeRecords()
      ?.forEach((entry) =>
        logPerformance(entry, performanceNotableMs, performanceShowWrapperMeasures, relativePath),
      );
    observer?.disconnect();
    callback(null, modifiedSource);
  } catch (error) {
    // log any pending performance entries before completing
    observer
      ?.takeRecords()
      ?.forEach((entry) =>
        logPerformance(entry, performanceNotableMs, performanceShowWrapperMeasures, relativePath),
      );
    observer?.disconnect();
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}
