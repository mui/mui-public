// import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';
// import type { LoadVariantCode, LoadSource } from '@mui/internal-docs-infra/CodeHighlighter';
// import Code from '../../../code-highlighter/demos/Code';
// import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';

// const loadVariantCode: LoadVariantCode = async (variantName, url) => {
//   const response = await fetch(
//     `https://api.github.com/repos/mui/mui-public/contents/packages/docs-infra/docs/app/components/highlight-provider/demos/fetch/${variantName}`,
//   );
//   if (!response.ok) {
//     throw new Error(`Failed to load variant code: ${response.statusText}`);
//   }
//   const data = await response.json();

//   const code = {};
//   data.forEach(({ type, name }) => {
//     if (type === 'file') {
//       code.fileName = name;
//     }
//   });
// };

// const loadSource: LoadSource = async (variantName, filename, url) => {
//   const response = await fetch(
//     `https://raw.githubusercontent.com/mui/mui-public/master/packages/docs-infra/docs/app/components/highlight-provider/demos/fetch/${variantName}/${filename}`,
//   );
//   if (!response.ok) {
//     throw new Error(`Failed to load source code: ${response.statusText}`);
//   }
//   return response.text();
// };

// export default function HighlightProvider() {
//   return (
//     <HighlightProvider loadVariantCode={loadVariantCode}>
//       <CodeHighlighter variants={['Demo']} />
//     </HighlightProvider>
//   );
// }
