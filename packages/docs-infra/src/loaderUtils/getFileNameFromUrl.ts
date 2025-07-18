/**
 * Extracts the filename and extension from a URL or file path.
 * This function is isomorphic and works in both Node.js and browser environments.
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

    // Extract extension (including the dot)
    const lastDotIndex = fileName.lastIndexOf('.');
    const extension = lastDotIndex > 0 ? fileName.substring(lastDotIndex) : '';

    return { fileName, extension };
  } catch {
    // If URL parsing fails, fall back to simple string manipulation
    const fileName = url.split('/').pop() || url;
    const lastDotIndex = fileName.lastIndexOf('.');
    const extension = lastDotIndex > 0 ? fileName.substring(lastDotIndex) : '';

    return { fileName, extension };
  }
}
