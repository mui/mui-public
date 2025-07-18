import { createDemo } from '@/functions/createDemo';

const Demo = createDemo(
  import.meta.url,
  {
    Jsx: () => <div>JSX Demo Component</div>,
    Mdx: () => <div>MDX Demo Component</div>,
  },
  {
    name: 'Demo',
    slug: 'demo',
    description: 'This is a demo component for CodeHighlighter.',
    code: {
      Jsx: {
        fileName: 'index.js',
        source: `() => <div>JSX Demo Component</div>`,
      },
      Mdx: {
        fileName: 'index.js',
        source: `() => <div>MDX Demo Component</div>`,
      },
    },
  },
);

export default Demo;
