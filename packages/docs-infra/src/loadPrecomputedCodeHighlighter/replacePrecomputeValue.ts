/**
 * Adds or replaces precompute data in createDemo function calls.
 *
 * This function handles multiple scenarios:
 * 1. Replaces any existing 'precompute' property with actual data
 * 2. Adds precompute property to existing options object when missing
 * 3. Adds entire options object with precompute when no options exist
 * 4. Optionally adds an ExternalsProvider property for external dependencies
 *
 * @param source - The source code string containing createDemo calls
 * @param precomputeData - The data object to inject
 * @param demoCallInfo - Information about the parsed demo call structure
 * @param externalsProviderPath - Optional path to the generated externals provider file
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
  externalsProviderPath?: string,
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

  // Prepare externals provider import and property if needed
  let modifiedSource = source;
  let additionalProperties = '';

  if (externalsProviderPath) {
    // Add import statement at the top of the file
    const importStatement = `import { CodeExternalsProvider } from '${externalsProviderPath}';\n`;
    modifiedSource = importStatement + modifiedSource;

    // Prepare the CodeExternalsProvider property
    additionalProperties = `, CodeExternalsProvider`;
  }

  // Case 1: Replace existing precompute property (from key start to value end)
  if (hasPrecompute && precomputeKeyStart !== undefined && precomputeValueEnd !== undefined) {
    // Replace the entire property from key start to value end
    const beforeProperty = optionsObjectStr.substring(0, precomputeKeyStart);
    const afterProperty = optionsObjectStr.substring(precomputeValueEnd);
    const newOptionsStr = `${beforeProperty}precompute: ${precomputeDataString}${additionalProperties}${afterProperty}`;
    return modifiedSource.replace(optionsObjectStr, newOptionsStr);
  }

  // Case 2: Add precompute to existing options object
  if (hasOptions) {
    const optionsMatch = optionsObjectStr.match(/^(\s*\{)([\s\S]*?)(\s*\}\s*)$/);
    if (optionsMatch) {
      const [, openBrace, content, closeBrace] = optionsMatch;
      const trimmedContent = content.trim();
      const needsComma = trimmedContent !== '' && !trimmedContent.endsWith(',');
      const newOptions = `${openBrace}${content}${needsComma ? ',' : ''}\n  precompute: ${precomputeDataString}${additionalProperties}${closeBrace}`;

      return modifiedSource.replace(optionsObjectStr, newOptions);
    }
  } else {
    // Case 3: Add entire options object
    const newCall = fullMatch.replace(
      /(\s*)\)$/,
      `$1, { precompute: ${precomputeDataString}${additionalProperties} })`,
    );
    return modifiedSource.replace(fullMatch, newCall);
  }

  return source;
}
