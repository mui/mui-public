import { fileUrlToPortablePath } from './fileUrlToPortablePath';

/**
 * Extracts and formats a name and slug from a URL path.
 * This utility takes the last meaningful segment of a URL path and formats it
 * into both a human-readable title and a URL-friendly slug.
 *
 * - Strips common file extensions (index.js, index.ts, index.tsx, etc.)
 * - Converts kebab-case to Title Case for names
 * - Ensures slugs are in kebab-case format
 */

/**
 * Converts a camelCase string to kebab-case
 * @param camelCase - The camelCase string to convert
 * @returns kebab-case string
 */
function camelToKebabCase(camelCase: string): string {
  return (
    camelCase
      // Insert hyphens before uppercase letters that follow lowercase letters or numbers
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      // Insert hyphens before numbers that follow letters
      .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
      // Insert hyphens before letters that follow numbers
      .replace(/([0-9])([a-zA-Z])/g, '$1-$2')
      .toLowerCase()
  );
}

/**
 * Converts a camelCase string to Title Case with spaces
 * @param camelCase - The camelCase string to convert
 * @returns Title case string with spaces
 */
function camelToTitleCase(camelCase: string): string {
  return (
    camelCase
      // Insert spaces before uppercase letters that follow lowercase letters or numbers
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      // Insert spaces before numbers that follow letters
      .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
      // Insert spaces before letters that follow numbers
      .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
      // Capitalize the first letter
      .replace(/^./, (str) => str.toUpperCase())
  );
}

/**
 * Converts a kebab-case string to Title Case
 * @param kebabCase - The kebab-case string to convert
 * @returns Title case string
 */
function kebabToTitleCase(kebabCase: string): string {
  return kebabCase
    .split(/[-_]/) // Split on both hyphens and underscores
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Detects if a string is camelCase or PascalCase
 * @param str - The string to check
 * @returns true if the string is camelCase or PascalCase
 */
function isCamelCase(str: string): boolean {
  // Check if it matches the camelCase/PascalCase pattern:
  // - Only contains letters and numbers
  // - Has at least one transition from lowercase letter or number to uppercase letter
  // - Doesn't contain hyphens, underscores, or spaces
  return /^[a-zA-Z][a-zA-Z0-9]*$/.test(str) && /[a-z0-9][A-Z]/.test(str);
}

/**
 * Converts a string to kebab-case
 * @param str - The string to convert
 * @returns kebab-case string
 */
function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extracts the last meaningful segment from a URL path
 * @param url - The URL to extract from
 * @returns The last meaningful path segment
 */
function extractLastSegment(url: string): string {
  // Convert to portable path format for consistent handling across platforms
  // This handles file:// URLs, Windows paths with backslashes, and regular paths
  const path = fileUrlToPortablePath(url);

  // Strip query parameters and hash fragments before processing
  const cleanPath = path.split('?')[0].split('#')[0];

  // Split the path into segments and filter out empty ones
  const segments = cleanPath.split('/').filter(Boolean);

  if (segments.length === 0) {
    throw new Error('Could not extract meaningful segment from URL');
  }

  // Get the last segment
  let lastSegment = segments[segments.length - 1];

  // Handle index files - any file that starts with 'index.'
  if (lastSegment.startsWith('index.')) {
    // If it's an index file, use the parent directory name
    if (segments.length < 2) {
      throw new Error('Cannot extract name from index file without parent directory');
    }
    lastSegment = segments[segments.length - 2];
  } else {
    // Strip everything after the first dot from non-index files
    // This handles all extensions: .js, .d.ts, .module.css, .config.dev.js, etc.
    const firstDotIndex = lastSegment.indexOf('.');
    if (firstDotIndex !== -1) {
      lastSegment = lastSegment.substring(0, firstDotIndex);
    }
  }

  if (!lastSegment) {
    throw new Error('Could not extract meaningful segment from URL');
  }

  return lastSegment;
}

/**
 * Extracts and formats a name and slug from a URL path
 * @param url - The URL to extract from (can be file:// URL or regular path)
 * @returns Object containing the formatted name and slug
 *
 * @example
 * extractNameAndSlugFromUrl('file:///app/components/demos/advanced-keyboard/index.ts')
 * // Returns: { name: 'Advanced Keyboard', slug: 'advanced-keyboard' }
 *
 * @example
 * extractNameAndSlugFromUrl('/src/components/button-group.tsx')
 * // Returns: { name: 'Button Group', slug: 'button-group' }
 *
 * @example
 * extractNameAndSlugFromUrl('/src/components/customButton.tsx')
 * // Returns: { name: 'Custom Button', slug: 'custom-button' }
 *
 * @example
 * extractNameAndSlugFromUrl('https://example.com/docs/getting-started/')
 * // Returns: { name: 'Getting Started', slug: 'getting-started' }
 */
export function extractNameAndSlugFromUrl(url: string): { name: string; slug: string } {
  const segment = extractLastSegment(url);

  // Check if the segment is camelCase and handle it appropriately
  if (isCamelCase(segment)) {
    return {
      name: camelToTitleCase(segment),
      slug: camelToKebabCase(segment),
    };
  }

  // For kebab-case, snake_case, or other formats, use the existing logic
  return {
    name: kebabToTitleCase(segment),
    slug: toKebabCase(segment),
  };
}
