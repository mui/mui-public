import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { parseSource } from '@mui/internal-docs-infra/parseSource';
import { transformTsToJs } from '@mui/internal-docs-infra/transformTsToJs';
import type { CodeHighlighterProps, Components } from '@mui/internal-docs-infra/CodeHighlighter';

import { DemoContent } from './DemoContent';

type DemoProps = Pick<CodeHighlighterProps, 'name' | 'slug' | 'description' | 'forceClient'>;
type Demo = React.ComponentType<DemoProps> & { Title: React.ComponentType };

type Options = Partial<
  Pick<CodeHighlighterProps, 'name' | 'slug' | 'description' | 'precompute' | 'code'>
>;

export function createDemo(
  url: string,
  components: { [key: string]: React.ComponentType },
  opts: Options,
) {
  function Component(props: DemoProps) {
    const renderedComponents: Components = Object.entries(components).reduce(
      (acc, [key, Variant]) => {
        acc[key] = <Variant />;
        return acc;
      },
      {} as Components,
    );

    return (
      <CodeHighlighter
        {...opts}
        {...props}
        url={url}
        components={renderedComponents}
        Content={DemoContent}
        parseSource={parseSource}
        sourceTransformers={[{ extensions: ['ts', 'tsx'], transformer: transformTsToJs }]}
      />
    );
  }

  Component.Title = (() => <h2 id={opts.slug}>{opts.name}</h2>) as React.ComponentType;

  if (process.env.NODE_ENV !== 'production') {
    const displayName = `${opts.name?.replace(/ /g, '')}Demo`;
    Component.Title.displayName = `${displayName}Title`;
    Component.displayName = displayName; // TODO: should have displayName instead
  }

  return Component as Demo;
}
