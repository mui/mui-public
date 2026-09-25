/**
 * Known brand names and acronyms that have a canonical capitalization.
 * Keys are lowercase, values are the canonical form to use in titles.
 */
const BRAND_NAME_OVERRIDES: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
};

/**
 * Capitalizes a single word, applying brand-name overrides when applicable.
 */
function capitalizeWord(word: string): string {
  const lower = word.toLowerCase();
  const override = BRAND_NAME_OVERRIDES[lower];
  if (override) {
    return override;
  }
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Converts a kebab-case (or snake_case) string to Title Case, honoring brand-name overrides
 * (e.g. `javascript` -> `JavaScript`). This is the single title-casing rule shared by the
 * producers that turn a slug/folder name into a display title — directory-derived index titles,
 * URL-segment names, and route-group section headings — so those titles never diverge.
 *
 * @example kebabToTitleCase('alert-dialog') -> 'Alert Dialog'
 * @example kebabToTitleCase('getting_started') -> 'Getting Started'
 * @example kebabToTitleCase('typescript') -> 'TypeScript'
 */
export function kebabToTitleCase(kebabCase: string): string {
  return kebabCase.split(/[-_]/).map(capitalizeWord).join(' ');
}
