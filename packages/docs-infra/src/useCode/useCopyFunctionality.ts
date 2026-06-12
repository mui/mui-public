import * as React from 'react';
import { stringOrHastToString } from '../pipeline/hastUtils';
import { useCopier, type UseCopierOpts } from '../useCopier';
import type { Fallbacks, VariantCode, VariantSource } from '../CodeHighlighter/types';
import type { FallbackNode } from '../CodeHighlighter/fallbackFormat';
import { generateVariantMarkdown, type MarkdownFile } from './generateVariantMarkdown';
import type { TransformedFiles } from './useCodeUtils';

interface UseCopyFunctionalityProps {
  selectedFile: VariantSource | null;
  selectedVariant: VariantCode | null;
  transformedFiles: TransformedFiles | undefined;
  /**
   * Per-file fallbacks for the selected variant (keyed by file name). Used as
   * the DEFLATE dictionary to decode `hastCompressed` sources back to text.
   */
  fallbacks?: Fallbacks;
  /** Fallback for the single selected file (the dictionary for `selectedFile`). */
  selectedFileFallback?: FallbackNode[];
  /** Title used as the heading for the Markdown copy. */
  title?: string;
  copyOpts?: UseCopierOpts;
}

export interface UseCopyFunctionalityResult {
  copy: (event: React.MouseEvent<Element>) => Promise<void>;
  /**
   * Copies all files in the current variant to the clipboard as a Markdown
   * snippet (heading + per-file fenced code blocks).
   */
  copyMarkdown: (event: React.MouseEvent<Element>) => Promise<void>;
}

export function collectVariantFiles(
  selectedVariant: VariantCode | null,
  transformedFiles: TransformedFiles | undefined,
  fallbacks?: Fallbacks,
): MarkdownFile[] {
  if (!selectedVariant) {
    return [];
  }

  // Resolve per-file DEFLATE dictionaries from both places a fallback can
  // arrive (mirrors `resolvedFallbacks` in `useFileNavigation`): the passed
  // `fallbacks` (hoisted from a `ContentLoading` component) and the variant's
  // own per-file `fallback` fields (kept on `Code` when not stripped — e.g. the
  // standalone `useCode`/`useDemo` path with no `CodeHighlighter` context, so
  // `context?.fallbacks` is undefined). Without this merge, copy-as-markdown
  // throws on a `hastCompressed` source whose dictionary lives on the
  // `VariantCode`. The variant copy wins so the full text — the dictionary
  // `hastCompressed` needs — is used when a `fallbackCollapsed` block hoisted
  // only the visible window.
  const resolvedFallbacks: Fallbacks = { ...fallbacks };
  if (selectedVariant.fileName && selectedVariant.fallback) {
    resolvedFallbacks[selectedVariant.fileName] = selectedVariant.fallback;
  }
  for (const [name, fileData] of Object.entries(selectedVariant.extraFiles || {})) {
    if (typeof fileData === 'object' && fileData?.fallback) {
      resolvedFallbacks[name] = fileData.fallback;
    }
  }

  // When a transform has produced files, prefer them so the copied snippet
  // matches what the user is currently viewing. Files the transform actually
  // rewrote are live HAST (already decoded), but files it left untouched are
  // passed through as their ORIGINAL source, which may still be `hastCompressed`
  // and needs its dictionary — resolved here by `originalName`.
  if (transformedFiles && transformedFiles.files.length > 0) {
    return transformedFiles.files.map((file) => ({
      name: file.name,
      source: stringOrHastToString(file.source, resolvedFallbacks[file.originalName]),
    }));
  }

  const files: MarkdownFile[] = [];

  if (selectedVariant.fileName && selectedVariant.source !== undefined) {
    files.push({
      name: selectedVariant.fileName,
      // `resolvedFallbacks` is the active variant's per-file dictionary map, so
      // it decodes a `hastCompressed` source in both the hoisted and the
      // on-`VariantCode` cases.
      source: stringOrHastToString(
        selectedVariant.source,
        resolvedFallbacks[selectedVariant.fileName],
      ),
    });
  }

  if (selectedVariant.extraFiles) {
    for (const [name, fileData] of Object.entries(selectedVariant.extraFiles)) {
      if (typeof fileData === 'string') {
        files.push({ name, source: fileData });
      } else if (fileData && typeof fileData === 'object' && fileData.source !== undefined) {
        files.push({
          name,
          source: stringOrHastToString(fileData.source, resolvedFallbacks[name]),
        });
      }
    }
  }

  return files;
}

/**
 * Hook for managing copy-to-clipboard functionality
 */
export function useCopyFunctionality({
  selectedFile,
  selectedVariant,
  transformedFiles,
  fallbacks,
  selectedFileFallback,
  title,
  copyOpts,
}: UseCopyFunctionalityProps): UseCopyFunctionalityResult {
  const sourceFileToText = React.useCallback((): string | undefined => {
    if (!selectedFile) {
      return undefined;
    }
    return stringOrHastToString(selectedFile, selectedFileFallback);
  }, [selectedFile, selectedFileFallback]);

  const variantToMarkdown = React.useCallback((): string | undefined => {
    const files = collectVariantFiles(selectedVariant, transformedFiles, fallbacks);
    if (files.length === 0) {
      return undefined;
    }
    return generateVariantMarkdown({ title, files });
  }, [selectedVariant, transformedFiles, fallbacks, title]);

  const { copy } = useCopier(sourceFileToText, copyOpts);
  const { copy: copyMarkdown } = useCopier(variantToMarkdown, copyOpts);

  return {
    copy,
    copyMarkdown,
  };
}
