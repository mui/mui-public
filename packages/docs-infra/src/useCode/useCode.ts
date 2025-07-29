import * as React from 'react';

import { useCodeHighlighterContextOptional } from '../CodeHighlighter/CodeHighlighterContext';
import type { ContentProps } from '../CodeHighlighter/types';
import { useVariantSelection } from './useVariantSelection';
import { useTransformManagement } from './useTransformManagement';
import { useFileNavigation } from './useFileNavigation';
import { useUIState } from './useUIState';
import { useCopyFunctionality } from './useCopyFunctionality';
import { useSourceEditing } from './useSourceEditing';

type UseCodeOpts = {
  defaultOpen?: boolean;
  copy?: any; // UseCopierOpts
  githubUrlPrefix?: string;
  codeSandboxUrlPrefix?: string;
  stackBlitzPrefix?: string;
  initialVariant?: string;
  initialTransform?: string;
};

export interface UseCodeResult {
  variants: string[];
  selectedVariant: string;
  selectVariant: React.Dispatch<React.SetStateAction<string>>;
  files: Array<{ name: string; component: React.ReactNode }>;
  selectedFile: React.ReactNode;
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
}

export function useCode<T extends {} = {}>(
  contentProps: ContentProps<T>,
  opts?: UseCodeOpts,
): UseCodeResult {
  const { copy: copyOpts, defaultOpen = false, initialVariant, initialTransform } = opts || {};

  // Safely try to get context values - will be undefined if not in context
  const context = useCodeHighlighterContextOptional();

  // Get the effective code - context overrides contentProps if available
  const effectiveCode = React.useMemo(() => {
    return context?.code || contentProps.code || {};
  }, [context?.code, contentProps.code]);

  // Sub-hook: UI State Management
  const uiState = useUIState({ defaultOpen });

  // Sub-hook: Variant Selection
  const variantSelection = useVariantSelection({
    effectiveCode,
    initialVariant,
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
  };
}
