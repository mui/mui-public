/**
 * Adds or replaces precompute data in createDemo function calls.
 *
 * This function handles multiple scenarios:
 * 1. Replaces any existing 'precompute' property with actual data
 * 2. Adds precompute property to existing options object when missing
 * 3. Adds entire options object with precompute when no options exist
 *
 * @param source - The source code string containing createDemo calls
 * @param precomputeData - The data object to inject
 * @param demoCallInfo - Information about the parsed demo call structure
 * @returns The modified source code with precompute data injected
 */
export function replacePrecomputeValue(
  source: string,
  precomputeData: Record<string, any>,
  demoCallInfo?: {
    fullMatch: string;
    optionsObjectStr: string;
    hasOptions: boolean;
    hasPrecompute: boolean;
    precomputeValue?: any;
    precomputeKeyStart?: number;
    precomputeValueStart?: number;
    precomputeValueEnd?: number;
  },
): string {
  // Convert the data to a properly formatted JSON string
  const precomputeDataString = JSON.stringify(precomputeData, null, 2);

  // If no demoCallInfo provided, return unchanged
  if (!demoCallInfo) {
    return source;
  }

  const callInfo = demoCallInfo;
  const {
    fullMatch,
    optionsObjectStr,
    hasOptions,
    hasPrecompute,
    precomputeKeyStart,
    precomputeValueEnd,
  } = callInfo;

  // Case 1: Replace existing precompute property (from key start to value end)
  if (hasPrecompute && precomputeKeyStart !== undefined && precomputeValueEnd !== undefined) {
    // Replace the entire property from key start to value end
    const beforeProperty = optionsObjectStr.substring(0, precomputeKeyStart);
    const afterProperty = optionsObjectStr.substring(precomputeValueEnd);
    const newOptionsStr = `${beforeProperty}precompute: ${precomputeDataString}${afterProperty}`;
    return source.replace(optionsObjectStr, newOptionsStr);
  }

  // Case 2: Add precompute to existing options object
  if (hasOptions) {
    const optionsMatch = optionsObjectStr.match(/^(\s*\{)([\s\S]*?)(\s*\}\s*)$/);
    if (optionsMatch) {
      const [, openBrace, content, closeBrace] = optionsMatch;
      const trimmedContent = content.trim();
      const needsComma = trimmedContent !== '' && !trimmedContent.endsWith(',');
      const newOptions = `${openBrace}${content}${needsComma ? ',' : ''}\n  precompute: ${precomputeDataString}${closeBrace}`;

      return source.replace(optionsObjectStr, newOptions);
    }
  } else {
    // Case 3: Add entire options object
    const newCall = fullMatch.replace(/(\s*)\)$/, `$1, { precompute: ${precomputeDataString} })`);
    return source.replace(fullMatch, newCall);
  }

  return source;
}
