import CodeHighlighter, { ContentProps, hastOrJsonToJsx } from '../../CodeHighlighter';

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
