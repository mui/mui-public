// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import { pathToFileURL } from 'url';

/**
 * Converts a filesystem path to a portable path format that can be used with path-module (POSIX-only).
 *
 * This function handles filesystem paths that may have platform-specific separators:
 * - On Unix: `/home/user/file.ts` - already portable
 * - On Windows: `C:\Users\file.ts` - needs conversion to `/C:/Users/file.ts`
 *
 * @param fsPath - A filesystem path (may have backslashes on Windows)
 * @returns A portable path starting with `/` that works with path-module
 *
 * @example
 * // Unix path
 * fsPathToPortablePath('/home/user/file.ts') // => '/home/user/file.ts'
 *
 * // Windows path
 * fsPathToPortablePath('C:\\Users\\file.ts') // => '/C:/Users/file.ts'
 * fsPathToPortablePath('C:/Users/file.ts') // => '/C:/Users/file.ts'
 */
export function fsPathToPortablePath(fsPath: string): string {
  // Convert to file URL first, then to portable path
  const fileUrl = pathToFileURL(fsPath).href;
  return fileUrlToPortablePath(fileUrl);
}

/**
 * Converts a file:// URL to a portable path format that can be used with path-module (POSIX-only).
 *
 * This function is designed to work with isomorphic code that uses path-module,
 * which only supports POSIX paths. The key insight is that by stripping the `file://`
 * prefix and normalizing backslashes to forward slashes, we get a path that:
 * - On Unix: `/home/user/file.ts` - works directly with path-module
 * - On Windows: `/C:/Users/file.ts` - also works with path-module because it starts with `/`
 *
 * The resulting path is NOT a valid filesystem path on Windows, but it's a valid
 * POSIX-style path for path manipulation. Use `fileURLToPath` from the `url` module
 * when you need to access the actual filesystem.
 *
 * @param fileUrl - A file:// URL or absolute path (with forward slashes)
 * @returns A portable path starting with `/` that works with path-module
 *
 * @example
 * // Unix file URL
 * fileUrlToPortablePath('file:///home/user/file.ts') // => '/home/user/file.ts'
 *
 * // Windows file URL
 * fileUrlToPortablePath('file:///C:/Users/file.ts') // => '/C:/Users/file.ts'
 *
 * // Already a portable path (passthrough)
 * fileUrlToPortablePath('/home/user/file.ts') // => '/home/user/file.ts'
 */
export function fileUrlToPortablePath(fileUrl: string): string {
  // If it's not a file:// URL, check if it's already a portable path
  if (!fileUrl.startsWith('file://')) {
    // Normalize backslashes to forward slashes
    const normalized = fileUrl.replace(/\\/g, '/');
    // If it doesn't start with /, it's likely a Windows path - add leading slash
    if (!normalized.startsWith('/') && /^[a-zA-Z]:\//.test(normalized)) {
      return `/${normalized}`;
    }
    return normalized;
  }

  // Strip the file:// prefix
  // file:///home/user/file.ts => /home/user/file.ts (Unix)
  // file:///C:/Users/file.ts => /C:/Users/file.ts (Windows - keep the leading slash)
  let path = fileUrl.slice(7); // Remove 'file://'

  // Normalize any backslashes that might have snuck in
  path = path.replace(/\\/g, '/');

  // If it doesn't start with /, add one (should already have one for valid file:// URLs)
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  return path;
}

/**
 * Converts a portable path back to a file:// URL.
 *
 * This is the inverse of `fileUrlToPortablePath`. It takes a portable path
 * (which always starts with `/`) and converts it back to a proper file:// URL.
 *
 * @param portablePath - A portable path starting with `/`
 * @returns A file:// URL
 *
 * @example
 * // Unix path
 * portablePathToFileUrl('/home/user/file.ts') // => 'file:///home/user/file.ts'
 *
 * // Windows path (portable format)
 * portablePathToFileUrl('/C:/Users/file.ts') // => 'file:///C:/Users/file.ts'
 */
export function portablePathToFileUrl(portablePath: string): string {
  // If it's already a file:// URL, return as-is
  if (portablePath.startsWith('file://')) {
    return portablePath;
  }

  // For Windows portable paths like /C:/Users/..., we need file:// + path
  // For Unix paths like /home/user/..., we need file:// + path
  // Both cases: file:// + /path = file:///path
  return `file://${portablePath}`;
}
