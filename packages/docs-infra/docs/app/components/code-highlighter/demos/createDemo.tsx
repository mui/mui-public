import * as React from 'react';
import CodeHighlighter from '@mui/internal-docs-infra/CodeHighlighter/';
import { hastOrJsonToJsx } from '@mui/internal-docs-infra/CodeHighlighter/';

import type {
  CodeHighlighterProps,
  Components,
  ContentProps,
} from '@mui/internal-docs-infra/CodeHighlighter/';

function DemoContent(props: ContentProps) {
  return (
    <div>
      <div>{props.components?.Default}</div>
      <h2>{props.name}</h2>
      <p>{props.description}</p>
      <pre>{hastOrJsonToJsx(props.code?.Default?.source)}</pre>
    </div>
  );
}

type DemoProps = Pick<CodeHighlighterProps, 'name' | 'slug' | 'description' | 'clientOnly'>;
type Demo = React.ComponentType<DemoProps>;

type Options = Pick<CodeHighlighterProps, 'name' | 'slug' | 'description' | 'precompute' | 'code'>;

function createDemo(
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
      />
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    Component.displayName = `${opts.name}Demo`; // TODO: should have displayName instead
  }

  return Component as Demo;
}

export default createDemo;
