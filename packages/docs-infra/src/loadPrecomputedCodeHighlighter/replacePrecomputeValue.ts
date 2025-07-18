/**
 * Replaces 'precompute: true' with the actual precomputed data in source code.
 *
 * This function performs a precise replacement of the boolean true value in
 * 'precompute: true' expressions with the provided data object, keeping the
 * rest of the source code unchanged.
 *
 * @param source - The source code string containing 'precompute: true'
 * @param precomputeData - The data object to replace the true value with
 * @returns The modified source code with precompute data injected
 *
 * @example
 * ```typescript
 * const source = `
 * export const demo = createDemo(
 *   import.meta.url,
 *   { Component },
 *   { precompute: true }
 * );
 * `;
 *
 * const data = { variants: { default: { code: "..." } } };
 * const result = replacePrecomputeValue(source, data);
 * // Result will have 'precompute: true' replaced with 'precompute: { variants: { default: { code: "..." } } }'
 * ```
 */
export function replacePrecomputeValue(
  source: string,
  precomputeData: Record<string, any>,
): string {
  // Regex to match 'precompute: true' with optional whitespace
  const precomputeRegex = /precompute\s*:\s*true/g;

  // Convert the data to a properly formatted JSON string
  const precomputeDataString = JSON.stringify(precomputeData, null, 2);

  // Replace 'precompute: true' with 'precompute: {data}'
  // The regex will match the exact pattern and we replace just that part
  return source.replace(precomputeRegex, `precompute: ${precomputeDataString}`);
}
