import type { Externals } from '../../CodeHighlighter/types';

/**
 * Node.js built-in modules that should never appear in a client bundle.
 * Detection happens both with and without the `node:` prefix.
 */
const NODE_BUILTIN_MODULES = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'dns',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'sys',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

/**
 * Module specifiers that explicitly mark a module as server-only.
 * Currently this is the Next.js convention (`server-only` poisons client bundles
 * by throwing at build time).
 */
const SERVER_ONLY_MODULES = new Set(['server-only']);

/**
 * Returns true when `modulePath` is unambiguously a server-only module:
 *   - the literal `server-only` package
 *   - any `node:*` import
 *   - any unprefixed Node.js built-in (e.g. `fs`, `path`, `child_process`)
 */
export function isServerOnlyModule(modulePath: string): boolean {
  if (SERVER_ONLY_MODULES.has(modulePath)) {
    return true;
  }
  if (modulePath.startsWith('node:')) {
    return true;
  }
  return NODE_BUILTIN_MODULES.has(modulePath);
}

/**
 * Inspects collected externals and returns the list of module paths that are
 * server-only. An empty array means the demo's dependencies are safe to inline
 * into the client bundle.
 *
 * Pass the unfiltered externals (i.e. before `filterRuntimeExternals`) so that
 * side-effect imports like `import 'server-only';` — which have no bound names
 * and would otherwise be dropped — are still detected.
 */
export function findServerOnlyExternals(externals: Externals): string[] {
  const found: string[] = [];
  for (const modulePath of Object.keys(externals)) {
    if (isServerOnlyModule(modulePath)) {
      found.push(modulePath);
    }
  }
  return found;
}
