import createDemo from '../createDemo'
import Default from './BasicCode'

export const CodeDemo = createDemo(
  import.meta.url,
  { Default }, // TODO: it would be nice to just do import.meta.url, BasicCode, {
  {
    name: 'Basic Code Block',
    slug: 'code',
    // precompute: true, TODO: enable this
    code: {
      Default: {
        fileName: 'BasicCode.tsx',
        source: `import Code from '../Code';

function BasicCode() {
  return <Code>{\`console.log('Hello, world!');\`}</Code>;
}

export default BasicCode;`,
        extraFiles: {
          Code: {
            fileName: '../Code.tsx',
            source: `import CodeHighlighter, {
  ContentProps,
  hastOrJsonToJsx,
} from '../../../../../src/CodeHighlighter/CodeHighlighter';

function CodeContent(props: ContentProps) {
  return (
    <div>
      <h2>{props.code.Default.fileName}</h2>
      <pre>{hastOrJsonToJsx(props.code.Default.source)}</pre>
    </div>
  );
}

function Code({ children, fileName = 'index.js' }: { children: string; fileName?: string }) {
  return (
    <CodeHighlighter code={{ Default: { fileName, source: children } }} Content={CodeContent} />
  );
}

export default Code;
`,
          },
        },
      },
    },
  }
)
