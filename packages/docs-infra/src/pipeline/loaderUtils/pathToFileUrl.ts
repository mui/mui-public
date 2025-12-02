/**
 * Converts a file system path to a file:// URL in an isomorphic way.
 *
 * This handles the difference between Unix and Windows paths:
 * - Unix: `/home/user/file.ts` → `file:///home/user/file.ts`
 * - Windows: `C:/Users/file.ts` → `file:///C:/Users/file.ts`
 *
 * The key insight is that Windows absolute paths start with a drive letter (e.g., C:/)
 * and need an extra slash to form a valid file:// URL.
 *
 * @param filePath - The file system path to convert (should use forward slashes)
 * @returns The file:// URL
 */
export function pathToFileUrl(filePath: string): string {
  // If it's already a URL, return as-is
  if (
    filePath.startsWith('file://') ||
    filePath.startsWith('http://') ||
    filePath.startsWith('https://')
  ) {
    return filePath;
  }

  // Check if it looks like a Windows absolute path (e.g., C:/ or D:/)
  // This regex matches drive letter followed by colon and slash
  if (/^[a-zA-Z]:[\\/]/.test(filePath)) {
    // Windows path - needs three slashes total: file:/// + C:/...
    return `file:///${filePath.replace(/\\/g, '/')}`;
  }

  // Unix path (starts with /) - two slashes + path gives three slashes
  return `file://${filePath}`;
}
