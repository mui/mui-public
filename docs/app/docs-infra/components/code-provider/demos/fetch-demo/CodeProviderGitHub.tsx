'use client';

import * as React from 'react';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';
import type {
  Code,
  LoadCodeMeta,
  LoadSource,
  LoadVariantMeta,
} from '@mui/internal-docs-infra/CodeHighlighter/types';
import { parseCreateFactoryCall } from '@mui/internal-docs-infra/pipeline/parseCreateFactoryCall';
import {
  buildGitHubUrl,
  fetchContents,
  fetchDirectoryEntries,
  fetchRawSource,
  parseGitHubUrl,
} from '../github';

// Sentinel file:// URL we hand to `parseCreateFactoryCall` so it can resolve
// relative imports. We strip its prefix back off when mapping the resolved
// variant URLs back to GitHub URLs below.
const PLACEHOLDER_DIR = 'file:///placeholder';
const PLACEHOLDER_INDEX = `${PLACEHOLDER_DIR}/index.ts`;

/**
 * Fetches the demo entry file (e.g. `.../demo-basic/index.ts`), parses the
 * `createDemo` / `createDemoWithVariants` call inside it, and emits one
 * extension-less GitHub URL per variant. `loadVariantMeta` then probes that
 * URL to discover whether it points at a file or a directory.
 */
const loadCodeMeta: LoadCodeMeta = async (url) => {
  const parsed = parseGitHubUrl(url);
  const lastSlash = parsed.path.lastIndexOf('/');
  const dirPath = lastSlash >= 0 ? parsed.path.slice(0, lastSlash) : parsed.path;

  const source = await fetchRawSource(url);
  const factory = await parseCreateFactoryCall(source, PLACEHOLDER_INDEX);
  if (!factory || !factory.variants) {
    throw new Error(`No create* factory call found in ${url}`);
  }

  const code: Code = {};
  for (const [variantName, resolvedUrl] of Object.entries(factory.variants)) {
    // resolvedUrl is `file:///placeholder/<importPath>`; strip the placeholder
    // and append the bare import path to the entry's directory.
    if (!resolvedUrl.startsWith(`${PLACEHOLDER_DIR}/`)) {
      continue;
    }
    const importPath = resolvedUrl.slice(PLACEHOLDER_DIR.length + 1);
    code[variantName] = buildGitHubUrl({
      ...parsed,
      kind: 'tree',
      path: `${dirPath}/${importPath}`,
    });
  }
  return code;
};

/**
 * Resolves a variant URL to its main file + sibling `extraFiles`. The URL
 * has no extension, so we probe the Contents API:
 *
 * - If it returns an array → directory: pick `index.{ext}` as the main file
 *   and expose every other file in the directory as `extraFiles`.
 * - If it 404s → the path is a sibling file (e.g. `Foo.tsx`); list the parent
 *   directory once to discover the matching file's extension.
 */
const loadVariantMeta: LoadVariantMeta = async (_variantName, url) => {
  const parsed = parseGitHubUrl(url);
  const contents = await fetchContents(parsed);

  if (Array.isArray(contents)) {
    const childFiles = contents.filter((entry) => entry.type === 'file');
    const indexFile = childFiles.find((file) => /^index\.[^.]+$/.test(file.name));
    if (!indexFile) {
      throw new Error(`No index.* file found in ${url}`);
    }
    const indexUrl = buildGitHubUrl({
      ...parsed,
      kind: 'blob',
      path: `${parsed.path}/${indexFile.name}`,
    });
    const extraFiles: Record<string, string> = {};
    for (const file of childFiles) {
      if (file.name === indexFile.name) {
        continue;
      }
      extraFiles[file.name] = buildGitHubUrl({
        ...parsed,
        kind: 'blob',
        path: `${parsed.path}/${file.name}`,
      });
    }
    // Eagerly fetch the main file so we keep `url` as the URL we were given
    // (the consumer-facing anchor) and pass the raw text through `source`.
    const source = await fetchRawSource(indexUrl);
    return {
      url,
      fileName: indexFile.name,
      source,
      extraFiles,
      allFilesListed: true,
    };
  }

  // 404: the import resolves to a sibling file. List the parent to find the
  // file whose name without extension matches the import's base name.
  const lastSlash = parsed.path.lastIndexOf('/');
  const parentPath = lastSlash >= 0 ? parsed.path.slice(0, lastSlash) : parsed.path;
  const baseName = parsed.path.slice(lastSlash + 1);

  const parentEntries = await fetchDirectoryEntries({
    ...parsed,
    kind: 'tree',
    path: parentPath,
  });
  const matchingFile = parentEntries.find(
    (entry) =>
      entry.type === 'file' &&
      (entry.name === baseName || entry.name.replace(/\.[^.]+$/, '') === baseName),
  );
  if (!matchingFile) {
    throw new Error(`Could not resolve ${url} to a file or directory`);
  }
  const fileUrl = buildGitHubUrl({
    ...parsed,
    kind: 'blob',
    path: `${parentPath}/${matchingFile.name}`,
  });
  const source = await fetchRawSource(fileUrl);
  return {
    url,
    fileName: matchingFile.name,
    source,
    extraFiles: {},
    allFilesListed: true,
  };
};

/**
 * Fetches the source for a single file. The URL is an absolute GitHub `blob`
 * URL produced by `loadCodeMeta` or `loadVariantMeta`, so we only need to map
 * it to `raw.githubusercontent.com`.
 */
const loadSource: LoadSource = async (url) => {
  return { source: await fetchRawSource(url) };
};

export function CodeProviderGitHub({ children }: { children: React.ReactNode }) {
  return (
    // @focus-start
    <CodeProvider
      loadCodeMeta={loadCodeMeta}
      loadVariantMeta={loadVariantMeta}
      loadSource={loadSource}
    >
      {children}
    </CodeProvider>
    // @focus-end
  );
}
