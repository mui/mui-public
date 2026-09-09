import type { ParserOptions } from 'typescript-api-extractor';

/**
 * Extraction policy the pipeline hands to `typescript-api-extractor`.
 *
 * The depth and property-count caps decide whether the parser resolves a type or hands
 * back a preserved reference, so anything parsing sources outside the pipeline — tests
 * included — has to apply the same caps or it will resolve shapes the real build leaves
 * alone.
 */
export const PARSER_OPTIONS: ParserOptions = {
  includeExternalTypes: false,
  shouldInclude: ({ depth }) => depth <= 15,
  shouldResolveObject: ({ propertyCount, depth }) => propertyCount <= 50 && depth <= 15,
};
