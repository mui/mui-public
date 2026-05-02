'use client';

import * as React from 'react';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';
import type {
  Code,
  Externals,
  LoadCodeMeta,
  LoadSource,
} from '@mui/internal-docs-infra/CodeHighlighter/types';
import { parseCreateFactoryCall } from '@mui/internal-docs-infra/pipeline/parseCreateFactoryCall';
import {
  IGNORE_COMMENT_PREFIXES,
  isJavaScriptModule,
  parseImportsAndComments,
  processRelativeImports,
  resolveImportResult,
  resolveModulePath,
  type DirectoryReader,
} from '@mui/internal-docs-infra/pipeline/loaderUtils';
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
   * URL to a real blob URL. The framework's `loadSource` then recursively
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
          code[variantName] = buildGitHubUrl({ ...parseGitHubUrl(importUrl), kind: 'blob' });
        }),
      );
      return code;
    },
    [cache, fetchSource, readDirectory],
  );

  /**
   * Fetches a single file, parses its imports, resolves them against the
   * GitHub tree, then defers to `processRelativeImports` to pick the
   * `extraFiles` keys (with conflict resolution) and rewrite the source.
   * The framework calls this recursively for every key in `extraFiles`.
   */
  const loadSource = React.useCallback<LoadSource>(
    async (url) => {
      const immutableUrl = await cache.toImmutableUrl(url);
      const rawSource = await fetchSource(immutableUrl);

      const {
        relative,
        externals: externalImports,
        code: strippedSource,
        comments,
      } = await parseImportsAndComments(rawSource, immutableUrl, {
        removeCommentsWithPrefix: REMOVE_COMMENTS_WITH_PREFIX,
        notableCommentsPrefix: NOTABLE_COMMENTS_PREFIX,
      });
      // `parseImportsAndComments` returns the comment-stripped source as `code`
      // when `removeCommentsWithPrefix` is set; fall back to the raw source when
      // it had no comments to remove.
      const source = strippedSource ?? rawSource;

      // Re-shape the per-import metadata into the simpler `Externals` record
      // the framework expects. We keep `name` / `type` / `isType` and drop the
      // position info that was only useful for source rewriting.
      const transformedExternals: Externals = {};
      for (const [modulePath, externalImport] of Object.entries(externalImports)) {
        transformedExternals[modulePath] = externalImport.names.map((importName) => ({
          name: importName.name,
          type: importName.type,
          isType: importName.isType,
        }));
      }
      const externals =
        Object.keys(transformedExternals).length > 0 ? transformedExternals : undefined;

      if (Object.keys(relative).length === 0) {
        return { source, comments, externals };
      }

      // `processRelativeImports` expects names as plain strings (alias-aware).
      const importsCompatible: Record<
        string,
        { url: string; names: string[]; positions: Array<{ start: number; end: number }> }
      > = {};
      for (const [importPath, { url: importUrl, names, positions }] of Object.entries(relative)) {
        importsCompatible[importPath] = {
          url: importUrl,
          names: names.map(({ name, alias }) => alias || name),
          positions,
        };
      }

      const isJsFile = isJavaScriptModule(immutableUrl);
      let resolvedBlobMap: Map<string, string> | undefined;
      let resolvedPathsMap: Map<string, string> | undefined;
      if (isJsFile) {
        // Resolve every relative import to its real blob URL on the GitHub tree.
        resolvedPathsMap = await resolveImportResult(importsCompatible, readDirectory);
        // Normalize to GitHub `blob/` URLs so the framework can hand them back
        // to this same `loadSource` to fetch.
        resolvedBlobMap = new Map();
        for (const [importUrl, resolvedUrl] of resolvedPathsMap) {
          resolvedBlobMap.set(
            importUrl,
            buildGitHubUrl({ ...parseGitHubUrl(resolvedUrl), kind: 'blob' }),
          );
        }
      }

      const { processedSource, extraFiles } = processRelativeImports(
        source,
        importsCompatible,
        'flat',
        isJsFile,
        resolvedBlobMap,
      );

      // Build the dependency list the framework uses to recursively call
      // `loadSource` for each imported file. For JS we use the resolved blob
      // URLs; for CSS the import URL is already a real path.
      const extraDependencies = isJsFile
        ? Object.values(relative)
            .map(({ url: importUrl }) => resolvedBlobMap?.get(importUrl))
            .filter((resolved): resolved is string => resolved !== undefined)
        : Object.values(relative).map(({ url: importUrl }) => importUrl);

      return {
        source: processedSource,
        extraFiles,
        extraDependencies: extraDependencies.length > 0 ? extraDependencies : undefined,
        externals,
        comments,
      };
    },
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
