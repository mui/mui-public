import * as React from 'react';
import { CodeHighlighter } from '../CodeHighlighter';
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
} from '../CodeHighlighter/types';
import { createDemoDataWithVariants } from '../createDemoData';
import { DemoGlobalData } from '../createDemoData/types';

type CreateDemoMeta = {
  name?: string;
  slug?: string;
  displayName?: string;
  variantType?: string;
  skipPrecompute?: boolean;
  highlightAt?: CodeHighlighterProps<{}>['highlightAt'];
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
  highlightAt?: CodeHighlighterProps<{}>['highlightAt'];
  fallbackUsesExtraFiles?: boolean;
  fallbackUsesAllVariants?: boolean;
  loadCodeMeta?: LoadCodeMeta;
  loadVariantMeta?: LoadVariantMeta;
  loadSource?: LoadSource;
  sourceParser?: Promise<ParseSource>;
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
        url={demoData.url}
        name={demoData.name}
        slug={demoData.slug}
        variantType={meta?.variantType || variantType}
        precompute={demoData.precompute}
        globalsCode={globalCode}
        components={renderedComponents}
        contentProps={props}
        Content={options.DemoContent}
        ContentLoading={options.DemoContentLoading}
        loadCodeMeta={options.loadCodeMeta}
        loadVariantMeta={options.loadVariantMeta}
        loadSource={options.loadSource}
        sourceParser={options.sourceParser}
        highlightAt={meta?.highlightAt || options.highlightAt}
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
