import * as React from 'react';
import { pathToFileURL } from 'node:url';
import { CodeHighlighter } from '../CodeHighlighter';
import {
  applyUrlPrefixToCode,
  applyUrlPrefixToGlobalsCode,
  replaceUrlPrefix,
  type UrlPrefix,
} from './applyUrlPrefix';
import type {
  Code,
  CodeHighlighterProps,
  Components,
  ContentLoadingProps,
  ContentProps,
  LoadCodeMeta,
  LoadSource,
  LoadVariantMeta,
  ParseSource,
  SourceEnhancers,
} from '../CodeHighlighter/types';
import { createDemoDataWithVariants } from '../createDemoData';
import { DemoGlobalData } from '../createDemoData/types';

type CreateDemoMeta = {
  name?: string;
  slug?: string;
  displayName?: string;
  variantType?: string;
  skipPrecompute?: boolean;
  highlightAfter?: CodeHighlighterProps<{}>['highlightAfter'];
  enhanceAfter?: CodeHighlighterProps<{}>['enhanceAfter'];
  precompute?: Code;
  ClientProvider?: React.ComponentType<{ children: React.ReactNode }>;
};

type AbstractCreateDemoOptions<T extends {}> = {
  DemoContent: React.ComponentType<ContentProps<T>>;
  DemoContentLoading?: React.ComponentType<ContentLoadingProps<T>>;
  DemoTitle?: React.ComponentType<{ slug?: string; children?: string }>;
  controlled?: boolean;
  demoGlobalData?: DemoGlobalData[];
  variantTypes?: Record<string, string>;
  highlightAfter?: CodeHighlighterProps<{}>['highlightAfter'];
  enhanceAfter?: CodeHighlighterProps<{}>['enhanceAfter'];
  fallbackUsesExtraFiles?: boolean;
  fallbackUsesAllVariants?: boolean;
  loadCodeMeta?: LoadCodeMeta;
  loadVariantMeta?: LoadVariantMeta;
  loadSource?: LoadSource;
  sourceParser?: Promise<ParseSource>;
  sourceEnhancers?: SourceEnhancers;
  /**
   * Absolute filesystem path of the project root used to resolve `url`s
   * gathered from `import.meta.url`. Combined with `projectUrl` to rewrite
   * local `file://` URLs into hosted Git URLs (e.g.
   * `https://github.com/owner/repo/tree/<branch>/`) before they reach the
   * `CodeHighlighter`.
   *
   * Typically read from an environment variable populated by the build
   * pipeline (e.g. Netlify's `REPOSITORY_URL`/`BRANCH` plus
   * `git rev-parse --show-toplevel`). When either `projectPath` or
   * `projectUrl` is missing, URLs are left untouched.
   */
  projectPath?: string;
  /**
   * Public URL prefix that maps to `projectPath`. See `projectPath` for
   * details.
   */
  projectUrl?: string;
};

export function abstractCreateDemo<T extends {}>(
  options: AbstractCreateDemoOptions<T>,
  url: string,
  variants: { [key: string]: React.ComponentType },
  meta: CreateDemoMeta | undefined,
): React.ComponentType<T> & { Title: React.ComponentType } {
  const demoData = createDemoDataWithVariants(url, variants, meta);

  const variantType =
    options.variantTypes && options.variantTypes[Object.keys(variants).sort().join(':')];

  const globalCode: Array<Code | string> = [];
  if (options.demoGlobalData) {
    options.demoGlobalData.forEach((data) => {
      globalCode.push(data.precompute || data.url);
    });
  }

  // Apply urlPrefix once at factory build time so the rewritten values are
  // captured by the closures below (and shared across renders) instead of
  // being recomputed on every render inside `DemoComponent`.
  const urlPrefix = resolveUrlPrefix(options.projectPath, options.projectUrl);
  const resolvedUrl = urlPrefix
    ? (replaceUrlPrefix(demoData.url, urlPrefix) ?? demoData.url)
    : demoData.url;
  const resolvedPrecompute =
    urlPrefix && demoData.precompute
      ? applyUrlPrefixToCode(demoData.precompute, urlPrefix)
      : demoData.precompute;
  const resolvedGlobalCode =
    urlPrefix && globalCode.length > 0
      ? applyUrlPrefixToGlobalsCode(globalCode, urlPrefix)
      : globalCode;

  function DemoComponent(props: T) {
    const renderedComponents = Object.entries(demoData.components).reduce(
      (acc, [key, Component]) => {
        acc[key] = React.createElement(Component);
        return acc;
      },
      {} as Components,
    );

    const highlighter = (
      <CodeHighlighter
        url={resolvedUrl}
        name={demoData.name}
        slug={demoData.slug}
        variantType={meta?.variantType || variantType}
        precompute={resolvedPrecompute}
        globalsCode={resolvedGlobalCode}
        components={renderedComponents}
        contentProps={props}
        Content={options.DemoContent}
        ContentLoading={options.DemoContentLoading}
        loadCodeMeta={options.loadCodeMeta}
        loadVariantMeta={options.loadVariantMeta}
        loadSource={options.loadSource}
        sourceParser={options.sourceParser}
        sourceEnhancers={options.sourceEnhancers}
        highlightAfter={meta?.highlightAfter || options.highlightAfter}
        enhanceAfter={meta?.enhanceAfter || options.enhanceAfter}
        controlled={options.controlled}
        fallbackUsesExtraFiles={options.fallbackUsesExtraFiles}
        fallbackUsesAllVariants={options.fallbackUsesAllVariants}
      />
    );

    // Use client provider if available
    const ClientProvider = meta?.ClientProvider;

    if (ClientProvider) {
      return <ClientProvider>{highlighter}</ClientProvider>;
    }

    return highlighter;
  }

  function Title() {
    if (options.DemoTitle) {
      return <options.DemoTitle slug={demoData.slug}>{demoData.name}</options.DemoTitle>;
    }

    return <h3 id={demoData.slug}>{demoData.name}</h3>;
  }
  DemoComponent.Title = Title as React.ComponentType;

  if (process.env.NODE_ENV !== 'production') {
    DemoComponent.displayName = demoData.displayName;
    DemoComponent.Title.displayName = `${demoData.displayName}Title`;
  }

  return DemoComponent;
}

function resolveUrlPrefix(
  projectPath: string | undefined,
  projectUrl: string | undefined,
): UrlPrefix | undefined {
  if (!projectPath || !projectUrl) {
    return undefined;
  }
  const from = `${pathToFileURL(projectPath).href}/`;
  const to = projectUrl.endsWith('/') ? projectUrl : `${projectUrl}/`;
  return { from, to };
}

export function createDemoFactory<T extends {}>(options: AbstractCreateDemoOptions<T>) {
  /**
   * Creates a demo component for displaying code examples with syntax highlighting.
   * @param url Depends on `import.meta.url` to determine the source file location.
   * @param component The component to be rendered in the demo.
   * @param meta Additional meta for the demo.
   */
  const createDemo = (url: string, component: React.ComponentType, meta?: CreateDemoMeta) => {
    return abstractCreateDemo(
      options,
      url,
      { Default: component }, // precomputed code will use the 'Default' key
      meta,
    );
  };

  return createDemo;
}

export function createDemoWithVariantsFactory<T extends {}>(options: AbstractCreateDemoOptions<T>) {
  /**
   * Creates a demo component for displaying code examples with syntax highlighting.
   * A variant is a different implementation style of the same component.
   * @param url Depends on `import.meta.url` to determine the source file location.
   * @param variants The variants of the component to be rendered in the demo.
   * @param meta Additional meta for the demo.
   */
  const createDemoWithVariants = (
    url: string,
    variants: Record<string, React.ComponentType>,
    meta?: CreateDemoMeta,
  ) => {
    return abstractCreateDemo(options, url, variants, meta);
  };

  return createDemoWithVariants;
}
