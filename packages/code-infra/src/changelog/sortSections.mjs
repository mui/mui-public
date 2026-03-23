/**
 * @typedef {import('./types.ts').ChangelogSection} ChangelogSection
 * @typedef {import('./types.ts').CategorizationConfig} CategorizationConfig
 */

/**
 * Sorts changelog sections based on configured order priority.
 * Sections with lower order index appear first.
 * When two sections have the same order index, they are sorted alphabetically by title.
 *
 * @param {ChangelogSection[]} sections - Sections to sort
 * @param {CategorizationConfig} config - Categorization configuration containing order
 * @returns {ChangelogSection[]} Sorted sections
 */
export function sortSections(sections, config) {
  const orderConfig = config.sections.order || {};

  return [...sections].sort((a, b) => {
    const orderA = orderConfig[a.key] ?? 0;
    const orderB = orderConfig[b.key] ?? 0;

    // Sort by order index first (lower values come first)
    if (orderA !== orderB) {
      return orderA - orderB;
    }

    // When order index is the same, sort alphabetically by key
    return a.key.localeCompare(b.key);
  });
}
