import * as React from 'react';
import { stringOrHastToString } from '../pipeline/hastUtils';
import { useCopier, type UseCopierOpts } from '../useCopier';
import type { VariantCode, VariantSource } from '../CodeHighlighter/types';
import { generateVariantMarkdown, type MarkdownFile } from './generateVariantMarkdown';
import type { TransformedFiles } from './useCodeUtils';

interface UseCopyFunctionalityProps {
  selectedFile: VariantSource | null;
  selectedVariant: VariantCode | null;
  transformedFiles: TransformedFiles | undefined;
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

function collectVariantFiles(
  selectedVariant: VariantCode | null,
  transformedFiles: TransformedFiles | undefined,
): MarkdownFile[] {
  if (!selectedVariant) {
    return [];
  }

  // When a transform has produced files, prefer them so the copied snippet
  // matches what the user is currently viewing.
  if (transformedFiles && transformedFiles.files.length > 0) {
    return transformedFiles.files.map((file) => ({
      name: file.name,
      source: stringOrHastToString(file.source),
    }));
  }

  const files: MarkdownFile[] = [];

  if (selectedVariant.fileName && selectedVariant.source !== undefined) {
    files.push({
      name: selectedVariant.fileName,
      source: stringOrHastToString(selectedVariant.source),
    });
  }

  if (selectedVariant.extraFiles) {
    for (const [name, fileData] of Object.entries(selectedVariant.extraFiles)) {
      if (typeof fileData === 'string') {
        files.push({ name, source: fileData });
      } else if (fileData && typeof fileData === 'object' && fileData.source !== undefined) {
        files.push({ name, source: stringOrHastToString(fileData.source) });
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
  title,
  copyOpts,
}: UseCopyFunctionalityProps): UseCopyFunctionalityResult {
  const sourceFileToText = React.useCallback((): string | undefined => {
    if (!selectedFile) {
      return undefined;
    }
    return stringOrHastToString(selectedFile);
  }, [selectedFile]);

  const variantToMarkdown = React.useCallback((): string | undefined => {
    const files = collectVariantFiles(selectedVariant, transformedFiles);
    if (files.length === 0) {
      return undefined;
    }
    return generateVariantMarkdown({ title, files });
  }, [selectedVariant, transformedFiles, title]);

  const { copy } = useCopier(sourceFileToText, copyOpts);
  const { copy: copyMarkdown } = useCopier(variantToMarkdown, copyOpts);

  return {
    copy,
    copyMarkdown,
  };
}
