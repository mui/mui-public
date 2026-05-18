import * as React from 'react';

import { useCodeHighlighterContextOptional } from '../CodeHighlighter/CodeHighlighterContext';
import { useCodeContext } from '../CodeProvider/CodeContext';
import type { ContentProps, SourceEnhancers } from '../CodeHighlighter/types';
import { useControlledCode } from '../CodeControllerContext';
import { extractNameAndSlugFromUrl } from '../pipeline/loaderUtils';
import { useVariantSelection } from './useVariantSelection';
import { useTransformManagement } from './useTransformManagement';
import { useFileNavigation } from './useFileNavigation';
import { useUIState } from './useUIState';
import { useCopyFunctionality } from './useCopyFunctionality';
import { useSourceEditing } from './useSourceEditing';
import { type UseCopierOpts } from '../useCopier';

export type UseCodeOpts = {
  preClassName?: string;
  defaultOpen?: boolean;
  copy?: UseCopierOpts;
  githubUrlPrefix?: string;
  initialVariant?: string;
  initialTransform?: string;
  /**
   * Controls hash removal behavior when user interacts with file tabs:
   * - 'remove-hash': Remove entire hash (default)
   * - 'remove-filename': Remove only filename, keep variant in hash
   */
  fileHashMode?: 'remove-hash' | 'remove-filename';
  /**
   * Controls when to save hash variant to localStorage:
   * - 'on-load': Save immediately when page loads with hash
   * - 'on-interaction': Save only when user clicks a tab (default)
   * - 'never': Never save hash variant to localStorage
   */
  saveHashVariantToLocalStorage?: 'on-load' | 'on-interaction' | 'never';
  /**
   * Array of enhancer functions to apply to parsed HAST sources.
   * Enhancers receive the HAST root, comments extracted from source, and filename.
   * Runs asynchronously when code changes.
   */
  sourceEnhancers?: SourceEnhancers;
  /**
   * Disables editing of the code block even when a CodeControllerContext is present.
   */
  disabled?: boolean;
  /**
   * Delay in milliseconds between a transform change and the actual swap
   * of the rendered file tree to the new transform. `selectedTransform`
   * still updates synchronously so UI controls reflect the change
   * immediately — whether triggered by a user click in this demo or
   * received as an external broadcast from a peer demo. While the swap
   * is pending the rendered `<pre>` element receives a `data-transforming`
   * attribute (and a `--docs-infra-transform-delay` CSS variable matching
   * this value) so consumer CSS can run an exit animation — most notably
   * expanding `.collapse` placeholders back to their original height —
   * before the new tree replaces them. When omitted or `0`, the new
   * transform commits synchronously (default behavior).
   */
  transformDelay?: number;
};

type UserProps<T extends {} = {}> = T & {
  name?: string;
  slug?: string;
};

export interface UseCodeResult<T extends {} = {}> {
  variants: string[];
  selectedVariant: string;
  selectVariant: (variant: string | null) => void;
  files: Array<{ name: string; slug?: string; component: React.ReactNode }>;
  selectedFile: React.ReactNode;
  selectedFileLines: number;
  selectedFileName: string | undefined;
  /**
   * URL of the currently selected file, derived from the selected variant's
   * `url`, the file's name, and its `relativeUrl` (when set). `undefined` when
   * the variant has no `url` or the URL cannot be resolved.
   */
  selectedFileUrl: string | undefined;
  /**
   * Slug for the currently selected file. Always derived from the canonical
   * (original) file name — transforms are a view preference and do not
   * produce separate slugs. Useful for building permalinks (e.g. `#${slug}`)
   * that survive transform changes.
   */
  selectedFileSlug: string | undefined;
  selectFileName: (fileName: string) => void;
  allFilesSlugs: Array<{ fileName: string; slug: string; variantName: string }>;
  expanded: boolean;
  expand: () => void;
  setExpanded: (expanded: boolean) => void;
  copy: (event: React.MouseEvent<Element>) => Promise<void>;
  /**
   * Copies all files in the current variant to the clipboard as a Markdown
   * snippet (heading + per-file fenced code blocks).
   */
  copyMarkdown: (event: React.MouseEvent<Element>) => Promise<void>;
  availableTransforms: string[];
  selectedTransform: string | null | undefined;
  selectTransform: (transformName: string | null) => void;
  /**
   * Replace the source of the currently selected file (or `fileName` when
   * provided) in the controlled code. Internal hooks may pass additional
   * arguments (caret position, pre-parsed HAST) that are not part of the
   * public contract.
   */
  setSource?: (source: string, fileName?: string) => void;
  /**
   * Clears the entire controlled code state back to `undefined`, discarding
   * user edits across **all variants and files** owned by the surrounding
   * `CodeControllerContext` (not just the currently selected file or
   * variant). Only available when a `CodeControllerContext` with `setCode`
   * is in scope and editing is not disabled.
   */
  reset?: () => void;
  userProps: UserProps<T>;
}

export function useCode<T extends {} = {}>(
  contentProps: ContentProps<T>,
  opts?: UseCodeOpts,
): UseCodeResult<T> {
  const {
    copy: copyOpts,
    defaultOpen = false,
    initialVariant,
    initialTransform,
    preClassName,
    fileHashMode = 'remove-hash',
    saveHashVariantToLocalStorage = 'on-interaction',
    sourceEnhancers,
    disabled,
    transformDelay,
  } = opts || {};

  // Safely try to get context values - will be undefined if not in context
  const context = useCodeHighlighterContextOptional();
  const codeContext = useCodeContext();
  const controllerContext = useControlledCode();

  // Merge enhancers from CodeProvider, CodeControllerContext, and useCode opts.
  // Provider enhancers run first so they match the order applied by
  // `loadPrecomputedCodeHighlighter` on the server, then controller and
  // per-call enhancers layer on top. This lets a single `<CodeProvider>`
  // configure the baseline (e.g., `@highlight` / `@focus` framing) while
  // individual `useCode` callers add demo-specific extras without losing the
  // shared defaults.
  const mergedEnhancers = React.useMemo((): SourceEnhancers | undefined => {
    const enhancers: SourceEnhancers = [];
    if (codeContext.sourceEnhancers) {
      enhancers.push(...codeContext.sourceEnhancers);
    }
    if (controllerContext?.sourceEnhancers) {
      enhancers.push(...controllerContext.sourceEnhancers);
    }
    if (sourceEnhancers) {
      enhancers.push(...sourceEnhancers);
    }
    return enhancers.length > 0 ? enhancers : undefined;
  }, [codeContext.sourceEnhancers, controllerContext?.sourceEnhancers, sourceEnhancers]);

  // Get the effective code - context overrides contentProps if available
  const effectiveCode = React.useMemo(() => {
    return context?.code || contentProps.code || {};
  }, [context?.code, contentProps.code]);
  const shouldHighlight = !context?.deferHighlight;

  // Memoize userProps with auto-generated name and slug if missing
  const userProps = React.useMemo((): UserProps<T> => {
    // Extract only the user-defined properties (T) from contentProps
    const {
      name: contentName,
      slug: contentSlug,
      code,
      components,
      url: contentUrl,
      ...userDefinedProps
    } = contentProps;
    // Get URL from context first, then fall back to contentProps
    const effectiveUrl = context?.url || contentUrl;

    let name = contentName;
    let slug = contentSlug;
    // Generate name and slug from URL if they're missing and we have a URL
    if ((!name || !slug) && effectiveUrl) {
      try {
        const generated = extractNameAndSlugFromUrl(effectiveUrl);
        name = name || generated.name;
        slug = slug || generated.slug;
      } catch {
        // If URL parsing fails, keep the original values (which might be undefined)
      }
    }

    return {
      ...userDefinedProps,
      name,
      slug,
    } as UserProps<T>;
  }, [contentProps, context?.url]);

  // Sub-hook: UI State Management (needs slug to check for relevant hash)
  const uiState = useUIState({ defaultOpen, mainSlug: userProps.slug });

  // Sub-hook: Variant Selection
  const variantSelection = useVariantSelection({
    effectiveCode,
    initialVariant,
    variantType: contentProps.variantType,
    mainSlug: userProps.slug,
    saveHashVariantToLocalStorage,
  });

  // Sub-hook: Transform Management
  const transformManagement = useTransformManagement({
    context,
    effectiveCode,
    selectedVariantKey: variantSelection.selectedVariantKey,
    selectedVariant: variantSelection.selectedVariant,
    initialTransform,
    transformDelay,
  });

  // Sub-hook: Source Editing
  const sourceEditing = useSourceEditing({
    context,
    selectedVariantKey: variantSelection.selectedVariantKey,
    effectiveCode,
    selectedVariant: variantSelection.selectedVariant,
    disabled,
  });

  // Sub-hook: File Navigation
  const fileNavigation = useFileNavigation({
    selectedVariant: variantSelection.selectedVariant,
    transformedFiles: transformManagement.transformedFiles,
    selectedTransform: transformManagement.selectedTransform,
    mainSlug: userProps.slug,
    selectedVariantKey: variantSelection.selectedVariantKey,
    selectVariant: variantSelection.selectVariantProgrammatic,
    variantKeys: variantSelection.variantKeys,
    shouldHighlight,
    preClassName,
    setSource: sourceEditing.setSource,
    effectiveCode,
    fileHashMode,
    saveHashVariantToLocalStorage,
    saveVariantToLocalStorage: variantSelection.saveVariantToLocalStorage,
    hashVariant: variantSelection.hashVariant,
    sourceEnhancers: mergedEnhancers,
    expanded: uiState.expanded,
    expand: uiState.expand,
    transforming: transformManagement.transformingPhase,
  });

  // Sub-hook: Copy Functionality
  const copyFunctionality = useCopyFunctionality({
    selectedFile: fileNavigation.selectedFile,
    selectedVariant: variantSelection.selectedVariant,
    transformedFiles: transformManagement.transformedFiles,
    title: userProps.name,
    copyOpts,
  });

  return {
    variants: variantSelection.variantKeys,
    selectedVariant: variantSelection.selectedVariantKey,
    selectVariant: variantSelection.selectVariant,
    files: fileNavigation.files,
    selectedFile: fileNavigation.selectedFileComponent,
    selectedFileLines: fileNavigation.selectedFileLines,
    selectedFileName: fileNavigation.selectedFileName,
    selectedFileUrl: fileNavigation.selectedFileUrl,
    selectedFileSlug: fileNavigation.selectedFileSlug,
    selectFileName: fileNavigation.selectFileName,
    allFilesSlugs: fileNavigation.allFilesSlugs,
    expanded: uiState.expanded,
    expand: uiState.expand,
    setExpanded: uiState.setExpanded,
    copy: copyFunctionality.copy,
    copyMarkdown: copyFunctionality.copyMarkdown,
    availableTransforms: transformManagement.availableTransforms,
    selectedTransform: transformManagement.selectedTransform,
    selectTransform: transformManagement.selectTransform,
    setSource: sourceEditing.setSource,
    reset: sourceEditing.reset,
    userProps,
  };
}
