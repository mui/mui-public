import * as React from 'react';

import { useCodeHighlighterContextOptional } from '../CodeHighlighter/CodeHighlighterContext';
import type { ContentProps } from '../CodeHighlighter/types';
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
};

type UserProps<T extends {} = {}> = T & {
  name?: string;
  slug?: string;
};

export interface UseCodeResult<T extends {} = {}> {
  variants: string[];
  selectedVariant: string;
  selectVariant: React.Dispatch<React.SetStateAction<string>>;
  files: Array<{ name: string; slug?: string; component: React.ReactNode }>;
  selectedFile: React.ReactNode;
  selectedFileLines: number;
  selectedFileName: string | undefined;
  selectFileName: (fileName: string) => void;
  expanded: boolean;
  expand: () => void;
  setExpanded: React.Dispatch<React.SetStateAction<boolean>>;
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

  // Sub-hook: UI State Management
  const uiState = useUIState({ defaultOpen });

  // Sub-hook: Variant Selection
  const variantSelection = useVariantSelection({
    effectiveCode,
    initialVariant,
    variantType: contentProps.variantType,
  });

  // Sub-hook: Transform Management
  const transformManagement = useTransformManagement({
    context,
    effectiveCode,
    selectedVariantKey: variantSelection.selectedVariantKey,
    selectedVariant: variantSelection.selectedVariant,
    initialTransform,
    shouldHighlight,
  });

  // Sub-hook: File Navigation
  const fileNavigation = useFileNavigation({
    selectedVariant: variantSelection.selectedVariant,
    transformedFiles: transformManagement.transformedFiles,
    mainSlug: userProps.slug,
    selectedVariantKey: variantSelection.selectedVariantKey,
    variantKeys: variantSelection.variantKeys,
    initialVariant,
    shouldHighlight,
    preClassName,
    preRef,
    effectiveCode,
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
