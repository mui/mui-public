'use client';

import * as React from 'react';
import { generateFileSlug, toKebabCase } from './generateFileSlug';
import { renderCodeToReact } from './renderCodeToReact';
import type { ContentProps, DeferredSources } from './types';
import { useDeferredSources } from './useDeferredSources';
import { useDemoHashNavigation } from './useDemoHashNavigation';
import { usePreference } from './usePreference';

export interface UseDemoOptions {
  copy?: { onCopied?: () => void };
}

function htmlToText(html: string): string {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return holder.textContent ?? '';
}

export interface UseDemoResult {
  component: React.ReactNode;
  variants: string[];
  selectedVariant: string;
  selectVariant: (variant: string | null) => void;
  files: Array<{ name: string; slug: string }>;
  allFilesSlugs: Array<{ fileName: string; slug: string; variantName: string }>;
  selectedFile: React.ReactNode;
  selectedFileName: string;
  selectedFileLines: number;
  loading: boolean;
  deferredSourcesError: Error | null;
  selectFileName: (name: string | null) => void;
  expanded: boolean;
  expand: () => void;
  setExpanded: (expanded: boolean) => void;
  loadDeferredSources: () => Promise<DeferredSources | null>;
  copy: () => Promise<void>;
}

/** Consumes loader output into demo variant, file, copy, and export state. */
export function useDemo<T extends object = {}>(
  props: ContentProps<T>,
  options: UseDemoOptions = {},
): UseDemoResult {
  const { code: rawCode, components, slug } = props;
  const deferredUrl = rawCode.deferredUrl;
  const { code, deferredSources, deferredSourcesError, loadDeferredSources } =
    useDeferredSources(rawCode);
  const variants = Object.keys(code.variants);
  if (variants.length === 0) {
    throw new Error('docs-infra: the demo loader returned no variants.');
  }

  const [preferredVariant, setPreferredVariant] = usePreference('variant', variants, variants[0]);
  const selectedVariant =
    preferredVariant && variants.includes(preferredVariant) ? preferredVariant : variants[0];
  const variant = code.variants[selectedVariant];
  const mainFileName = variant.fileName;
  const files = React.useMemo(
    () => [
      {
        name: mainFileName,
        slug: generateFileSlug(slug, mainFileName, selectedVariant),
      },
      ...Object.keys(variant.extraFiles ?? {}).map((fileName) => ({
        name: fileName,
        slug: generateFileSlug(slug, fileName, selectedVariant),
      })),
    ],
    [mainFileName, selectedVariant, slug, variant.extraFiles],
  );

  const [pickedFileName, selectFileName] = React.useState<string | null>(null);
  const selectedFileName = files.some((file) => file.name === pickedFileName)
    ? pickedFileName!
    : files[0].name;
  const selectedFileData =
    selectedFileName === mainFileName ? variant : variant.extraFiles![selectedFileName];
  const selectedFile = selectedFileData.html
    ? renderCodeToReact(selectedFileData.html, selectedFileData.language)
    : null;
  const loading = selectedFileData.html === undefined;
  const selectedFileLines = selectedFileData.totalLines;

  const [expanded, setExpanded] = React.useState(false);
  const expand = React.useCallback(() => setExpanded(true), []);
  React.useEffect(() => {
    if (deferredUrl && !deferredSources && !deferredSourcesError && (expanded || loading)) {
      loadDeferredSources();
    }
  }, [deferredSources, deferredSourcesError, deferredUrl, expanded, loading, loadDeferredSources]);

  const onCopied = options.copy?.onCopied;
  const copy = React.useCallback(async () => {
    let html = selectedFileData.html;
    if (deferredUrl) {
      const sources = deferredSources ?? (await loadDeferredSources());
      if (!sources) {
        return;
      }
      const deferredVariant = sources?.[selectedVariant];
      html =
        (selectedFileName === mainFileName
          ? deferredVariant?.source
          : deferredVariant?.extraFiles?.[selectedFileName]) ?? html;
    }
    if (html === undefined) {
      return;
    }
    await navigator.clipboard.writeText(htmlToText(html));
    onCopied?.();
  }, [
    deferredSources,
    deferredUrl,
    loadDeferredSources,
    mainFileName,
    onCopied,
    selectedFileData.html,
    selectedFileName,
    selectedVariant,
  ]);

  const allFilesSlugs = React.useMemo(() => {
    const allSlugs: Array<{ fileName: string; slug: string; variantName: string }> = [];
    for (const [variantName, variantCode] of Object.entries(code.variants)) {
      const fileName = variantCode.fileName;
      if (variantName !== 'Default') {
        allSlugs.push({ fileName, slug: `${slug}:${toKebabCase(variantName)}`, variantName });
      }
      allSlugs.push({
        fileName,
        slug: generateFileSlug(slug, fileName, variantName),
        variantName,
      });
      for (const extraFileName of Object.keys(variantCode.extraFiles ?? {})) {
        allSlugs.push({
          fileName: extraFileName,
          slug: generateFileSlug(slug, extraFileName, variantName),
          variantName,
        });
      }
    }
    return allSlugs;
  }, [code.variants, slug]);

  useDemoHashNavigation({
    mainSlug: slug,
    allFilesSlugs,
    expanded,
    setPreferredVariant,
    selectFileName,
    setExpanded,
  });

  return {
    component: components[selectedVariant],
    variants,
    selectedVariant,
    selectVariant: setPreferredVariant,
    files,
    selectedFileName,
    selectFileName,
    allFilesSlugs,
    selectedFile,
    selectedFileLines,
    loading,
    deferredSourcesError,
    expanded,
    expand,
    setExpanded,
    loadDeferredSources,
    copy,
  };
}
