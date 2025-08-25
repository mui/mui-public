import * as React from 'react';
import kebabCase from 'kebab-case';

import { useCode } from '../useCode';
import { UseCopierOpts } from '../useCopier';
import type { ContentProps } from '../CodeHighlighter/types';
import { CodeHighlighterContext } from '../CodeHighlighter/CodeHighlighterContext';
import { createStackBlitz } from './createStackBlitz';
import { createCodeSandbox } from './createCodeSandbox';
import { exportVariant, type ExportConfig } from './exportVariant';
import { exportVariantAsCra } from './exportVariantAsCra';
import { flattenVariant } from './flattenVariant';

/**
 * Demo templates use the exportVariant/exportVariantAsCra with flattenVariant pattern:
 *
 * For StackBlitz:
 * const { exported: exportedVariant, entrypoint } = exportVariant(variantCode);
 * const flattenedFiles = flattenVariant(exportedVariant);
 * createStackBlitzDemo({ title, description, flattenedFiles, useTypescript, initialFile: entrypoint })
 *
 * For CodeSandbox:
 * const { exported: craExport, entrypoint } = exportVariantAsCra(variantCode, { title, description, useTypescript });
 * const flattenedFiles = flattenVariant(craExport);
 * createCodeSandboxDemo({ title, description, flattenedFiles, useTypescript, initialFile: entrypoint })
 * createCodeSandboxDemo({ title, description, flattenedFiles, useTypescript })
 */

type UseDemoOpts = {
  defaultOpen?: boolean;
  copy?: UseCopierOpts;
  githubUrlPrefix?: string;
  codeSandboxUrlPrefix?: string;
  stackBlitzPrefix?: string;
  initialVariant?: string;
  initialTransform?: string;
  /** Common export configuration applied to both StackBlitz and CodeSandbox */
  export?: ExportConfig;
  /** StackBlitz-specific export configuration (merged with common export config) */
  exportStackBlitz?: ExportConfig;
  /** CodeSandbox-specific export configuration (merged with common export config) */
  exportCodeSandbox?: ExportConfig;
};

/**
 * Helper to create HTML form element with hidden inputs
 */
export function addHiddenInput(form: HTMLFormElement, name: string, value: string): void {
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = name;
  input.value = value;
  form.appendChild(input);
}

/**
 * Generic function to create and submit a form for opening online demo platforms
 * This function creates HTML elements and should be used in browser contexts
 */
export function openWithForm({
  url,
  formData,
  method = 'POST',
  target = '_blank',
}: {
  url: string;
  formData: Record<string, string>;
  method?: string;
  target?: string;
}): void {
  const form = document.createElement('form');
  form.method = method;
  form.target = target;
  form.action = url;

  Object.entries(formData).forEach(([name, value]) => {
    addHiddenInput(form, name, value);
  });

  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

// TODO: take initialVariant and initialTransforms as parameters
export function useDemo<T extends {} = {}>(contentProps: ContentProps<T>, opts?: UseDemoOpts) {
  const code = useCode(contentProps, opts);

  // Extract export configuration options
  const {
    export: commonExportConfig = {},
    exportStackBlitz: stackBlitzExportConfig = {},
    exportCodeSandbox: codeSandboxExportConfig = {},
  } = opts || {};

  // Get context to access components if available (using React.useContext to avoid import conflicts)
  const context = React.useContext(CodeHighlighterContext);

  const slug = React.useMemo(
    () =>
      contentProps.slug || (contentProps.name ? kebabCase(contentProps.name, false) : undefined),
    [contentProps.slug, contentProps.name],
  );

  // Get the effective components object - context overrides contentProps
  const effectiveComponents = React.useMemo(() => {
    return context?.components || contentProps.components || {};
  }, [context?.components, contentProps.components]);

  // Get the component for the current variant
  const component = React.useMemo(() => {
    return effectiveComponents[code.selectedVariant] || null;
  }, [effectiveComponents, code.selectedVariant]);

  // Demo-specific ref and focus management
  const ref = React.useRef<HTMLDivElement | null>(null);
  const resetFocus = React.useCallback(() => {
    ref.current?.focus();
  }, []);

  // Get the effective code - context overrides contentProps if available
  const effectiveCode = React.useMemo(() => {
    return context?.code || contentProps.code || {};
  }, [context?.code, contentProps.code]);

  // Create StackBlitz demo callback
  const openStackBlitz = React.useCallback(() => {
    // Get the current variant code
    const variantCode = effectiveCode[code.selectedVariant];

    if (!variantCode || typeof variantCode === 'string') {
      console.warn('No valid variant code available for StackBlitz demo');
      return;
    }

    const title = contentProps.name || 'Demo';
    const description = `${title} demo`;

    // Determine if we should use TypeScript based on whether 'js' transform is NOT applied
    // If 'js' transform is applied, it means we're showing the JS version of TS code
    const useTypescript = code.selectedTransform !== 'js';

    // Merge common export config with StackBlitz-specific config
    const mergedConfig: ExportConfig = {
      ...commonExportConfig,
      ...stackBlitzExportConfig,
      variantName: code.selectedVariant,
      title,
      description,
      useTypescript,
    };

    // Use custom export function if provided, otherwise use default exportVariant
    const exportFunction = mergedConfig.exportFunction || exportVariant;
    const { exported, rootFile } = exportFunction(variantCode, mergedConfig);

    // Flatten the variant to get a flat file structure
    const flattenedFiles = flattenVariant(exported);

    const stackBlitzDemo = createStackBlitz({
      title,
      description,
      flattenedFiles,
      rootFile,
    });

    openWithForm(stackBlitzDemo);
  }, [
    effectiveCode,
    code.selectedVariant,
    code.selectedTransform,
    contentProps.name,
    commonExportConfig,
    stackBlitzExportConfig,
  ]);

  // Create CodeSandbox demo callback
  const openCodeSandbox = React.useCallback(() => {
    // Get the current variant code
    const variantCode = effectiveCode[code.selectedVariant];

    if (!variantCode || typeof variantCode === 'string') {
      console.warn('No valid variant code available for CodeSandbox demo');
      return;
    }

    const title = contentProps.name || 'Demo';
    const description = `${title} demo`;

    // Determine if we should use TypeScript based on whether 'js' transform is NOT applied
    // If 'js' transform is applied, it means we're showing the JS version of TS code
    const useTypescript = code.selectedTransform !== 'js';

    // Merge common export config with CodeSandbox-specific config
    const mergedConfig: ExportConfig = {
      ...commonExportConfig,
      ...codeSandboxExportConfig,
      variantName: code.selectedVariant,
      title,
      description,
      useTypescript,
    };

    // Use custom export function if provided, otherwise use default exportVariantAsCra
    const exportFunction = mergedConfig.exportFunction || exportVariantAsCra;
    const { exported: craExport, rootFile } = exportFunction(variantCode, mergedConfig);

    // Flatten the variant to get a flat file structure
    const flattenedFiles = flattenVariant(craExport);

    const codeSandboxDemo = createCodeSandbox({
      flattenedFiles,
      rootFile,
    });

    openWithForm(codeSandboxDemo);
  }, [
    effectiveCode,
    code.selectedVariant,
    code.selectedTransform,
    contentProps.name,
    commonExportConfig,
    codeSandboxExportConfig,
  ]);

  return {
    ...code,
    // Demo-specific additions
    component,
    ref,
    resetFocus,
    openStackBlitz,
    openCodeSandbox,
    name: contentProps.name,
    slug,
  };
}
