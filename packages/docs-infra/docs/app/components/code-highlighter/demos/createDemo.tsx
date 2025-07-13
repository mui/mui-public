import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { stringOrHastToJsx, stringOrHastToString } from '@mui/internal-docs-infra/hast';
import { parseSource } from '@mui/internal-docs-infra/parseSource';

import type {
  CodeHighlighterProps,
  Components,
  ContentProps,
} from '@mui/internal-docs-infra/CodeHighlighter';
// import { patch } from 'jsondiffpatch';

import '@wooorm/starry-night/style/light';
import { transformTsToJs } from '@mui/internal-docs-infra/transformTsToJs';
import { Nodes } from 'hast';

function DemoContent(props: ContentProps) {
  const code = props.code?.Default;
  if (!code) {
    return <div>No code available</div>;
  }

  let source = code.source && stringOrHastToJsx(code.source, true);
  // const delta = code.transforms?.js?.delta;
  // if (delta) {
  //   if (typeof code.source === 'string') {
  //     const patched = patch(stringOrHastToString(code.source).split('\n'), delta);
  //     if (Array.isArray(patched)) {
  //       source = patched.join('\n');
  //     }
  //   } else {
  //     source = stringOrHastToJsx(patch(code.source, delta) as Nodes, true);
  //   }
  // }

  return (
    <div style={{ border: '1px solid #ccc', padding: '16px' }}>
      <div style={{ marginBottom: '16px' }}>{props.components?.Default}</div>
      <span style={{ textDecoration: 'underline' }}>{code.fileName}</span>
      <pre>{source}</pre>
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
        sourceTransformers={[{ extensions: ['ts', 'tsx'], transformer: transformTsToJs }]}
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
