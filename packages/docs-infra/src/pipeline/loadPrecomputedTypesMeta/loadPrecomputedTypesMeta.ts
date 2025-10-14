// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';
// eslint-disable-next-line n/prefer-node-protocol
import fs from 'fs/promises';

import { resolve } from 'import-meta-resolve';
import type { LoaderContext } from 'webpack';
import { ExportNode, parseFromProgram, ParserOptions } from 'typescript-api-extractor';
import type { VariantCode } from '../../CodeHighlighter/types';
import { parseCreateFactoryCall } from '../loadPrecomputedCodeHighlighter/parseCreateFactoryCall';
import { replacePrecomputeValue } from '../loadPrecomputedCodeHighlighter/replacePrecomputeValue';
import { extractNameAndSlugFromUrl, getFileNameFromUrl } from '../loaderUtils';
import { createOptimizedProgram, MissingGlobalTypesError } from './createOptimizedProgram';
import {
  createPerformanceLogger,
  logPerformance,
  nameMark,
} from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { resolveVariantPathsWithFs } from '../loaderUtils/resolveModulePathWithFs';
import { loadTypescriptConfig } from './loadTypescriptConfig';
import {
  ComponentTypeMeta as ComponentType,
  formatComponentData,
  isPublicComponent,
} from './formatComponent';
import { formatHookData, HookTypeMeta as HookType, isPublicHook } from './formatHook';
import { generateTypesMarkdown } from './generateTypesMarkdown';
import { parseExports } from './parseExports';
import { findMetaFiles } from './findMetaFiles';

export type LoaderOptions = {
  performance?: {
    logging?: boolean;
    notableMs?: number;
    showWrapperMeasures?: boolean;
  };
};

export type ComponentTypeMeta = ComponentType;
export type HookTypeMeta = HookType;

export type TypesMeta =
  | {
      type: 'component';
      name: string;
      data: ComponentTypeMeta;
    }
  | {
      type: 'hook';
      name: string;
      data: HookTypeMeta;
    }
  | {
      type: 'other';
      name: string;
      data: ExportNode;
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
    new URL('.', `file://${this.resourcePath}`).pathname,
  ).name;

  let observer: PerformanceObserver | undefined = undefined;
  if (options.performance?.logging) {
    observer = new PerformanceObserver(
      createPerformanceLogger(performanceNotableMs, performanceShowWrapperMeasures),
    );
    observer.observe({ entryTypes: ['measure'] });
  }

  const relativePath = path.relative(this.rootContext || process.cwd(), this.resourcePath);
  const startMark = nameMark(functionName, 'Start Loading', [relativePath]);
  performance.mark(startMark);
  let currentMark = startMark;

  try {
    // Parse the source to find a single createTypesMeta call
    const typesMetaCall = await parseCreateFactoryCall(source, this.resourcePath, {
      allowExternalVariants: true,
    });

    const parsedFactoryMark = nameMark(functionName, 'Parsed Factory', [relativePath]);
    performance.mark(parsedFactoryMark);
    performance.measure(
      nameMark(functionName, 'Factory Parsing', [relativePath]),
      currentMark,
      parsedFactoryMark,
    );
    currentMark = parsedFactoryMark;

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

    const watchSourceDirectly = Boolean(typesMetaCall.structuredOptions?.watchSourceDirectly);

    const config = await loadTypescriptConfig(tsconfigPath);

    let paths: Record<string, string[]> | undefined;
    if (watchSourceDirectly && config.options.paths) {
      const optionsPaths = config.options.paths;
      Object.keys(optionsPaths).forEach((key) => {
        const regex = `^${key.replace('**', '(.+)').replace('*', '([^/]+)')}$`;
        if (!paths) {
          paths = {};
        }
        paths[regex] = optionsPaths[key].map((p) => {
          let index = 0;
          return p.replace(/\*\*|\*/g, () => {
            index = index + 1;
            return `$${index}`;
          });
        });
      });
    }

    const tsconfigLoadedMark = nameMark(functionName, 'tsconfig.json loaded', [relativePath]);
    performance.mark(tsconfigLoadedMark);
    performance.measure(
      nameMark(functionName, 'tsconfig.json loading', [relativePath]),
      currentMark,
      tsconfigLoadedMark,
    );
    currentMark = tsconfigLoadedMark;

    // Load variant data for all variants
    const variantData: Record<
      string,
      {
        types: TypesMeta[];
        importedFrom: string;
      }
    > = {};
    const allDependencies: string[] = [];

    // Resolve all variant entry point paths using import.meta.resolve
    let globalTypes = typesMetaCall?.structuredOptions?.globalTypes?.[0].map((s: any) =>
      s.replace(/['"]/g, ''),
    );

    let resolvedVariantMap = new Map<string, string>();
    if (typesMetaCall.variants) {
      const relativeVariants: Record<string, string> = {};
      const externalVariants: Record<string, string> = {};

      const projectRoot = this.rootContext || process.cwd();
      Object.entries(typesMetaCall.variants).forEach(([variantName, variantPath]) => {
        if (variantPath.startsWith(projectRoot)) {
          relativeVariants[variantName] = variantPath;
        } else if (paths) {
          Object.keys(paths).find((key) => {
            if (!paths) {
              return false;
            }

            const regex = new RegExp(key);
            const pathMatch = variantPath.match(regex);
            if (pathMatch && pathMatch.length > 0) {
              const replacements = paths[key];
              for (const replacement of replacements) {
                let replacedPath = replacement;
                for (let i = 1; i < pathMatch.length; i += 1) {
                  replacedPath = replacedPath.replace(`$${i}`, pathMatch[i]);
                }
                if (replacedPath.startsWith('.')) {
                  let basePath = String(config.options.pathsBasePath || projectRoot);
                  basePath = basePath.endsWith('/') ? basePath : `${basePath}/`;
                  relativeVariants[variantName] = new URL(
                    replacedPath,
                    `file://${basePath}`,
                  ).pathname;
                } else {
                  externalVariants[variantName] = replacedPath;
                }

                return true;
              }
            }

            return false;
          });
        } else {
          externalVariants[variantName] = variantPath;
        }
      });

      resolvedVariantMap = await resolveVariantPathsWithFs(relativeVariants);

      const externalVariantPromises = Object.entries(externalVariants).map(
        async ([variantName, variantPath]) => {
          // We can use this ponyfill because it behaves strangely when using native import.meta.resolve(path, parentUrl)
          const resolvedPath = resolve(variantPath, `file://${this.resourcePath}`);

          if (!typesMetaCall.structuredOptions?.watchSourceDirectly) {
            globalTypes = []; // if we are reading d.ts files directly, we shouldn't need to add any global types
            return [variantName, resolvedPath] as const;
          }

          // Lookup the source map to find the original .ts/.tsx source file
          const resolvedSourceMap = resolvedPath.replace('file://', '').replace('.js', '.d.ts.map');
          const sourceMap = await fs.readFile(resolvedSourceMap, 'utf-8').catch(() => null);
          if (!sourceMap) {
            throw new Error(
              `Missing source map for variant "${variantName}" at ${resolvedSourceMap}.`,
            );
          }

          const parsedSourceMap = JSON.parse(sourceMap);

          if (
            !('sources' in parsedSourceMap) ||
            !Array.isArray(parsedSourceMap.sources) ||
            parsedSourceMap.sources.length === 0
          ) {
            throw new Error(
              `Invalid source map for variant "${variantName}" at ${resolvedSourceMap}. Missing "sources" field.`,
            );
          }

          const basePath = parsedSourceMap.sourceRoot
            ? new URL(parsedSourceMap.sourceRoot, resolvedPath)
            : resolvedPath;
          const sourceUrl = new URL(parsedSourceMap.sources[0], basePath).toString();

          return [variantName, sourceUrl] as const;
        },
      );

      const externalVariantResults = await Promise.all(externalVariantPromises);
      externalVariantResults.forEach((result) => {
        if (result) {
          resolvedVariantMap.set(result[0], result[1]);
        }
      });

      const pathsResolvedMark = nameMark(functionName, 'Paths Resolved', [relativePath]);
      performance.mark(pathsResolvedMark);
      performance.measure(
        nameMark(functionName, 'Path Resolution', [relativePath]),
        currentMark,
        pathsResolvedMark,
      );
      currentMark = pathsResolvedMark;
    }

    // Collect all entrypoints for optimized program creation
    const resolvedEntrypoints = Array.from(resolvedVariantMap.values()).map((url) =>
      url.replace('file://', ''),
    );

    const allEntrypoints = await Promise.all(
      resolvedEntrypoints.map(async (entrypoint) => {
        return [entrypoint, ...(await findMetaFiles(entrypoint))];
      }),
    ).then((pairs) => pairs.flat());

    const metaFilesResolvedMark = nameMark(functionName, 'Meta Files Resolved', [relativePath]);
    performance.mark(metaFilesResolvedMark);
    performance.measure(
      nameMark(functionName, 'Meta Files Resolution', [relativePath]),
      currentMark,
      metaFilesResolvedMark,
    );
    currentMark = metaFilesResolvedMark;

    // Create optimized TypeScript program
    // This provides 70%+ performance improvement by reducing file loading
    // from ~700+ files to ~80-100 files while maintaining type accuracy
    let program;
    try {
      program = createOptimizedProgram(config.projectPath, config.options, allEntrypoints, {
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

    const programCreatedMark = nameMark(functionName, 'program created', [relativePath]);
    performance.mark(programCreatedMark);
    performance.measure(
      nameMark(functionName, 'program creation', [relativePath]),
      currentMark,
      programCreatedMark,
    );
    currentMark = programCreatedMark;

    const internalTypesCache: Record<string, ExportNode[]> = {};
    const parserOptions: ParserOptions = {
      includeExternalTypes: false, // Only include project types
      shouldInclude: ({ depth }) => depth <= 10, // Limit depth
      shouldResolveObject: ({ propertyCount, depth }) => propertyCount <= 50 && depth <= 10,
    };
    const checker = program.getTypeChecker();

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
          const exportName = typesMetaCall.namedExports?.[variantName];
          if (exportName) {
            namespaces.push(exportName);
          }

          const reExportResults = parseExports(sourceFile, checker, program, parserOptions);
          if (reExportResults && reExportResults.length > 0) {
            namespaces = reExportResults.map((result) => result.name).filter(Boolean);
          }

          // Flatten all exports from the re-export results
          const exports = reExportResults.flatMap((result) => result.exports);

          // Get all source files that are dependencies of this entrypoint
          const dependencies = [...config.dependencies, entrypoint];

          // Get all imported files from the TypeScript program
          // This includes all transitively imported files (imports within imports)
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

          const relativeEntrypoint = path.relative(this.rootContext || process.cwd(), entrypoint);
          const parsedFromProgramMark = nameMark(functionName, 'parsed from program', [
            relativeEntrypoint,
            relativePath,
          ]);
          performance.mark(parsedFromProgramMark);
          performance.measure(
            nameMark(functionName, 'program parsing', [relativeEntrypoint, relativePath]),
            currentMark,
            parsedFromProgramMark,
          );
          currentMark = parsedFromProgramMark;

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

          const formattedTypesMark = nameMark(functionName, 'formatted types', [
            relativeEntrypoint,
            relativePath,
          ]);
          performance.mark(formattedTypesMark);
          performance.measure(
            nameMark(functionName, 'types formatting', [relativeEntrypoint, relativePath]),
            currentMark,
            formattedTypesMark,
          );
          currentMark = formattedTypesMark;

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

    const parsedFromProgramMark = nameMark(
      functionName,
      'parsed all entrypoints',
      [relativePath],
      true,
    );
    performance.mark(parsedFromProgramMark);
    performance.measure(
      nameMark(functionName, 'entrypoint parsing', [relativePath], true),
      programCreatedMark,
      parsedFromProgramMark,
    );
    currentMark = parsedFromProgramMark;

    // Replace the factory function call with the actual precomputed data
    const modifiedSource = replacePrecomputeValue(source, variantData, typesMetaCall);

    const replacedPrecomputeMark = nameMark(functionName, 'replaced precompute', [relativePath]);
    performance.mark(replacedPrecomputeMark);
    performance.measure(
      nameMark(functionName, 'precompute replacement', [relativePath]),
      currentMark,
      replacedPrecomputeMark,
    );
    currentMark = replacedPrecomputeMark;

    const allTypes: TypesMeta[] = [];
    Object.values(variantData).forEach((v) => {
      allTypes.push(...v.types);
    });

    const markdown = await generateTypesMarkdown(resourceName, allTypes);
    const markdownFilePath = this.resourcePath.replace(/\.tsx?$/, '.md');
    await fs.writeFile(markdownFilePath, markdown, 'utf-8');

    if (process.env.NODE_ENV === 'production') {
      // during development, if this markdown file is included as a dependency,
      // it causes a second rebuild when this file is written
      // during production builds, we should already have the file in place
      // so this is not an issue and we should ensure changing this file triggers a rebuild
      allDependencies.push(markdownFilePath);
    }

    const generatedTypesMdMark = nameMark(functionName, 'generated types.md', [relativePath]);
    performance.mark(generatedTypesMdMark);
    performance.measure(
      nameMark(functionName, 'types.md generation', [relativePath]),
      currentMark,
      generatedTypesMdMark,
    );
    currentMark = generatedTypesMdMark;

    // Add all dependencies to webpack's watch list
    allDependencies.forEach((dep) => {
      // Strip 'file://' prefix if present before adding to webpack's dependency tracking
      this.addDependency(dep.startsWith('file://') ? dep.slice(7) : dep);
    });

    if (options.performance?.logging) {
      if (allDependencies.length > 25) {
        // eslint-disable-next-line no-console
        console.log(
          `[${functionName}] ${relativePath} - added ${allDependencies.length} dependencies to watch:\n\n${allDependencies.map((dep) => `- ${path.relative(config.projectPath, dep)}`).join('\n')}\n`,
        );
      }
    }

    // log any pending performance entries before completing
    observer
      ?.takeRecords()
      ?.forEach((entry) =>
        logPerformance(entry, performanceNotableMs, performanceShowWrapperMeasures),
      );
    observer?.disconnect();
    callback(null, modifiedSource);
  } catch (error) {
    // log any pending performance entries before completing
    observer
      ?.takeRecords()
      ?.forEach((entry) =>
        logPerformance(entry, performanceNotableMs, performanceShowWrapperMeasures),
      );
    observer?.disconnect();
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}
