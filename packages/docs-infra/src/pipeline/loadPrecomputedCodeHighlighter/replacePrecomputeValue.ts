import { serializeFunctionArguments } from './serializeFunctionArguments';
import type { ParsedCreateFactory } from './parseCreateFactoryCall';

/**
 * Adds or replaces precompute data in createDemo function calls.
 *
 * @param source - The source code string containing createDemo calls
 * @param precomputeData - The data object to inject
 * @param demoCallInfo - Information about the parsed demo call structure from parseCreateFactoryCall
 * @param options - Optional configuration
 * @param options.passPrecomputeAsIs - Whether to pass precompute data as-is without JSON stringifying (default: false)
 * @returns The modified source code with precompute data injected
 */
export function replacePrecomputeValue(
  source: string,
  precomputeData: Record<string, any>,
  demoCallInfo?: ParsedCreateFactory,
  options: { passPrecomputeAsIs?: boolean } = {},
): string {
  // If no demoCallInfo provided, return unchanged
  if (!demoCallInfo) {
    return source;
  }

  const {
    hasOptions,
    argumentsStartIndex,
    argumentsEndIndex,
    structuredUrl,
    structuredVariants,
    structuredOptions,
  } = demoCallInfo;

  const { passPrecomputeAsIs = false } = options;

  // Create new options object with precompute data
  const newOptions: Record<string, any> = {};

  // First, copy all existing options to preserve their order
  if (hasOptions && structuredOptions) {
    Object.entries(structuredOptions).forEach(([key, value]) => {
      if (key !== 'precompute') {
        // Skip existing precompute, we'll replace it
        newOptions[key] = value;
      }
    });
  }

  // Add precompute data - pass as-is if requested, otherwise JSON stringify
  newOptions.precompute = passPrecomputeAsIs
    ? precomputeData
    : JSON.stringify(precomputeData, null, 2);

  // Serialize all arguments using the standard function
  let args: any[];

  // Build arguments array based on what's available
  if (hasOptions || Object.keys(newOptions).length > 0) {
    // We need to include options
    if (structuredVariants !== undefined) {
      // Normal case: url, variants, options
      args = [structuredUrl, structuredVariants, newOptions];
    } else {
      // Metadata-only case: url, options (skip undefined variants)
      args = [structuredUrl, newOptions];
    }
  } else if (structuredVariants !== undefined) {
    // No options needed, but we have variants
    args = [structuredUrl, structuredVariants];
  } else {
    // Only URL argument
    args = [structuredUrl];
  }

  const serializedArgs = serializeFunctionArguments(args);

  // Replace the arguments section
  const before = source.substring(0, argumentsStartIndex);
  const after = source.substring(argumentsEndIndex);

  return `${before}${serializedArgs}${after}`;
}
