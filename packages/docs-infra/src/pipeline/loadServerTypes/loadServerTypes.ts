import path from 'node:path';
import { nameMark, performanceMeasure } from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { highlightTypes } from './highlightTypes';
import {
  enhanceCodeTypes,
  type EnhancedTypesMeta,
  type EnhancedComponentTypeMeta,
  type EnhancedHookTypeMeta,
  type EnhancedFunctionTypeMeta,
  type EnhancedProperty,
  type EnhancedParameter,
} from './enhanceCodeTypes';
import { syncTypes, type SyncTypesOptions, type TypesMeta } from '../syncTypes';

export type {
  TypesMeta,
  EnhancedTypesMeta,
  EnhancedComponentTypeMeta,
  EnhancedHookTypeMeta,
  EnhancedFunctionTypeMeta,
  EnhancedProperty,
  EnhancedParameter,
};

const functionName = 'Load Server Types';

export interface LoadServerTypesOptions extends SyncTypesOptions {}

export interface LoadServerTypesResult {
  /** Enhanced variant data with highlighted type fields ready for precompute injection */
  highlightedVariantData: Record<
    string,
    { types: EnhancedTypesMeta[]; typeNameMap?: Record<string, string> }
  >;
  /** All dependencies that should be watched for changes */
  allDependencies: string[];
  /** All processed types for external use (plain, not enhanced) */
  allTypes: TypesMeta[];
  /** Type name map from variant processing */
  typeNameMap?: Record<string, string>;
}

/**
 * Server-side function for loading and processing TypeScript types.
 *
 * This function:
 * 1. Calls syncTypes to process TypeScript types and generate markdown
 * 2. Applies syntax highlighting to markdown content via highlightTypes
 * 3. Enhances type fields with HAST via enhanceCodeTypes
 *
 * The pipeline is:
 * - syncTypes: extracts types, formats to plain text, generates markdown
 * - highlightTypes: highlights markdown code blocks, builds highlightedExports map
 * - enhanceCodeTypes: converts type text to HAST, derives shortType/detailedType
 */
export async function loadServerTypes(
  options: LoadServerTypesOptions,
): Promise<LoadServerTypesResult> {
  const { typesMarkdownPath, rootContext, formattingOptions } = options;

  // Derive relative path for logging
  const relativePath = path.relative(rootContext, typesMarkdownPath);

  let currentMark = nameMark(functionName, 'Start Loading', [relativePath]);
  performance.mark(currentMark);

  // Call syncTypes to process types and generate markdown
  const syncResult = await syncTypes(options);

  currentMark = performanceMeasure(currentMark, { mark: 'types synced', measure: 'type syncing' }, [
    functionName,
    relativePath,
  ]);

  // Apply syntax highlighting to markdown content and build highlightedExports map
  const highlightStart = performance.now();

  const highlightResult = await highlightTypes(syncResult.variantData);

  const highlightEnd = performance.now();
  const highlightCompleteMark = nameMark(functionName, 'markdown highlighted', [relativePath]);
  performance.mark(highlightCompleteMark);
  performance.measure(nameMark(functionName, 'markdown highlighting', [relativePath]), {
    start: highlightStart,
    end: highlightEnd,
  });

  currentMark = nameMark(functionName, 'markdown highlighted', [relativePath]);

  // Enhance type fields with syntax-highlighted HAST
  const enhanceStart = performance.now();

  const enhancedVariantData = await enhanceCodeTypes(highlightResult.variantData, {
    highlightedExports: highlightResult.highlightedExports,
    formatting: formattingOptions,
  });

  const enhanceEnd = performance.now();
  const enhanceCompleteMark = nameMark(functionName, 'types enhanced', [relativePath]);
  performance.mark(enhanceCompleteMark);
  performance.measure(nameMark(functionName, 'type enhancement', [relativePath]), {
    start: enhanceStart,
    end: enhanceEnd,
  });

  performanceMeasure(
    currentMark,
    { mark: 'complete', measure: 'total processing' },
    [functionName, relativePath],
    true,
  );

  return {
    highlightedVariantData: enhancedVariantData,
    allDependencies: syncResult.allDependencies,
    allTypes: syncResult.allTypes,
    typeNameMap: syncResult.typeNameMap,
  };
}
