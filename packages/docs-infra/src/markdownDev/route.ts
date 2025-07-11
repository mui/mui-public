import fs from 'fs/promises';
import { htmlToMarkdown } from '../htmlToMarkdown';

export const dynamic = 'force-static';

// TODO: this doesn't seem to fix 404s when hitting an unrelated path in dev
export const dynamicParams = false;
// e.g. /does-not-exist should return a 404, but it returns a 500 instead
// Error: Page "/[...markdownPath]/route" is missing param "/does-not-exist" in "generateStaticParams()", which is required with "output: export" config.
// https://github.com/vercel/next.js/issues/56253

const PORT = process.env.PORT || 3000;
const PLACEHOLDER = '(generated after build)';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ markdownPath: string[] }> },
) {
  const path = (await params).markdownPath;
  if (path.length === 0 || (path.length === 1 && path[0] === PLACEHOLDER)) {
    return new Response('No path provided', { status: 400 });
  }

  path[path.length - 1] = path[path.length - 1].replace(/\.md$/, '');
  const html = await fetch(`http://127.0.0.1:${PORT}/${path.join('/')}`).then((res) => res.text());

  const markdown = await htmlToMarkdown(html);

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  });
}

// TODO: refactor to be used by build process
async function generateStaticParamsRecursive(
  maxDepth: number = 5,
  basePath: string[] = [],
  currentPath: string[] = [],
) {
  if (maxDepth === 0) {
    return [];
  }

  const fullPath = [...basePath, ...currentPath].join('/');
  const files = await fs.readdir(`./app/${fullPath}`, { withFileTypes: true });

  const params: { markdownPath: string[] }[] = [];
  const dirPromises: Promise<{ markdownPath: string[] }[]>[] = [];

  for (const file of files) {
    if (file.isDirectory()) {
      dirPromises.push(
        generateStaticParamsRecursive(maxDepth - 1, basePath, [...currentPath, file.name]),
      );
    } else if (file.isFile() && file.name.startsWith('page.')) {
      const markdownPath = [...currentPath];
      markdownPath[markdownPath.length - 1] += '.md';
      params.push({ markdownPath });
    }
  }

  const dirResults = await Promise.all(dirPromises);
  for (const result of dirResults) {
    params.push(...result);
  }

  return params;
}

export async function generateStaticParams() {
  if (process.env.NODE_ENV === 'development') {
    return generateStaticParamsRecursive();
  }

  // During a production build, we can't fetch html from the server,
  // so we return a placeholder path to avoid errors.
  // TODO: PR to Next.js generateIntrospectiveStaticParams() should return paths based on the actual build output
  // it would leave these pages to be generated last, after the build is complete and a temporary server is running
  // TODO: we would also need a PR to Next.js to output `file.md` in `out/` when static export is used
  return [{ markdownPath: [PLACEHOLDER] }];
}
