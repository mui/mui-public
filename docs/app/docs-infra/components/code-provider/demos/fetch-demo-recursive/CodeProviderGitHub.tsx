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
  parseImportsAndComments,
  resolveModulePath,
  type DirectoryReader,
} from '@mui/internal-docs-infra/pipeline/loaderUtils';
import { buildGitHubUrl, createGitHubCache, parseGitHubUrl, type GitHubCache } from '../github';

export function CodeProviderGitHub({ children }: { children: React.ReactNode }) {
  // The cache lives for the lifetime of this component instance: a remount
  // resets every directory listing, file body and ref→SHA lookup.
  const cacheRef = React.useRef<GitHubCache | null>(null);
  if (cacheRef.current === null) {
    cacheRef.current = createGitHubCache();
  }
  const cache = cacheRef.current;

  // `resolveModulePath` walks the tree on demand: every directory it
  // touches is fetched once and reused, including 404s.
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

  // Resolves an extension-less module URL (e.g. `.../Foo`) to its real
  // blob URL (e.g. `.../Foo.tsx` or `.../Foo/index.tsx`).
  const resolveBlobUrl = React.useCallback(
    async (moduleUrl: string) => {
      const resolved = await resolveModulePath(moduleUrl, readDirectory);
      const importUrl = typeof resolved === 'string' ? resolved : resolved.import;
      return buildGitHubUrl({ ...parseGitHubUrl(importUrl), kind: 'blob' });
    },
    [readDirectory],
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
   * URL to a real file. The framework's `loadSource` then recursively
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
          code[variantName] = await resolveBlobUrl(variantUrl);
        }),
      );
      return code;
    },
    [cache, fetchSource, resolveBlobUrl],
  );

  /**
   * Fetches a single file, parses its imports, and resolves each relative
   * import on demand so the framework can recursively load the rest of
   * the demo.
   */
  const loadSource = React.useCallback<LoadSource>(
    async (url) => {
      const immutableUrl = await cache.toImmutableUrl(url);
      const source = await fetchSource(immutableUrl);
      const { relative } = await parseImportsAndComments(source, immutableUrl);

      const extraFiles: Record<string, string> = {};
      await Promise.all(
        Object.entries(relative).map(async ([importPath, info]) => {
          // Static assets (.css, .json, etc.) already include their
          // extension and don't need module resolution.
          const hasExtension = /\.[^/]+$/.test(info.url);
          extraFiles[importPath] = hasExtension
            ? buildGitHubUrl({ ...parseGitHubUrl(info.url), kind: 'blob' })
            : await resolveBlobUrl(info.url);
        }),
      );

      return { source, extraFiles };
    },
    [cache, fetchSource, resolveBlobUrl],
  );

  return (
    // @focus-start
    <CodeProvider loadCodeMeta={loadCodeMeta} loadSource={loadSource}>
      {children}
    </CodeProvider>
    // @focus-end
  );
}
