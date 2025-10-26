/**
 * Known compound extensions that should be treated as a single unit
 */
const COMPOUND_EXTENSIONS = [
  '.module.css',
  '.module.scss',
  '.module.sass',
  '.module.less',
  '.d.ts',
  '.parts.ts',
  '.parts.tsx',
  '.test.js',
  '.test.jsx',
  '.test.ts',
  '.test.tsx',
  '.spec.js',
  '.spec.jsx',
  '.spec.ts',
  '.spec.tsx',
  '.config.js',
  '.config.ts',
  '.setup.js',
  '.setup.ts',
  '.stories.js',
  '.stories.jsx',
  '.stories.ts',
  '.stories.tsx',
] as const;

/**
 * Extracts the filename and extension from a URL or file path.
 * This function is isomorphic and works in both Node.js and browser environments.
 * It properly handles compound extensions like .module.css, .d.ts, .test.js, etc.
 *
 * @param url - The URL or file path to extract the filename from
 * @returns An object containing the filename and extension
 */
export function getFileNameFromUrl(url: string): { fileName: string; extension: string } {
  try {
    // Use URL constructor to handle various URL formats
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const fileName = pathname.split('/').pop() || '';

    return extractFileNameAndExtension(fileName);
  } catch {
    // If URL parsing fails, fall back to simple string manipulation
    const fileName = url.split('/').pop() || url;
    return extractFileNameAndExtension(fileName);
  }
}

/**
 * Helper function to extract filename and extension, handling compound extensions
 */
function extractFileNameAndExtension(fileName: string): { fileName: string; extension: string } {
  if (!fileName) {
    return { fileName: '', extension: '' };
  }

  // Check for compound extensions first
  for (const compoundExt of COMPOUND_EXTENSIONS) {
    if (fileName.endsWith(compoundExt)) {
      return { fileName, extension: compoundExt };
    }
  }

  // Fall back to simple extension detection
  const lastDotIndex = fileName.lastIndexOf('.');
  const extension = lastDotIndex > 0 ? fileName.substring(lastDotIndex) : '';

  return { fileName, extension };
}
