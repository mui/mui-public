import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter'
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter'
import { stringOrHastToJsx } from '@mui/internal-docs-infra/hast'
import { parseSource } from '@mui/internal-docs-infra/parseSource'

import '@wooorm/starry-night/style/light'

function CodeContent(props: ContentProps) {
  const code = props.code?.Default
  if (!code) {
    return <div>No code available</div>
  }

  return (
    <div style={{ border: '1px solid #ccc', padding: '16px' }}>
      <span style={{ textDecoration: 'underline' }}>{code.fileName}</span>
      {code.source && <pre>{stringOrHastToJsx(code.source, true)}</pre>}
    </div>
  )
}

function Code({
  children,
  fileName = 'index.js',
  forceClient,
}: {
  children: string
  fileName?: string
  forceClient?: boolean
}) {
  return (
    <CodeHighlighter
      code={{ Default: { fileName, source: children } }}
      Content={CodeContent}
      forceClient={forceClient}
      parseSource={parseSource}
    />
  )
}

export default Code
