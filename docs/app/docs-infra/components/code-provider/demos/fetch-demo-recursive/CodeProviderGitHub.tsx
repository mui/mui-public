'use client';

import * as React from 'react';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';
import type {
  Code,
  LoadCodeMeta,
  LoadSource,
} from '@mui/internal-docs-infra/CodeHighlighter/types';
import { parseCreateFactoryCall } from '@mui/internal-docs-infra/pipeline/parseCreateFactoryCall';
import {
  IGNORE_COMMENT_PREFIXES,
  getFileNameFromUrl,
  resolveImportResult,
  resolveModulePath,
  type DirectoryReader,
} from '@mui/internal-docs-infra/pipeline/loaderUtils';
import { createLoadIsomorphicCodeSource } from '@mui/internal-docs-infra/pipeline/loadIsomorphicCodeSource';
import {
  enhanceCodeEmphasis,
  EMPHASIS_COMMENT_PREFIX,
  FOCUS_COMMENT_PREFIX,
} from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';
import { buildGitHubUrl, createGitHubCache, parseGitHubUrl, type GitHubCache } from '../github';

const NOTABLE_COMMENTS_PREFIX = [EMPHASIS_COMMENT_PREFIX, FOCUS_COMMENT_PREFIX];
const REMOVE_COMMENTS_WITH_PREFIX = [
  EMPHASIS_COMMENT_PREFIX,
  FOCUS_COMMENT_PREFIX,
  ...IGNORE_COMMENT_PREFIXES,
];

// Apply the same `@highlight` / `@focus` framing
const SOURCE_ENHANCERS = [enhanceCodeEmphasis];

export function CodeProviderGitHub({ children }: { children: React.ReactNode }) {
  // The cache lives for the lifetime of this component instance: a remount
  // resets every directory listing, file body and ref→SHA lookup.
  const cacheRef = React.useRef<GitHubCache | null>(null);
  if (cacheRef.current === null) {
    cacheRef.current = createGitHubCache();
  }
  const cache = cacheRef.current;

  // Adapter so `resolveModulePath` / `resolveImportResult` can walk the
  // GitHub tree on demand. Every directory we touch is fetched once and
  // reused, including 404s.
  const readDirectory = React.useCallback<DirectoryReader>(
    async (dirUrl) => {
      const entries = await cache.readDirectory(dirUrl);
      if (!entries) {
        return [];
      }
      return entries.map((entry) => ({
        name: entry.name,
        isFile: entry.type === 'file',
        isDirectory: entry.type === 'dir',
      }));
    },
    [cache],
  );

  const fetchSource = React.useCallback(
    async (url: string) => {
      const source = await cache.readFile(url);
      if (source === null) {
        throw new Error(`File not found: ${url}`);
      }
      return source;
    },
    [cache],
  );

  /**
   * Pins the entry URL to a commit SHA, fetches the entry source, parses its
   * `createDemo` / `createDemoWithVariants` call, and resolves each variant
   * URL to a real blob URL. Variants declared with a named export get the
   * richer `{ url, fileName, namedExport }` shape so the framework knows
   * which export to import. The framework's `loadSource` then recursively
   * discovers each variant's imports.
   */
  const loadCodeMeta = React.useCallback<LoadCodeMeta>(
    async (url) => {
      const immutableUrl = await cache.toImmutableUrl(url);
      const source = await fetchSource(immutableUrl);
      const factory = await parseCreateFactoryCall(source, immutableUrl);
      if (!factory || !factory.variants) {
        throw new Error(`No create* factory call found in ${url}`);
      }

      const code: Code = {};
      await Promise.all(
        Object.entries(factory.variants).map(async ([variantName, variantUrl]) => {
          const resolved = await resolveModulePath(variantUrl, readDirectory);
          const importUrl = typeof resolved === 'string' ? resolved : resolved.import;
          const fileUrl = buildGitHubUrl({ ...parseGitHubUrl(importUrl), kind: 'blob' });
          const namedExport = factory.namedExports?.[variantName];
          if (namedExport) {
            const { fileName } = getFileNameFromUrl(fileUrl);
            if (!fileName) {
              throw new Error(
                `Cannot determine fileName from URL "${fileUrl}" for variant "${variantName}".`,
              );
            }
            code[variantName] = { url: fileUrl, fileName, namedExport };
          } else {
            code[variantName] = fileUrl;
          }
        }),
      );
      return code;
    },
    [cache, fetchSource, readDirectory],
  );

  /**
   * Defers all the comment-stripping, externals reshaping and `extraFiles`
   * assembly to the shared isomorphic loader. The two GitHub-specific bits
   * — pinning a URL to an immutable commit SHA before fetching, and walking
   * the GitHub tree to resolve each relative import to a `blob/` URL — are
   * injected via `fetchSource` and `resolveImports`.
   */
  const loadSource = React.useCallback<LoadSource>(
    (url) =>
      createLoadIsomorphicCodeSource({
        fetchSource: async (fetchUrl) => {
          const immutableUrl = await cache.toImmutableUrl(fetchUrl);
          return fetchSource(immutableUrl);
        },
        resolveImports: async (imports) => {
          // Resolve each relative import on the GitHub tree, then normalize
          // every result to a `blob/` URL so the framework can hand it back
          // to this same loader on the next recursion.
          const resolvedPathsMap = await resolveImportResult(imports, readDirectory);
          const resolvedBlobMap = new Map<string, string>();
          for (const [importUrl, resolvedUrl] of resolvedPathsMap) {
            resolvedBlobMap.set(
              importUrl,
              buildGitHubUrl({ ...parseGitHubUrl(resolvedUrl), kind: 'blob' }),
            );
          }
          return resolvedBlobMap;
        },
        removeCommentsWithPrefix: REMOVE_COMMENTS_WITH_PREFIX,
        notableCommentsPrefix: NOTABLE_COMMENTS_PREFIX,
      })(url),
    [cache, fetchSource, readDirectory],
  );

  return (
    // @focus-start
    <CodeProvider
      loadCodeMeta={loadCodeMeta}
      loadSource={loadSource}
      sourceEnhancers={SOURCE_ENHANCERS}
    >
      {children}
    </CodeProvider>
    // @focus-end
  );
}
