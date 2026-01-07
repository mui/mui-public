import { nameMark, performanceMeasure } from '../loadPrecomputedCodeHighlighter/performanceLogger';
import { highlightTypes } from './highlightTypes';
import { syncTypes, type SyncTypesOptions, type TypesMeta } from '../syncTypes';

export type { TypesMeta };

const functionName = 'Load Server Types';

export interface LoadServerTypesOptions extends SyncTypesOptions {}

export interface LoadServerTypesResult {
  /** Highlighted variant data ready for precompute injection */
  highlightedVariantData: Record<
    string,
    { types: TypesMeta[]; typeNameMap?: Record<string, string> }
  >;
  /** All dependencies that should be watched for changes */
  allDependencies: string[];
  /** All processed types for external use */
  allTypes: TypesMeta[];
  /** Type name map from variant processing */
  typeNameMap?: Record<string, string>;
}

/**
 * Server-side function for loading and processing TypeScript types.
 *
 * This function:
 * 1. Calls syncTypes to process TypeScript types and generate markdown
 * 2. Applies syntax highlighting to the type data via highlightTypes
 *
 * The highlighting is separated from syncTypes to allow for different
 * rendering strategies (e.g., server-side vs client-side highlighting).
 */
export async function loadServerTypes(
  options: LoadServerTypesOptions,
): Promise<LoadServerTypesResult> {
  const { relativePath } = options;

  let currentMark = nameMark(functionName, 'Start Loading', [relativePath]);
  performance.mark(currentMark);

  // Call syncTypes to process types and generate markdown
  const syncResult = await syncTypes(options);

  currentMark = performanceMeasure(currentMark, { mark: 'types synced', measure: 'type syncing' }, [
    functionName,
    relativePath,
  ]);

  // Apply syntax highlighting to type data
  const highlightStart = performance.now();

  const highlightedVariantData = await highlightTypes(syncResult.variantData);

  const highlightEnd = performance.now();
  const highlightCompleteMark = nameMark(functionName, 'HAST transformed', [relativePath]);
  performance.mark(highlightCompleteMark);
  performance.measure(nameMark(functionName, 'HAST transformation', [relativePath]), {
    start: highlightStart,
    end: highlightEnd,
  });

  performanceMeasure(
    currentMark,
    { mark: 'complete', measure: 'total processing' },
    [functionName, relativePath],
    true,
  );

  return {
    highlightedVariantData,
    allDependencies: syncResult.allDependencies,
    allTypes: syncResult.allTypes,
    typeNameMap: syncResult.typeNameMap,
  };
}
