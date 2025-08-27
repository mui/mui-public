import { serializeFunctionParameters } from './serializeFunctionParameters';
import type { ParsedCreateFactory } from './parseCreateFactoryCall';

/**
 * Adds or replaces precompute data in createDemo function calls.
 *
 * @param source - The source code string containing createDemo calls
 * @param precomputeData - The data object to inject
 * @param demoCallInfo - Information about the parsed demo call structure from parseCreateFactoryCall
 * @param externalsProviderPath - Optional path to the generated externals provider file
 * @returns The modified source code with precompute data injected
 */
export function replacePrecomputeValue(
  source: string,
  precomputeData: Record<string, any>,
  demoCallInfo?: ParsedCreateFactory,
  externalsProviderPath?: string,
): string {
  // If no demoCallInfo provided, return unchanged
  if (!demoCallInfo) {
    return source;
  }

  const {
    hasOptions,
    parametersStartIndex,
    parametersEndIndex,
    structuredUrl,
    structuredVariants,
    structuredOptions,
  } = demoCallInfo;

  // Prepare externals provider import if needed
  let result = source;
  let importAdjustment = 0;

  if (externalsProviderPath) {
    // Add import statement at the top of the file
    const importStatement = `import { CodeExternalsProvider } from '${externalsProviderPath}';\n`;
    result = importStatement + result;
    importAdjustment = importStatement.length;
  }

  // Create new options object with precompute data as JSON string
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

  // Add precompute data as JSON string so it gets serialized as raw JavaScript
  newOptions.precompute = JSON.stringify(precomputeData, null, 2);

  if (externalsProviderPath) {
    newOptions.CodeExternalsProvider = 'CodeExternalsProvider'; // This will be serialized as shorthand property
  }

  // Serialize all parameters using the standard function
  let params: any[];
  if (hasOptions || Object.keys(newOptions).length > 0) {
    params = [structuredUrl, structuredVariants, newOptions];
  } else {
    params = [structuredUrl, structuredVariants];
  }

  const serializedParams = serializeFunctionParameters(params);

  // Replace the parameters section
  const parametersStart = parametersStartIndex + importAdjustment;
  const parametersEnd = parametersEndIndex + importAdjustment;
  const before = result.substring(0, parametersStart);
  const after = result.substring(parametersEnd);

  return `${before}${serializedParams}${after}`;
}
