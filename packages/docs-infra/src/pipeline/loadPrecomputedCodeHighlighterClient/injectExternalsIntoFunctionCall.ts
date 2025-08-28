import { replacePrecomputeValue } from '../loadPrecomputedCodeHighlighter/replacePrecomputeValue';
import type { ParsedCreateFactory } from '../loadPrecomputedCodeHighlighter/parseCreateFactoryCall';

/**
 * Injects precompute.externals into a create*Client function call using the standard replacePrecomputeValue function.
 * This ensures consistent parameter handling and serialization across all loaders.
 */
export function injectExternalsIntoFunctionCall(
  source: string,
  demoCall: ParsedCreateFactory,
  externalsObject: Record<string, any>,
): string {
  // Use the standard replacePrecomputeValue function with externals as precompute data
  const precomputeData = {
    externals: externalsObject,
  };

  return replacePrecomputeValue(source, precomputeData, demoCall);
}
