import * as React from 'react';

import { useCodeHighlighterContextOptional } from '../CodeHighlighter/CodeHighlighterContext';
import type { ContentProps, SourceEnhancers } from '../CodeHighlighter/types';
import { extractNameAndSlugFromUrl } from '../pipeline/loaderUtils';
import { useVariantSelection } from './useVariantSelection';
import { useTransformManagement } from './useTransformManagement';
import { useFileNavigation } from './useFileNavigation';
import { useUIState } from './useUIState';
import { useCopyFunctionality } from './useCopyFunctionality';
import { useSourceEditing } from './useSourceEditing';
import { UseCopierOpts } from '../useCopier';

export type UseCodeOpts = {
  preClassName?: string;
  preRef?: React.Ref<HTMLPreElement>;
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
  selectFileName: (fileName: string) => void;
  allFilesSlugs: Array<{ fileName: string; slug: string; variantName: string }>;
  expanded: boolean;
  expand: () => void;
  setExpanded: (expanded: boolean) => void;
  copy: (event: React.MouseEvent<HTMLButtonElement>) => Promise<void>;
  availableTransforms: string[];
  selectedTransform: string | null | undefined;
  selectTransform: (transformName: string | null) => void;
  setSource?: (source: string) => void;
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
    preRef,
    fileHashMode = 'remove-hash',
    saveHashVariantToLocalStorage = 'on-interaction',
    sourceEnhancers,
  } = opts || {};

  // Safely try to get context values - will be undefined if not in context
  const context = useCodeHighlighterContextOptional();

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
  });

  // Sub-hook: File Navigation
  const fileNavigation = useFileNavigation({
    selectedVariant: variantSelection.selectedVariant,
    transformedFiles: transformManagement.transformedFiles,
    mainSlug: userProps.slug,
    selectedVariantKey: variantSelection.selectedVariantKey,
    selectVariant: variantSelection.selectVariantProgrammatic,
    variantKeys: variantSelection.variantKeys,
    shouldHighlight,
    preClassName,
    preRef,
    effectiveCode,
    fileHashMode,
    saveHashVariantToLocalStorage,
    saveVariantToLocalStorage: variantSelection.saveVariantToLocalStorage,
    hashVariant: variantSelection.hashVariant,
    sourceEnhancers,
  });

  // Sub-hook: Copy Functionality
  const copyFunctionality = useCopyFunctionality({
    selectedFile: fileNavigation.selectedFile,
    copyOpts,
  });

  // Sub-hook: Source Editing
  const sourceEditing = useSourceEditing({
    context,
    selectedVariantKey: variantSelection.selectedVariantKey,
    effectiveCode,
    selectedVariant: variantSelection.selectedVariant,
  });

  return {
    variants: variantSelection.variantKeys,
    selectedVariant: variantSelection.selectedVariantKey,
    selectVariant: variantSelection.selectVariant,
    files: fileNavigation.files,
    selectedFile: fileNavigation.selectedFileComponent,
    selectedFileLines: fileNavigation.selectedFileLines,
    selectedFileName: fileNavigation.selectedFileName,
    selectFileName: fileNavigation.selectFileName,
    allFilesSlugs: fileNavigation.allFilesSlugs,
    expanded: uiState.expanded,
    expand: uiState.expand,
    setExpanded: uiState.setExpanded,
    copy: copyFunctionality.copy,
    availableTransforms: transformManagement.availableTransforms,
    selectedTransform: transformManagement.selectedTransform,
    selectTransform: transformManagement.selectTransform,
    setSource: sourceEditing.setSource,
    userProps,
  };
}
