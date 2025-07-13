import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { stringOrHastToJsx } from '@mui/internal-docs-infra/hast';
import { parseSource } from '@mui/internal-docs-infra/parseSource';

import type {
  CodeHighlighterProps,
  Components,
  ContentProps,
} from '@mui/internal-docs-infra/CodeHighlighter';

import '@wooorm/starry-night/style/both';
import transformTsToJs from '../../../../../build/transformTsToJs/transformTsToJs';

function DemoContent(props: ContentProps) {
  const code = props.code?.Default;
  if (!code) {
    return <div>No code available</div>;
  }

  return (
    <div style={{ border: '1px solid #ccc', padding: '16px' }}>
      <div>{props.components?.Default}</div>
      {code.source && <pre>{stringOrHastToJsx(code.source)}</pre>}
    </div>
  );
}

type DemoProps = Pick<CodeHighlighterProps, 'name' | 'slug' | 'description' | 'forceClient'>;
type Demo = React.ComponentType<DemoProps> & { Title: React.ComponentType };

type Options = Partial<
  Pick<CodeHighlighterProps, 'name' | 'slug' | 'description' | 'precompute' | 'code'>
>;

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
        parseSource={parseSource}
      />
    );
  }

  Component.Title = () => <h2 id={opts.slug}>{opts.name}</h2>;

  if (process.env.NODE_ENV !== 'production') {
    Component.displayName = `${opts.name}Demo`; // TODO: should have displayName instead
  }

  return Component as Demo;
}

export default createDemo;
