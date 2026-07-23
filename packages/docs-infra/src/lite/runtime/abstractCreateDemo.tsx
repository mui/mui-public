import * as React from 'react';
import type { CodePrecompute, ContentProps } from './types';

export interface CreateDemoConfig {
  DemoContent: React.ComponentType<ContentProps<DemoComponentProps>>;
}

export interface DemoComponentProps {
  preloadSources?: boolean;
}

export type DemoComponent = React.ComponentType<DemoComponentProps> & {
  __docsInfraPrecompute?: CodePrecompute;
};

function getDemoIdentity(sourceUrl: string): { name: string; slug: string } {
  let directory: string;
  try {
    const segments = new URL(sourceUrl).pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      throw new Error();
    }
    directory = decodeURIComponent(segments[segments.length - 2]);
  } catch {
    throw new Error(
      `docs-infra: createDemo requires import.meta.url with a parent directory; received ${JSON.stringify(sourceUrl)}.`,
    );
  }
  const words = directory.split(/[-_]/).filter(Boolean);
  const slug = directory
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug || words.length === 0) {
    throw new Error(
      `docs-infra: createDemo could not derive a demo name from ${JSON.stringify(sourceUrl)}.`,
    );
  }
  const name = words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
  return { name, slug };
}

function makeDemo(
  config: CreateDemoConfig,
  sourceUrl: string,
  variants: Record<string, React.ComponentType>,
): DemoComponent {
  const { DemoContent } = config;
  const { name, slug } = getDemoIdentity(sourceUrl);
  const components = Object.fromEntries(
    Object.entries(variants).map(([variantName, Component]) => [variantName, <Component />]),
  );

  function Demo({ preloadSources }: DemoComponentProps) {
    // eslint-disable-next-line no-underscore-dangle
    const code = (Demo as DemoComponent).__docsInfraPrecompute;
    if (!code) {
      throw new Error(
        `docs-infra: the demo loader did not attach __docsInfraPrecompute to the demo from ${sourceUrl}.`,
      );
    }
    return (
      <DemoContent
        code={code}
        components={components}
        name={name}
        preloadSources={preloadSources}
        slug={slug}
        url={sourceUrl}
      />
    );
  }
  if (process.env.NODE_ENV !== 'production') {
    Demo.displayName = `Demo(${name})`;
  }
  return Demo as DemoComponent;
}

export function createDemoFactory(config: CreateDemoConfig) {
  return function createDemo(sourceUrl: string, component: React.ComponentType): DemoComponent {
    return makeDemo(config, sourceUrl, { Default: component });
  };
}

export function createDemoWithVariantsFactory(config: CreateDemoConfig) {
  return function createDemoWithVariants(
    sourceUrl: string,
    variants: Record<string, React.ComponentType>,
  ): DemoComponent {
    return makeDemo(config, sourceUrl, variants);
  };
}
