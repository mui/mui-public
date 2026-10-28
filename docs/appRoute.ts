// This module lives at the docs root, so the Next.js app-router root is its `app` directory.
// The route is derived by resolving a demo file against this captured root — not by searching the
// path for an `app` segment — so a route segment that is itself named `app` stays correct.
//
// It is kept self-contained (no `@mui/internal-docs-infra` import) on purpose: Playwright loads
// these test files with its own transpiler, which cannot resolve the workspace package's exports.
const APP_ROOT = new URL('./app/', import.meta.url).pathname;

/**
 * The public URL route of a demo, derived from the demo file's `import.meta.url`.
 *
 * The route is the file's containing directory relative to the app root, with Next.js route-group
 * segments (`(group)`) removed — those organize files without appearing in the URL. A file
 * directly in the app root resolves to `/`.
 */
export function appRoute(fileUrl: string): string {
  const dir = new URL('.', fileUrl).pathname;
  if (!dir.startsWith(APP_ROOT)) {
    throw new Error(`appRoute: "${fileUrl}" is not inside the app root "${APP_ROOT}".`);
  }

  const segments = dir
    .slice(APP_ROOT.length)
    .split('/')
    .filter((segment) => segment && !(segment.startsWith('(') && segment.endsWith(')')));

  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}
