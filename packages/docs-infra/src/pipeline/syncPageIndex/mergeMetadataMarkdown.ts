import {
  clusterPagesBySection,
  hasDetailSection,
  markdownToMetadata,
  metadataToMarkdown,
  orderPagesBySection,
  pageSectionGroup,
  resolveSectionGroup,
  routeGroupOfPath,
  routeGroupToTitle,
  DEFAULT_DETAILS_SECTION_TITLE,
} from './metadataToMarkdown';
import type {
  MetadataToMarkdownOptions,
  PagesMetadata,
  PageMetadata,
  PageIndexSection,
} from './metadataToMarkdown';

/**
 * Derives the ordered route-group sections for an index, given the sections recovered from
 * the existing file (whose titles/order humans may have edited) and each page's section group
 * (`pageGroups`, aligned with the merged pages — own route group, else manual placement).
 * Existing sections are kept in place so renames and reordering survive; a group seen for the
 * first time is appended with a seeded title. Sections that no longer have any page are
 * dropped. Returns undefined when no page belongs to a group (flat index).
 */
function deriveIndexSections(
  existingSections: PageIndexSection[] | undefined,
  pageGroups: (string | undefined)[],
): PageIndexSection[] | undefined {
  const usedGroups = new Set(pageGroups.filter((group) => group !== undefined));

  const result: PageIndexSection[] = [];
  const seen = new Set<string>();

  // Keep existing sections (order + human-edited titles), de-duped by group and limited
  // to groups still in use.
  for (const section of existingSections ?? []) {
    if (usedGroups.has(section.group) && !seen.has(section.group)) {
      seen.add(section.group);
      result.push(section);
    }
  }

  // Append a seeded section for any in-use group not already covered, in page order.
  for (const group of pageGroups) {
    if (group && !seen.has(group)) {
      seen.add(group);
      result.push({ group, title: routeGroupToTitle(group) });
    }
  }

  return result.length > 0 ? result : undefined;
}

/**
 * Re-keys each derived section to the group a fresh parse of the rendered file would assign, and
 * re-points the manual placement (`sectionGroup`) of the ungrouped pages under it to match. Once a
 * section's last route-grouped page is removed, nothing in the rendered file still encodes the real
 * `(group)` — the parser can only recover a synthetic id from the heading text (or drop the section
 * to flat if a local page remains under it). Applying {@link resolveSectionGroup} — the same rule
 * the parser uses — here keeps the merged (cache) metadata consistent with that parse. Route-grouped
 * pages derive their section from their own path and are left untouched. Runs on a copy.
 */
function reconcileSectionGroups(
  sections: PageIndexSection[],
  pages: PageMetadata[],
  pageGroups: (string | undefined)[],
): { sections: PageIndexSection[]; pages: PageMetadata[] } {
  const { bySection } = clusterPagesBySection(pages, sections, pageGroups);

  // Map each section's current group to the canonical one a parse would assign (undefined = the
  // section collapses to flat and is dropped).
  const canonicalByGroup = new Map<string, string | undefined>();
  const reconciledSections: PageIndexSection[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    const paths = (bySection.get(section.group) ?? []).map((page) => page.path);
    const canonical = resolveSectionGroup(section.title, paths);
    canonicalByGroup.set(section.group, canonical);
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      reconciledSections.push(
        canonical === section.group ? section : { ...section, group: canonical },
      );
    }
  }

  const reconciledPages = pages.map((page, index) => {
    const group = pageGroups[index];
    // Only an ungrouped page's manual placement can be re-keyed; a route-grouped page owns its group.
    if (group === undefined || routeGroupOfPath(page.path) !== undefined) {
      return page;
    }
    const canonical = canonicalByGroup.get(group);
    if (canonical === group) {
      return page;
    }
    if (canonical === undefined) {
      const { sectionGroup, ...rest } = page;
      return rest;
    }
    return { ...page, sectionGroup: canonical };
  });

  return { sections: reconciledSections, pages: reconciledPages };
}

/**
 * Derives the grouped fields of a metadata result — sections, the canonically-ordered pages,
 * and the "Details" wrapper title — from a base set of sections/pages. Pages are reordered
 * into the section-clustered order the renderer emits, and `detailsSectionTitle` defaults to
 * the value the renderer would write, so the pre-populated cache matches a fresh parse of the
 * rendered file on every path (first sync, parse failure, and normal merge alike).
 */
function deriveGroupedFields(
  baseSections: PageIndexSection[] | undefined,
  pages: PageMetadata[],
  existingDetailsSectionTitle: string | undefined,
): Pick<PagesMetadata, 'pages' | 'sections' | 'detailsSectionTitle'> {
  // Compute each page's section group once (own route group, else its manual placement) and
  // key both the section derivation and the page ordering off it, so a section is kept as
  // long as any page still belongs to it — even an ungrouped link filed under it by hand.
  let pageGroups = pages.map(pageSectionGroup);
  let sections = deriveIndexSections(baseSections, pageGroups);
  let groupedPages = pages;
  if (sections) {
    // Reconcile each section's group with the id a fresh parse of the rendered file would assign,
    // so a warm cache read never diverges from a cold read of the file it wrote.
    const reconciled = reconcileSectionGroups(sections, groupedPages, pageGroups);
    sections = reconciled.sections.length > 0 ? reconciled.sections : undefined;
    groupedPages = reconciled.pages;
    pageGroups = groupedPages.map(pageSectionGroup);
  }
  // Mirror the renderer's `## Details` guard: the wrapper — and hence its title — only exists
  // when the index is grouped AND at least one page actually renders a detail section. A grouped
  // index made only of external links (all skipDetailSection) writes no wrapper, so a fresh parse
  // yields no title; the pre-populated cache must agree, or the consistency check diverges.
  const rendersDetailsWrapper = Boolean(sections) && hasDetailSection(groupedPages);
  return {
    sections,
    pages: sections ? orderPagesBySection(groupedPages, sections, pageGroups) : groupedPages,
    detailsSectionTitle: rendersDetailsWrapper
      ? (existingDetailsSectionTitle ?? DEFAULT_DETAILS_SECTION_TITLE)
      : undefined,
  };
}

/**
 * Options for mergeMetadataMarkdown
 */
export interface MergeMetadataMarkdownOptions extends Omit<
  MetadataToMarkdownOptions,
  'editableMarker' | 'indexWrapperComponent'
> {
  /** If true, pages in existing markdown that aren't in newMetadata will be preserved. If false (default), they are removed. */
  preserveUnlisted?: boolean;
  /**
   * Component name to wrap the autogenerated content.
   * - `undefined`: preserve existing wrapper (if any)
   * - `null`: explicitly remove the wrapper
   * - `string`: use this component name
   */
  indexWrapperComponent?: string | null;
  /**
   * The path to the file being generated. Used in autogenerated comments to help
   * users validate the file.
   */
  path?: string;
  /**
   * If true, preserve existing page titles and slugs when they exist.
   * New metadata titles/slugs will only be used if the existing page doesn't have them.
   * Useful when auto-generating metadata that shouldn't override user-set values.
   * Default: false (new metadata takes precedence)
   */
  preserveExistingTitleAndSlug?: boolean;
}

/**
 * Result of merging new metadata into existing markdown: the normalized
 * `PagesMetadata` that renders to the merged markdown, plus the rendering options
 * needed to reproduce that markdown.
 */
export interface MergedMetadataResult {
  /** The normalized pages metadata that renders to the merged markdown. */
  metadata: PagesMetadata;
  /** Effective wrapper component to render with (undefined = no wrapper). */
  indexWrapperComponent?: string;
  /** Editable marker to render with (e.g. the alphabetical-sort marker), if any. */
  editableMarker?: string;
}

/**
 * Merges new page metadata with existing markdown content and returns the
 * normalized `PagesMetadata` (and rendering options) without serializing to markdown.
 *
 * This is the in-memory source of truth that {@link mergeMetadataMarkdown} renders.
 * `syncPageIndex` reuses it to pre-populate the page-index cache, so the cached
 * value matches a fresh read of the rendered markdown.
 *
 * See {@link mergeMetadataMarkdown} for the ordering and merge semantics.
 */
export async function mergeMetadataPages(
  existingMarkdown: string | undefined,
  newMetadata: PagesMetadata,
  options: MergeMetadataMarkdownOptions = {},
): Promise<MergedMetadataResult> {
  const { indexWrapperComponent, preserveExistingTitleAndSlug } = options;

  // With no existing markdown (or if it fails to parse), just use the new metadata. Use the
  // provided wrapper unless it's null (which means remove).
  const existingMetadata = existingMarkdown
    ? await markdownToMetadata(existingMarkdown)
    : undefined;
  if (!existingMetadata) {
    return {
      metadata: {
        ...newMetadata,
        ...deriveGroupedFields(
          newMetadata.sections,
          newMetadata.pages,
          newMetadata.detailsSectionTitle,
        ),
      },
      indexWrapperComponent: indexWrapperComponent === null ? undefined : indexWrapperComponent,
    };
  }

  // Determine effective wrapper component:
  // - undefined: preserve existing
  // - null: explicitly remove
  // - string: use provided value
  let effectiveWrapper: string | undefined;
  if (indexWrapperComponent === undefined) {
    effectiveWrapper = existingMetadata.indexWrapperComponent;
  } else if (indexWrapperComponent === null) {
    effectiveWrapper = undefined;
  } else {
    effectiveWrapper = indexWrapperComponent;
  }

  // Create a map of new pages by path for quick lookup
  const newPagesMap = new Map<string, PageMetadata>();
  for (const page of newMetadata.pages) {
    newPagesMap.set(page.path, page);
  }

  // Build the merged pages array, preserving order from existing markdown
  let pages: PageMetadata[] = [];
  const addedPaths = new Set<string>();

  // First, add all pages that exist in the existing markdown, in their original order
  for (const existingPage of existingMetadata.pages) {
    const newPage = newPagesMap.get(existingPage.path);
    if (newPage) {
      // Page exists in both - merge the metadata
      // Only exclude descriptionMarkdown if newPage provides a new description
      const { descriptionMarkdown, ...existingPageWithoutDescriptionMarkdown } = existingPage;
      const merged = {
        ...(newPage.description ? existingPageWithoutDescriptionMarkdown : existingPage),
        ...newPage,
        // Optionally preserve title/slug from existing (for auto-generated metadata that shouldn't override)
        ...(preserveExistingTitleAndSlug
          ? {
              title: existingPage.title || newPage.title,
              slug: existingPage.slug || newPage.slug,
            }
          : {}),
        // Preserve tags from existing (user-managed, program should never delete tags)
        tags: existingPage.tags,
        // Preserve skipDetailSection from existing (user-managed for external links)
        skipDetailSection: existingPage.skipDetailSection,
        // Preserve the section a human filed this page under (user-managed placement for
        // pages without a route group of their own, e.g. external links).
        sectionGroup: existingPage.sectionGroup,
        // Preserve sections from existing if new doesn't have them
        sections: newPage.sections || existingPage.sections,
        // Preserve displayTitle (user-managed title override) only if it still
        // differs from the new title. If the override now matches the actual title,
        // clear it so the titles stay in sync going forward.
        displayTitle:
          existingPage.displayTitle && existingPage.displayTitle !== newPage.title
            ? existingPage.displayTitle
            : undefined,
      };
      pages.push(merged);
      addedPaths.add(newPage.path);
    }
    // If page doesn't exist in new metadata, it's been removed - don't include it
  }

  // Then, add any new pages that weren't in the existing markdown
  for (const newPage of newMetadata.pages) {
    if (!addedPaths.has(newPage.path)) {
      // This is a new page - automatically add the [New] tag
      const pageWithTag = {
        ...newPage,
        tags: newPage.tags ? [...newPage.tags, 'New'] : ['New'],
      };
      pages.push(pageWithTag);
      addedPaths.add(newPage.path);
    }
  }

  // If alphabetical sorting is requested, sort pages alphabetically by title
  const alphabeticalSortMarker =
    "[//]: # 'This section is autogenerated, but the following list order, title, and [Tag]s can be modified, but nothing within the parentheses. Automatically sorted alphabetically.'";
  // TODO: Remove the old marker check once all index files have been migrated to the new format.
  const oldAlphabeticalSortMarker =
    "[//]: # 'This file is autogenerated, but the following list can be modified. Automatically sorted alphabetically.'";
  const requestsAlphabeticalSort =
    existingMarkdown?.includes(alphabeticalSortMarker) ||
    existingMarkdown?.includes(oldAlphabeticalSortMarker) ||
    false;

  if (requestsAlphabeticalSort) {
    pages = pages.sort((a, b) => {
      const titleA = a.displayTitle ?? a.title ?? a.slug;
      const titleB = b.displayTitle ?? b.title ?? b.slug;
      return titleA.localeCompare(titleB);
    });
  }

  // Preserve route-group section headings (order + human-edited titles) from the existing
  // file, appending sections for any newly-seen group; reorder pages into the section-
  // clustered order the renderer emits; and keep the "Details" wrapper heading, falling back
  // to the renderer's default when a flat index first becomes grouped — so the pre-populated
  // cache stays consistent with a fresh parse.
  const mergedMetadata: PagesMetadata = {
    title: newMetadata.title, // Always use the new title
    ...deriveGroupedFields(existingMetadata.sections, pages, existingMetadata.detailsSectionTitle),
    // Preserve the existing pageMetadata (e.g., robots config) from the current file
    pageMetadata: existingMetadata.pageMetadata,
  };

  return {
    metadata: mergedMetadata,
    indexWrapperComponent: effectiveWrapper,
    // Preserve the alphabetical sorting marker if it was present
    editableMarker: requestsAlphabeticalSort ? alphabeticalSortMarker : undefined,
  };
}

/**
 * Merges new page metadata with existing markdown content, preserving the order
 * of pages from the existing markdown when available, unless the file contains
 * only the autogeneration marker (no editable section), in which case pages are
 * sorted alphabetically by title.
 *
 * Pages are matched by their `path` property (e.g., './button/page.mdx'), not by slug.
 * This allows multiple pages to have the same slug (anchor) while still being treated
 * as distinct pages.
 *
 * @param existingMarkdown - The existing markdown content (or undefined if none exists)
 * @param newMetadata - The new metadata to merge in
 * @param options - Optional configuration
 * @param options.preserveUnlisted - If true, pages in existing markdown that aren't in newMetadata will be preserved. If false (default), they are removed.
 * @param options.indexWrapperComponent - Optional component name to wrap the autogenerated content (e.g., 'PagesIndex')
 * @returns The updated markdown content with merged metadata
 *
 * @example
 * ```ts
 * const existingMarkdown = `# Components
 * - Button - ([Outline](#button), [Contents](./button/page.mdx)) - A button
 * - Checkbox - ([Outline](#checkbox), [Contents](./checkbox/page.mdx)) - A checkbox
 * `;
 *
 * const newMetadata = {
 *   title: 'Components',
 *   pages: [
 *     { slug: 'checkbox', path: './checkbox/page.mdx', title: 'Checkbox', description: 'Updated checkbox' },
 *     { slug: 'button', path: './button/page.mdx', title: 'Button', description: 'Updated button' },
 *     { slug: 'input', path: './input/page.mdx', title: 'Input', description: 'New input' },
 *   ],
 * };
 *
 * const result = await mergeMetadataMarkdown(existingMarkdown, newMetadata);
 * // Result preserves Button, Checkbox order from existing markdown, adds Input at the end
 * ```
 */
export async function mergeMetadataMarkdown(
  existingMarkdown: string | undefined,
  newMetadata: PagesMetadata,
  options: MergeMetadataMarkdownOptions = {},
): Promise<string> {
  const { path } = options;
  const { metadata, indexWrapperComponent, editableMarker } = await mergeMetadataPages(
    existingMarkdown,
    newMetadata,
    options,
  );
  return metadataToMarkdown(metadata, { editableMarker, indexWrapperComponent, path });
}
