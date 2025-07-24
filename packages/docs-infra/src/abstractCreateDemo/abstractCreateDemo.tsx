import * as React from 'react';
import { CodeHighlighter } from '../CodeHighlighter';
import type { Code, Components, ContentLoadingProps, ContentProps } from '../CodeHighlighter';

type CreateDemoMeta = {
  name?: string;
  slug?: string;
  displayName?: string;
  skipPrecompute?: boolean;
  precompute?: Code;
};

type AbstractCreateDemoOptions<T extends {}> = {
  DemoContent: React.ComponentType<ContentProps<T>>;
  DemoContentLoading?: React.ComponentType<ContentLoadingProps<T>>;
  DemoTitle?: React.ComponentType<{ slug?: string; children?: string }>;
}; // TODO: allow passing any CodeHighlighter prop

export function abstractCreateDemo<T extends {}>(
  options: AbstractCreateDemoOptions<T>,
  url: string,
  variants: { Default: React.ComponentType } | { [key: string]: React.ComponentType },
  meta: CreateDemoMeta | undefined,
): React.ComponentType<T> & { Title: React.ComponentType } {
  if (!url.startsWith('file:')) {
    throw new Error(
      'createDemo() requires the `url` parameter to be a file URL. Use `import.meta.url` to get the current file URL.',
    );
  }

  if (!meta || (!meta.precompute && !meta.skipPrecompute)) {
    throw new Error(
      'createDemo() was unable to precompute the code. Ensure the createDemo() function is called within a path used for demo indexes. Run `pnpm run check:conventions:demo`',
    );
  }

  const precompute = meta.precompute;

  function Component(props: T) {
    const renderedComponents = Object.entries(variants).reduce((acc, [key, Variant]) => {
      acc[key] = <Variant />;
      return acc;
    }, {} as Components);

    return (
      <CodeHighlighter
        url={url}
        precompute={precompute}
        components={renderedComponents}
        contentProps={props}
        Content={options.DemoContent}
        ContentLoading={options.DemoContentLoading}
      />
    );
  }

  function Title() {
    if (options.DemoTitle) {
      return <options.DemoTitle slug={meta?.slug}>{meta?.name}</options.DemoTitle>;
    }

    return <h3 id={meta?.slug}>{meta?.name}</h3>;
  }
  Component.Title = Title as React.ComponentType;

  if (process.env.NODE_ENV !== 'production') {
    const displayName = meta?.displayName || `${meta?.name?.replace(/ /g, '')}Demo`;
    Component.displayName = displayName;
    Component.Title.displayName = `${displayName}Title`;
  }

  return Component;
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
